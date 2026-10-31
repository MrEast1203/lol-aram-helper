const test = require('node:test');
const assert = require('node:assert');
const { buildMatcher, detectOffers, normalize, matchText } = require('../src/main/matcher');
const { AugmentDetector } = require('../src/main/augmentDetector');
const { guidesForChampion } = require('../src/main/guides');

const AUGS = [
  { id: 1001, name: '泰坦的決意', rarityName: 'prismatic' },
  { id: 3049, name: '裝甲衝擊', rarityName: 'gold' },
  { id: 1028, name: '侵蝕裝甲', rarityName: 'silver' },
  { id: 1030, name: '亮起來！', rarityName: 'gold' },
  { id: 1040, name: '質變：稜鏡', rarityName: 'gold' },
  { id: 1050, name: '衝鋒', rarityName: 'silver' },
  { id: 1060, name: '巨人', rarityName: 'gold' },
  { id: 1070, name: '蠻力重擊', rarityName: 'silver' },
  { id: 1080, name: '急救箱', rarityName: 'silver' },
];
const matcher = buildMatcher(AUGS);

function mockSettings(extra = {}) {
  let v = { scanRegion: { x: 0, y: 0, w: 1, h: 1 }, ocrLang: 'x', ocrScale: 1, minCardMatches: 2, titleRowY: null, ...extra };
  return { get: () => v, set: (p) => (v = { ...v, ...p }) };
}

// Windows OCR returns CJK text as one "word" per character.
function line(text, x, y, ch = 22) {
  const words = [...text].map((t, i) => ({ t, x: x + i * (ch + 2), y, w: ch, h: ch }));
  return { text: [...text].join(' '), words };
}

test('normalize strips spaces and punctuation, folds full-width', () => {
  assert.equal(normalize('亮 起 來 ！'), '亮起來');
  assert.equal(normalize('質變：稜鏡'), '質變稜鏡');
});

test('exact and fuzzy matches', () => {
  assert.equal(matchText(matcher, '裝 甲 衝 擊').id, 3049);
  assert.equal(matchText(matcher, '泰坦的決薏').id, 1001); // one OCR error in 5 chars
  assert.equal(matchText(matcher, '衝鋒').id, 1050); // 2-char names need exact
  assert.equal(matchText(matcher, '衝峰'), null);
  // Long description lines must not match a short name inside them.
  assert.equal(matchText(matcher, '獲得巨人效果並提升體型與生命值'), null);
});

test('detects three cards in one row, sorted by x', () => {
  const lines = [line('侵蝕裝甲', 1300, 500), line('泰坦的決意', 400, 502), line('裝甲衝擊', 850, 498), line('受到傷害時獲得層數', 400, 560)];
  const { offers } = detectOffers(matcher, lines, { minMatches: 2 });
  assert.deepEqual(
    offers.map((o) => o.augmentId),
    [1001, 3049, 1028]
  );
});

test('splits a merged OCR line into card titles', () => {
  const a = line('泰坦的決意', 400, 500);
  const b = line('裝甲衝擊', 850, 500);
  const merged = { text: a.text + ' ' + b.text, words: [...a.words, ...b.words] };
  const { offers } = detectOffers(matcher, [merged], { minMatches: 2 });
  assert.deepEqual(
    offers.map((o) => o.augmentId),
    [1001, 3049]
  );
});

test('row completion fills garbled titles from the same rarity', () => {
  // Only the middle title reads cleanly; the others have OCR errors too heavy for strict matching.
  const lines = [line('衝峰', 400, 500), line('侵蝕裝甲', 850, 500), line('急救稻', 1300, 502), line('對敵方英雄造成傷害時', 800, 560)];
  const { offers } = detectOffers(matcher, lines, { minMatches: 2 });
  assert.deepEqual(
    offers.map((o) => [o.augmentId, !!o.inferred]),
    [
      [1050, true],
      [1028, false],
      [1080, true],
    ]
  );
});

test('row completion ignores other rarities and ambiguous text', () => {
  // '巨入' (garbled gold 巨人) is not offered from the silver pool; 'xx' matches nothing.
  const lines = [line('巨入', 400, 500), line('侵蝕裝甲', 850, 500), line('xx', 1300, 500)];
  const { offers } = detectOffers(matcher, lines, { minMatches: 1 });
  assert.deepEqual(
    offers.map((o) => o.augmentId),
    [1028]
  );
});

test('detector learns the title row and then reads only that strip', async () => {
  const settings = mockSettings();
  const calls = [];
  const lines = [line('泰坦的決意', 400, 500), line('裝甲衝擊', 850, 500), line('侵蝕裝甲', 1300, 500)];
  const native = { ocr: async (rect, lang, opts) => (calls.push(opts.bands.length), { lines, ms: 1 }) };
  const det = new AugmentDetector({ native, settings });
  det.setAugments(AUGS);
  const rect = { x: 0, y: 0, w: 1920, h: 1080 };
  await det.scan(rect);
  assert.ok(calls[0] > 1, 'first scan sweeps several strips');
  assert.ok(Math.abs(settings.get().titleRowY - 511 / 1080) < 0.01);
  await det.scan(rect);
  assert.equal(calls[1], 1, 'then only the title strip');
});

test('a single stray match is not a selection screen', () => {
  const { offers } = detectOffers(matcher, [line('裝甲衝擊', 850, 500)], { minMatches: 2 });
  assert.equal(offers.length, 0);
});

test('scan reports progress per strip and falls back to a sweep', async () => {
  const settings = mockSettings({ titleRowY: 0.3 }); // stale row: nothing there
  const good = [line('泰坦的決意', 400, 500), line('裝甲衝擊', 850, 500), line('侵蝕裝甲', 1300, 500)];
  const native = {
    ocr: async (rect, lang, opts) => {
      if (opts.bands.length === 1) return { lines: [], ms: 1 };
      opts.bands.forEach((_, i) => opts.onProgress(i + 1));
      return { lines: good, ms: 1 };
    },
  };
  const det = new AugmentDetector({ native, settings });
  det.setAugments(AUGS);
  const seen = [];
  const r = await det.scan({ x: 0, y: 0, w: 1920, h: 1080 }, { onProgress: (done, total) => seen.push([done, total]) });
  assert.equal(r.offers.length, 3);
  assert.ok(r.swept);
  const last = seen[seen.length - 1];
  assert.equal(last[0], last[1], 'progress ends at 100%');
  assert.ok(seen.every(([d, t]) => d <= t));
  assert.ok(Math.abs(settings.get().titleRowY - 511 / 1080) < 0.01, 'row re-learned');
});

test('helper.ps1 is ASCII-only (PowerShell 5.1 reads BOM-less scripts as the ANSI codepage)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/main/helper.ps1'), 'utf8');
  assert.ok(!/[^\x00-\x7F]/.test(src));
});

test('guides are shown per champion regardless of augments', () => {
  const guides = [
    { id: 'a', enabled: true, augmentIds: [3049], championIds: [], items: [1029] },
    { id: 'b', enabled: true, augmentIds: [3049], championIds: [266], items: [] },
    { id: 'c', enabled: true, augmentIds: [], championIds: [17], items: [] },
    { id: 'd', enabled: false, augmentIds: [3049], championIds: [], items: [] },
  ];
  assert.deepEqual(
    guidesForChampion(guides, 266).map((g) => g.id),
    ['a', 'b']
  );
  assert.deepEqual(
    guidesForChampion(guides, 17).map((g) => g.id),
    ['a', 'c']
  );
});

test('champion details stay valid across data releases of one game patch', async () => {
  const { DataStore } = require('../src/main/data');
  const ds = new DataStore({ dir: require('os').tmpdir(), settings: { get: () => ({ locale: 'zh-TW', apiKey: '' }) } });
  ds.latestVersion = '16.21.5';
  ds.champions.set(266, { dataVersion: '16.21.4', data: { champion: { id: 266 } } });
  ds.champions.set(17, { dataVersion: '16.20.9', data: { champion: { id: 17 } } });
  // Same patch: served from cache without any request (there is no API key here).
  assert.equal((await ds.getChampion(266)).stale, false);
  assert.equal((await ds.getChampion(17, { fetch: false })).stale, true);
  const st = ds.status();
  assert.equal(st.cachedChampions, 1);
  assert.equal(st.totalCachedChampions, 2);
});
