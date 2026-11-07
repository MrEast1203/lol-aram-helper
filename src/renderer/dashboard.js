// Main window: status, tier lists, custom guide editor and settings.
import { api, h, pct, num, tierBadge, stripHtml, RARITY, loadDb } from './common.js';
import { buildPanel, guideBox, guidesPanel } from './buildview.js';
import { t, lang, dateLocale } from './i18n.js';

let db = await loadDb();
let state = await api.getState();
let settings = await api.getSettings();
let guides = await api.listGuides();
const appVersion = (await api.appInfo()).version;
let tab = 'overview';
const ui = { champSearch: '', champSel: null, augSearch: '', augRarity: '', augOpen: null, guideSel: null, draft: null, scan: null, scanning: false };

const view = document.getElementById('view');
const HOTKEYS = ['F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'Insert', 'Home', 'PageUp', 'Backquote'];
const PHASES = { None:t('首頁'), Lobby: t('房間'), Matchmaking: t('配對中'), ReadyCheck: t('接受對戰'), ChampSelect: t('選角中'), GameStart: t('遊戲載入'), InProgress: t('遊戲中'), WaitingForStats: t('等待結算'), PreEndOfGame: t('結算'), EndOfGame: t('結算'), Reconnect: t('重新連線') };

document.querySelectorAll('#nav button[data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('#nav button[data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    render();
  })
);

function render() {
  renderNav();
  const fn = { overview: renderOverview, champions: renderChampions, augments: renderAugments, guides: renderGuides, settings: renderSettings }[tab];
  const scrollTop = view.scrollTop;
  view.replaceChildren(fn());
  view.scrollTop = scrollTop;
}

function renderNav() {
  const d = state.data;
  document.getElementById('navStatus').textContent = t('資料 {version} · credits {left}/{daily}', { version: d.dataVersion || '—', left: d.credits?.remaining ?? '—', daily: d.credits?.daily ?? '—' });
}

// ---------------- modal picker ----------------

function openPicker({ title, entries, multi = false, selected = [], filters = [], onPick, onDone }) {
  const modal = document.getElementById('modal');
  const sel = new Set(selected);
  let query = '';
  let filter = filters[0]?.value ?? '';
  const grid = h('div', { class: 'picker' });
  const draw = () => {
    const f = filters.find((x) => x.value === filter);
    grid.replaceChildren(
      ...entries
        .filter((e) => (!query || e.search.includes(query)) && (!f?.test || f.test(e)))
        .map((e) =>
          h(
            'div',
            {
              class: `p ${sel.has(e.id) ? 'on' : ''}`,
              title: e.title || '',
              onclick: () => {
                if (onPick) onPick(e.id);
                if (multi) {
                  sel.has(e.id) ? sel.delete(e.id) : sel.add(e.id);
                  draw();
                } else if (!onPick) {
                  close();
                  onDone?.([e.id]);
                } else draw();
              },
            },
            e.icon(),
            h('span', null, e.label),
            e.sub ? h('span', { class: 'muted' }, e.sub) : null
          )
        )
    );
  };
  const close = () => modal.classList.add('hidden');
  const search = h('input', { placeholder: t('搜尋…'), class: 'grow', oninput: (ev) => ((query = ev.target.value.trim().toLowerCase()), draw()) });
  modal.replaceChildren(
    h(
      'div',
      { class: 'box' },
      h('div', { class: 'row' }, h('b', { style: { color: 'var(--brand-light)' } }, title), search),
      filters.length
        ? h(
            'div',
            { class: 'row' },
            filters.map((f) =>
              h(
                'button',
                {
                  class: f.value === filter ? 'primary' : '',
                  onclick: (ev) => {
                    filter = f.value;
                    ev.target.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', b === ev.target));
                    draw();
                  },
                },
                f.label
              )
            )
          )
        : null,
      grid,
      h(
        'div',
        { class: 'row', style: { justifyContent: 'flex-end' } },
        h('button', { onclick: close }, t('取消')),
        multi || onPick
          ? h(
              'button',
              {
                class: 'primary',
                onclick: () => {
                  close();
                  onDone?.([...sel]);
                },
              },
              t('完成')
            )
          : null
      )
    )
  );
  modal.onclick = (ev) => ev.target === modal && close();
  modal.classList.remove('hidden');
  draw();
  search.focus();
}

const augEntries = () =>
  db.augments.map((a) => ({
    id: a.id,
    label: a.name,
    sub: `${RARITY[a.rarityName] || ''} T${a.stats?.tier ?? '-'}`,
    rarity: a.rarityName,
    search: (a.name + a.key).toLowerCase(),
    title: stripHtml(a.description),
    icon: () => db.augIcon(a.id, 44),
  }));
const augFilters = [
  { label: t('全部'), value: '' },
  { label: t('稜鏡'), value: 'prismatic', test: (e) => e.rarity === 'prismatic' },
  { label: t('黃金'), value: 'gold', test: (e) => e.rarity === 'gold' },
  { label: t('白銀'), value: 'silver', test: (e) => e.rarity === 'silver' },
];
const champEntries = () =>
  [...db.champions]
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
    .map((c) => ({ id: c.id, label: c.name, search: (c.name + c.title + c.alias).toLowerCase(), icon: () => db.champIcon(c.id, 44) }));
const itemEntries = () =>
  db.shopItems().map((i) => ({
    id: i.id,
    label: i.name,
    sub: String(i.priceTotal),
    cats: i.categories || [],
    basic: !(i.from || []).length,
    boots: (i.categories || []).includes('Boots'),
    search: i.name.toLowerCase(),
    title: stripHtml(i.description),
    icon: () => db.itemIcon(i.id, 40),
  }));
const cat = (c) => (e) => e.cats.includes(c);
const itemFilters = [
  { label: t('全部'), value: '' },
  { label: t('基礎'), value: 'basic', test: (e) => e.basic },
  { label: t('物防'), value: 'Armor', test: cat('Armor') },
  { label: t('魔抗'), value: 'SpellBlock', test: cat('SpellBlock') },
  { label: t('生命'), value: 'Health', test: cat('Health') },
  { label: t('物攻'), value: 'Damage', test: cat('Damage') },
  { label: t('魔攻'), value: 'SpellDamage', test: cat('SpellDamage') },
  { label: t('攻速'), value: 'AttackSpeed', test: cat('AttackSpeed') },
  { label: t('爆擊'), value: 'CriticalStrike', test: cat('CriticalStrike') },
  { label: t('技能急速'), value: 'AbilityHaste', test: cat('AbilityHaste') },
  { label: t('鞋子'), value: 'Boots', test: (e) => e.boots },
];

// Build dropdown wiring: the choice is stored per champion and shared with the overlay.
function buildChoiceProps(championId) {
  return {
    choice: settings.buildChoice?.[championId],
    onSelectBuild: async (_i, tag) => {
      settings = await api.setSettings({ buildChoice: { ...settings.buildChoice, [championId]: tag } });
      render();
    },
  };
}

// ---------------- overview ----------------

function dot(on, warn) {
  return h('span', { class: `status-dot ${on ? 'on' : warn ? 'warn' : ''}` });
}

let detailCache = new Map();
async function loadDetail(id, fetch = false) {
  const r = await api.getChampion(id, { fetch, reason: '主視窗：下載詳情' });
  const d = r?.data ? { ...r.data, stale: r.stale } : r?.error ? { error: r.error } : null;
  detailCache.set(id, d);
  return d;
}

// Credit log, reloaded whenever the data status reports a newer entry.
let creditLog = { at: undefined, entries: [] };
function cachedCreditLog() {
  const at = state.data.creditLogAt;
  if (creditLog.at !== at) {
    creditLog.at = at;
    api.creditLog().then((entries) => {
      creditLog.entries = entries;
      render();
    });
  }
  return creditLog.entries;
}
function cachedDetail(id) {
  if (!detailCache.has(id)) {
    detailCache.set(id, undefined);
    loadDetail(id).then(() => render());
  }
  return detailCache.get(id);
}

function renderOverview() {
  const s = state;
  const warnings = [];
  if (!s.data.hasApiKey) warnings.push(h('div', { class: 'warn-box' }, t('尚未設定 API Key，請到「設定」貼上 aramgg API Key。')));
  if (s.windowMode === 0)
    warnings.push(
      h(
        'div',
        { class: 'warn-box' },
        h('b', null, t('遊戲目前是「全螢幕」模式，覆蓋層和海克斯偵測無法運作。')),
        h('div', null, t('請在遊戲內：設定 → 視訊 → 視窗模式 → 改為「無邊框」。（本程式不會修改任何遊戲檔案。）'))
      )
    );
  if (s.data.error) warnings.push(h('div', { class: 'warn-box' }, t('資料錯誤：{error}', { error: s.data.error })));

  const game = s.game;
  const gameCard = h(
    'div',
    { class: 'card col' },
    h('h3', null, t('對局')),
    game
      ? h(
          'div',
          { class: 'col' },
          h(
            'div',
            { class: 'row' },
            db.champIcon(game.championId, 40),
            h('b', null, db.champ(game.championId)?.name || game.alias || '—'),
            h('span', { class: 'tag' }, game.gameMode || ''),
            h('span', { class: 'muted' }, t('等級 {level}', { level: game.level })),
            s.gameWindow ? h('span', { class: 'muted' }, s.gameWindow.foreground ? t('視窗在前景') : t('視窗在背景')) : h('span', { class: 'muted' }, t('找不到遊戲視窗'))
          ),
          s.offers.length
            ? h('div', { class: 'row' }, h('span', { class: 'muted' }, t('畫面上的海克斯：')), s.offers.map((o) => h('span', { class: 'chip' }, db.augIcon(o.augmentId, 22), db.aug(o.augmentId)?.name || o.augmentId)))
            : null
        )
      : h('div', { class: 'muted' }, t('目前不在遊戲中。'))
  );

  const det = s.detector;
  const scan = ui.scan;
  const detectorCard = h(
    'div',
    { class: 'card col' },
    h('h3', null, t('海克斯偵測（Windows OCR）')),
    h('div', { class: 'muted' }, t('遊戲中在海克斯選擇畫面按 {scan}（或點左側「🔍 掃描海克斯」按鈕）顯示 tier；重抽後再按一次更新；按 {hide} 隱藏。', { scan: settings.scanHotkey, hide: settings.hideHotkey })),
    h(
      'div',
      { class: 'kv' },
      h('span', null, t('狀態')),
      h('span', null, s.scan?.active ? t('掃描中 {done}/{total}', { done: s.scan.progress, total: s.scan.total }) : t('待命')),
      h('span', null, t('掃描次數')),
      h('span', null, num(det.scans)),
      h('span', null, t('上次耗時')),
      h('span', null, det.lastMs != null ? det.lastMs + ' ms' : '—'),
      h('span', null, t('錯誤')),
      h('span', null, det.lastError || t('無'))
    ),
    h(
      'div',
      { class: 'row' },
      h(
        'button',
        {
          class: 'primary',
          disabled: ui.scanning,
          onclick: async () => {
            ui.scanning = true;
            render();
            ui.scan = await api.testScan();
            ui.scanning = false;
            render();
          },
        },
        ui.scanning ? t('掃描中…') : t('立即測試偵測')
      ),
      h(
        'button',
        {
          disabled: ui.scanning,
          onclick: async () => {
            const r = await api.testScanFile();
            if (r) {
              ui.scan = r;
              render();
            }
          },
        },
        t('用截圖測試')
      ),
      h('button', { onclick: () => api.openScans() }, t('掃描紀錄'))
    ),
    h('div', { class: 'muted' }, t('「立即測試」掃描遊戲視窗（不在遊戲中則掃描主螢幕）；「用截圖測試」可選一張海克斯選擇畫面的截圖。')),
    scan
      ? scan.error
        ? h('div', { class: 'warn-box' }, scan.error)
        : h(
            'div',
            { class: 'col' },
            h('div', null, t('耗時 {ms} ms，辨識 {lines} 行，匹配 {n} 個海克斯名稱。', { ms: scan.ms, lines: scan.lines.length, n: scan.candidates.length })),
            scan.offers.length
              ? h('div', { class: 'row' }, h('b', null, t('偵測到選擇畫面：')), scan.offers.map((o) => h('span', { class: 'chip', title: `OCR：${o.text}` }, db.augIcon(o.id, 22), o.name, o.inferred ? h('span', { class: 'tag' }, t('推測')) : null)))
              : h('div', { class: 'muted' }, t('沒有偵測到海克斯選擇畫面（需要同一排至少 {n} 張卡）。', { n: settings.minCardMatches })),
            scan.candidates.length ? h('pre', { class: 'scan' }, scan.candidates.map((c) => `${c.name}  ← 「${c.text}」 (${c.score})`).join('\n')) : null,
            h('details', null, h('summary', { class: 'muted' }, t('OCR 原始文字')), h('pre', { class: 'scan' }, scan.lines.join('\n'))),
            h('button', { onclick: () => api.openPath(scan.saved) }, t('開啟截圖'))
          )
      : null
  );

  const d = s.data;
  const checkedAt = d.lastCheck && new Date(d.lastCheck.at).toLocaleTimeString(dateLocale);
  const checked = d.lastCheck && (d.lastCheck.error ? t('（{time} 檢查失敗：{error}）', { time: checkedAt, error: d.lastCheck.error }) : t('（{time} 檢查）', { time: checkedAt }));
  const dataCard = h(
    'div',
    { class: 'card col' },
    h('h3', null, t('資料（aramgg）')),
    h(
      'div',
      { class: 'kv' },
      h('span', null, t('本地資料版本')),
      h('span', null, d.dataVersion || '—'),
      h('span', null, t('aramgg 最新')),
      h('span', null, d.latestVersion || '—', checked ? h('span', { class: 'muted' }, checked) : null),
      h('span', null, t('遊戲版本')),
      h('span', null, t('統計資料 {stats} · Riot 最新 {riot}', { stats: d.gamePatch || '—', riot: d.riotPatch || '—' })),
      h('span', null, t('今日 credits')),
      h(
        'span',
        null,
        d.credits
          ? t('剩餘 {left} / {daily}{estimated}，預載保留 {reserve}', { left: d.credits.remaining, daily: d.credits.daily, estimated: d.credits.estimated ? t('（估計）') : '', reserve: settings.prefetchReserve })
          : '—'
      ),
      h('span', null, t('已快取英雄')),
      h(
        'span',
        null,
        t('{cached} / {total}（{patch} 版本內有效）', { cached: d.cachedChampions, total: db.champions.length, patch: d.gamePatch || '' }),
        d.cachedChampions > d.latestChampions
          ? h('div', { class: 'muted' }, t('其中 {n} 位是較舊的 {patch}.x 資料，仍可使用；背景預載會更新到 {version}。', { n: d.cachedChampions - d.latestChampions, patch: d.gamePatch, version: d.latestVersion || d.dataVersion }))
          : null
      ),
      h('span', null, t('背景預載')),
      h('span', null, d.prefetching ? t('進行中…') : d.prefetchNote || '—')
    ),
    d.riotPatch && d.gamePatch && d.riotPatch !== d.gamePatch
      ? h('div', { class: 'muted' }, t('遊戲已更新到 {riot}，但 aramgg 還沒發布 {riot} 的統計，目前最新的是 {stats} 版的資料。aramgg 發布後，程式會在 30 分鐘內自動更新。', { riot: d.riotPatch, stats: d.gamePatch }))
      : null,
    h(
      'div',
      { class: 'row' },
      h('button', { disabled: d.checking || d.loading, onclick: () => api.refreshData() }, d.loading ? t('更新中…') : d.checking ? t('檢查中…') : t('檢查更新')),
      h('button', { class: 'danger', onclick: () => confirm(t('清除所有快取並重新下載？會消耗 credits。')) && api.clearCache() }, t('清除快取'))
    )
  );

  const entries = cachedCreditLog();
  const dayStart = new Date().setUTCHours(0, 0, 0, 0); // the daily quota resets at UTC 00:00
  const usedBy = new Map();
  for (const e of entries.filter((e) => e.at >= dayStart && e.cost)) {
    const k = (e.reason || '其他').split('：')[0]; // reasons are stored as their Chinese text
    usedBy.set(k, (usedBy.get(k) || 0) + e.cost);
  }
  const logRow = (e) =>
    h(
      'tr',
      null,
      h('td', { class: 'muted' }, new Date(e.at).toLocaleString(dateLocale, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })),
      h('td', null, creditItem(e.resource)),
      h('td', null, e.reason ? t(e.reason) : '—'),
      h('td', null, e.status < 300 ? `-${e.cost ?? '?'}` : `HTTP ${e.status}`),
      h('td', null, e.remaining ?? '—')
    );
  const logTable = (rows) => h('table', { class: 'credit-log' }, h('thead', null, h('tr', null, [t('時間'), t('項目'), t('原因'), 'credits', t('剩餘')].map((x) => h('th', null, x)))), h('tbody', null, rows.map(logRow)));
  const creditCard = h(
    'div',
    { class: 'card col', style: { gridColumn: '1 / -1' } },
    h('h3', null, t('Credits 使用紀錄')),
    h(
      'div',
      null,
      t('今日（UTC 00:00 起）伺服器記錄已用 {used} credits', { used: d.credits ? (d.credits.estimated ? 0 : d.credits.usedToday) : '—' }),
      usedBy.size ? t('；本程式：{list}', { list: [...usedBy].map(([k, v]) => `${t(k)} ${v}`).join(t('、')) }) : t('；本程式今天還沒用到 credits')
    ),
    h('div', { class: 'muted' }, t('只有下載資料表（1 credit）和英雄詳情（2 credits）會花 credits，檢查版本免費。背景預載會留 {reserve} credits 給選角和遊戲中使用，可在「設定 → 資料」修改。', { reserve: settings.prefetchReserve })),
    entries.length ? logTable(entries.slice(0, 15)) : h('div', { class: 'muted' }, t('尚無紀錄。')),
    entries.length > 15 ? h('details', null, h('summary', { class: 'muted' }, t('顯示全部 {n} 筆', { n: entries.length })), logTable(entries.slice(15))) : null
  );

  const lcuCard = h(
    'div',
    { class: 'card col' },
    h('h3', null, t('英雄聯盟客戶端')),
    h('div', { class: 'row' }, dot(s.lcu.connected), s.lcu.connected ? t('已連線 · {phase}', { phase: PHASES[s.lcu.phase] || s.lcu.phase || '' }) : t('未偵測到客戶端')),
    s.champSelect
      ? h('div', { class: 'row' }, t('選角：'), db.champIcon(s.champSelect.championId, 28), db.champ(s.champSelect.championId)?.name || '—', tierBadge(db.champ(s.champSelect.championId)?.stats?.tier), s.champSelect.bench.length ? h('span', { class: 'muted' }, t('板凳 {n} 位', { n: s.champSelect.bench.length })) : null)
      : null
  );

  const history = s.history || [];
  const historyCard = h(
    'div',
    { class: 'card col' },
    h('h3', null, t('最近對局（賽後從比賽紀錄同步的海克斯）')),
    history.length
      ? h(
          'table',
          { class: 'history' },
          h('tbody', null, history.slice(0, 10).map((g) => h('tr', null, h('td', null, new Date(g.at).toLocaleString(dateLocale)), h('td', null, db.champIcon(g.championId, 26)), h('td', { class: g.win ? 'win' : 'loss' }, g.win ? t('勝') : t('敗')), h('td', null, h('div', { class: 'row' }, g.augments.map((id) => db.augIcon(id, 24)))))))
        )
      : h('div', { class: 'muted' }, t('尚無紀錄。每場結束後會自動記錄。'))
  );

  let preview = null;
  if (game?.championId) {
    const detail = cachedDetail(game.championId);
    preview = h(
      'div',
      { class: 'card col' },
      h('h3', null, t('Tab 面板預覽')),
      guidesPanel(db, guides, game.championId, s.offers.map((o) => o.augmentId)),
      buildPanel(db, { championId: game.championId, detail, stale: detail?.stale, ...buildChoiceProps(game.championId) })
    );
  }

  return h('div', { class: 'col', style: { gap: '12px' } }, warnings, h('div', { class: 'grid2' }, lcuCard, gameCard, detectorCard, dataCard, historyCard, preview, creditCard));
}

const TABLE_NAMES = { champions: t('英雄列表'), augments: t('海克斯列表'), items: t('裝備列表'), 'summoner-spells': t('召喚師技能列表') };
function creditItem(resource) {
  const m = /^champions\/(\d+)$/.exec(resource);
  if (!m) return TABLE_NAMES[resource] || resource;
  const id = Number(m[1]);
  return h('span', { class: 'row' }, db.champIcon(id, 20), db.champ(id)?.name || t('英雄 {id}', { id }));
}

// ---------------- champions ----------------

// Cached champion versions for the 快取 column, reloaded when the cache counts change.
let cacheIndex = { key: undefined, map: {} };
function cachedVersions() {
  const d = state.data;
  const key = `${d.totalCachedChampions}/${d.latestChampions}/${d.latestVersion}`;
  if (cacheIndex.key !== key) {
    cacheIndex.key = key;
    api.cacheIndex().then((map) => {
      cacheIndex.map = map;
      render();
    });
  }
  return cacheIndex.map;
}

// ✓ for the newest data; an older release of the same patch shows its version.
function cacheCell(version) {
  if (!version) return '';
  if (version === (state.data.latestVersion || state.data.dataVersion)) return '✓';
  return h('span', { title: t('較舊的資料，背景預載會更新') }, version);
}

function renderChampions() {
  const q = ui.champSearch.toLowerCase();
  const versions = cachedVersions();
  const list = [...db.champions]
    .sort((a, b) => db.champRank.get(a.id) - db.champRank.get(b.id))
    .filter((c) => !q || (c.name + c.title + c.alias).toLowerCase().includes(q));
  const table = h(
    'table',
    null,
    h('thead', null, h('tr', null, ['#', '', t('英雄'), 'Tier', t('勝率'), t('選取率'), t('快取')].map((x) => h('th', null, x)))),
    h(
      'tbody',
      null,
      list.map((c) =>
        h(
          'tr',
          {
            class: `clickable ${ui.champSel === c.id ? 'selected' : ''}`,
            onclick: () => {
              ui.champSel = c.id;
              render();
            },
          },
          h('td', { class: 'muted' }, db.champRank.get(c.id)),
          h('td', null, db.champIcon(c.id, 28)),
          h('td', null, c.name, ' ', h('span', { class: 'muted' }, c.title)),
          h('td', null, tierBadge(c.stats?.tier)),
          h('td', null, pct(c.stats?.winRate)),
          h('td', null, pct(c.stats?.pickRate)),
          h('td', { class: 'muted' }, cacheCell(versions[c.id]))
        )
      )
    )
  );
  return h(
    'div',
    { class: 'split' },
    h(
      'div',
      { class: 'col scroll' },
      h(
        'div',
        { class: 'toolbar' },
        h('input', {
          placeholder: t('搜尋英雄…'),
          value: ui.champSearch,
          oninput: (e) => {
            ui.champSearch = e.target.value;
            const pos = e.target.selectionStart;
            render();
            const inp = view.querySelector('input');
            inp.focus();
            inp.setSelectionRange(pos, pos);
          },
        }),
        h('span', { class: 'muted' }, t('{n} 位英雄 · 排名依 Tier 再依勝率', { n: list.length }))
      ),
      table
    ),
    h('div', { class: 'scroll' }, ui.champSel ? champDetailView(ui.champSel) : h('div', { class: 'muted' }, t('點選左側英雄查看海克斯排名與出裝。')))
  );
}

function champDetailView(id) {
  const detail = cachedDetail(id);
  if (detail === undefined) return h('div', { class: 'muted' }, t('讀取中…'));
  if (!detail || detail.error)
    return h(
      'div',
      { class: 'card col' },
      detail?.error ? h('div', { class: 'warn-box' }, detail.error) : null,
      h('div', null, t('此英雄的詳情尚未快取。')),
      h('button', { class: 'primary', onclick: async () => (await loadDetail(id, true), render()) }, t('下載詳情（2 credits）'))
    );
  const augs = [...(detail.augments || [])].sort((a, b) => (a.stats?.rank ?? 999) - (b.stats?.rank ?? 999));
  return h(
    'div',
    { class: 'col', style: { gap: '12px' } },
    h('div', { class: 'card col' }, guidesPanel(db, guides, id), buildPanel(db, { championId: id, detail, stale: detail.stale, ...buildChoiceProps(id) })),
    (detail.augmentTrios || []).length
      ? h('div', { class: 'card col' }, h('h3', null, t('三海克斯組合')), detail.augmentTrios.map((trio) => h('div', { class: 'row' }, trio.augmentIds.map((a) => db.augIcon(a, 28)), h('span', { class: 'muted' }, t('{games} 場', { games: num(trio.games) })))))
      : null,
    h(
      'div',
      { class: 'card col' },
      h('h3', null, t('海克斯排名（{n}）', { n: augs.length })),
      h(
        'table',
        null,
        h('thead', null, h('tr', null, [t('排名'), '', t('海克斯'), t('稀有度'), 'Tier', t('選取率'), t('場次')].map((x) => h('th', null, x)))),
        h(
          'tbody',
          null,
          augs.map((a) =>
            h(
              'tr',
              null,
              h('td', { class: 'muted' }, a.stats?.rank ?? '—'),
              h('td', null, db.augIcon(a.id, 26)),
              h('td', null, a.name),
              h('td', { class: 'muted' }, a.rarityDisplayName),
              h('td', null, tierBadge(a.stats?.tier)),
              h('td', null, pct(a.stats?.pickRate)),
              h('td', { class: 'muted' }, num(a.stats?.games))
            )
          )
        )
      )
    )
  );
}

// ---------------- augments ----------------

function renderAugments() {
  const q = ui.augSearch.toLowerCase();
  const list = [...db.augments]
    .filter((a) => (!ui.augRarity || a.rarityName === ui.augRarity) && (!q || a.name.toLowerCase().includes(q) || stripHtml(a.description).includes(q)))
    .sort((a, b) => (a.stats?.tier ?? 9) - (b.stats?.tier ?? 9) || (b.stats?.winRate ?? 0) - (a.stats?.winRate ?? 0));
  const rows = [];
  for (const a of list) {
    const g = guides.filter((x) => x.augmentIds.includes(a.id));
    rows.push(
      h(
        'tr',
        {
          class: 'clickable',
          onclick: () => {
            ui.augOpen = ui.augOpen === a.id ? null : a.id;
            render();
          },
        },
        h('td', null, db.augIcon(a.id, 30)),
        h('td', null, a.name, g.length ? h('span', { class: 'tag', style: { marginLeft: '6px' } }, `📘 ${g.length}`) : null),
        h('td', { class: 'muted' }, a.rarityDisplayName),
        h('td', null, tierBadge(a.stats?.tier)),
        h('td', null, pct(a.stats?.pickRate)),
        h('td', null, h('div', { class: 'row' }, (a.topChampions || []).slice(0, 6).map((c) => db.champIcon(c.id, 24))))
      )
    );
    if (ui.augOpen === a.id) rows.push(h('tr', null, h('td', { colspan: 6 }, h('div', { class: 'desc' }, stripHtml(a.tooltip || a.description)))));
  }
  return h(
    'div',
    { class: 'col' },
    h(
      'div',
      { class: 'toolbar' },
      h('input', {
        placeholder: t('搜尋海克斯…'),
        value: ui.augSearch,
        oninput: (e) => {
          ui.augSearch = e.target.value;
          const pos = e.target.selectionStart;
          render();
          const inp = view.querySelector('input');
          inp.focus();
          inp.setSelectionRange(pos, pos);
        },
      }),
      augFilters.map((f) =>
        h(
          'button',
          {
            class: ui.augRarity === f.value ? 'primary' : '',
            onclick: () => {
              ui.augRarity = f.value;
              render();
            },
          },
          f.label
        )
      ),
      h('span', { class: 'muted' }, t('{n} 個 · 全域統計（局內會顯示該英雄專屬排名）', { n: list.length }))
    ),
    h('table', null, h('thead', null, h('tr', null, ['', t('海克斯'), t('稀有度'), 'Tier', t('選取率'), t('最佳英雄')].map((x) => h('th', null, x)))), h('tbody', null, rows))
  );
}

// ---------------- guides ----------------

const emptyDraft = () => ({ name: '', enabled: true, augmentIds: [], championIds: [], items: [], note: '' });

function renderGuides() {
  if (!ui.draft) ui.draft = ui.guideSel ? structuredClone(guides.find((g) => g.id === ui.guideSel) || emptyDraft()) : null;
  const list = h(
    'div',
    { class: 'col guide-list' },
    h(
      'div',
      { class: 'toolbar' },
      h(
        'button',
        {
          class: 'primary',
          onclick: () => {
            ui.guideSel = null;
            ui.draft = emptyDraft();
            render();
          },
        },
        t('＋ 新增攻略')
      ),
      h(
        'button',
        {
          onclick: () => {
            ui.guideSel = null;
            ui.draft = { ...emptyDraft(), name: t('裝甲衝擊：先出布甲'), augmentIds: [3049], items: [1029, 1031, 3075], note: t('裝甲衝擊吃物理防禦，先出布甲/鎖子甲疊防禦再合荊棘之甲。') };
            render();
          },
        },
        t('範例')
      ),
      h('button', { onclick: () => api.importGuides() }, t('匯入')),
      h('button', { onclick: () => api.exportGuides() }, t('匯出'))
    ),
    guides.length ? null : h('div', { class: 'muted' }, t('還沒有自訂攻略。選到對應海克斯後，Tab 面板會優先顯示你的攻略出裝。')),
    guides.map((g) =>
      h(
        'div',
        {
          class: `g ${ui.guideSel === g.id ? 'sel' : ''} ${g.enabled ? '' : 'off'}`,
          onclick: () => {
            ui.guideSel = g.id;
            ui.draft = structuredClone(g);
            render();
          },
        },
        h('div', { class: 'row' }, g.augmentIds.map((id) => db.augIcon(id, 24)), h('b', null, g.name), g.enabled ? null : h('span', { class: 'tag' }, t('停用'))),
        h('div', { class: 'row muted' }, g.championIds.length ? g.championIds.map((id) => db.champIcon(id, 18)) : t('所有英雄'), ' · ', t('{n} 件裝備', { n: g.items.length }))
      )
    )
  );
  return h('div', { class: 'split' }, h('div', { class: 'scroll' }, list), h('div', { class: 'scroll' }, ui.draft ? guideEditor(ui.draft) : h('div', { class: 'muted' }, t('選擇或新增一個攻略。'))));
}

function guideEditor(d) {
  const set = (k, v) => {
    d[k] = v;
    render();
  };
  const move = (i, delta) => {
    const j = i + delta;
    if (j < 0 || j >= d.items.length) return;
    [d.items[i], d.items[j]] = [d.items[j], d.items[i]];
    render();
  };
  return h(
    'div',
    { class: 'col', style: { gap: '12px' } },
    h(
      'div',
      { class: 'card col' },
      h('h3', null, d.id ? t('編輯攻略') : t('新增攻略')),
      h('label', { class: 'col' }, h('span', { class: 'label' }, t('名稱')), h('input', { value: d.name, placeholder: t('例如：裝甲衝擊先出布甲'), oninput: (e) => (d.name = e.target.value) })),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: d.enabled, onchange: (e) => (d.enabled = e.target.checked) }), t('啟用')),
      h('div', { class: 'label' }, t('相關海克斯（選擇畫面出現這些海克斯時，卡片徽章會顯示 📘 提醒）')),
      h(
        'div',
        { class: 'row' },
        d.augmentIds.map((id) => h('span', { class: 'chip' }, db.augIcon(id, 26), db.aug(id)?.name || id, h('button', { onclick: () => set('augmentIds', d.augmentIds.filter((x) => x !== id)) }, '✕'))),
        h('button', { onclick: () => openPicker({ title: t('選擇相關海克斯'), entries: augEntries(), filters: augFilters, multi: true, selected: d.augmentIds, onDone: (ids) => set('augmentIds', ids) }) }, t('＋ 選擇海克斯'))
      ),
      h('div', { class: 'label' }, t('適用英雄（不選 = 所有英雄）。按 Tab 時會一直顯示在適用英雄的攻略欄。')),
      h(
        'div',
        { class: 'row' },
        d.championIds.map((id) => h('span', { class: 'chip' }, db.champIcon(id, 24), db.champ(id)?.name || id, h('button', { onclick: () => set('championIds', d.championIds.filter((x) => x !== id)) }, '✕'))),
        h('button', { onclick: () => openPicker({ title: t('選擇適用英雄'), entries: champEntries(), multi: true, selected: d.championIds, onDone: (ids) => set('championIds', ids) }) }, t('＋ 選擇英雄'))
      ),
      h('div', { class: 'label' }, t('出裝順序')),
      h(
        'div',
        { class: 'seq' },
        d.items.map((id, i) =>
          h(
            'div',
            { class: 'slot' },
            h('span', { class: 'idx' }, i + 1),
            db.itemIcon(id, 40),
            h('div', { class: 'ctl' }, h('button', { onclick: () => move(i, -1) }, '◀'), h('button', { onclick: () => set('items', d.items.filter((_, k) => k !== i)) }, '✕'), h('button', { onclick: () => move(i, 1) }, '▶'))
          )
        ),
        h(
          'button',
          {
            onclick: () =>
              openPicker({
                title: t('點選裝備加入順序（可重複點選）'),
                entries: itemEntries(),
                filters: itemFilters,
                onPick: (id) => d.items.push(id),
                onDone: () => render(),
              }),
          },
          t('＋ 加入裝備')
        )
      ),
      h('label', { class: 'col' }, h('span', { class: 'label' }, t('備註（會顯示在 Tab 面板）')), h('textarea', { rows: 3, oninput: (e) => (d.note = e.target.value) }, d.note)),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'primary',
            onclick: async () => {
              if (!d.name.trim()) d.name = d.augmentIds.length ? t('{name} 攻略', { name: db.aug(d.augmentIds[0])?.name }) : t('未命名攻略');
              const saved = await api.saveGuide(d);
              ui.guideSel = saved.id;
              ui.draft = structuredClone(saved);
              guides = await api.listGuides();
              render();
            },
          },
          t('儲存')
        ),
        d.id
          ? h(
              'button',
              {
                class: 'danger',
                onclick: async () => {
                  if (!confirm(t('刪除「{name}」？', { name: d.name }))) return;
                  await api.deleteGuide(d.id);
                  ui.guideSel = null;
                  ui.draft = null;
                  guides = await api.listGuides();
                  render();
                },
              },
              t('刪除')
            )
          : null
      )
    ),
    h('div', { class: 'card col' }, h('h3', null, t('Tab 面板中的樣子')), guideBox(db, { ...d, name: d.name || t('（未命名）') }))
  );
}

// ---------------- settings ----------------

function renderSettings() {
  const s = settings;
  const save = (patch) => api.setSettings(patch).then((v) => (settings = v));
  const field = (label, input, hint) => [h('span', null, label), input, hint ? h('div', { class: 'hint' }, hint) : null];
  const numInput = (key, opts = {}) => h('input', { type: 'number', value: s[key], step: opts.step || 1, min: opts.min, style: { width: '120px' }, onchange: (e) => save({ [key]: Number(e.target.value) }) });
  const check = (key) => h('input', { type: 'checkbox', checked: s[key], onchange: (e) => save({ [key]: e.target.checked }) });
  const posInput = (key) => h('input', { type: 'number', value: +(s[key] * 100).toFixed(1), min: 0, max: 100, step: 0.5, style: { width: '80px' }, onchange: (e) => save({ [key]: Number(e.target.value) / 100 }) });
  const region = s.scanRegion;
  const regionInput = (k) =>
    h('input', { type: 'number', value: Math.round(region[k] * 100), min: 0, max: 100, style: { width: '70px' }, onchange: (e) => save({ scanRegion: { ...settings.scanRegion, [k]: Number(e.target.value) / 100 } }) });
  return h(
    'div',
    { class: 'col', style: { gap: '12px', maxWidth: '860px' } },
    h(
      'div',
      { class: 'card' },
      h('h3', null, t('資料')),
      h(
        'div',
        { class: 'setting' },
        field(
          '介面語言 / Language',
          h('select', { onchange: (e) => save({ uiLang: e.target.value }) }, [['auto', t('跟隨系統')], ['zh-TW', '繁體中文'], ['en', 'English']].map(([v, label]) => h('option', { value: v, selected: s.uiLang === v }, label))),
          t('只改程式介面；海克斯和英雄名稱跟隨「資料語言」。')
        ),
        field('aramgg API Key', h('input', { type: 'password', value: s.apiKey, style: { width: '360px' }, onchange: (e) => save({ apiKey: e.target.value.trim() }) }), t('在 data.dtodo.cn/developer.html 申請；免費每日 200 credits。')),
        field(
          t('資料語言'),
          h('select', { onchange: (e) => save({ locale: e.target.value }) }, ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'vi'].map((l) => h('option', { value: l, selected: s.locale === l }, l))),
          t('需與遊戲語言一致，海克斯名稱才能被 OCR 對上。')
        ),
        field(t('背景預載英雄詳情'), check('prefetch'), t('版本更新後，用剩餘 credits 慢慢預載常用英雄（優先選取率高的）。')),
        field(t('預載保留 credits'), numInput('prefetchReserve', { min: 0 }), t('預載不會用到這個數量以下，保留給選角/局內即時查詢（每位英雄 2 credits）。預設 80。'))
      )
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', null, t('海克斯偵測')),
      h(
        'div',
        { class: 'setting' },
        field(
          t('OCR 語言'),
          h('select', { onchange: (e) => save({ ocrLang: e.target.value }) }, ['zh-Hant-TW', 'zh-Hant-HK', 'zh-Hans-CN', 'en-US', 'ja', 'ko'].map((l) => h('option', { value: l, selected: s.ocrLang === l }, l))),
          t('需要 Windows 已安裝對應語言的 OCR。')
        ),
        field(
          t('手動掃描快捷鍵'),
          h('select', { onchange: (e) => save({ scanHotkey: e.target.value }) }, HOTKEYS.map((k) => h('option', { value: k, selected: s.scanHotkey === k }, k))),
          t('在海克斯選擇畫面按一下顯示 tier；重抽後再按一次更新。請選遊戲沒用到的鍵。')
        ),
        field(
          t('隱藏 tier 快捷鍵'),
          h('select', { onchange: (e) => save({ hideHotkey: e.target.value }) }, HOTKEYS.map((k) => h('option', { value: k, selected: s.hideHotkey === k }, k)))
        ),
        field(t('遊戲內顯示掃描按鈕'), check('scanButton'), t('畫面左側的「🔍 掃描海克斯」按鈕，點擊不會搶走遊戲焦點。')),
        field(t('按鈕位置 (% X, Y)'), h('div', { class: 'row' }, posInput('scanButtonX'), posInput('scanButtonY'))),
        field(t('OCR 放大倍率'), numInput('ocrScale', { min: 0.5, step: 0.25 }), t('字太小辨識不到時可調 1.5。')),
        field(t('掃描範圍 (% of 遊戲畫面)'), h('div', { class: 'row' }, 'X', regionInput('x'), 'Y', regionInput('y'), t('寬'), regionInput('w'), t('高'), regionInput('h'))),
        field(
          t('已學到的標題列位置'),
          h('div', { class: 'row' }, s.titleRowY != null ? `${(s.titleRowY * 100).toFixed(1)}%` : t('尚未學到'), s.titleRowY != null ? h('button', { onclick: () => save({ titleRowY: null }).then(render) }, t('重設')) : null),
          t('第一次偵測成功後會記住卡片標題的高度，之後只掃那一條，速度快很多。')
        ),
        field(t('最少卡片匹配數'), numInput('minCardMatches', { min: 1 }), t('同一排至少辨識到幾張海克斯卡才算選擇畫面。')),
        field(t('徽章與名稱距離 (px)'), numInput('badgeOffsetY')),
        field(t('截圖/錄影時隱藏覆蓋層'), check('hideFromCapture'), t('也讓 OCR 不會讀到自己的徽章，建議開啟。'))
      )
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', null, t('介面')),
      h(
        'div',
        { class: 'setting' },
        field(
          t('Tab 面板位置'),
          h(
            'div',
            { class: 'row' },
            h('select', { onchange: (e) => save({ tabPanelSide: e.target.value }) }, h('option', { value: 'right', selected: s.tabPanelSide === 'right' }, t('出裝在右側')), h('option', { value: 'left', selected: s.tabPanelSide === 'left' }, t('出裝在左側'))),
            Object.keys(s.tabPanelPos || {}).length ? h('button', { onclick: () => save({ tabPanelPos: {} }).then(render) }, t('重設拖曳位置')) : null
          ),
          t('遊戲中按住 Tab，拖曳面板頂端的「⠿ 拖曳移動」即可移動並記住位置；雙擊它回到預設位置。')
        ),
        field(t('Tab 面板寬度'), numInput('tabPanelWidth', { min: 280, step: 10 })),
        field(t('Tab 面板上邊距（預設位置）'), numInput('tabPanelTop', { min: 0, step: 10 })),
        field(t('選角時顯示側邊面板'), check('champSelectPanel')),
        field(t('關閉視窗時縮到系統匣'), check('closeToTray'), t('不勾：關閉視窗就完全結束程式。勾選：程式留在系統匣，遊戲中的覆蓋層繼續運作。')),
        field(t('LoL 安裝路徑'), h('input', { value: s.installPath, style: { width: '360px' }, onchange: (e) => save({ installPath: e.target.value }) }), t('只會「讀取」lockfile 與 game.cfg，不會修改遊戲檔案。'))
      )
    ),
    h(
      'div',
      { class: 'card col muted' },
      h('h3', null, t('安全性')),
      h('div', null, t('本程式不讀取遊戲記憶體、不注入遊戲、不修改遊戲檔案，也不會送出任何鍵盤滑鼠輸入給遊戲。')),
      h('div', null, t('只使用遊戲在本機提供的介面（LCU 客戶端 API、Live Client Data API）與螢幕畫面 OCR；覆蓋層是獨立的透明視窗。')),
      h('div', null, t('依 Riot 的英雄聯盟政策，本程式不顯示海克斯的勝率，只顯示 Tier、排名與選取率。'))
    ),
    h(
      'div',
      { class: 'card col muted' },
      h('h3', null, t('關於與免責聲明')),
      h('div', null, t('ARAM Helper {version} · 授權：PolyForm Noncommercial 1.0.0（僅限非商業用途）', { version: appVersion || '' })),
      h('div', null, t('統計資料來自 aramgg.com Data API（data.dtodo.cn），每位使用者需使用自己的 API Key；資料的正確性與即時性由資料來源決定。')),
      h('div', null, t('本程式為個人非官方工具，「按現狀」提供，不提供任何保證。使用本程式的一切風險（包括帳號相關風險）由使用者自行承擔。')),
      h('div', null, LEGAL_EN),
      lang === 'en' ? null : h('div', null, LEGAL_ZH),
      h(
        'div',
        { class: 'row' },
        h('button', { onclick: () => api.openExternal('https://polyformproject.org/licenses/noncommercial/1.0.0/') }, t('授權條款')),
        h('button', { onclick: () => api.openExternal('https://aramgg.com') }, 'aramgg.com'),
        h('button', { onclick: () => api.openExternal('https://developer.riotgames.com/policies/general') }, t('Riot 開發者政策'))
      )
    )
  );
}

// Riot's required legal boilerplate (developer.riotgames.com/policies/general).
const LEGAL_EN =
  "ARAM Helper isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";
const LEGAL_ZH = 'ARAM Helper 未獲 Riot Games 認可，也不代表 Riot Games 或任何正式參與製作、管理 Riot Games 資產人士的觀點或意見。Riot Games 及所有相關資產皆為 Riot Games, Inc. 的商標或註冊商標。';

// ---------------- live updates ----------------

let lastOverviewKey = '';
api.onState((s) => {
  state = s;
  renderNav();
  if (tab !== 'overview') return;
  const key = JSON.stringify([s.lcu, s.windowMode, s.champSelect, s.game && { ...s.game, gameTime: 0 }, s.gameWindow?.foreground, !!s.gameWindow, s.detector.scans >> 3, s.detector.lastError, s.scan, s.offers, s.data, s.history.length]);
  if (key !== lastOverviewKey) {
    lastOverviewKey = key;
    if (document.getElementById('modal').classList.contains('hidden')) render();
  }
});
api.onDataChanged(async (d) => {
  if (d.kind === 'tables') db = await loadDb();
  if (d.kind === 'settings') settings = await api.getSettings();
  if (d.kind === 'guides') guides = await api.listGuides();
  if (d.kind === 'champion') {
    detailCache.delete(d.id);
    cacheIndex.key = undefined;
  }
  if (d.kind === 'settings' && tab === 'settings') return;
  render();
});
render();
