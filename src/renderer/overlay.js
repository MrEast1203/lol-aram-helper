// In-game overlay: tier badges over augment cards, scan progress, Tab panels, toasts.
import { api, h, pct, loadDb, augmentInfo, guidesForAugment } from './common.js';
import { buildPanel, guidesPanel } from './buildview.js';

let db = await loadDb();
let settings = await api.getSettings();
let guides = await api.listGuides();
let state = await api.getState();
let detail = null;
let detailFor = null;

async function ensureDetail(force = false) {
  const id = state.game?.championId;
  if (!id) return (detail = null);
  if (!force && detailFor === id && detail) return;
  detailFor = id;
  const r = await api.getChampion(id, { fetch: false });
  detail = r?.data ? { ...r.data, stale: r.stale } : null;
}

function renderBadges() {
  const root = document.getElementById('badges');
  root.replaceChildren();
  const offers = state.game ? state.offers || [] : [];
  if (!offers.length) return;
  const champId = state.game.championId;
  const infos = offers.map((o) => augmentInfo(db, detail, o.augmentId));
  // Best offer: lowest champion rank, else best global tier / win rate.
  const score = (i) => (i.rank != null ? i.rank : 1000 + (i.tier ?? 9) * 100 - (i.winRate || 0) * 100);
  const bestIdx = infos.reduce((b, i, k) => (score(i) < score(infos[b]) ? k : b), 0);
  offers.forEach((o, k) => {
    const info = infos[k];
    const g = guidesForAugment(guides, champId, o.augmentId);
    root.append(
      h(
        'div',
        {
          class: `badge b${info.tier ?? 'x'} ${k === bestIdx && offers.length > 1 ? 'top' : ''}`,
          style: { left: `${o.x + o.w / 2}px`, top: `${o.y - settings.badgeOffsetY}px` },
        },
        h(
          'div',
          { class: 'main' },
          k === bestIdx && offers.length > 1 ? h('span', { class: 'best' }, '★') : null,
          h('span', { class: `tier tier-${info.tier ?? 'x'}` }, info.tier != null ? 'T' + info.tier : '—'),
          // No augment win rates: Riot's League policy forbids showing them in any product.
          info.rank != null ? h('span', null, `#${info.rank}/${info.total}`) : h('span', { class: 'sub' }, '全域')
        ),
        info.scope === 'champion' && info.games ? h('div', { class: 'sub' }, `此英雄 ${info.games} 場 · 選取 ${pct(info.pickRate)}`) : null,
        o.inferred ? h('div', { class: 'guess' }, `推測：${db.aug(o.augmentId)?.name || ''}`) : null,
        g.length ? h('div', { class: 'guide' }, '📘 ' + g.map((x) => x.name).join('、')) : null
      )
    );
  });
}

// Tab: builds on one side, custom guides (always shown) on the other.
function renderTab() {
  const builds = document.getElementById('tab');
  const guideEl = document.getElementById('guides');
  if (!state.tabHeld || !state.game) {
    endDrag();
    builds.style.display = guideEl.style.display = 'none';
    return;
  }
  const championId = state.game.championId;
  const panel = buildPanel(db, {
    championId,
    detail,
    stale: detail?.stale,
    choice: settings.buildChoice?.[championId],
    onSelectBuild: (_i, tag) => api.setSettings({ buildChoice: { ...settings.buildChoice, [championId]: tag } }),
  });
  panel.prepend(dragBar('builds'));
  builds.replaceChildren(panel);
  if (drag?.key !== 'builds') placePanel('builds', builds);
  const gPanel = guidesPanel(db, guides, championId, (state.offers || []).map((o) => o.augmentId));
  if (gPanel) {
    gPanel.prepend(dragBar('guides'));
    guideEl.replaceChildren(gPanel);
    if (drag?.key !== 'guides') placePanel('guides', guideEl);
  } else guideEl.style.display = 'none';
}

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
const PANELS = { builds: 'tab', guides: 'guides' };

// Puts a Tab panel where it was dragged to, else on its default side.
function placePanel(key, el) {
  const w = settings.tabPanelWidth;
  const pos = settings.tabPanelPos?.[key];
  const onLeft = (settings.tabPanelSide === 'left') === (key === 'builds');
  const x = clamp(pos ? pos.x * innerWidth : onLeft ? 16 : innerWidth - w - 16, 0, innerWidth - w);
  const y = clamp(pos ? pos.y * innerHeight : settings.tabPanelTop, 0, innerHeight - 60);
  Object.assign(el.style, { display: 'block', width: w + 'px', left: x + 'px', top: y + 'px', maxHeight: innerHeight - y - 12 + 'px' });
}

function dragBar(key) {
  return h('div', { class: 'drag-bar', title: '拖曳移動 · 雙擊回到預設位置', onmousedown: (e) => startDrag(e, key), ondblclick: () => savePanelPos(key, null) }, '⠿ 拖曳移動');
}

// Dragging a panel's top bar moves it; the spot is saved as fractions of the game window.
let drag = null;
function startDrag(e, key) {
  if (e.button !== 0) return;
  e.preventDefault();
  const el = document.getElementById(PANELS[key]);
  drag = { key, el, dx: e.clientX - el.offsetLeft, dy: e.clientY - el.offsetTop };
  el.classList.add('dragging');
  api.setOverlayDragging(true);
}
document.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const x = clamp(e.clientX - drag.dx, 0, innerWidth - drag.el.offsetWidth);
  const y = clamp(e.clientY - drag.dy, 0, innerHeight - 60);
  Object.assign(drag.el.style, { left: x + 'px', top: y + 'px', maxHeight: innerHeight - y - 12 + 'px' });
});
document.addEventListener('mouseup', () => endDrag());
function endDrag() {
  if (!drag) return;
  const { key, el } = drag;
  drag = null;
  el.classList.remove('dragging');
  api.setOverlayDragging(false);
  savePanelPos(key, { x: +(el.offsetLeft / innerWidth).toFixed(4), y: +(el.offsetTop / innerHeight).toFixed(4) });
}
function savePanelPos(key, pos) {
  const all = { ...settings.tabPanelPos };
  if (pos) all[key] = pos;
  else delete all[key];
  return api.setSettings({ tabPanelPos: all });
}

// Progress while scanning, then a short result line.
let statusTimer;
function renderScanStatus() {
  const el = document.getElementById('scanStatus');
  const s = state.game ? state.scan : null;
  clearTimeout(statusTimer);
  if (!s || (!s.active && Date.now() - s.at > 3000)) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  const keys = `${settings.scanHotkey} 重新掃描 · ${settings.hideHotkey} 隱藏`;
  if (s.active) {
    const pctDone = Math.round((100 * s.progress) / Math.max(1, s.total));
    el.replaceChildren(
      h('div', { class: 'label' }, '🔍 掃描海克斯中…'),
      h('div', { class: 'bar' }, h('div', { class: 'fill', style: { width: `${Math.max(6, pctDone)}%` } })),
      h('div', { class: 'meta' }, `${s.progress}/${s.total}`)
    );
  } else {
    const text = s.error ? `掃描失敗：${s.error}` : s.found ? `✓ 找到 ${s.found} 個海克斯 · ${(s.ms / 1000).toFixed(2)} 秒 · ${keys}` : `✗ 沒偵測到海克斯選擇畫面 · 截圖已存到掃描紀錄`;
    el.replaceChildren(h('div', { class: `label ${s.found ? 'ok' : 'bad'}` }, text));
    statusTimer = setTimeout(renderScanStatus, 3000 - (Date.now() - s.at));
  }
}

// The overlay is click-through. The main process makes it clickable while the cursor is
// over one of these rects: every visible `.interactive` element (scan button, Tab panels).
// They are re-sent whenever the page changes: a panel shown, moved, or grown by the build
// picker opening.
let lastRegions = '';
let regionsQueued = false;
function reportRegions() {
  regionsQueued = false;
  if (drag) return; // the panel follows the cursor; endDrag reports the final spot
  const rects = [...document.querySelectorAll('.interactive')]
    .filter((el) => el.offsetParent)
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width && r.height)
    .map((r) => ({ x: Math.floor(r.left), y: Math.floor(r.top), w: Math.ceil(r.width), h: Math.ceil(r.height) }));
  const key = JSON.stringify(rects);
  if (key === lastRegions) return;
  lastRegions = key;
  api.setOverlayRegions(rects);
}
function queueRegions() {
  if (regionsQueued) return;
  regionsQueued = true;
  setTimeout(reportRegions, 0);
}
new MutationObserver(queueRegions).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
const resizes = new ResizeObserver(queueRegions);
for (const id of ['tab', 'guides', 'scanBtn']) resizes.observe(document.getElementById(id));
window.addEventListener('resize', queueRegions);

const scanBtn = document.getElementById('scanBtn');
scanBtn.addEventListener('click', () => api.manualScan());

function renderScanButton() {
  const show = !!state.game && settings.scanButton;
  if (!show) {
    scanBtn.style.display = 'none';
    return;
  }
  Object.assign(scanBtn.style, { display: 'block', left: `${settings.scanButtonX * 100}vw`, top: `${settings.scanButtonY * 100}vh` });
  const busy = !!state.scan?.active;
  scanBtn.classList.toggle('busy', busy);
  scanBtn.textContent = busy ? '🔍 掃描中…' : `🔍 掃描海克斯 (${settings.scanHotkey})`;
}

function renderToast() {
  const el = document.getElementById('toast');
  if (state.toast) {
    el.textContent = state.toast.text;
    el.style.display = 'block';
  } else el.style.display = 'none';
}

let lastKey = '';
async function render() {
  await ensureDetail();
  // Avoid rebuilding the DOM on every live-data tick.
  const key = JSON.stringify([state.offers, state.tabHeld, state.game?.championId, state.toast, state.scan, !!state.game, detailFor, !!detail]);
  if (key === lastKey) return;
  lastKey = key;
  renderBadges();
  renderTab();
  renderToast();
  renderScanButton();
  renderScanStatus();
}

api.onState((s) => {
  state = s;
  render();
});
api.onDataChanged(async (d) => {
  if (d.kind === 'tables') db = await loadDb();
  if (d.kind === 'settings') settings = await api.getSettings();
  if (d.kind === 'guides') guides = await api.listGuides();
  if (d.kind === 'champion' && d.id !== detailFor) return;
  await ensureDetail(true);
  lastKey = '';
  render();
});
render();
