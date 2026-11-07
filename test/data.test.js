// DataStore against a fake aramgg API: version checks, the credit log and the prefetch reserve.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DataStore } = require('../src/main/data');

const meta = (resource) => ({ dataVersion: '16.21.5', gamePatch: '16.21', resource });
const quiet = { info() {}, warn() {}, error() {} };

function setup(champions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aram-data-'));
  const loc = path.join(dir, 'zh-TW');
  fs.mkdirSync(path.join(loc, 'champions'), { recursive: true });
  const tables = { champions, augments: [], items: [], 'summoner-spells': [] };
  for (const [name, data] of Object.entries(tables)) fs.writeFileSync(path.join(loc, `${name}.json`), JSON.stringify({ meta: meta(name), data }));
  const values = { locale: 'zh-TW', apiKey: 'test-key', prefetch: true, prefetchReserve: 80 };
  return { dir, settings: { get: () => values } };
}

// Paid requests cost 2 credits, starting from `remaining`.
function fakeFetch(remaining) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    if (url.includes('ddragon')) return new Response(JSON.stringify(['16.22.1', '16.21.1']));
    if (url.endsWith('/config.json')) return new Response(JSON.stringify({ dataVersion: '16.21.5' }));
    const id = Number(/champions\/(\d+)\.json$/.exec(url)[1]);
    remaining -= 2;
    const headers = { 'x-credits-cost': '2', 'x-credits-remaining': String(remaining), 'x-credits-daily': '200', 'x-credits-used-today': String(200 - remaining) };
    return new Response(JSON.stringify({ meta: meta(`champions/${id}`), data: { champion: { id } } }), { headers });
  };
  fn.calls = calls;
  return fn;
}

test('an unchanged dataVersion spends nothing and reports the Riot patch', async () => {
  const { dir, settings } = setup([]);
  const store = new DataStore({ dir, settings, log: quiet });
  await store.init();
  global.fetch = fakeFetch(200);
  await store.checkVersion();
  const st = store.status();
  assert.equal(st.latestVersion, '16.21.5');
  assert.equal(st.riotPatch, '16.22');
  assert.equal(st.gamePatch, '16.21');
  assert.ok(st.lastCheck && !st.lastCheck.error);
  assert.ok(global.fetch.calls.every((u) => !u.includes('/champions')));
  assert.equal(store.creditLog.length, 0);
});

test('paid requests are logged with their reason and saved to disk', async () => {
  const { dir, settings } = setup([{ id: 266 }]);
  const store = new DataStore({ dir, settings, log: quiet });
  await store.init();
  global.fetch = fakeFetch(100);
  await store.getChampion(266, { reason: '選角：自己的英雄' });
  assert.deepEqual(
    { resource: store.creditLog[0].resource, reason: store.creditLog[0].reason, cost: store.creditLog[0].cost, remaining: store.creditLog[0].remaining },
    { resource: 'champions/266', reason: '選角：自己的英雄', cost: 2, remaining: 98 }
  );
  await new Promise((r) => setTimeout(r, 50));
  const reloaded = new DataStore({ dir, settings, log: quiet });
  await reloaded.init();
  assert.equal(reloaded.creditLog[0].resource, 'champions/266');
});

test('prefetch stops at the reserve and says why', async () => {
  const { dir, settings } = setup([{ id: 1, stats: { pickRate: 0.5 } }, { id: 2, stats: { pickRate: 0.4 } }]);
  const store = new DataStore({ dir, settings, log: quiet });
  await store.init();
  global.fetch = fakeFetch(82);
  await store.prefetch();
  assert.equal(store.creditLog.length, 1);
  assert.equal(store.creditLog[0].reason, '背景預載：未快取');
  assert.match(store.status().prefetchNote, /剩餘 80 credits，已到保留值 80；還有 1 位未快取、0 位舊資料待更新到 16.21.5/);
});
