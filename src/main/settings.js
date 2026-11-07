// Persistent user settings (userData/settings.json).
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const SETTINGS_VERSION = 5;
// Removed in v3: scanning is manual only and picks are no longer tracked.
const OBSOLETE = ['augmentLevels', 'autoScan', 'respawnScanMs', 'gameStartScanSec', 'scanSessionMs', 'scanFastMs', 'scanIdleMs', 'buildsShown'];

const DEFAULTS = {
  settingsVersion: SETTINGS_VERSION,
  apiKey: '',
  locale: 'zh-TW',
  ocrLang: 'zh-Hant-TW',
  installPath: 'C:\\Riot Games\\League of Legends',
  // Hotkeys (uiohook key names): scan the augment cards / hide their badges.
  scanHotkey: 'F7',
  hideHotkey: 'F8',
  // Clickable scan button on the in-game overlay.
  scanButton: true,
  scanButtonX: 0.004,
  scanButtonY: 0.36,
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
  tabPanelPos: {}, // {builds|guides: {x, y}} dragged top-left corner, as fractions of the game window
  // Build shown per champion: { [championId]: build tag }, picked in the build dropdown.
  buildChoice: {},
  hideFromCapture: true,
  champSelectPanel: true,
  // Off: closing the main window quits the app.
  closeToTray: false,
  prefetch: true,
  // Credits the background prefetch leaves for champ select and in-game lookups.
  prefetchReserve: 80,
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
      // v2: strip OCR. Drop scan values tuned for the old full-screen OCR.
      for (const k of ['scanRegion', 'ocrScale']) delete stored[k];
    }
    // v4: closing the window quits by default; the old saved default was hide-to-tray.
    if ((stored.settingsVersion || 1) < 4) delete stored.closeToTray;
    // v5: the prefetch reserve default went from 60 to 80; keep values the user changed.
    if ((stored.settingsVersion || 1) < 5 && stored.prefetchReserve === 60) delete stored.prefetchReserve;
    for (const k of OBSOLETE) delete stored[k];
    stored.settingsVersion = SETTINGS_VERSION;
    this.values = { ...DEFAULTS, ...stored, scanRegion: { ...DEFAULTS.scanRegion, ...(stored.scanRegion || {}) } };
    this.save();
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
