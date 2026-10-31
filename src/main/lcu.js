// League Client (LCU) connector: finds credentials via the lockfile (or the
// LeagueClientUx.exe command line) and polls gameflow / champ select state.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { requestJson } = require('./http');

const PRODUCT_SETTINGS = 'C:\\ProgramData\\Riot Games\\Metadata\\league_of_legends.live\\league_of_legends.live.product_settings.yaml';

function readLockfile(dir) {
  try {
    const [, , port, password, protocol] = fs.readFileSync(path.join(dir, 'lockfile'), 'utf8').trim().split(':');
    if (port && password) return { port: Number(port), password, protocol };
  } catch {}
  return null;
}

function riotInstallDir() {
  try {
    const m = fs.readFileSync(PRODUCT_SETTINGS, 'utf8').match(/product_install_full_path:\s*"?([^"\r\n]+)"?/);
    if (m) return m[1].trim().replace(/\//g, '\\');
  } catch {}
  return null;
}

class LcuClient extends EventEmitter {
  constructor({ native, settings, log = console }) {
    super();
    this.native = native;
    this.settings = settings;
    this.log = log;
    this.creds = null;
    this.installDir = null;
    this.phase = null;
    this.connected = false;
    this.lastDiscover = 0;
    this.busy = false;
    this.lastSessionJson = '';
    this.gameSession = null;
  }

  async discover() {
    const dirs = [this.installDir, this.settings.get().installPath, riotInstallDir(), 'C:\\Riot Games\\League of Legends'].filter(Boolean);
    for (const dir of dirs) {
      const creds = readLockfile(dir);
      if (creds) {
        this.installDir = dir;
        return creds;
      }
    }
    try {
      const p = await this.native.lcuProcess();
      if (!p.found) return null;
      const port = /--app-port=(\d+)/.exec(p.commandLine)?.[1];
      const password = /--remoting-auth-token=([\w-]+)/.exec(p.commandLine)?.[1];
      if (p.path) this.installDir = path.dirname(p.path);
      if (port && password) return { port: Number(port), password };
    } catch (e) {
      this.log.warn('[lcu] process lookup failed', e.message);
    }
    return null;
  }

  req(method, p, body) {
    if (!this.creds) return Promise.reject(new Error('LCU not connected'));
    return requestJson(`https://127.0.0.1:${this.creds.port}${p}`, { method, body, auth: `riot:${this.creds.password}`, timeout: 4000 });
  }

  start() {
    this.timer = setInterval(() => this.tick(), 1000);
    this.tick();
  }
  stop() {
    clearInterval(this.timer);
  }

  setConnected(v) {
    if (this.connected === v) return;
    this.connected = v;
    if (!v) this.setPhase(null);
    this.emit('connection', v);
  }

  setPhase(phase) {
    if (this.phase === phase) return;
    const prev = this.phase;
    this.phase = phase;
    this.emit('phase', phase, prev);
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.creds) {
        if (Date.now() - this.lastDiscover < 5000) return;
        this.lastDiscover = Date.now();
        this.creds = await this.discover();
        if (!this.creds) return this.setConnected(false);
      }
      const phase = await this.req('GET', '/lol-gameflow/v1/gameflow-phase');
      this.setConnected(true);
      const prev = this.phase;
      this.setPhase(phase);

      if (phase === 'ChampSelect') {
        const session = await this.req('GET', '/lol-champ-select/v1/session').catch(() => null);
        const json = JSON.stringify(session);
        if (session && json !== this.lastSessionJson) {
          this.lastSessionJson = json;
          this.emit('champSelect', session);
        }
      } else {
        this.lastSessionJson = '';
      }

      if ((phase === 'InProgress' || phase === 'GameStart' || phase === 'Reconnect') && (prev !== phase || !this.gameSession)) {
        this.gameSession = await this.req('GET', '/lol-gameflow/v1/session').catch(() => null);
        if (this.gameSession) this.emit('gameSession', this.gameSession);
      }
      if (phase === 'Lobby' || phase === 'None' || phase === 'ChampSelect') this.gameSession = null;

      if ((phase === 'EndOfGame' || phase === 'PreEndOfGame') && prev !== phase) {
        const eog = await this.req('GET', '/lol-end-of-game/v1/eog-stats-block').catch(() => null);
        this.emit('endOfGame', eog);
      }
    } catch (e) {
      if (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.status === 401) {
        this.creds = null;
        this.setConnected(false);
      } else {
        this.log.warn('[lcu]', e.message);
      }
    } finally {
      this.busy = false;
    }
  }

  // Last N match-history games (used to back-fill augments after a game).
  async recentMatches(count = 5) {
    const j = await this.req('GET', `/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=${count}`);
    return j?.games?.games || [];
  }

  applySpells(spell1Id, spell2Id) {
    return this.req('PATCH', '/lol-champ-select/v1/session/my-selection', { spell1Id, spell2Id });
  }

  gameConfigPath() {
    return path.join(this.installDir || this.settings.get().installPath, 'Config', 'game.cfg');
  }

  // WindowMode: 0 = fullscreen, 1 = windowed, 2 = borderless.
  readWindowMode() {
    try {
      const m = fs.readFileSync(this.gameConfigPath(), 'utf8').match(/^\s*WindowMode\s*=\s*(\d)/m);
      return m ? Number(m[1]) : null;
    } catch {
      return null;
    }
  }
}

module.exports = { LcuClient };
