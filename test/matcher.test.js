const test = require('node:test');
const assert = require('node:assert');
const { buildMatcher, detectOffers, normalize, matchText } = require('../src/main/matcher');
const { AugmentDetector } = require('../src/main/augmentDetector');
const { matchingGuides } = require('../src/main/guides');

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

test('detector records the clicked card when the screen closes', async () => {
  const settings = mockSettings();
  let lines = [line('泰坦的決意', 400, 500), line('裝甲衝擊', 850, 500), line('侵蝕裝甲', 1300, 500)];
  const native = { ocr: async () => ({ lines, ms: 1 }) };
  const det = new AugmentDetector({ native, settings });
  det.setAugments(AUGS);
  const picked = [];
  det.on('picked', (id) => picked.push(id));
  const rect = { x: 0, y: 0, w: 1920, h: 1080 };
  await det.scan(rect);
  assert.equal(det.offers.length, 3);
  det.onMouseDown(890, 450); // click on the middle card
  lines = [];
  await det.scan(rect);
  assert.deepEqual(picked, []); // one miss is not enough (flicker)
  await det.scan(rect);
  assert.deepEqual(picked, [3049]);
  assert.equal(det.offers.length, 0);
});

test('reroll keeps the same screen; next screen resolves the previous pick', async () => {
  const settings = mockSettings();
  let lines = [line('泰坦的決意', 400, 500), line('裝甲衝擊', 850, 500), line('侵蝕裝甲', 1300, 500)];
  const det = new AugmentDetector({ native: { ocr: async () => ({ lines, ms: 1 }) }, settings });
  det.setAugments(AUGS);
  const picked = [];
  det.on('picked', (id) => picked.push(id));
  const rect = { x: 0, y: 0, w: 1920, h: 1080 };
  await det.scan(rect);
  lines = [line('泰坦的決意', 400, 500), line('衝鋒', 870, 500), line('侵蝕裝甲', 1300, 500)]; // rerolled middle
  await det.scan(rect);
  assert.deepEqual(picked, []);
  det.onMouseDown(420, 400); // pick the left card
  lines = [line('亮起來！', 400, 500), line('巨人', 870, 500), line('質變：稜鏡', 1300, 500)]; // next pending screen
  await det.scan(rect);
  assert.deepEqual(picked, [1001]);
  assert.equal(det.offers.length, 3);
});

test('clicking outside the cards (hide button) records nothing', async () => {
  const settings = mockSettings();
  let lines = [line('泰坦的決意', 400, 500), line('裝甲衝擊', 850, 500)];
  const det = new AugmentDetector({ native: { ocr: async () => ({ lines, ms: 1 }) }, settings });
  det.setAugments(AUGS);
  const picked = [];
  det.on('picked', (id) => picked.push(id));
  const rect = { x: 0, y: 0, w: 1920, h: 1080 };
  await det.scan(rect);
  det.onMouseDown(900, 1000); // far below the cards
  lines = [];
  await det.scan(rect);
  await det.scan(rect);
  assert.deepEqual(picked, []);
});

test('helper.ps1 is ASCII-only (PowerShell 5.1 reads BOM-less scripts as the ANSI codepage)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/main/helper.ps1'), 'utf8');
  assert.ok(!/[^\x00-\x7F]/.test(src));
});

test('guide matching by augment and champion', () => {
  const guides = [
    { id: 'a', enabled: true, augmentIds: [3049], championIds: [], items: [1029] },
    { id: 'b', enabled: true, augmentIds: [3049], championIds: [266], items: [] },
    { id: 'c', enabled: true, augmentIds: [], championIds: [17], items: [] },
    { id: 'd', enabled: false, augmentIds: [3049], championIds: [], items: [] },
  ];
  assert.deepEqual(
    matchingGuides(guides, 266, [3049]).map((g) => g.id),
    ['a', 'b']
  );
  assert.deepEqual(
    matchingGuides(guides, 17, []).map((g) => g.id),
    ['c']
  );
  assert.deepEqual(matchingGuides(guides, 17, [1001]).map((g) => g.id), ['c']);
});
