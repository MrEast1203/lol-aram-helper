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

  async scan(gameRect, { save, file } = {}) {
    if (!this.matcher) throw new Error('augment list not loaded');
    const s = this.settings.get();
    const rect = this.scanRect(gameRect);
    const res = await this.native.ocr(rect, s.ocrLang, { scale: s.ocrScale, save, file });
    const { offers, candidates } = detectOffers(this.matcher, res.lines, { minMatches: 1, rowTolerance: Math.round(gameRect.h * 0.03) });
    this.gameRect = gameRect;
    this.update(offers, s.minCardMatches);
    return { offers, candidates, lines: res.lines, ms: res.ms, rect };
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
