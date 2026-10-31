// OCR-based augment card reader, run on demand (F7 / the overlay button).
// Augment offers are never written to logs or exposed by the LCU or the Live Client
// API while the game runs, so the screen itself is read instead.
const { buildMatcher, detectOffers } = require('./matcher');

class AugmentDetector {
  constructor({ native, settings, log = console }) {
    this.native = native;
    this.settings = settings;
    this.log = log;
    this.matcher = null;
  }

  setAugments(augments) {
    this.matcher = buildMatcher(augments || []);
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

  // Reads the learned title strip first (~30ms); sweeps the whole region only when
  // that finds too few cards. onProgress(done, total) follows each strip.
  async scan(gameRect, { save, file, learn = !file, onProgress = () => {} } = {}) {
    if (!this.matcher) throw new Error('augment list not loaded');
    const s = this.settings.get();
    const rect = this.scanRect(gameRect);
    const opts = { minMatches: 1, rowTolerance: Math.round(gameRect.h * 0.03) };
    const row = this.rowBand(gameRect, rect);
    const sweep = this.sweepBands(gameRect, rect);
    let res = { lines: [], ms: 0 };
    let found = { offers: [], candidates: [] };
    let swept = false;
    if (row) {
      onProgress(0, 1);
      res = await this.native.ocr(rect, s.ocrLang, { scale: s.ocrScale, save, file, bands: [row], thresholds: [0, 180] });
      found = detectOffers(this.matcher, res.lines, opts);
      onProgress(1, 1);
    }
    if (found.offers.length < s.minCardMatches) {
      const base = row ? 1 : 0;
      onProgress(base, base + sweep.length);
      const r = await this.native.ocr(rect, s.ocrLang, {
        scale: s.ocrScale,
        save: row ? undefined : save,
        file,
        bands: sweep,
        thresholds: [0],
        onProgress: (done) => onProgress(base + done, base + sweep.length),
      });
      res = { lines: [...res.lines, ...r.lines], ms: res.ms + r.ms };
      found = detectOffers(this.matcher, res.lines, opts);
      swept = true;
    }
    const offers = found.offers.length >= s.minCardMatches ? found.offers : [];
    if (learn) this.learnTitleRow(gameRect, offers);
    return { offers, candidates: found.candidates, lines: res.lines, ms: res.ms, rect, swept };
  }

  learnTitleRow(gameRect, offers) {
    const strong = offers.filter((o) => !o.inferred);
    if (strong.length < 1 || offers.length < 2 || !gameRect.h) return;
    const cy = strong.reduce((sum, o) => sum + o.box.y + o.box.h / 2, 0) / strong.length;
    const frac = +((cy - gameRect.y) / gameRect.h).toFixed(4);
    const prev = this.settings.get().titleRowY;
    if (prev == null || Math.abs(prev - frac) > 0.006) this.settings.set({ titleRowY: frac });
  }
}

module.exports = { AugmentDetector };
