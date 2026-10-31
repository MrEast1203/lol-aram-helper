// aramgg data API client with an on-disk cache.
//
// Credit budget (free plan: 200/day) drives the caching policy:
//  - config.json is free: it is polled for `dataVersion` at startup and every 30 minutes.
//  - The 4 list tables (1 credit each) are refetched only when dataVersion changes.
//  - Champion details (2 credits each) are fetched on demand. A full sync would cost
//    4 + 173*2 = 350 credits, more than a day's quota, so the rest are prefetched in the
//    background (most-picked first) while keeping `prefetchReserve` credits for on-demand use.
//  - An older cached version is always served as a fallback when fetching fails.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { EventEmitter } = require('events');

const BASE = 'https://data.dtodo.cn/api/v1';
const TABLES = ['champions', 'augments', 'items', 'summoner-spells'];
const CHAMPION_COST = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const utcDay = () => new Date().toISOString().slice(0, 10);

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
    this.error = null;
    this.loading = false;
    this.prefetching = false;
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
    await this.loadTablesFromDisk();
    this.emitStatus();
  }

  status() {
    const credits = this.creditsNow();
    return {
      dataVersion: this.tables?.dataVersion || null,
      gamePatch: this.tables?.gamePatch || null,
      latestVersion: this.latestVersion,
      hasApiKey: !!this.settings.get().apiKey,
      credits,
      error: this.error,
      loading: this.loading,
      prefetching: this.prefetching,
      cachedChampions: [...this.champions.values()].filter((c) => c.dataVersion === this.currentVersion()).length,
    };
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

  async request(resource) {
    const key = this.settings.get().apiKey;
    if (!key) throw Object.assign(new Error('尚未設定 API Key'), { code: 'NO_API_KEY' });
    const res = await fetch(`${BASE}/${this.locale}/${resource}.json`, { headers: { 'x-api-key': key } });
    this.updateCredits(res.headers);
    if (!res.ok) {
      const msg = res.status === 401 ? 'API Key 無效' : res.status === 429 ? '今日額度已用完或請求過快' : `HTTP ${res.status}`;
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
    try {
      const res = await fetch(`${BASE}/${this.locale}/config.json`);
      const cfg = await res.json();
      this.latestVersion = cfg.dataVersion;
    } catch (e) {
      this.log.warn('[data] config.json failed', e.message);
      if (!this.tables) this.error = '無法連線到資料伺服器';
      this.emitStatus();
      return;
    }
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
        fresh[name] = await this.request(name);
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

  // Returns { dataVersion, data, stale } or null. `fetch: false` never spends credits.
  async getChampion(id, { fetch: allowFetch = true } = {}) {
    id = Number(id);
    if (!id) return null;
    const cur = this.currentVersion();
    const cached = this.champions.get(id);
    if (cached && cached.dataVersion === cur) return { ...cached, stale: false };
    if (!allowFetch) return cached ? { ...cached, stale: true } : null;
    if (this.inflight.has(id)) return this.inflight.get(id);
    const p = (async () => {
      try {
        const j = await this.request(`champions/${id}`);
        const entry = { dataVersion: j.meta.dataVersion, fetchedAt: Date.now(), data: j.data };
        this.champions.set(id, entry);
        await fsp.writeFile(this.champFile(id), JSON.stringify(entry));
        this.emit('champion', id);
        return { ...entry, stale: false };
      } catch (e) {
        this.log.warn('[data] champion', id, e.message);
        if (cached) return { ...cached, stale: true, error: e.message };
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
    try {
      const order = [...this.tables.champions].sort((a, b) => (b.stats?.pickRate || 0) - (a.stats?.pickRate || 0));
      for (const c of order) {
        const s = this.settings.get();
        if (!s.prefetch) break;
        const credits = this.creditsNow();
        if (credits && credits.remaining - CHAMPION_COST < s.prefetchReserve) break;
        const cached = this.champions.get(c.id);
        if (cached && cached.dataVersion === this.currentVersion()) continue;
        try {
          await this.getChampion(c.id);
        } catch (e) {
          if (e.status === 429 || e.status === 401 || e.code === 'NO_API_KEY') break;
        }
        await sleep(2500); // stay well under the 60 req/min limit
      }
    } finally {
      this.prefetching = false;
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
