// Champ select side panel: my champion's tier/rank/spells/augments and the ARAM bench.
import { api, h, pct, tierBadge, loadDb } from './common.js';
import { buildBlock, spellsRow } from './buildview.js';

let db = await loadDb();
let state = await api.getState();
let guides = await api.listGuides();
let viewing = null; // champion id selected in the pool (defaults to my champion)
const details = new Map();

document.getElementById('close').onclick = () => window.close();

async function detailFor(id, fetch = false) {
  if (!id) return null;
  if (details.has(id) && !fetch) return details.get(id);
  const r = await api.getChampion(id, { fetch });
  const d = r?.data ? { ...r.data, stale: r.stale } : r?.error ? { error: r.error } : null;
  details.set(id, d);
  return d;
}

function poolItem(id, me, myTier) {
  const c = db.champ(id);
  const t = c?.stats?.tier;
  return h(
    'div',
    {
      class: `pool-item ${me ? 'me' : ''} ${viewing === id ? 'sel' : ''} ${!me && t != null && myTier != null && t < myTier ? 'better' : ''}`,
      onclick: () => {
        viewing = id;
        render(true);
      },
    },
    db.champIcon(id, 40),
    tierBadge(t),
    h('span', { class: 'wr' }, pct(c?.stats?.winRate))
  );
}

async function render(fetchViewing = false) {
  const main = document.getElementById('main');
  const cs = state.champSelect;
  if (!cs) {
    main.replaceChildren(h('div', { class: 'muted' }, '等待選角…'));
    return;
  }
  const myId = cs.championId;
  if (!viewing || (viewing !== myId && ![...cs.bench, ...cs.team.map((t) => t.championId)].includes(viewing))) viewing = myId;
  const id = viewing || myId;
  const champ = db.champ(id);
  // My champion is fetched by the main process; others only when clicked (2 credits).
  const detail = await detailFor(id, fetchViewing || id === myId);
  const build = detail?.builds?.[0] || detail?.build;
  const myTier = db.champ(myId)?.stats?.tier;

  const topAugs = (detail?.augments || [])
    .filter((a) => a.stats?.rank != null)
    .sort((a, b) => a.stats.rank - b.stats.rank)
    .slice(0, 8);
  const champGuides = guides.filter((g) => g.enabled && g.championIds.includes(id));

  main.replaceChildren(
    h(
      'div',
      { class: 'card col' },
      h(
        'div',
        { class: 'row' },
        db.champIcon(id, 52),
        h('div', { class: 'col grow', style: { gap: '2px' } }, h('b', { style: { fontSize: '16px', color: 'var(--gold2)' } }, champ?.name || '—'), h('span', { class: 'muted' }, champ?.title || '')),
        h('div', { class: 'col', style: { alignItems: 'flex-end', gap: '3px' } }, tierBadge(champ?.stats?.tier), h('span', { class: 'muted' }, `排名 #${db.champRank.get(id) || '—'}/${db.champions.length}`))
      ),
      h('div', { class: 'row muted' }, `勝率 ${pct(champ?.stats?.winRate)} · 選取率 ${pct(champ?.stats?.pickRate)}`, id !== myId ? h('span', { class: 'tag' }, '板凳/隊友') : null)
    ),
    build
      ? h(
          'div',
          { class: 'card col' },
          h('h3', null, '召喚師技能'),
          (build.summonerSpells || []).slice(0, 3).map((s) =>
            h(
              'div',
              { class: 'row' },
              spellsRow(db, [s]),
              id === myId
                ? h(
                    'button',
                    {
                      style: { marginLeft: 'auto', padding: '2px 8px' },
                      onclick: async (e) => {
                        const r = await api.applySpells(s.summonerSpellIds[0], s.summonerSpellIds[1]);
                        e.target.textContent = r.error ? '失敗' : '已套用';
                      },
                    },
                    '套用'
                  )
                : null
            )
          )
        )
      : h('div', { class: 'card muted' }, detail?.error ? `詳情載入失敗：${detail.error}` : id === myId ? '載入英雄詳情中…' : '點擊後載入詳情（2 credits）'),
    topAugs.length
      ? h(
          'div',
          { class: 'card col' },
          h('h3', null, '推薦海克斯（此英雄）'),
          topAugs.map((a) => h('div', { class: 'aug-line' }, db.augIcon(a.id, 26), h('span', { class: 'name' }, a.name), tierBadge(a.stats.tier), h('span', { class: 'muted' }, `#${a.stats.rank}`)))
        )
      : null,
    champGuides.length ? h('div', { class: 'card col' }, h('h3', null, '📘 自訂攻略'), champGuides.map((g) => h('div', null, g.name))) : null,
    build ? h('div', { class: 'card' }, buildBlock(db, build, 0)) : null,
    cs.bench.length || cs.team.length
      ? h(
          'div',
          { class: 'card col' },
          h('h3', null, '板凳 / 隊友'),
          cs.bench.length ? h('div', { class: 'muted' }, '板凳（綠色勝率 = 比你目前英雄更高 tier）') : null,
          cs.bench.length ? h('div', { class: 'pool' }, cs.bench.map((b) => poolItem(b, false, myTier))) : null,
          h('div', { class: 'muted' }, '我方'),
          h('div', { class: 'pool' }, cs.team.filter((t) => t.championId).map((t) => poolItem(t.championId, t.isMe, myTier)))
        )
      : null
  );
  const d = state.data;
  document.getElementById('footer').textContent = `資料 ${d.dataVersion || '—'} · 剩餘 credits ${d.credits?.remaining ?? '—'}`;
}

let lastKey = '';
api.onState((s) => {
  state = s;
  const key = JSON.stringify([s.champSelect, s.data?.credits?.remaining]);
  if (key !== lastKey) {
    lastKey = key;
    render();
  }
});
api.onDataChanged(async (d) => {
  if (d.kind === 'tables') db = await loadDb();
  if (d.kind === 'guides') guides = await api.listGuides();
  if (d.kind === 'champion') details.delete(d.id);
  render();
});
render();
