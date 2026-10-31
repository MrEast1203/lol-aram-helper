// Persistent user settings (userData/settings.json).
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const SETTINGS_VERSION = 2;

const DEFAULTS = {
  settingsVersion: SETTINGS_VERSION,
  apiKey: '',
  locale: 'zh-TW',
  ocrLang: 'zh-Hant-TW',
  installPath: 'C:\\Riot Games\\League of Legends',
  // Levels at which ARAM Mayhem offers an augment screen.
  augmentLevels: [3, 7, 11, 15],
  // Augment screens only open while the shop is usable (dead, or in the fountain
  // after respawning / at game start), so auto scans are limited to those moments.
  autoScan: true,
  respawnScanMs: 25000,
  gameStartScanSec: 90,
  // Manual scan: hotkey (uiohook key name) and a clickable button on the overlay.
  scanHotkey: 'F7',
  scanButton: true,
  scanButtonX: 0.004,
  scanButtonY: 0.36,
  scanSessionMs: 20000,
  scanFastMs: 1000,
  scanIdleMs: 0,
  ocrScale: 1,
  // Fraction of the game window that is OCR'd for augment cards.
  scanRegion: { x: 0.05, y: 0.15, w: 0.9, h: 0.65 },
  // Learned vertical position (fraction of game height) of the card title row.
  titleRowY: null,
  minCardMatches: 2,
  badgeOffsetY: 6,
  tabPanelSide: 'right',
  tabPanelWidth: 380,
  tabPanelTop: 90,
  buildsShown: 2,
  hideFromCapture: true,
  champSelectPanel: true,
  closeToTray: true,
  prefetch: true,
  prefetchReserve: 60,
};

function readEnvKey(dirs) {
  for (const dir of dirs) {
    try {
      const txt = fs.readFileSync(path.join(dir, '.env'), 'utf8');
      const m = txt.match(/^\s*ARAMGG_API_KEY\s*=\s*(\S+)/m);
      if (m) return m[1].trim();
    } catch {}
  }
  return '';
}

class Settings extends EventEmitter {
  constructor(file, envDirs = []) {
    super();
    this.file = file;
    let stored = {};
    try {
      stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {}
    if ((stored.settingsVersion || 1) < 2) {
      // v2: strip OCR, death-gated scanning. Drop scan values tuned for the old full-screen OCR.
      for (const k of ['scanRegion', 'scanIdleMs', 'ocrScale']) delete stored[k];
      stored.settingsVersion = SETTINGS_VERSION;
    }
    this.values = { ...DEFAULTS, ...stored, scanRegion: { ...DEFAULTS.scanRegion, ...(stored.scanRegion || {}) } };
    if (stored.settingsVersion !== undefined) this.save();
    if (!this.values.apiKey) {
      const key = readEnvKey(envDirs);
      if (key) {
        this.values.apiKey = key;
        this.save();
      }
    }
  }

  get() {
    return this.values;
  }

  set(patch) {
    this.values = { ...this.values, ...patch };
    this.save();
    this.emit('change', this.values, patch);
    return this.values;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
  }
}

module.exports = { Settings, DEFAULTS };
