// Every UI string passed to t() (and every credit-log reason) needs an English entry.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const EN = JSON.parse(read('src/locales/en.json'));

const SOURCES = [
  'src/renderer/dashboard.js',
  'src/renderer/overlay.js',
  'src/renderer/champselect.js',
  'src/renderer/buildview.js',
  'src/renderer/common.js',
  'src/main/main.js',
  'src/main/controller.js',
  'src/main/data.js',
];

function uiStrings() {
  const keys = new Set();
  for (const f of SOURCES) {
    const s = read(f);
    for (const m of s.matchAll(/\bt\(\s*'([^'\n]*)'/g)) keys.add(m[1]);
    // prefetch notes are [text, args] pairs translated later
    for (const m of s.matchAll(/note = \[\s*'([^'\n]*)'/g)) keys.add(m[1]);
    // credit-log reasons and their categories (the part before "：")
    for (const m of s.matchAll(/'((?:背景預載|資料表|選角|遊戲中|選角面板|主視窗)：[^'\n]*)'/g)) {
      keys.add(m[1]);
      keys.add(m[1].split('：')[0]);
    }
  }
  for (const f of ['src/renderer/dashboard.html', 'src/renderer/champselect.html']) {
    const s = read(f);
    for (const m of s.matchAll(/data-i18n>([^<]*)</g)) keys.add(m[1].trim());
    for (const m of s.matchAll(/title="([^"]*)" data-i18n-title/g)) keys.add(m[1]);
  }
  keys.add('其他');
  return keys;
}

test('every UI string has an English translation', () => {
  const missing = [...uiStrings()].filter((k) => !(k in EN));
  assert.deepEqual(missing, []);
});

test('translations keep the same placeholders', () => {
  const ph = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const bad = Object.entries(EN).filter(([zh, en]) => ph(zh) !== ph(en));
  assert.deepEqual(bad, []);
});

test('t() falls back to Chinese and fills placeholders', () => {
  const i18n = require('../src/main/i18n');
  i18n.setLang('zh-TW');
  assert.equal(i18n.t('已預載 {n} 位英雄', { n: 3 }), '已預載 3 位英雄');
  i18n.setLang('en');
  assert.equal(i18n.t('已預載 {n} 位英雄', { n: 3 }), EN['已預載 {n} 位英雄'].replace('{n}', '3'));
  assert.equal(i18n.t('沒有這個字串'), '沒有這個字串');
  assert.equal(i18n.resolveLang('auto', 'zh-TW'), 'zh-TW');
  assert.equal(i18n.resolveLang('auto', 'en-US'), 'en');
  assert.equal(i18n.resolveLang('en', 'zh-TW'), 'en');
  i18n.setLang('zh-TW');
});
