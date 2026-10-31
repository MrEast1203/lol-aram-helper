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
  for (const a of augments) {
    const norm = normalize(a.name);
    if (norm.length < 2) continue;
    entries.push({ id: a.id, norm, len: norm.length });
    if (!exact.has(norm)) exact.set(norm, a.id);
  }
  return { entries, exact };
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
  const offers = best && best.items.length >= minMatches ? best.items : [];
  return { offers, candidates: cands };
}

module.exports = { normalize, levenshtein, buildMatcher, matchText, splitSegments, findCandidates, detectOffers };
