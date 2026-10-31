// Orchestrates LCU, Live Client Data, the OCR detector and global input into one
// app state that is pushed to every window.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { requestJson } = require('./http');

const LIVE_URL = 'https://127.0.0.1:2999/liveclientdata/allgamedata';
const NON_GAME_PHASES = new Set(['None', 'Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect', 'EndOfGame', 'PreEndOfGame', 'WaitingForStats']);
const GAME_WINDOW_CLASS = 'RiotWindowClass';
const CLIENT_WINDOW_CLASS = 'RCLIENT';

class Controller extends EventEmitter {
  constructor({ settings, data, lcu, native, detector, guides, input, historyFile, log = console }) {
    super();
    Object.assign(this, { settings, data, lcu, native, detector, guides, input, historyFile, log });
    this.state = {
      lcu: { connected: false, phase: null },
      windowMode: null,
      champSelect: null,
      game: null,
      offers: [],
      gameWindow: null,
      clientWindow: null,
      tabHeld: false,
      // Current/last manual scan: { active, progress, total, found, ms, error, at }
      scan: null,
      toast: null,
      detector: { scans: 0, lastMs: null, lastError: null, lastScanAt: null },
      data: data.status(),
      history: this.loadHistory(),
    };
    this.liveFailures = 0;
    this.lastVersionCheck = 0;
    this.windowTicks = 0;
    this.champSelectChampion = null;
  }

  // ---------- state plumbing ----------

  patch(p) {
    Object.assign(this.state, p);
    if (this.emitQueued) return;
    this.emitQueued = true;
    setImmediate(() => {
      this.emitQueued = false;
      this.emit('state', this.state);
    });
  }

  patchGame(p) {
    if (!this.state.game) return;
    this.patch({ game: { ...this.state.game, ...p } });
  }

  start() {
    this.lcu.on('connection', (connected) => this.patch({ lcu: { ...this.state.lcu, connected } }));
    this.lcu.on('phase', (phase, prev) => this.onPhase(phase, prev));
    this.lcu.on('champSelect', (s) => this.onChampSelect(s));
    this.lcu.on('gameSession', (s) => this.onGameSession(s));
    this.lcu.on('endOfGame', () => this.onEndOfGame());
    this.data.on('status', (st) => this.patch({ data: st }));
    this.data.on('tables', (t) => this.detector.setAugments(t.augments));
    if (this.data.tables) this.detector.setAugments(this.data.tables.augments);

    this.input.on('tab', (down) => {
      if (this.sim) return;
      const fg = this.state.gameWindow?.foreground !== false;
      this.patch({ tabHeld: down && !!this.state.game && fg });
    });
    this.input.on('hotkey', (action) => {
      if (!this.state.game || this.state.gameWindow?.foreground === false) return;
      if (action === 'scan') this.manualScan();
      if (action === 'hide') this.hideOffers();
    });

    this.lcu.start();
    this.liveTimer = setInterval(() => this.liveTick(), 1500);
    this.windowTimer = setInterval(() => this.windowTick(), 1000);
    this.patch({ windowMode: this.lcu.readWindowMode() });
  }

  stop() {
    clearInterval(this.liveTimer);
    clearInterval(this.windowTimer);
    this.lcu.stop();
  }

  // Set by main.js: converts physical screen px to overlay-relative DIP.
  offerToView(o) {
    const r = this.toOverlayRect ? this.toOverlayRect(o.box) : o.box;
    return { augmentId: o.augmentId, score: o.score, inferred: !!o.inferred, ...r };
  }

  // ---------- LCU ----------

  onPhase(phase, prev) {
    this.patch({ lcu: { connected: this.lcu.connected, phase } });
    if (phase === 'ChampSelect') {
      this.patch({ windowMode: this.lcu.readWindowMode() });
      if (Date.now() - this.lastVersionCheck > 10 * 60 * 1000) {
        this.lastVersionCheck = Date.now();
        this.data.checkVersion();
      }
    } else if (prev === 'ChampSelect') {
      this.patch({ champSelect: null });
    }
  }

  onChampSelect(session) {
    const me = (session.myTeam || []).find((p) => p.cellId === session.localPlayerCellId);
    const championId = me?.championId || me?.championPickIntent || 0;
    this.champSelectChampion = championId || this.champSelectChampion;
    this.patch({
      champSelect: {
        championId,
        bench: (session.benchChampions || []).map((b) => b.championId),
        benchEnabled: !!session.benchEnabled,
        team: (session.myTeam || []).map((p) => ({ championId: p.championId, isMe: p.cellId === session.localPlayerCellId })),
        spells: me ? [me.spell1Id, me.spell2Id] : [],
        timer: session.timer?.phase || null,
      },
    });
    if (championId) this.data.getChampion(championId).catch(() => {});
  }

  onGameSession(s) {
    const gameId = s?.gameData?.gameId || null;
    const queue = s?.gameData?.queue || {};
    if (this.state.game && gameId && this.state.game.gameId && this.state.game.gameId !== gameId) this.endGame();
    this.pendingSession = { gameId, queueId: queue.id || null, gameMode: queue.gameMode || s?.map?.gameMode || null };
    if (this.state.game) this.patchGame(this.pendingSession);
  }

  async onEndOfGame() {
    const game = this.state.game;
    this.endGame();
    if (!game?.gameId) return;
    // Match history needs a moment before the finished game shows up.
    for (const delay of [4000, 15000, 45000]) {
      await new Promise((r) => setTimeout(r, delay));
      try {
        const match = (await this.lcu.recentMatches(5)).find((m) => m.gameId === game.gameId);
        if (!match) continue;
        const stats = match.participants?.[0]?.stats || {};
        const augments = [1, 2, 3, 4, 5, 6].map((i) => stats['playerAugment' + i]).filter(Boolean);
        this.recordHistory({
          gameId: game.gameId,
          at: Date.now(),
          championId: match.participants?.[0]?.championId || game.championId,
          queueId: match.queueId,
          win: !!stats.win,
          augments,
        });
        return;
      } catch (e) {
        this.log.warn('[history]', e.message);
      }
    }
  }

  loadHistory() {
    try {
      return JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
    } catch {
      return [];
    }
  }

  recordHistory(entry) {
    const history = [entry, ...this.state.history.filter((h) => h.gameId !== entry.gameId)].slice(0, 100);
    fs.mkdirSync(path.dirname(this.historyFile), { recursive: true });
    fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 1));
    this.patch({ history });
  }

  // ---------- live game ----------

  // Dev preview (ARAM_SIM=<screenshot>): fakes a running game whose "screen" is the image.
  startSimulation(file, rect, { championId = 266, tab = false } = {}) {
    this.sim = file;
    this.patch({
      game: { gameId: 'sim', queueId: 2400, gameMode: 'KIWI', championId, alias: '', level: 3, isDead: false, gameTime: 0, items: [], startedAt: Date.now() },
      gameWindow: { ...rect, foreground: true },
      tabHeld: tab,
    });
  }

  async liveTick() {
    if (this.liveBusy || this.sim) return;
    if (this.lcu.connected && NON_GAME_PHASES.has(this.state.lcu.phase) && !this.state.game) return;
    this.liveBusy = true;
    try {
      const all = await requestJson(LIVE_URL, { timeout: 1200 });
      this.liveFailures = 0;
      this.onLiveData(all);
    } catch {
      if (this.state.game && ++this.liveFailures >= 4) this.endGame();
    } finally {
      this.liveBusy = false;
    }
  }

  resolveChampion(all) {
    const me = all.activePlayer || {};
    const players = all.allPlayers || [];
    const mine = players.find((p) => (me.riotId && p.riotId === me.riotId) || (me.summonerName && p.summonerName === me.summonerName)) || null;
    const alias = (mine?.rawChampionName || '').replace('game_character_displayname_', '');
    const champs = this.data.tables?.champions || [];
    const byAlias = champs.find((c) => c.alias.toLowerCase() === alias.toLowerCase());
    return { player: mine, championId: byAlias?.id || this.champSelectChampion || null, alias };
  }

  onLiveData(all) {
    if (!all?.activePlayer) return;
    const gameTime = all.gameData?.gameTime || 0;
    // A lower game time than before means a different game (e.g. LCU was not connected).
    if (this.state.game && gameTime + 30 < this.state.game.gameTime) this.endGame();
    const { player, championId, alias } = this.resolveChampion(all);
    const level = all.activePlayer.level || player?.level || 1;
    if (!this.state.game) {
      this.patch({
        game: {
          gameId: this.pendingSession?.gameId || null,
          queueId: this.pendingSession?.queueId || null,
          gameMode: this.pendingSession?.gameMode || all.gameData?.gameMode || null,
          championId,
          alias,
          level,
          isDead: false,
          gameTime,
          items: [],
          startedAt: Date.now(),
        },
      });
      this.patch({ windowMode: this.lcu.readWindowMode() });
      if (championId) this.data.getChampion(championId).catch(() => {});
    }
    this.patchGame({
      championId: this.state.game.championId || championId,
      alias,
      level,
      isDead: !!player?.isDead,
      gameTime,
      gameMode: this.state.game.gameMode || all.gameData?.gameMode || null,
      items: (player?.items || []).map((i) => i.itemID),
    });
  }

  endGame() {
    if (!this.state.game) return;
    this.patch({ game: null, offers: [], scan: null, tabHeld: false, gameWindow: null });
  }

  // ---------- windows & scanning ----------

  async windowTick() {
    try {
      // The window-mode warning must follow changes made in the game's settings.
      if (++this.windowTicks % 10 === 0) {
        const windowMode = this.lcu.readWindowMode();
        if (windowMode !== this.state.windowMode) this.patch({ windowMode });
      }
      if (this.state.game && !this.sim) {
        const w = await this.native.findWindow(GAME_WINDOW_CLASS, null);
        const gameWindow = w.found && !w.minimized && w.w > 0 ? { x: w.x, y: w.y, w: w.w, h: w.h, foreground: w.foreground } : null;
        if (JSON.stringify(gameWindow) !== JSON.stringify(this.state.gameWindow)) this.patch({ gameWindow });
      }
      if (this.state.champSelect) {
        const c = await this.native.findWindow(CLIENT_WINDOW_CLASS, null);
        const clientWindow = c.found && !c.minimized ? { ...c.outer, foreground: c.foreground } : null;
        if (JSON.stringify(clientWindow) !== JSON.stringify(this.state.clientWindow)) this.patch({ clientWindow });
      }
    } catch (e) {
      this.log.warn('[window]', e.message);
    }
  }

  // F7 / overlay button: one scan with live progress. The badges stay until the next
  // scan replaces them (e.g. after a reroll) or F8 hides them.
  async manualScan() {
    const win = this.state.gameWindow;
    if (!this.state.game || this.scanning) return;
    if (!win) return this.patch({ toast: { text: '找不到遊戲視窗', at: Date.now() } });
    if (!this.detector.matcher) return this.patch({ toast: { text: '海克斯資料尚未載入', at: Date.now() } });
    this.scanning = true;
    const startedAt = Date.now();
    this.patch({ scan: { active: true, progress: 0, total: 1, at: startedAt } });
    const save = this.sim ? undefined : this.debugScanPath();
    try {
      const r = await this.detector.scan(win, {
        file: this.sim,
        save,
        onProgress: (progress, total) => this.patch({ scan: { active: true, progress, total, at: startedAt } }),
      });
      if (save) this.writeScanLog(save, r);
      const ms = Date.now() - startedAt;
      this.patch({
        offers: r.offers.map((o) => this.offerToView(o)),
        scan: { active: false, found: r.offers.length, ms, at: Date.now() },
        detector: { ...this.state.detector, scans: this.state.detector.scans + 1, lastMs: ms, lastError: null, lastScanAt: Date.now() },
      });
    } catch (e) {
      this.patch({ scan: { active: false, error: e.message, at: Date.now() }, detector: { ...this.state.detector, lastError: e.message } });
    } finally {
      this.scanning = false;
    }
  }

  hideOffers() {
    this.patch({ offers: [], scan: null });
  }

  scanLogDir() {
    return path.join(path.dirname(this.historyFile), 'scans');
  }

  debugScanPath() {
    const dir = this.scanLogDir();
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(dir, `scan-${stamp}.png`);
  }

  // Saved next to the capture so detection problems can be diagnosed later. Keeps 10 scans.
  writeScanLog(pngPath, r) {
    const names = new Map((this.data.tables?.augments || []).map((a) => [a.id, a.name]));
    const log = {
      at: new Date().toISOString(),
      rect: r.rect,
      ms: r.ms,
      offers: r.offers.map((o) => ({ id: o.augmentId, name: names.get(o.augmentId), text: o.text, inferred: !!o.inferred, box: o.box })),
      lines: r.lines.map((l) => ({ text: l.text, box: l.words[0] && { x: l.words[0].x, y: l.words[0].y, h: l.words[0].h } })),
    };
    fs.promises
      .writeFile(pngPath.replace(/\.png$/, '.json'), JSON.stringify(log, null, 1))
      .then(() => fs.promises.readdir(this.scanLogDir()))
      .then((files) => {
        const pngs = files.filter((f) => f.endsWith('.png')).sort();
        return Promise.all(pngs.slice(0, -10).flatMap((f) => [f, f.replace(/\.png$/, '.json')].map((x) => fs.promises.rm(path.join(this.scanLogDir(), x), { force: true }))));
      })
      .catch(() => {});
  }

  // Manual OCR test from the dashboard: an image file, the game window, or the primary screen.
  // Results are only reported back, never shown on the overlay.
  async testScan(fallbackRect, imagePath, { file, save } = {}) {
    if (!this.detector.matcher) throw new Error('海克斯資料尚未載入');
    let rect = fallbackRect;
    let inGame = false;
    if (!file) {
      const w = await this.native.findWindow(GAME_WINDOW_CLASS, null).catch(() => ({ found: false }));
      if (w.found && w.w > 0) {
        rect = { x: w.x, y: w.y, w: w.w, h: w.h };
        inGame = true;
      }
    }
    const r = await this.detector.scan(rect, { save, file, learn: inGame });
    const names = new Map((this.data.tables?.augments || []).map((a) => [a.id, a.name]));
    return {
      rect: r.rect,
      ms: r.ms,
      saved: imagePath,
      lines: r.lines.map((l) => l.text),
      candidates: r.candidates.map((c) => ({ id: c.augmentId, name: names.get(c.augmentId), text: c.text, score: +c.score.toFixed(2) })),
      offers: r.offers.map((c) => ({ id: c.augmentId, name: names.get(c.augmentId), inferred: !!c.inferred, text: c.text })),
    };
  }
}

module.exports = { Controller };
