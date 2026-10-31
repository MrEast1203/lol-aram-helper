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
      toast: null,
      detector: { scans: 0, lastMs: null, lastError: null, lastScanAt: null },
      data: data.status(),
      history: this.loadHistory(),
    };
    this.liveFailures = 0;
    this.lastVersionCheck = 0;
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

    this.detector.on('offers', (offers) => this.patch({ offers: offers.map((o) => this.offerToView(o)) }));
    this.detector.on('picked', (id) => this.addPicked(id, true));

    this.input.on('tab', (down) => {
      if (this.sim) return;
      const fg = this.state.gameWindow?.foreground !== false;
      this.patch({ tabHeld: down && !!this.state.game && fg });
    });
    this.input.on('click', (x, y) => this.detector.onMouseDown(x, y));

    this.lcu.start();
    this.liveTimer = setInterval(() => this.liveTick(), 1500);
    this.windowTimer = setInterval(() => this.windowTick(), 1000);
    this.scheduleScan(1500);
    this.patch({ windowMode: this.lcu.readWindowMode() });
  }

  stop() {
    clearInterval(this.liveTimer);
    clearInterval(this.windowTimer);
    clearTimeout(this.scanTimer);
    this.lcu.stop();
  }

  // Set by main.js: converts physical screen px to overlay-relative DIP.
  offerToView(o) {
    const r = this.toOverlayRect ? this.toOverlayRect(o.box) : o.box;
    return { augmentId: o.augmentId, score: o.score, ...r };
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
          detected: game.picked,
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
      game: { gameId: 'sim', queueId: 2400, gameMode: 'KIWI', championId, alias: '', level: 3, isDead: false, gameTime: 0, items: [], picked: [3049], pending: 1, startedAt: Date.now() },
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

  // Keeps the latest raw Live Client response per game so we can verify whether Riot
  // exposes augments there (if it does, extractLiveAugments uses them instead of OCR).
  saveLiveSnapshot(all) {
    if (Date.now() - (this.lastSnapshot || 0) < 30000) return;
    this.lastSnapshot = Date.now();
    const dir = path.join(path.dirname(this.historyFile), 'live-snapshots');
    const name = `${this.state.game?.gameId || 'game'}.json`;
    fs.promises
      .mkdir(dir, { recursive: true })
      .then(() => fs.promises.writeFile(path.join(dir, name), JSON.stringify(all, null, 1)))
      .then(() => fs.promises.readdir(dir))
      .then((files) => Promise.all(files.sort().slice(0, -5).map((f) => fs.promises.rm(path.join(dir, f)))))
      .catch(() => {});
  }

  onLiveData(all) {
    if (!all?.activePlayer) return;
    this.saveLiveSnapshot(all);
    const gameTime = all.gameData?.gameTime || 0;
    // A lower game time than before means a different game (e.g. LCU was not connected).
    if (this.state.game && gameTime + 30 < this.state.game.gameTime) this.endGame();
    const { player, championId, alias } = this.resolveChampion(all);
    const level = all.activePlayer.level || player?.level || 1;
    const liveAugments = extractLiveAugments(all.activePlayer);
    if (!this.state.game) {
      this.detector.reset();
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
          picked: [],
          pending: 0,
          startedAt: Date.now(),
        },
      });
      this.patch({ windowMode: this.lcu.readWindowMode() });
      if (championId) this.data.getChampion(championId).catch(() => {});
    }
    const picked = liveAugments || this.state.game.picked;
    this.patchGame({
      championId: this.state.game.championId || championId,
      alias,
      level,
      isDead: !!player?.isDead,
      gameTime,
      gameMode: this.state.game.gameMode || all.gameData?.gameMode || null,
      items: (player?.items || []).map((i) => i.itemID),
      picked,
      pending: this.pendingScreens(level, picked.length),
    });
  }

  pendingScreens(level, pickedCount) {
    const reached = this.settings.get().augmentLevels.filter((l) => level >= l).length;
    return Math.max(0, reached - pickedCount);
  }

  endGame() {
    if (!this.state.game) return;
    this.detector.reset();
    this.patch({ game: null, offers: [], tabHeld: false, gameWindow: null });
  }

  addPicked(augmentId, fromDetector = false) {
    const game = this.state.game;
    if (!game || game.picked.includes(augmentId)) return;
    const picked = [...game.picked, augmentId];
    this.patchGame({ picked, pending: this.pendingScreens(game.level, picked.length) });
    const aug = this.data.tables?.augments.find((a) => a.id === augmentId);
    if (fromDetector) this.patch({ toast: { text: `已記錄海克斯：${aug?.name || augmentId}`, at: Date.now() } });
  }

  setPicked(ids) {
    const game = this.state.game;
    if (!game) return;
    const picked = ids.map(Number);
    this.patchGame({ picked, pending: this.pendingScreens(game.level, picked.length) });
  }

  // ---------- windows & scanning ----------

  async windowTick() {
    try {
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

  scheduleScan(ms) {
    clearTimeout(this.scanTimer);
    this.scanTimer = setTimeout(() => this.scanTick(), ms);
  }

  async scanTick() {
    const s = this.settings.get();
    const game = this.state.game;
    const win = this.state.gameWindow;
    const urgent = game && (game.pending > 0 || this.state.offers.length > 0);
    const interval = urgent ? s.scanFastMs : s.scanIdleMs;
    if (!game || !win || !win.foreground || !this.detector.matcher || !interval) return this.scheduleScan(1000);
    try {
      const r = await this.detector.scan(win, { file: this.sim });
      this.patch({ detector: { scans: this.state.detector.scans + 1, lastMs: r.ms, lastError: null, lastScanAt: Date.now(), lastOffers: r.offers.length } });
    } catch (e) {
      this.patch({ detector: { ...this.state.detector, lastError: e.message } });
    }
    this.scheduleScan(Math.max(250, interval));
  }

  // Manual OCR test from the dashboard: an image file, the game window, or the primary screen.
  // Uses a throwaway detector so a test never records picks for the running game.
  async testScan(fallbackRect, imagePath, { file, save } = {}) {
    if (!this.detector.matcher) throw new Error('海克斯資料尚未載入');
    let rect = fallbackRect;
    if (!file) {
      const w = await this.native.findWindow(GAME_WINDOW_CLASS, null).catch(() => ({ found: false }));
      if (w.found && w.w > 0) rect = { x: w.x, y: w.y, w: w.w, h: w.h };
    }
    const probe = new this.detector.constructor({ native: this.native, settings: this.settings, log: this.log });
    probe.matcher = this.detector.matcher;
    const r = await probe.scan(rect, { save, file });
    const names = new Map((this.data.tables?.augments || []).map((a) => [a.id, a.name]));
    return {
      rect: r.rect,
      ms: r.ms,
      saved: imagePath,
      lines: r.lines.map((l) => l.text),
      candidates: r.candidates.map((c) => ({ id: c.augmentId, name: names.get(c.augmentId), text: c.text, score: +c.score.toFixed(2) })),
      offers: r.offers.map((c) => ({ id: c.augmentId, name: names.get(c.augmentId) })),
    };
  }
}

// Future-proofing: use augments straight from the Live Client API if Riot ever exposes them.
function extractLiveAugments(activePlayer) {
  for (const [k, v] of Object.entries(activePlayer || {})) {
    if (!/augment/i.test(k) || !Array.isArray(v)) continue;
    const ids = v.map((x) => (typeof x === 'number' ? x : x?.id ?? x?.augmentId)).filter((x) => Number.isFinite(x) && x > 0);
    if (ids.length) return ids;
  }
  return null;
}

module.exports = { Controller, extractLiveAugments };
