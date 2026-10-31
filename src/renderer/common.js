// Shared renderer helpers: DOM builder, data indexes and build summarising.
export const api = window.api;

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const pct = (v, d = 1) => (v == null || Number.isNaN(v) ? '—' : (v * 100).toFixed(d) + '%');
export const num = (v) => (v == null ? '—' : Number(v).toLocaleString());

export function stripHtml(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

export function tierBadge(tier, prefix = 'T') {
  if (tier == null) return h('span', { class: 'tier tier-x' }, '—');
  return h('span', { class: `tier tier-${tier}` }, prefix + tier);
}

export const RARITY = { silver: '白銀', gold: '黃金', prismatic: '稜鏡' };

export function icon(url, { size = 32, title, cls = '', fallback } = {}) {
  const img = h('img', { class: `icon ${cls}`, src: url || '', width: size, height: size, title, loading: 'lazy', draggable: 'false' });
  img.onerror = () => {
    img.onerror = () => (img.style.visibility = 'hidden');
    if (fallback) img.src = fallback;
    else img.style.visibility = 'hidden';
  };
  return img;
}

// Items hidden from the guide editor: not buyable on Howling Abyss.
const NON_ARAM_CATEGORIES = ['Jungle', 'Vision', 'GoldPer', 'Trinket'];

export class Db {
  constructor(tables) {
    this.tables = tables;
    this.version = tables?.dataVersion;
    this.champions = tables?.champions || [];
    this.augments = tables?.augments || [];
    this.items = tables?.items || [];
    this.spells = tables?.spells || [];
    this.champById = new Map(this.champions.map((c) => [c.id, c]));
    this.augById = new Map(this.augments.map((a) => [a.id, a]));
    this.itemById = new Map(this.items.map((i) => [i.id, i]));
    this.spellById = new Map(this.spells.map((s) => [s.id, s]));
    // Overall champion rank: tier first, then win rate.
    const ranked = [...this.champions].sort((a, b) => (a.stats?.tier ?? 9) - (b.stats?.tier ?? 9) || (b.stats?.winRate ?? 0) - (a.stats?.winRate ?? 0));
    this.champRank = new Map(ranked.map((c, i) => [c.id, i + 1]));
  }

  champ(id) {
    return this.champById.get(Number(id));
  }
  aug(id) {
    return this.augById.get(Number(id));
  }
  item(id) {
    return this.itemById.get(Number(id));
  }

  champIcon(id, size = 32) {
    const c = this.champ(id);
    return icon(c?.iconUrl, { size, title: c ? `${c.name} ${c.title}` : String(id), cls: 'champ' });
  }
  augIcon(id, size = 32) {
    const a = this.aug(id);
    return icon(a?.iconUrl, { size, title: a ? a.name : String(id), cls: `aug rarity-${a?.rarityName || 'x'}` });
  }
  itemIcon(id, size = 32) {
    const it = this.item(id);
    return icon(it?.iconUrl || `https://cdn.dtodo.cn/hextech/item-icons/${id}.png`, {
      size,
      title: it ? `${it.name}（${it.priceTotal}）` : String(id),
      cls: 'item',
      fallback: this.tables?.gamePatch ? `https://ddragon.leagueoflegends.com/cdn/${this.tables.gamePatch}.1/img/item/${id}.png` : null,
    });
  }
  spellIcon(id, size = 28) {
    const s = this.spellById.get(Number(id));
    return icon(s?.iconUrl || `https://cdn.dtodo.cn/hextech/summoner-spell-icons/${id}.png`, { size, title: s?.name, cls: 'spell' });
  }

  // Items a player can actually buy on Howling Abyss, de-duplicated by name.
  shopItems() {
    const seen = new Map();
    for (const it of this.items) {
      if (!it.inStore || it.id >= 100000 || !it.priceTotal) continue;
      if ((it.categories || []).some((c) => NON_ARAM_CATEGORIES.includes(c))) continue;
      if (!seen.has(it.name) || seen.get(it.name).id > it.id) seen.set(it.name, it);
    }
    return [...seen.values()].sort((a, b) => a.priceTotal - b.priceTotal);
  }
}

export async function loadDb() {
  return new Db(await api.getTables());
}

// Champion-specific augment stats, by augment id.
export function champAugStats(detail) {
  const m = new Map();
  for (const a of detail?.augments || []) m.set(a.id, a.stats);
  return m;
}

// Info shown on an augment card: champion-specific when available, else global.
export function augmentInfo(db, detail, augmentId) {
  const s = champAugStats(detail).get(augmentId);
  if (s && s.tier != null) return { tier: s.tier, rank: s.rank, total: s.total, winRate: s.winRate, pickRate: s.pickRate, games: s.games, scope: 'champion' };
  const g = db.aug(augmentId)?.stats;
  return { tier: g?.tier ?? null, rank: null, total: null, winRate: g?.winRate, pickRate: g?.pickRate, scope: 'global' };
}

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

export function skillPriority(order) {
  const keys = order?.skillKeys || [];
  const counts = { Q: 0, W: 0, E: 0 };
  const maxedAt = {};
  keys.forEach((k, i) => {
    if (k in counts && ++counts[k] === 5) maxedAt[k] = i;
  });
  return Object.keys(counts).sort((a, b) => (maxedAt[a] ?? 99) - (maxedAt[b] ?? 99));
}

export function summarizeBuild(b) {
  if (!b) return null;
  const core = b.coreItems?.[0];
  const coreIds = core?.itemIds || [];
  const exts = (b.itemExtensions || []).filter((e) => sameSet(e.coreItemIds, coreIds));
  const weights = new Map();
  for (const e of exts.length ? exts : b.itemExtensions || []) {
    for (const id of e.itemIds) if (!coreIds.includes(id)) weights.set(id, (weights.get(id) || 0) + e.games);
  }
  const followups = [...weights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id);
  return {
    tag: b.tags ? Object.values(b.tags).join(' / ') : '',
    games: b.stats?.games,
    winRate: b.stats?.winRate,
    pickRate: b.stats?.pickRate,
    spells: b.summonerSpells || [],
    starting: b.startingItems || [],
    cores: b.coreItems || [],
    followups,
    situational: (b.situationalItems || []).slice(0, 8).map((s) => s.id),
    skill: b.skillOrders?.[0] || null,
    priority: skillPriority(b.skillOrders?.[0]),
  };
}

export function guidesForChampion(guides, championId) {
  return guides.filter((g) => g.enabled && (!g.championIds.length || g.championIds.includes(championId)));
}

export function guidesForAugment(guides, championId, augmentId) {
  return guides.filter((g) => g.enabled && g.augmentIds.includes(augmentId) && (!g.championIds.length || g.championIds.includes(championId)));
}

export function itemRow(db, ids, size = 30, arrows = false) {
  const out = [];
  ids.forEach((id, i) => {
    if (arrows && i) out.push(h('span', { class: 'arrow' }, '›'));
    out.push(db.itemIcon(id, size));
  });
  return h('div', { class: 'row items' }, out);
}
