// Main window: status, tier lists, custom guide editor and settings.
import { api, h, pct, num, tierBadge, stripHtml, RARITY, loadDb } from './common.js';
import { buildPanel, buildBlock, guideBox, guidesPanel } from './buildview.js';

let db = await loadDb();
let state = await api.getState();
let settings = await api.getSettings();
let guides = await api.listGuides();
let tab = 'overview';
const ui = { champSearch: '', champSel: null, augSearch: '', augRarity: '', augOpen: null, guideSel: null, draft: null, scan: null, scanning: false };

const view = document.getElementById('view');
const HOTKEYS = ['F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'Insert', 'Home', 'PageUp', 'Backquote'];
const PHASES = { None:'首頁', Lobby: '房間', Matchmaking: '配對中', ReadyCheck: '接受對戰', ChampSelect: '選角中', GameStart: '遊戲載入', InProgress: '遊戲中', WaitingForStats: '等待結算', PreEndOfGame: '結算', EndOfGame: '結算', Reconnect: '重新連線' };

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
  document.getElementById('navStatus').textContent = `資料 ${d.dataVersion || '—'} · credits ${d.credits?.remaining ?? '—'}/${d.credits?.daily ?? '—'}`;
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
  const search = h('input', { placeholder: '搜尋…', class: 'grow', oninput: (ev) => ((query = ev.target.value.trim().toLowerCase()), draw()) });
  modal.replaceChildren(
    h(
      'div',
      { class: 'box' },
      h('div', { class: 'row' }, h('b', { style: { color: 'var(--gold2)' } }, title), search),
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
        h('button', { onclick: close }, '取消'),
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
              '完成'
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
  { label: '全部', value: '' },
  { label: '稜鏡', value: 'prismatic', test: (e) => e.rarity === 'prismatic' },
  { label: '黃金', value: 'gold', test: (e) => e.rarity === 'gold' },
  { label: '白銀', value: 'silver', test: (e) => e.rarity === 'silver' },
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
  { label: '全部', value: '' },
  { label: '基礎', value: 'basic', test: (e) => e.basic },
  { label: '物防', value: 'Armor', test: cat('Armor') },
  { label: '魔抗', value: 'SpellBlock', test: cat('SpellBlock') },
  { label: '生命', value: 'Health', test: cat('Health') },
  { label: '物攻', value: 'Damage', test: cat('Damage') },
  { label: '魔攻', value: 'SpellDamage', test: cat('SpellDamage') },
  { label: '攻速', value: 'AttackSpeed', test: cat('AttackSpeed') },
  { label: '爆擊', value: 'CriticalStrike', test: cat('CriticalStrike') },
  { label: '技能急速', value: 'AbilityHaste', test: cat('AbilityHaste') },
  { label: '鞋子', value: 'Boots', test: (e) => e.boots },
];

// ---------------- overview ----------------

function dot(on, warn) {
  return h('span', { class: `status-dot ${on ? 'on' : warn ? 'warn' : ''}` });
}

let detailCache = new Map();
async function loadDetail(id, fetch = false) {
  const r = await api.getChampion(id, { fetch });
  const d = r?.data ? { ...r.data, stale: r.stale } : r?.error ? { error: r.error } : null;
  detailCache.set(id, d);
  return d;
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
  if (!s.data.hasApiKey) warnings.push(h('div', { class: 'warn-box' }, '尚未設定 API Key，請到「設定」貼上 aramgg API Key。'));
  if (s.windowMode === 0)
    warnings.push(
      h(
        'div',
        { class: 'warn-box' },
        h('b', null, '遊戲目前是「全螢幕」模式，覆蓋層和海克斯偵測無法運作。'),
        h('div', null, '請在遊戲內：設定 → 視訊 → 視窗模式 → 改為「無邊框」。（本程式不會修改任何遊戲檔案。）')
      )
    );
  if (s.data.error) warnings.push(h('div', { class: 'warn-box' }, '資料錯誤：' + s.data.error));

  const game = s.game;
  const gameCard = h(
    'div',
    { class: 'card col' },
    h('h3', null, '對局'),
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
            h('span', { class: 'muted' }, `等級 ${game.level}`),
            s.gameWindow ? h('span', { class: 'muted' }, s.gameWindow.foreground ? '視窗在前景' : '視窗在背景') : h('span', { class: 'muted' }, '找不到遊戲視窗')
          ),
          s.offers.length
            ? h('div', { class: 'row' }, h('span', { class: 'muted' }, '畫面上的海克斯：'), s.offers.map((o) => h('span', { class: 'chip' }, db.augIcon(o.augmentId, 22), db.aug(o.augmentId)?.name || o.augmentId)))
            : null
        )
      : h('div', { class: 'muted' }, '目前不在遊戲中。')
  );

  const det = s.detector;
  const scan = ui.scan;
  const detectorCard = h(
    'div',
    { class: 'card col' },
    h('h3', null, '海克斯偵測（Windows OCR）'),
    h('div', { class: 'muted' }, `遊戲中在海克斯選擇畫面按 ${settings.scanHotkey}（或點左側「🔍 掃描海克斯」按鈕）顯示 tier；重抽後再按一次更新；按 ${settings.hideHotkey} 隱藏。`),
    h(
      'div',
      { class: 'kv' },
      h('span', null, '狀態'),
      h('span', null, s.scan?.active ? `掃描中 ${s.scan.progress}/${s.scan.total}` : '待命'),
      h('span', null, '掃描次數'),
      h('span', null, num(det.scans)),
      h('span', null, '上次耗時'),
      h('span', null, det.lastMs != null ? det.lastMs + ' ms' : '—'),
      h('span', null, '錯誤'),
      h('span', null, det.lastError || '無')
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
        ui.scanning ? '掃描中…' : '立即測試偵測'
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
        '用截圖測試'
      ),
      h('button', { onclick: () => api.openScans() }, '掃描紀錄')
    ),
    h('div', { class: 'muted' }, '「立即測試」掃描遊戲視窗（不在遊戲中則掃描主螢幕）；「用截圖測試」可選一張海克斯選擇畫面的截圖。'),
    scan
      ? scan.error
        ? h('div', { class: 'warn-box' }, scan.error)
        : h(
            'div',
            { class: 'col' },
            h('div', null, `耗時 ${scan.ms} ms，辨識 ${scan.lines.length} 行，匹配 ${scan.candidates.length} 個海克斯名稱。`),
            scan.offers.length
              ? h('div', { class: 'row' }, h('b', null, '偵測到選擇畫面：'), scan.offers.map((o) => h('span', { class: 'chip', title: `OCR：${o.text}` }, db.augIcon(o.id, 22), o.name, o.inferred ? h('span', { class: 'tag' }, '推測') : null)))
              : h('div', { class: 'muted' }, '沒有偵測到海克斯選擇畫面（需要同一排至少 ' + settings.minCardMatches + ' 張卡）。'),
            scan.candidates.length ? h('pre', { class: 'scan' }, scan.candidates.map((c) => `${c.name}  ← 「${c.text}」 (${c.score})`).join('\n')) : null,
            h('details', null, h('summary', { class: 'muted' }, 'OCR 原始文字'), h('pre', { class: 'scan' }, scan.lines.join('\n'))),
            h('button', { onclick: () => api.openPath(scan.saved) }, '開啟截圖')
          )
      : null
  );

  const d = s.data;
  const dataCard = h(
    'div',
    { class: 'card col' },
    h('h3', null, '資料（aramgg）'),
    h(
      'div',
      { class: 'kv' },
      h('span', null, '本地資料版本'),
      h('span', null, d.dataVersion || '—'),
      h('span', null, '最新版本'),
      h('span', null, d.latestVersion || '—'),
      h('span', null, '遊戲版本'),
      h('span', null, d.gamePatch || '—'),
      h('span', null, '今日 credits'),
      h('span', null, d.credits ? `剩餘 ${d.credits.remaining} / ${d.credits.daily}${d.credits.estimated ? '（估計）' : ''}` : '—'),
      h('span', null, '已快取英雄'),
      h('span', null, `${d.cachedChampions} / ${db.champions.length}（${d.gamePatch || ''} 版本內有效${d.prefetching ? '，背景預載中' : ''}）`)
    ),
    h('div', { class: 'row' }, h('button', { onclick: () => api.refreshData() }, d.loading ? '更新中…' : '檢查更新'), h('button', { class: 'danger', onclick: () => confirm('清除所有快取並重新下載？會消耗 credits。') && api.clearCache() }, '清除快取'))
  );

  const lcuCard = h(
    'div',
    { class: 'card col' },
    h('h3', null, '英雄聯盟客戶端'),
    h('div', { class: 'row' }, dot(s.lcu.connected), s.lcu.connected ? `已連線 · ${PHASES[s.lcu.phase] || s.lcu.phase || ''}` : '未偵測到客戶端'),
    s.champSelect
      ? h('div', { class: 'row' }, '選角：', db.champIcon(s.champSelect.championId, 28), db.champ(s.champSelect.championId)?.name || '—', tierBadge(db.champ(s.champSelect.championId)?.stats?.tier), s.champSelect.bench.length ? h('span', { class: 'muted' }, `板凳 ${s.champSelect.bench.length} 位`) : null)
      : null
  );

  const history = s.history || [];
  const historyCard = h(
    'div',
    { class: 'card col' },
    h('h3', null, '最近對局（賽後從比賽紀錄同步的海克斯）'),
    history.length
      ? h(
          'table',
          { class: 'history' },
          h('tbody', null, history.slice(0, 10).map((g) => h('tr', null, h('td', null, new Date(g.at).toLocaleString()), h('td', null, db.champIcon(g.championId, 26)), h('td', { class: g.win ? 'win' : 'loss' }, g.win ? '勝' : '敗'), h('td', null, h('div', { class: 'row' }, g.augments.map((id) => db.augIcon(id, 24)))))))
        )
      : h('div', { class: 'muted' }, '尚無紀錄。每場結束後會自動記錄。')
  );

  let preview = null;
  if (game?.championId) {
    const detail = cachedDetail(game.championId);
    preview = h(
      'div',
      { class: 'card col' },
      h('h3', null, 'Tab 面板預覽'),
      guidesPanel(db, guides, game.championId, s.offers.map((o) => o.augmentId)),
      buildPanel(db, { championId: game.championId, detail, buildsShown: settings.buildsShown, stale: detail?.stale })
    );
  }

  return h('div', { class: 'col', style: { gap: '12px' } }, warnings, h('div', { class: 'grid2' }, lcuCard, gameCard, detectorCard, dataCard, historyCard, preview));
}

// ---------------- champions ----------------

function renderChampions() {
  const q = ui.champSearch.toLowerCase();
  const list = [...db.champions]
    .sort((a, b) => db.champRank.get(a.id) - db.champRank.get(b.id))
    .filter((c) => !q || (c.name + c.title + c.alias).toLowerCase().includes(q));
  const table = h(
    'table',
    null,
    h('thead', null, h('tr', null, ['#', '', '英雄', 'Tier', '勝率', '選取率', '快取'].map((t) => h('th', null, t)))),
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
          h('td', { class: 'muted' }, detailCache.get(c.id) ? '✓' : '')
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
          placeholder: '搜尋英雄…',
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
        h('span', { class: 'muted' }, `${list.length} 位英雄 · 排名依 Tier 再依勝率`)
      ),
      table
    ),
    h('div', { class: 'scroll' }, ui.champSel ? champDetailView(ui.champSel) : h('div', { class: 'muted' }, '點選左側英雄查看海克斯排名與出裝。'))
  );
}

function champDetailView(id) {
  const detail = cachedDetail(id);
  if (detail === undefined) return h('div', { class: 'muted' }, '讀取中…');
  if (!detail || detail.error)
    return h(
      'div',
      { class: 'card col' },
      detail?.error ? h('div', { class: 'warn-box' }, detail.error) : null,
      h('div', null, '此英雄的詳情尚未快取。'),
      h('button', { class: 'primary', onclick: async () => (await loadDetail(id, true), render()) }, '下載詳情（2 credits）')
    );
  const augs = [...(detail.augments || [])].sort((a, b) => (a.stats?.rank ?? 999) - (b.stats?.rank ?? 999));
  return h(
    'div',
    { class: 'col', style: { gap: '12px' } },
    h('div', { class: 'card col' }, guidesPanel(db, guides, id), buildPanel(db, { championId: id, detail, buildsShown: 1, stale: detail.stale })),
    (detail.builds || []).length > 1 ? h('div', { class: 'card col' }, h('h3', null, '其他流派'), detail.builds.slice(1).map((b, i) => buildBlock(db, b, i + 1))) : null,
    (detail.augmentTrios || []).length
      ? h('div', { class: 'card col' }, h('h3', null, '三海克斯組合'), detail.augmentTrios.map((t) => h('div', { class: 'row' }, t.augmentIds.map((a) => db.augIcon(a, 28)), h('span', { class: 'muted' }, `${pct(t.stats?.winRate)} · ${num(t.games)} 場`))))
      : null,
    h(
      'div',
      { class: 'card col' },
      h('h3', null, `海克斯排名（${augs.length}）`),
      h(
        'table',
        null,
        h('thead', null, h('tr', null, ['排名', '', '海克斯', '稀有度', 'Tier', '勝率', '選取率', '場次'].map((t) => h('th', null, t)))),
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
              h('td', null, pct(a.stats?.winRate)),
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
        h('td', null, pct(a.stats?.winRate)),
        h('td', null, pct(a.stats?.pickRate)),
        h('td', null, h('div', { class: 'row' }, (a.topChampions || []).slice(0, 6).map((c) => db.champIcon(c.id, 24))))
      )
    );
    if (ui.augOpen === a.id) rows.push(h('tr', null, h('td', { colspan: 7 }, h('div', { class: 'desc' }, stripHtml(a.tooltip || a.description)))));
  }
  return h(
    'div',
    { class: 'col' },
    h(
      'div',
      { class: 'toolbar' },
      h('input', {
        placeholder: '搜尋海克斯…',
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
      h('span', { class: 'muted' }, `${list.length} 個 · 全域統計（局內會顯示該英雄專屬排名）`)
    ),
    h('table', null, h('thead', null, h('tr', null, ['', '海克斯', '稀有度', 'Tier', '勝率', '選取率', '最佳英雄'].map((t) => h('th', null, t)))), h('tbody', null, rows))
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
        '＋ 新增攻略'
      ),
      h(
        'button',
        {
          onclick: () => {
            ui.guideSel = null;
            ui.draft = { ...emptyDraft(), name: '裝甲衝擊：先出布甲', augmentIds: [3049], items: [1029, 1031, 3075], note: '裝甲衝擊吃物理防禦，先出布甲/鎖子甲疊防禦再合荊棘之甲。' };
            render();
          },
        },
        '範例'
      ),
      h('button', { onclick: () => api.importGuides() }, '匯入'),
      h('button', { onclick: () => api.exportGuides() }, '匯出')
    ),
    guides.length ? null : h('div', { class: 'muted' }, '還沒有自訂攻略。選到對應海克斯後，Tab 面板會優先顯示你的攻略出裝。'),
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
        h('div', { class: 'row' }, g.augmentIds.map((id) => db.augIcon(id, 24)), h('b', null, g.name), g.enabled ? null : h('span', { class: 'tag' }, '停用')),
        h('div', { class: 'row muted' }, g.championIds.length ? g.championIds.map((id) => db.champIcon(id, 18)) : '所有英雄', ' · ', `${g.items.length} 件裝備`)
      )
    )
  );
  return h('div', { class: 'split' }, h('div', { class: 'scroll' }, list), h('div', { class: 'scroll' }, ui.draft ? guideEditor(ui.draft) : h('div', { class: 'muted' }, '選擇或新增一個攻略。')));
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
      h('h3', null, d.id ? '編輯攻略' : '新增攻略'),
      h('label', { class: 'col' }, h('span', { class: 'label' }, '名稱'), h('input', { value: d.name, placeholder: '例如：裝甲衝擊先出布甲', oninput: (e) => (d.name = e.target.value) })),
      h('label', { class: 'row' }, h('input', { type: 'checkbox', checked: d.enabled, onchange: (e) => (d.enabled = e.target.checked) }), '啟用'),
      h('div', { class: 'label' }, '相關海克斯（選擇畫面出現這些海克斯時，卡片徽章會顯示 📘 提醒）'),
      h(
        'div',
        { class: 'row' },
        d.augmentIds.map((id) => h('span', { class: 'chip' }, db.augIcon(id, 26), db.aug(id)?.name || id, h('button', { onclick: () => set('augmentIds', d.augmentIds.filter((x) => x !== id)) }, '✕'))),
        h('button', { onclick: () => openPicker({ title: '選擇相關海克斯', entries: augEntries(), filters: augFilters, multi: true, selected: d.augmentIds, onDone: (ids) => set('augmentIds', ids) }) }, '＋ 選擇海克斯')
      ),
      h('div', { class: 'label' }, '適用英雄（不選 = 所有英雄）。按 Tab 時會一直顯示在適用英雄的攻略欄。'),
      h(
        'div',
        { class: 'row' },
        d.championIds.map((id) => h('span', { class: 'chip' }, db.champIcon(id, 24), db.champ(id)?.name || id, h('button', { onclick: () => set('championIds', d.championIds.filter((x) => x !== id)) }, '✕'))),
        h('button', { onclick: () => openPicker({ title: '選擇適用英雄', entries: champEntries(), multi: true, selected: d.championIds, onDone: (ids) => set('championIds', ids) }) }, '＋ 選擇英雄')
      ),
      h('div', { class: 'label' }, '出裝順序'),
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
                title: '點選裝備加入順序（可重複點選）',
                entries: itemEntries(),
                filters: itemFilters,
                onPick: (id) => d.items.push(id),
                onDone: () => render(),
              }),
          },
          '＋ 加入裝備'
        )
      ),
      h('label', { class: 'col' }, h('span', { class: 'label' }, '備註（會顯示在 Tab 面板）'), h('textarea', { rows: 3, oninput: (e) => (d.note = e.target.value) }, d.note)),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'primary',
            onclick: async () => {
              if (!d.name.trim()) d.name = d.augmentIds.length ? db.aug(d.augmentIds[0])?.name + ' 攻略' : '未命名攻略';
              const saved = await api.saveGuide(d);
              ui.guideSel = saved.id;
              ui.draft = structuredClone(saved);
              guides = await api.listGuides();
              render();
            },
          },
          '儲存'
        ),
        d.id
          ? h(
              'button',
              {
                class: 'danger',
                onclick: async () => {
                  if (!confirm(`刪除「${d.name}」？`)) return;
                  await api.deleteGuide(d.id);
                  ui.guideSel = null;
                  ui.draft = null;
                  guides = await api.listGuides();
                  render();
                },
              },
              '刪除'
            )
          : null
      )
    ),
    h('div', { class: 'card col' }, h('h3', null, 'Tab 面板中的樣子'), guideBox(db, { ...d, name: d.name || '（未命名）' }))
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
      h('h3', null, '資料'),
      h(
        'div',
        { class: 'setting' },
        field('aramgg API Key', h('input', { type: 'password', value: s.apiKey, style: { width: '360px' }, onchange: (e) => save({ apiKey: e.target.value.trim() }) }), '在 data.dtodo.cn/developer.html 申請；免費每日 200 credits。'),
        field(
          '資料語言',
          h('select', { onchange: (e) => save({ locale: e.target.value }) }, ['zh-TW', 'zh-CN', 'en', 'ja', 'ko', 'vi'].map((l) => h('option', { value: l, selected: s.locale === l }, l))),
          '需與遊戲語言一致，海克斯名稱才能被 OCR 對上。'
        ),
        field('背景預載英雄詳情', check('prefetch'), '版本更新後，用剩餘 credits 慢慢預載常用英雄（優先選取率高的）。'),
        field('預載保留 credits', numInput('prefetchReserve', { min: 0 }), '預載不會用到這個數量以下，保留給選角/局內即時查詢（每位英雄 2 credits）。')
      )
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', null, '海克斯偵測'),
      h(
        'div',
        { class: 'setting' },
        field(
          'OCR 語言',
          h('select', { onchange: (e) => save({ ocrLang: e.target.value }) }, ['zh-Hant-TW', 'zh-Hant-HK', 'zh-Hans-CN', 'en-US', 'ja', 'ko'].map((l) => h('option', { value: l, selected: s.ocrLang === l }, l))),
          '需要 Windows 已安裝對應語言的 OCR。'
        ),
        field(
          '手動掃描快捷鍵',
          h('select', { onchange: (e) => save({ scanHotkey: e.target.value }) }, HOTKEYS.map((k) => h('option', { value: k, selected: s.scanHotkey === k }, k))),
          '在海克斯選擇畫面按一下顯示 tier；重抽後再按一次更新。請選遊戲沒用到的鍵。'
        ),
        field(
          '隱藏 tier 快捷鍵',
          h('select', { onchange: (e) => save({ hideHotkey: e.target.value }) }, HOTKEYS.map((k) => h('option', { value: k, selected: s.hideHotkey === k }, k)))
        ),
        field('遊戲內顯示掃描按鈕', check('scanButton'), '畫面左側的「🔍 掃描海克斯」按鈕，點擊不會搶走遊戲焦點。'),
        field('按鈕位置 (% X, Y)', h('div', { class: 'row' }, posInput('scanButtonX'), posInput('scanButtonY'))),
        field('OCR 放大倍率', numInput('ocrScale', { min: 0.5, step: 0.25 }), '字太小辨識不到時可調 1.5。'),
        field('掃描範圍 (% of 遊戲畫面)', h('div', { class: 'row' }, 'X', regionInput('x'), 'Y', regionInput('y'), '寬', regionInput('w'), '高', regionInput('h'))),
        field(
          '已學到的標題列位置',
          h('div', { class: 'row' }, s.titleRowY != null ? `${(s.titleRowY * 100).toFixed(1)}%` : '尚未學到', s.titleRowY != null ? h('button', { onclick: () => save({ titleRowY: null }).then(render) }, '重設') : null),
          '第一次偵測成功後會記住卡片標題的高度，之後只掃那一條，速度快很多。'
        ),
        field('最少卡片匹配數', numInput('minCardMatches', { min: 1 }), '同一排至少辨識到幾張海克斯卡才算選擇畫面。'),
        field('徽章與名稱距離 (px)', numInput('badgeOffsetY')),
        field('截圖/錄影時隱藏覆蓋層', check('hideFromCapture'), '也讓 OCR 不會讀到自己的徽章，建議開啟。')
      )
    ),
    h(
      'div',
      { class: 'card' },
      h('h3', null, '介面'),
      h(
        'div',
        { class: 'setting' },
        field('Tab 面板位置', h('select', { onchange: (e) => save({ tabPanelSide: e.target.value }) }, h('option', { value: 'right', selected: s.tabPanelSide === 'right' }, '右側'), h('option', { value: 'left', selected: s.tabPanelSide === 'left' }, '左側'))),
        field('Tab 面板寬度', numInput('tabPanelWidth', { min: 280, step: 10 })),
        field('Tab 面板上邊距', numInput('tabPanelTop', { min: 0, step: 10 })),
        field('顯示流派數', numInput('buildsShown', { min: 1 })),
        field('選角時顯示側邊面板', check('champSelectPanel')),
        field('關閉視窗時縮到系統匣', check('closeToTray'), '不勾：關閉視窗就完全結束程式。勾選：程式留在系統匣，遊戲中的覆蓋層繼續運作。'),
        field('LoL 安裝路徑', h('input', { value: s.installPath, style: { width: '360px' }, onchange: (e) => save({ installPath: e.target.value }) }), '只會「讀取」lockfile 與 game.cfg，不會修改遊戲檔案。')
      )
    ),
    h(
      'div',
      { class: 'card col muted' },
      h('h3', null, '安全性'),
      h('div', null, '本程式不讀取遊戲記憶體、不注入遊戲、不修改遊戲檔案，也不會送出任何鍵盤滑鼠輸入給遊戲。'),
      h('div', null, '只使用 Riot 公開的本機 API（LCU 客戶端 API、Live Client Data API）與螢幕畫面 OCR；覆蓋層是獨立的透明視窗。')
    )
  );
}

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
  if (d.kind === 'champion') detailCache.delete(d.id);
  if (d.kind === 'settings' && tab === 'settings') return;
  render();
});
render();
