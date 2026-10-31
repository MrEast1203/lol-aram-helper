// Build panel shared by the Tab overlay, champ select panel and dashboard.
import { h, pct, num, tierBadge, itemRow, summarizeBuild, guidesForChampion } from './common.js';

export function guideBox(db, g, hot = false) {
  return h(
    'div',
    { class: `guide-box col ${hot ? 'hot' : ''}` },
    h('div', { class: 'row' }, g.augmentIds.map((id) => db.augIcon(id, 22)), h('span', { class: 'title' }, g.name)),
    g.items.length ? itemRow(db, g.items, 30, true) : null,
    g.note ? h('div', { class: 'note' }, g.note) : null
  );
}

export function spellsRow(db, spells, limit = 2) {
  return spells.slice(0, limit).map((s) =>
    h('div', { class: 'row' }, s.summonerSpellIds.map((id) => db.spellIcon(id, 24)), h('span', { class: 'muted' }, `${pct(s.winRate)} 勝 · ${pct(s.pickRate, 0)} 選`))
  );
}

export function skillLine(sum) {
  if (!sum?.skill) return null;
  return h(
    'div',
    { class: 'row' },
    h('span', { class: 'skill-prio' }, sum.priority.join(' > ')),
    h('span', { class: 'skill-seq' }, sum.skill.skillKeys.slice(0, 18).map((k) => h('b', { class: `sk sk-${k}` }, k)))
  );
}

export function buildBlock(db, build, index, { compact = false } = {}) {
  const s = summarizeBuild(build);
  if (!s) return null;
  const header = h(
    'div',
    { class: 'build-head row' },
    h('b', null, `流派 ${index + 1}`),
    s.tag ? h('span', { class: 'tag' }, s.tag) : null,
    h('span', { class: 'muted' }, `${pct(s.winRate)} 勝 · ${pct(s.pickRate, 0)} 選 · ${num(s.games)} 場`)
  );
  if (compact) return h('div', { class: 'build col' }, header, s.cores[0] ? itemRow(db, s.cores[0].itemIds, 26, true) : null);
  return h(
    'div',
    { class: 'build col' },
    header,
    h('div', { class: 'row' }, h('span', { class: 'label' }, '召喚師'), spellsRow(db, s.spells, 1)),
    s.starting[0] ? h('div', { class: 'row' }, h('span', { class: 'label' }, '出門'), itemRow(db, s.starting[0].itemIds, 26)) : null,
    s.cores.slice(0, 2).map((c, i) =>
      h('div', { class: 'row' }, h('span', { class: 'label' }, i ? '核心 B' : '核心'), itemRow(db, c.itemIds, 30, true), h('span', { class: 'muted' }, `${pct(c.winRate)} · ${num(c.games)}場`))
    ),
    s.followups.length ? h('div', { class: 'row' }, h('span', { class: 'label' }, '後續'), itemRow(db, s.followups, 26)) : null,
    s.situational.length ? h('div', { class: 'row' }, h('span', { class: 'label' }, '情境'), itemRow(db, s.situational, 24)) : null,
    h('div', { class: 'row' }, h('span', { class: 'label' }, '技能'), skillLine(s))
  );
}

// Custom guides for a champion, always shown (highlighted first: guides for the
// augments currently on screen).
export function guidesPanel(db, guides, championId, highlightAugmentIds = []) {
  const list = guidesForChampion(guides, championId);
  if (!list.length) return null;
  const hot = (g) => g.augmentIds.some((id) => highlightAugmentIds.includes(id));
  return h('div', { class: 'guides-panel col' }, h('div', { class: 'section' }, '📘 自訂攻略'), [...list.filter(hot), ...list.filter((g) => !hot(g))].map((g) => guideBox(db, g, hot(g))));
}

// Header and recommended builds.
export function buildPanel(db, { championId, detail, buildsShown = 2, stale = false }) {
  const champ = db.champ(championId);
  const builds = detail?.builds?.length ? detail.builds : detail?.build ? [detail.build] : [];
  return h(
    'div',
    { class: 'build-panel col' },
    h(
      'div',
      { class: 'row panel-head' },
      db.champIcon(championId, 40),
      h('div', { class: 'col', style: { gap: '2px' } }, h('b', { class: 'champ-name' }, champ?.name || '未知英雄'), h('span', { class: 'muted' }, champ?.title || '')),
      h('div', { class: 'grow' }),
      tierBadge(champ?.stats?.tier),
      h('span', { class: 'muted' }, `#${db.champRank.get(championId) || '—'} · ${pct(champ?.stats?.winRate)}`)
    ),
    builds.length
      ? h('div', { class: 'col' }, h('div', { class: 'section' }, '推薦出裝' + (stale ? '（舊版資料）' : '')), builds.slice(0, buildsShown).map((b, i) => buildBlock(db, b, i, { compact: i > 0 })))
      : h('div', { class: 'muted' }, detail?.error ? `出裝資料載入失敗：${detail.error}` : '出裝資料載入中…')
  );
}
