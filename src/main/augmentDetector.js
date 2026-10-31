// OCR-based augment selection detector.
// Augment offers/picks are never written to logs or exposed by the LCU while the game
// runs (only post-game `playerAugment1..6`), so the screen itself is read instead.
// A pick is inferred from the last mouse click on a card column before the screen closes.
const { EventEmitter } = require('events');
const { buildMatcher, detectOffers } = require('./matcher');

class AugmentDetector extends EventEmitter {
  constructor({ native, settings, log = console }) {
    super();
    this.native = native;
    this.settings = settings;
    this.log = log;
    this.matcher = null;
    this.reset();
  }

  setAugments(augments) {
    this.matcher = buildMatcher(augments || []);
  }

  reset() {
    this.offers = [];
    this.lastSeen = 0;
    this.missCount = 0;
    this.lastClick = null;
    this.gameRect = null;
  }

  scanRect(gameRect) {
    const r = this.settings.get().scanRegion;
    return {
      x: Math.round(gameRect.x + gameRect.w * r.x),
      y: Math.round(gameRect.y + gameRect.h * r.y),
      w: Math.round(gameRect.w * r.w),
      h: Math.round(gameRect.h * r.h),
    };
  }

  // Overlapping horizontal strips covering the scan region (Windows OCR misses
  // text on the full busy screen but reads it reliably strip by strip).
  sweepBands(gameRect, rect) {
    const bandH = Math.max(80, Math.round(gameRect.h * 0.1));
    const step = Math.round(bandH * 0.55);
    const bands = [];
    for (let y = 0; y < rect.h; y += step) {
      bands.push({ y, h: Math.min(bandH, rect.h - y) });
      if (y + bandH >= rect.h) break;
    }
    return bands;
  }

  // One strip around the title row learned from an earlier detection.
  rowBand(gameRect, rect) {
    const titleRowY = this.settings.get().titleRowY;
    if (titleRowY == null) return null;
    const bandH = Math.max(70, Math.round(gameRect.h * 0.08));
    const y = Math.round(gameRect.y + gameRect.h * titleRowY - bandH / 2 - rect.y);
    return y >= 0 && y + bandH <= rect.h ? { y, h: bandH } : null;
  }

  // `thorough` sweeps the whole region; otherwise only the learned title row is read.
  async scan(gameRect, { save, file, thorough = false, learn = !file } = {}) {
    if (!this.matcher) throw new Error('augment list not loaded');
    const s = this.settings.get();
    const rect = this.scanRect(gameRect);
    const opts = { minMatches: 1, rowTolerance: Math.round(gameRect.h * 0.03) };
    const row = this.rowBand(gameRect, rect);
    let res = { lines: [], ms: 0 };
    let found = { offers: [], candidates: [] };
    if (row) {
      res = await this.native.ocr(rect, s.ocrLang, { scale: s.ocrScale, save, file, bands: [row], thresholds: [0, 180] });
      found = detectOffers(this.matcher, res.lines, opts);
    }
    const enough = found.offers.length >= Math.min(3, s.minCardMatches + 1);
    if (!row || (thorough && !enough)) {
      const sweep = await this.native.ocr(rect, s.ocrLang, { scale: s.ocrScale, save: row ? undefined : save, file, bands: this.sweepBands(gameRect, rect), thresholds: [0] });
      res = { lines: [...res.lines, ...sweep.lines], ms: res.ms + sweep.ms };
      found = detectOffers(this.matcher, res.lines, opts);
      this.lastSweep = Date.now();
    }
    this.gameRect = gameRect;
    if (learn) this.learnTitleRow(gameRect, found.offers);
    this.update(found.offers, s.minCardMatches);
    return { offers: found.offers, candidates: found.candidates, lines: res.lines, ms: res.ms, rect, swept: !row || thorough };
  }

  learnTitleRow(gameRect, offers) {
    const strong = offers.filter((o) => !o.inferred);
    if (strong.length < 1 || offers.length < 2 || !gameRect.h) return;
    const cy = strong.reduce((sum, o) => sum + o.box.y + o.box.h / 2, 0) / strong.length;
    const frac = +((cy - gameRect.y) / gameRect.h).toFixed(4);
    const prev = this.settings.get().titleRowY;
    if (prev == null || Math.abs(prev - frac) > 0.006) this.settings.set({ titleRowY: frac });
  }

  update(found, minMatches) {
    const now = Date.now();
    const prevIds = this.offers.map((o) => o.augmentId);
    const overlap = found.some((o) => prevIds.includes(o.augmentId));
    if (found.length >= minMatches) {
      // All-new titles right after a screen means the next pending screen opened.
      if (this.offers.length && !overlap) this.resolve(now);
      this.offers = found;
      this.lastSeen = now;
      this.missCount = 0;
    } else if (this.offers.length && found.length && overlap) {
      // Partially covered (tooltip, cursor) but clearly the same screen.
      this.lastSeen = now;
      this.missCount = 0;
    } else if (this.offers.length) {
      if (++this.missCount >= 2) this.resolve(now);
    } else {
      return;
    }
    this.emit('offers', this.offers);
  }

  resolve(now) {
    const click = this.lastClick;
    if (click && now - click.time < 8000) {
      const offer = this.columnAt(click.x);
      if (offer) this.emit('picked', offer.augmentId);
    }
    this.offers = [];
    this.lastClick = null;
    this.missCount = 0;
  }

  columnAt(x) {
    if (!this.offers.length) return null;
    const xs = this.offers.map((o) => o.box.x + o.box.w / 2);
    const spacing = xs.length > 1 ? (xs[xs.length - 1] - xs[0]) / (xs.length - 1) : (this.gameRect?.w || 1920) * 0.2;
    let best = null;
    this.offers.forEach((o, i) => {
      const d = Math.abs(x - xs[i]);
      if (d < spacing * 0.55 && (!best || d < best.d)) best = { o, d };
    });
    return best?.o || null;
  }

  // Physical screen coordinates from the global mouse hook.
  onMouseDown(x, y) {
    if (!this.offers.length) return;
    const h = this.gameRect?.h || 1080;
    const titleY = this.offers[0].box.y;
    const inCardBand = y > titleY - h * 0.4 && y < titleY + h * 0.32;
    this.lastClick = inCardBand && this.columnAt(x) ? { x, y, time: Date.now() } : null;
  }
}

module.exports = { AugmentDetector };
