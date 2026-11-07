// OCR-based augment card reader, run on demand (F7 / the overlay button).
// Augment offers are never written to logs or exposed by the LCU or the Live Client
// API while the game runs, so the screen itself is read instead.
const { buildMatcher, detectOffers, findCandidates, splitSegments, normalize } = require('./matcher');

const centerX = (b) => b.x + b.w / 2;
// Distance between card centers as a fraction of the game height (the client scales
// its UI with height; 367 px at 1080p).
const CARD_SPACING = 0.34;

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
    let unknown = [];
    let cardRetries = 0;
    // Cards the strip missed are read again around their own column. Titles that are
    // read but match no augment are kept as unknown: most likely augments added in a
    // game patch the statistics don't cover yet.
    const complete = async () => {
      if (found.offers.length < 1 || found.offers.length > 2) return;
      const r = await this.readMissingCards(gameRect, rect, found.offers, res.lines, { lang: s.ocrLang, scale: s.ocrScale, file });
      cardRetries += r.tries;
      res = { lines: [...res.lines, ...r.lines], ms: res.ms + r.ms };
      if (r.lines.length) found = detectOffers(this.matcher, res.lines, opts);
      unknown = r.unknown.filter((u) => !found.offers.some((o) => Math.abs(centerX(o.box) - centerX(u.box)) < (o.box.w + u.box.w) / 2));
    };
    // A selection screen: at least one card matched, enough cards counting unknown ones.
    const enough = () => found.offers.length >= 1 && found.offers.length + unknown.length >= s.minCardMatches;
    if (row) {
      onProgress(0, 1);
      res = await this.native.ocr(rect, s.ocrLang, { scale: s.ocrScale, save, file, bands: [row], thresholds: [0, 180] });
      found = detectOffers(this.matcher, res.lines, opts);
      await complete();
      onProgress(1, 1);
    }
    if (!enough()) {
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
      await complete();
    }
    const ok = enough();
    const offers = ok ? found.offers : [];
    if (learn) this.learnTitleRow(gameRect, offers);
    return { offers, unknown: ok ? unknown : [], candidates: found.candidates, lines: res.lines, ms: res.ms, rect, swept, cardRetries };
  }

  // Windows OCR sometimes skips a title in the wide title strip: a short one (溢流), or a
  // faint one on a card that glows while hovered. It reads them in a narrow crop around
  // the card, but which crop works varies: centred bands suit the short titles, bands
  // starting just above the title (below our own badge) the faint ones.
  // With two cards found, the third card's column follows from their spacing. With one,
  // the others are where the title row shows more title-like text one or two card
  // spacings away (e.g. two augments new in this patch). Each column is read with these
  // crops in turn until one matches an augment name; a title that never matches (read
  // the same way twice) is returned as unknown.
  async readMissingCards(gameRect, rect, offers, lines, { lang, scale, file }) {
    const H = gameRect.h;
    const xs = offers.map((o) => centerX(o.box)).sort((x, y) => x - y);
    const cy = offers.reduce((sum, o) => sum + o.box.y + o.box.h / 2, 0) / offers.length;
    const th = offers.reduce((sum, o) => sum + o.box.h, 0) / offers.length;
    const out = { lines: [], ms: 0, tries: 0, unknown: [] };
    // Text shaped like a card title: on the title row, about as tall as the found titles.
    const titles = (ls) =>
      ls.flatMap(splitSegments).filter((seg) => Math.abs(seg.box.y + seg.box.h / 2 - cy) <= th * 0.7 && seg.box.h >= th * 0.6 && seg.box.h <= th * 1.7 && normalize(seg.text).length >= 2);
    let spacing;
    let columns;
    if (xs.length === 2) {
      const gap = xs[1] - xs[0];
      const middle = gap > H * CARD_SPACING * 1.5;
      spacing = middle ? gap / 2 : gap;
      columns = middle ? [xs[0] + spacing] : [xs[0] - spacing, xs[1] + spacing];
    } else {
      spacing = H * CARD_SPACING;
      const ks = new Set();
      for (const seg of titles(lines)) {
        const k = (centerX(seg.box) - xs[0]) / spacing;
        if (Math.round(k) && Math.abs(Math.round(k)) <= 2 && Math.abs(k - Math.round(k)) < 0.15) ks.add(Math.round(k));
      }
      if (ks.size < 2) return out;
      columns = [...ks].map((k) => xs[0] + k * spacing);
    }
    const need = 3 - xs.length;
    // Half-width (share of the card spacing), px above / below the title row, scale.
    const crops = [
      { hw: 0.33, up: 0.04 * H, down: 0.04 * H, scale: 1 },
      { hw: 0.33, up: 0.7 * th, down: 2.1 * th, scale: 1 },
      { hw: 0.41, up: 0.055 * H, down: 0.055 * H, scale: 1 },
      { hw: 0.41, up: 0.7 * th, down: 2.1 * th, scale: 2 },
      { hw: 0.33, up: 0.055 * H, down: 0.055 * H, scale: 1 },
      { hw: 0.33, up: 0.7 * th, down: 2.1 * th, scale: 2 },
    ];
    let done = 0;
    for (const cx of columns) {
      if (done >= need) break;
      const near = (seg) => Math.abs(centerX(seg.box) - cx) < spacing * 0.4;
      let seen = titles(lines).find(near) || null;
      let matched = false;
      for (const c of crops) {
        const hw = Math.round(spacing * c.hw);
        const x = Math.round(cx - hw);
        if (x < rect.x || x + 2 * hw > rect.x + rect.w) continue;
        const band = { y: Math.round(cy - rect.y - c.up), h: Math.round(c.up + c.down) };
        const r = await this.native.ocr({ x, y: rect.y, w: 2 * hw, h: rect.h }, lang, { scale: scale * c.scale, file, bands: [band], thresholds: [0] });
        out.ms += r.ms;
        out.tries++;
        if (findCandidates(this.matcher, r.lines).some((m) => Math.abs(m.box.y + m.box.h / 2 - cy) <= H * 0.03)) {
          out.lines.push(...r.lines);
          matched = true;
          break;
        }
        // The same unmatched title read twice: not an OCR slip, an augment not in the data.
        const read = titles(r.lines).find(near);
        if (read && seen && normalize(read.text) === normalize(seen.text)) break;
        seen ??= read || null;
      }
      if (matched) done++;
      else if (seen) {
        out.unknown.push(seen);
        done++;
      }
    }
    return out;
  }

  learnTitleRow(gameRect, offers) {
    const strong = offers.filter((o) => !o.inferred);
    if (strong.length < 1 || offers.length < 2 || !gameRect.h) return;
    const cy = strong.reduce((sum, o) => sum + o.box.y + o.box.h / 2, 0) / strong.length;
    const frac = +((cy - gameRect.y) / gameRect.h).toFixed(4);
    const prev = this.settings.get().titleRowY;
    if (prev == null || Math.abs(prev - frac) > 0.006) {
      this.settings.set({ titleRowY: frac });
      this.log.info(`[detector] title row learned at ${frac} (was ${prev})`);
    }
  }
}

module.exports = { AugmentDetector };
