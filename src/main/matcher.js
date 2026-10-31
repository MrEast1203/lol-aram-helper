// Fuzzy matching of OCR output against augment names, and detection of the
// augment selection screen (2+ card titles side by side on one row).

function normalize(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function buildMatcher(augments) {
  const entries = [];
  const exact = new Map();
  const byId = new Map();
  for (const a of augments) {
    const norm = normalize(a.name);
    if (norm.length < 2) continue;
    const e = { id: a.id, norm, len: norm.length, rarity: a.rarityName || null };
    entries.push(e);
    byId.set(a.id, e);
    if (!exact.has(norm)) exact.set(norm, a.id);
  }
  return { entries, exact, byId };
}

// Best augment for one text segment, or null.
function matchText(matcher, text) {
  const t = normalize(text);
  if (t.length < 2) return null;
  const hit = matcher.exact.get(t);
  if (hit != null) return { id: hit, score: 1 };
  let best = null;
  for (const e of matcher.entries) {
    let score = 0;
    if (e.len >= 3 && t.includes(e.norm) && e.len / t.length >= 0.6) {
      score = 0.92;
    } else if (e.len >= 4 && Math.abs(e.len - t.length) <= 2) {
      const sim = 1 - levenshtein(t, e.norm) / Math.max(e.len, t.length);
      const need = e.len >= 5 ? 0.7 : 0.75;
      if (sim >= need) score = sim * 0.9;
    }
    if (score && (!best || score > best.score)) best = { id: e.id, score };
  }
  return best;
}

function unionBox(words) {
  const x1 = Math.min(...words.map((w) => w.x));
  const y1 = Math.min(...words.map((w) => w.y));
  const x2 = Math.max(...words.map((w) => w.x + w.w));
  const y2 = Math.max(...words.map((w) => w.y + w.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// Windows OCR may merge titles of neighbouring cards into one line; split on wide gaps.
function splitSegments(line) {
  const words = [...(line.words || [])].sort((a, b) => a.x - b.x);
  if (!words.length) return [];
  const hs = words.map((w) => w.h).sort((a, b) => a - b);
  const gapLimit = Math.max(hs[Math.floor(hs.length / 2)] * 1.8, 12);
  const segs = [[words[0]]];
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    if (words[i].x - (prev.x + prev.w) > gapLimit) segs.push([]);
    segs[segs.length - 1].push(words[i]);
  }
  return segs.map((ws) => ({ text: ws.map((w) => w.t).join(' '), box: unionBox(ws) }));
}

function findCandidates(matcher, lines) {
  const out = [];
  for (const line of lines || []) {
    for (const seg of splitSegments(line)) {
      const m = matchText(matcher, seg.text);
      if (m) out.push({ augmentId: m.id, score: m.score, text: seg.text, box: seg.box });
    }
  }
  return out;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const centerX = (b) => b.x + b.w / 2;

// All cards on one screen share a rarity. Once some titles are matched, other text
// segments on the same title row are matched loosely against that rarity only.
function completeRow(matcher, lines, strong, { maxCards = 3 } = {}) {
  if (!strong.length || strong.length >= maxCards) return strong;
  const th = median(strong.map((o) => o.box.h));
  const rowY = strong.reduce((s, o) => s + o.box.y + o.box.h / 2, 0) / strong.length;
  const counts = new Map();
  for (const o of strong) {
    const r = matcher.byId.get(o.augmentId)?.rarity;
    counts.set(r, (counts.get(r) || 0) + 1);
  }
  const rarity = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const taken = new Set(strong.map((o) => o.augmentId));
  const pool = matcher.entries.filter((e) => e.rarity === rarity && !taken.has(e.id));
  const guesses = [];
  for (const line of lines || []) {
    for (const seg of splitSegments(line)) {
      const cy = seg.box.y + seg.box.h / 2;
      if (Math.abs(cy - rowY) > th * 0.7 || seg.box.h < th * 0.6 || seg.box.h > th * 1.7) continue;
      const t = normalize(seg.text);
      if (!t) continue;
      let best = null;
      let second = null;
      for (const e of pool) {
        const sim = 1 - levenshtein(t, e.norm) / Math.max(t.length, e.len);
        if (!best || sim > best.sim) [best, second] = [{ id: e.id, sim }, best];
        else if (!second || sim > second.sim) second = { id: e.id, sim };
      }
      if (best && best.sim >= 0.5 && (!second || best.sim - second.sim >= 0.15)) guesses.push({ augmentId: best.id, score: best.sim * 0.8, text: seg.text, box: seg.box, inferred: true });
    }
  }
  const result = [...strong];
  // Best guesses first; one augment per card column.
  for (const g of guesses.sort((a, b) => b.score - a.score)) {
    if (result.length >= maxCards || taken.has(g.augmentId)) continue;
    if (result.some((o) => Math.abs(centerX(o.box) - centerX(g.box)) < th * 4)) continue;
    result.push(g);
    taken.add(g.augmentId);
  }
  return result.sort((a, b) => a.box.x - b.box.x);
}

// Group candidates into rows; the selection screen is the row with the most distinct augments.
function detectOffers(matcher, lines, { minMatches = 2, rowTolerance = 30 } = {}) {
  const cands = findCandidates(matcher, lines);
  const rows = [];
  for (const c of cands) {
    const cy = c.box.y + c.box.h / 2;
    const row = rows.find((r) => Math.abs(r.cy - cy) <= Math.max(rowTolerance, c.box.h * 1.5));
    if (row) row.items.push(c);
    else rows.push({ cy, items: [c] });
  }
  let best = null;
  for (const r of rows) {
    const byId = new Map();
    for (const c of r.items) if (!byId.has(c.augmentId) || byId.get(c.augmentId).score < c.score) byId.set(c.augmentId, c);
    const items = [...byId.values()].sort((a, b) => a.box.x - b.box.x);
    const total = items.reduce((s, c) => s + c.score, 0);
    if (!best || items.length > best.items.length || (items.length === best.items.length && total > best.total)) best = { items, total };
  }
  const items = best ? completeRow(matcher, lines, best.items) : [];
  const offers = items.length >= minMatches ? items : [];
  return { offers, candidates: cands };
}

module.exports = { normalize, levenshtein, buildMatcher, matchText, splitSegments, findCandidates, completeRow, detectOffers };
