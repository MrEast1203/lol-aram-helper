// In-game overlay: tier badges over augment cards, Tab build panel, toasts.
import { api, h, pct, loadDb, augmentInfo, guidesForAugment } from './common.js';
import { buildPanel } from './buildview.js';

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
          info.rank != null ? h('span', null, `#${info.rank}/${info.total}`) : h('span', { class: 'sub' }, '全域'),
          h('span', null, pct(info.winRate))
        ),
        info.scope === 'champion' && info.games ? h('div', { class: 'sub' }, `此英雄 ${info.games} 場 · 選取 ${pct(info.pickRate)}`) : null,
        o.inferred ? h('div', { class: 'guess' }, `推測：${db.aug(o.augmentId)?.name || ''}`) : null,
        g.length ? h('div', { class: 'guide' }, '📘 ' + g.map((x) => x.name).join('、')) : null
      )
    );
  });
}

function renderTab() {
  const el = document.getElementById('tab');
  if (!state.tabHeld || !state.game) {
    el.style.display = 'none';
    return;
  }
  const w = settings.tabPanelWidth;
  Object.assign(el.style, {
    display: 'block',
    width: w + 'px',
    top: settings.tabPanelTop + 'px',
    left: settings.tabPanelSide === 'left' ? '16px' : `calc(100vw - ${w + 16}px)`,
  });
  el.replaceChildren(
    buildPanel(db, {
      championId: state.game.championId,
      detail,
      guides,
      picked: state.game.picked || [],
      buildsShown: settings.buildsShown,
      stale: detail?.stale,
    })
  );
}

// The overlay is click-through; it becomes clickable only while the button is hovered.
const scanBtn = document.getElementById('scanBtn');
scanBtn.addEventListener('mouseenter', () => api.setOverlayInteractive(true));
scanBtn.addEventListener('mouseleave', () => api.setOverlayInteractive(false));
scanBtn.addEventListener('click', () => api.manualScan());

function renderScanButton() {
  const show = !!state.game && settings.scanButton;
  if (!show) {
    if (scanBtn.style.display !== 'none') api.setOverlayInteractive(false);
    scanBtn.style.display = 'none';
    return;
  }
  Object.assign(scanBtn.style, { display: 'block', left: `${settings.scanButtonX * 100}vw`, top: `${settings.scanButtonY * 100}vh` });
  scanBtn.classList.toggle('busy', !!state.scanSession);
  scanBtn.textContent = state.scanSession ? '🔍 掃描中…' : `🔍 掃描海克斯 (${settings.scanHotkey})`;
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
  const key = JSON.stringify([state.offers, state.tabHeld, state.game?.championId, state.game?.picked, state.toast, state.scanSession, !!state.game, detailFor, !!detail]);
  if (key === lastKey) return;
  lastKey = key;
  renderBadges();
  renderTab();
  renderToast();
  renderScanButton();
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
