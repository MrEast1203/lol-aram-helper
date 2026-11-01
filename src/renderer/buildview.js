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

const buildSummaryLine = (s) => `${pct(s.winRate)} 勝 · ${pct(s.pickRate, 0)} 選 · ${num(s.games)} 場`;

// Below this many games a starting set is noise rather than a recommendation.
const MIN_STARTING_GAMES = 30;

function startingRow(db, top) {
  const label = h('span', { class: 'label' }, '出門');
  if (!top || top.games < MIN_STARTING_GAMES) return h('div', { class: 'row' }, label, h('span', { class: 'muted' }, '樣本不足'));
  return h('div', { class: 'row' }, label, itemRow(db, top.itemIds, 26), h('span', { class: 'muted' }, `${pct(top.winRate)} · ${num(top.games)}場`));
}

export function buildBlock(db, build, index, { compact = false, head = true } = {}) {
  const s = summarizeBuild(build);
  if (!s) return null;
  const header = head
    ? h('div', { class: 'build-head row' }, h('b', null, `流派 ${index + 1}`), s.tag ? h('span', { class: 'tag' }, s.tag) : null, h('span', { class: 'muted' }, buildSummaryLine(s)))
    : null;
  if (compact) return h('div', { class: 'build col' }, header, s.cores[0] ? itemRow(db, s.cores[0].itemIds, 26, true) : null);
  return h(
    'div',
    { class: 'build col' },
    header,
    h('div', { class: 'row' }, h('span', { class: 'label' }, '召喚師'), spellsRow(db, s.spells, 1)),
    startingRow(db, s.starting[0]),
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

export const buildTag = (b) => (b?.tags ? Object.values(b.tags).join(' / ') : '');
export const buildsOf = (detail) => (detail?.builds?.length ? detail.builds : detail?.build ? [detail.build] : []);

// The chosen build is remembered by its tag ("AD, Bruiser"), which survives the
// builds being re-ordered by a data update; falls back to the most played one.
export function chosenBuildIndex(builds, choice) {
  const i = builds.findIndex((b) => buildTag(b) === choice);
  return i >= 0 ? i : 0;
}

// Dropdown for picking which build to show. Plain elements (not <select>) so it
// also works in the click-through, never-focused overlay; `.interactive` marks it.
export function buildSelector(db, builds, index, onSelect) {
  const cur = summarizeBuild(builds[index]);
  const root = h('div', { class: 'build-select interactive' });
  const head = h(
    'div',
    { class: 'bs-head row', onclick: () => root.classList.toggle('open') },
    h('b', null, `流派 ${index + 1}/${builds.length}`),
    cur.tag ? h('span', { class: 'tag' }, cur.tag) : null,
    h('span', { class: 'muted' }, buildSummaryLine(cur)),
    h('span', { class: 'bs-caret' }, '▾')
  );
  const list = h(
    'div',
    { class: 'bs-list' },
    builds.map((b, i) => {
      const s = summarizeBuild(b);
      return h(
        'div',
        { class: `bs-opt col ${i === index ? 'on' : ''}`, onclick: () => (root.classList.remove('open'), onSelect(i, buildTag(b))) },
        h('div', { class: 'row' }, h('b', null, `流派 ${i + 1}`), s.tag ? h('span', { class: 'tag' }, s.tag) : null, h('span', { class: 'muted' }, buildSummaryLine(s))),
        s.cores[0] ? itemRow(db, s.cores[0].itemIds, 22, true) : null
      );
    })
  );
  root.append(head, list);
  return root;
}

// Header and the chosen recommended build (with a picker when onSelectBuild is given).
export function buildPanel(db, { championId, detail, stale = false, choice, onSelectBuild }) {
  const champ = db.champ(championId);
  const builds = buildsOf(detail);
  const index = chosenBuildIndex(builds, choice);
  const picker = onSelectBuild && builds.length > 1 ? buildSelector(db, builds, index, onSelectBuild) : null;
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
      ? h('div', { class: 'col' }, h('div', { class: 'section' }, '推薦出裝' + (stale ? '（舊版資料）' : '')), picker, buildBlock(db, builds[index], index, { head: !picker }))
      : h('div', { class: 'muted' }, detail?.error ? `出裝資料載入失敗：${detail.error}` : '出裝資料載入中…')
  );
}
