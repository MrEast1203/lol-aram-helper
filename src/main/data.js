// aramgg data API client with an on-disk cache.
//
// Credit budget (free plan: 200/day) drives the caching policy:
//  - config.json is free: it is polled for `dataVersion` at startup and every 30 minutes.
//  - The 4 list tables (1 credit each) are refetched only when dataVersion changes.
//  - Champion details (2 credits each) are fetched on demand and stay valid for the whole
//    game patch, so a new data release (16.21.4 -> 16.21.5) does not throw them away.
//    A full sync would cost 4 + 173*2 = 350 credits, more than a day's quota, so missing
//    champions (then same-patch refreshes) are prefetched in the background, most-picked
//    first, while keeping `prefetchReserve` credits for on-demand use.
//  - Cached files are never deleted on update; an older patch is served as a fallback.
//  - Every paid request is recorded in credit-log.json (shown on the dashboard) and app.log.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter } = require('events');
const { t } = require('./i18n');

const BASE = 'https://data.dtodo.cn/api/v1';
// Riot's public patch list, only to tell the player when aramgg is behind the game.
const DDRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';
const TABLES = ['champions', 'augments', 'items', 'summoner-spells'];
const CHAMPION_COST = 2;
const CREDIT_LOG_MAX = 300;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const utcDay = () => new Date().toISOString().slice(0, 10);
// "16.21.5" -> "16.21"
const patchOf = (v) => String(v || '').split('.').slice(0, 2).join('.');

class DataStore extends EventEmitter {
  constructor({ dir, settings, log = console }) {
    super();
    this.dir = dir;
    this.settings = settings;
    this.log = log;
    this.tables = null; // { dataVersion, gamePatch, champions, augments, items, spells }
    this.champions = new Map(); // id -> { dataVersion, fetchedAt, data }
    this.inflight = new Map();
    this.latestVersion = null;
    this.credits = null; // { remaining, daily, usedToday, day }
    this.creditLog = []; // newest first: { at, resource, reason, cost, remaining, status }
    this.lastCheck = null; // { at, error } (error untranslated)
    this.riotPatch = null; // latest live patch from Data Dragon, e.g. "16.22"
    this.error = null;
    this.loading = false;
    this.checking = false;
    this.prefetching = false;
    this.prefetchNote = null; // why the last prefetch stopped: [text, args] for t()
  }

  get locale() {
    return this.settings.get().locale;
  }
  localeDir() {
    return path.join(this.dir, this.locale);
  }

  async init() {
    await fsp.mkdir(path.join(this.localeDir(), 'champions'), { recursive: true });
    try {
      this.credits = JSON.parse(await fsp.readFile(path.join(this.dir, 'credits.json'), 'utf8'));
    } catch {}
    try {
      this.creditLog = JSON.parse(await fsp.readFile(path.join(this.dir, 'credit-log.json'), 'utf8'));
    } catch {}
    await this.loadTablesFromDisk();
    this.emitStatus();
  }

  status() {
    const credits = this.creditsNow();
    return {
      dataVersion: this.tables?.dataVersion || null,
      gamePatch: this.tables?.gamePatch || null,
      latestVersion: this.latestVersion,
      riotPatch: this.riotPatch,
      lastCheck: this.lastCheck && { ...this.lastCheck, error: this.lastCheck.error && t(this.lastCheck.error) },
      hasApiKey: !!this.settings.get().apiKey,
      credits,
      creditLogAt: this.creditLog[0]?.at || null,
      error: this.error,
      loading: this.loading,
      checking: this.checking,
      prefetching: this.prefetching,
      prefetchNote: this.prefetchNote && t(...this.prefetchNote),
      cachedChampions: [...this.champions.values()].filter((c) => this.usable(c)).length,
      latestChampions: [...this.champions.values()].filter((c) => c.dataVersion === this.currentVersion()).length,
      totalCachedChampions: this.champions.size,
    };
  }

  // { [championId]: dataVersion } of every cached champion, for the champion list.
  cacheIndex() {
    return Object.fromEntries([...this.champions].map(([id, e]) => [id, e.dataVersion]));
  }

  // Champion details stay valid for the whole game patch (16.21.x); a new data
  // release only refreshes them in the background with spare credits.
  usable(entry) {
    const cur = this.currentVersion();
    return !!entry && !!cur && patchOf(entry.dataVersion) === patchOf(cur);
  }

  emitStatus() {
    this.emit('status', this.status());
  }

  currentVersion() {
    return this.latestVersion || this.tables?.dataVersion || null;
  }

  creditsNow() {
    if (!this.credits) return null;
    // Quota resets at UTC 00:00.
    if (this.credits.day !== utcDay()) return { ...this.credits, remaining: this.credits.daily, usedToday: 0, day: utcDay(), estimated: true };
    return this.credits;
  }

  updateCredits(headers) {
    const remaining = headers.get('x-credits-remaining');
    if (remaining == null) return;
    this.credits = {
      remaining: Number(remaining),
      daily: Number(headers.get('x-credits-daily')),
      usedToday: Number(headers.get('x-credits-used-today')),
      day: utcDay(),
    };
    fsp.writeFile(path.join(this.dir, 'credits.json'), JSON.stringify(this.credits)).catch(() => {});
  }

  recordCredits(resource, reason, res) {
    const cost = res.headers.get('x-credits-cost');
    const entry = {
      at: Date.now(),
      resource,
      reason,
      cost: cost == null ? null : Number(cost),
      remaining: this.credits?.remaining ?? null,
      status: res.status,
    };
    this.creditLog.unshift(entry);
    this.creditLog.length = Math.min(this.creditLog.length, CREDIT_LOG_MAX);
    fsp.writeFile(path.join(this.dir, 'credit-log.json'), JSON.stringify(this.creditLog)).catch(() => {});
    this.log.info(`[credits] -${entry.cost ?? '?'} ${resource} (${reason}) HTTP ${res.status}, ${entry.remaining ?? '?'} left`);
  }

  async request(resource, reason = '') {
    const key = this.settings.get().apiKey;
    if (!key) throw Object.assign(new Error(t('尚未設定 API Key')), { code: 'NO_API_KEY' });
    const res = await fetch(`${BASE}/${this.locale}/${resource}.json`, { headers: { 'x-api-key': key } });
    this.updateCredits(res.headers);
    this.recordCredits(resource, reason, res);
    if (!res.ok) {
      const msg = res.status === 401 ? t('API Key 無效') : res.status === 429 ? t('今日額度已用完或請求過快') : `HTTP ${res.status}`;
      throw Object.assign(new Error(`${msg} (${resource})`), { status: res.status });
    }
    return res.json();
  }

  // ---------- tables ----------

  tableFile(name) {
    return path.join(this.localeDir(), `${name}.json`);
  }

  async loadTablesFromDisk() {
    const loaded = {};
    for (const name of TABLES) {
      try {
        loaded[name] = JSON.parse(await fsp.readFile(this.tableFile(name), 'utf8'));
      } catch {
        return;
      }
    }
    this.setTables(loaded);
    for (const f of await fsp.readdir(path.join(this.localeDir(), 'champions')).catch(() => [])) {
      try {
        const entry = JSON.parse(await fsp.readFile(path.join(this.localeDir(), 'champions', f), 'utf8'));
        this.champions.set(entry.data.champion.id, entry);
      } catch {}
    }
  }

  setTables(t) {
    const meta = t.champions.meta;
    this.tables = {
      dataVersion: meta.dataVersion,
      gamePatch: meta.gamePatch,
      champions: t.champions.data,
      augments: t.augments.data,
      items: t.items.data,
      spells: t['summoner-spells'].data,
    };
    this.emit('tables', this.tables);
  }

  async checkVersion() {
    if (this.checking) return;
    this.checking = true;
    this.emitStatus();
    const [cfg, riot] = await Promise.allSettled([
      fetch(`${BASE}/${this.locale}/config.json`).then((r) => r.json()),
      fetch(DDRAGON_VERSIONS).then((r) => r.json()),
    ]);
    this.checking = false;
    if (riot.status === 'fulfilled' && Array.isArray(riot.value)) this.riotPatch = patchOf(riot.value[0]);
    if (!cfg.value?.dataVersion) {
      this.log.warn('[data] config.json failed', cfg.reason?.message || 'no dataVersion');
      this.lastCheck = { at: Date.now(), error: '無法連線到資料伺服器' };
      if (!this.tables) this.error = t('無法連線到資料伺服器');
      this.emitStatus();
      return;
    }
    this.latestVersion = cfg.value.dataVersion;
    this.lastCheck = { at: Date.now(), error: null };
    this.log.info(`[data] version check: aramgg ${this.latestVersion}, local ${this.tables?.dataVersion || '-'}, Riot patch ${this.riotPatch || '-'}`);
    if (this.tables?.dataVersion !== this.latestVersion) await this.refreshTables();
    else this.emitStatus();
    this.prefetch();
  }

  async refreshTables() {
    if (this.loading) return;
    this.loading = true;
    this.error = null;
    this.emitStatus();
    try {
      await fsp.mkdir(path.join(this.localeDir(), 'champions'), { recursive: true });
      const fresh = {};
      for (const name of TABLES) {
        // Reuse a table already saved at this version (e.g. after a partial failure).
        let cached = null;
        try {
          cached = JSON.parse(await fsp.readFile(this.tableFile(name), 'utf8'));
        } catch {}
        if (cached && cached.meta.dataVersion === this.latestVersion) {
          fresh[name] = cached;
          continue;
        }
        fresh[name] = await this.request(name, '資料表：新版本');
        await fsp.writeFile(this.tableFile(name), JSON.stringify(fresh[name]));
      }
      this.setTables(fresh);
      this.log.info('[data] tables updated to', this.tables.dataVersion);
    } catch (e) {
      this.error = e.message;
      this.log.warn('[data] table refresh failed', e.message);
    } finally {
      this.loading = false;
      this.emitStatus();
    }
  }

  // ---------- champion details ----------

  champFile(id) {
    return path.join(this.localeDir(), 'champions', `${id}.json`);
  }

  // Returns { dataVersion, data, stale } or null; `stale` means an older game patch.
  // `fetch: false` never spends credits; `refresh` refetches a same-patch entry.
  // `reason` labels the request in the credit log.
  async getChampion(id, { fetch: allowFetch = true, refresh = false, reason = '' } = {}) {
    id = Number(id);
    if (!id) return null;
    const cached = this.champions.get(id);
    if (this.usable(cached) && !refresh) return { ...cached, stale: false };
    if (!allowFetch) return cached ? { ...cached, stale: !this.usable(cached) } : null;
    if (this.inflight.has(id)) return this.inflight.get(id);
    const p = (async () => {
      try {
        const j = await this.request(`champions/${id}`, reason);
        const entry = { dataVersion: j.meta.dataVersion, fetchedAt: Date.now(), data: j.data };
        this.champions.set(id, entry);
        await fsp.writeFile(this.champFile(id), JSON.stringify(entry));
        this.emit('champion', id);
        return { ...entry, stale: false };
      } catch (e) {
        this.log.warn('[data] champion', id, e.message);
        if (cached) return { ...cached, stale: !this.usable(cached), error: e.message };
        throw e;
      } finally {
        this.inflight.delete(id);
        this.emitStatus();
      }
    })();
    this.inflight.set(id, p);
    return p;
  }

  async prefetch() {
    if (this.prefetching || !this.tables || !this.settings.get().prefetch || !this.settings.get().apiKey) return;
    this.prefetching = true;
    this.emitStatus();
    // Notes and credit-log reasons stay Chinese here and are translated for display.
    let note = ['全部英雄都已是最新資料'];
    try {
      const version = this.currentVersion();
      const byPick = [...this.tables.champions].sort((a, b) => (b.stats?.pickRate || 0) - (a.stats?.pickRate || 0));
      // Missing (or older-patch) champions first, then same-patch refreshes to the newest release.
      const missing = byPick.filter((c) => !this.usable(this.champions.get(c.id)));
      const outdated = byPick.filter((c) => this.usable(this.champions.get(c.id)) && this.champions.get(c.id).dataVersion !== version);
      const todo = [...missing.map((c) => [c, '背景預載：未快取']), ...outdated.map((c) => [c, '背景預載：更新舊資料'])];
      if (!todo.length) return;
      this.log.info(`[data] prefetch: ${missing.length} missing, ${outdated.length} older than ${version}`);
      note = ['已預載 {n} 位英雄', { n: todo.length }];
      for (const [i, [c, reason]] of todo.entries()) {
        const s = this.settings.get();
        if (!s.prefetch) {
          note = ['背景預載已關閉'];
          break;
        }
        const credits = this.creditsNow();
        if (credits && credits.remaining - CHAMPION_COST < s.prefetchReserve) {
          const leftMissing = Math.max(0, missing.length - i);
          note = [
            '剩餘 {left} credits，已到保留值 {reserve}；還有 {missing} 位未快取、{outdated} 位舊資料待更新到 {version}，額度在 UTC 00:00 重置後繼續。',
            { left: credits.remaining, reserve: s.prefetchReserve, missing: leftMissing, outdated: todo.length - i - leftMissing, version },
          ];
          break;
        }
        try {
          await this.getChampion(c.id, { refresh: true, reason });
        } catch (e) {
          if (e.status === 429 || e.status === 401 || e.code === 'NO_API_KEY') {
            note = ['預載中止：{error}', { error: e.message }];
            break;
          }
        }
        await sleep(2500); // stay well under the 60 req/min limit
      }
      this.log.info('[data] prefetch stopped:', t(...note));
    } finally {
      this.prefetching = false;
      this.prefetchNote = note;
      this.emitStatus();
    }
  }

  // Drops in-memory data, e.g. after switching locale, then reloads from disk.
  async clearMemory() {
    this.tables = null;
    this.latestVersion = null;
    this.champions.clear();
    await this.init();
  }

  async clearCache() {
    await fsp.rm(this.localeDir(), { recursive: true, force: true });
    await this.clearMemory();
  }
}

module.exports = { DataStore };
