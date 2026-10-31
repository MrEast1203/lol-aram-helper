// Persistent user settings (userData/settings.json).
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const DEFAULTS = {
  apiKey: '',
  locale: 'zh-TW',
  ocrLang: 'zh-Hant-TW',
  installPath: 'C:\\Riot Games\\League of Legends',
  // Levels at which ARAM Mayhem offers an augment screen.
  augmentLevels: [3, 7, 11, 15],
  // OCR scan cadence while a screen is (probably) pending / otherwise. 0 disables idle scans.
  scanFastMs: 1000,
  scanIdleMs: 3000,
  ocrScale: 1,
  // Fraction of the game window that is OCR'd for augment cards.
  scanRegion: { x: 0.08, y: 0.1, w: 0.84, h: 0.72 },
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
    this.values = { ...DEFAULTS, ...stored, scanRegion: { ...DEFAULTS.scanRegion, ...(stored.scanRegion || {}) } };
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
