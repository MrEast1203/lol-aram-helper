const test = require('node:test');
const assert = require('node:assert');
const { LcuClient } = require('../src/main/lcu');

const quiet = { info() {}, warn() {} };
const SESSION = { localPlayerCellId: 0, myTeam: [{ cellId: 0, championId: 266 }], benchChampions: [] };
const err = (code) => Object.assign(new Error(code), { code });

// A client whose answers are scripted per tick: a value, or an error to throw.
function scripted(steps) {
  const lcu = new LcuClient({ native: {}, settings: { get: () => ({}) }, log: quiet });
  lcu.discover = async () => ({ port: 1, password: 'x' });
  let step;
  lcu.req = async (_m, p) => {
    const r = step[p.includes('gameflow-phase') ? 'phase' : 'session'];
    if (r instanceof Error) throw r;
    return r;
  };
  const events = [];
  lcu.on('champSelect', () => events.push('champSelect'));
  lcu.on('phase', (ph) => events.push(`phase ${ph}`));
  lcu.on('connection', (c) => events.push(c ? 'connected' : 'disconnected'));
  return {
    lcu,
    events,
    async run() {
      for (const s of steps) {
        step = s;
        lcu.lastDiscover = 0; // no 5 s wait before rediscovering
        await lcu.tick();
      }
    },
  };
}

test('a single reset or timeout keeps champ select', async () => {
  const s = scripted([
    { phase: 'ChampSelect', session: SESSION },
    { phase: err('ECONNRESET') },
    { phase: err('ETIMEDOUT') },
    { phase: 'ChampSelect', session: SESSION },
  ]);
  await s.run();
  assert.deepEqual(s.events, ['connected', 'phase ChampSelect', 'champSelect']);
  assert.equal(s.lcu.connected, true);
});

test('after a lost connection, the unchanged champ select session is sent again', async () => {
  const s = scripted([
    { phase: 'ChampSelect', session: SESSION },
    { phase: err('ECONNREFUSED') },
    { phase: 'ChampSelect', session: SESSION },
  ]);
  await s.run();
  assert.deepEqual(s.events, ['connected', 'phase ChampSelect', 'champSelect', 'phase null', 'disconnected', 'connected', 'phase ChampSelect', 'champSelect']);
});

test('three failures in a row count as a lost connection', async () => {
  const s = scripted([{ phase: 'Lobby' }, { phase: err('ETIMEDOUT') }, { phase: err('ECONNRESET') }, { phase: err('ETIMEDOUT') }]);
  await s.run();
  assert.equal(s.lcu.connected, false);
  assert.equal(s.lcu.creds, null);
});
