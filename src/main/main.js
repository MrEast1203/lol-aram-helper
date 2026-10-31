// ARAM Helper - Electron main process.
//
// Compliance rules (Riot third-party policy / Vanguard):
//  - Never read or write game memory, never inject into the game process.
//  - Never modify game files (lockfile and game.cfg are only read).
//  - Only Riot's public local APIs are used: LCU (client) and Live Client Data (port 2999).
//  - The overlay is a separate transparent window; augment cards are read from screen
//    pixels with Windows OCR, the same way screen recorders capture the desktop.
//  - No input is ever sent to the game; the global hook only listens.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const { Settings } = require('./settings');
const { DataStore } = require('./data');
const { NativeHelper } = require('./native');
const { LcuClient } = require('./lcu');
const { AugmentDetector } = require('./augmentDetector');
const { GuideStore } = require('./guides');
const { GlobalInput } = require('./input');
const { Controller } = require('./controller');

if (!app.requestSingleInstanceLock()) app.quit();

const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const ICON = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');
const log = console;

let settings, data, native, lcu, detector, guides, input, controller;
let dashboard, overlay, champPanel, tray;
let quitting = false;
let champDismissed = false;

function pipeConsole(win, name) {
  win.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2) log.warn(`[${name}] ${message} (${path.basename(source || '')}:${line})`);
  });
}

function createDashboard() {
  dashboard = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ARAM Helper',
    icon: ICON,
    backgroundColor: '#0b0f17',
    autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  pipeConsole(dashboard, 'dashboard');
  dashboard.loadFile(path.join(RENDERER, 'dashboard.html'));
  dashboard.on('close', (e) => {
    if (!quitting && settings.get().closeToTray) {
      e.preventDefault();
      dashboard.hide();
    }
  });
}

function createOverlay() {
  overlay = new BrowserWindow({
    width: 800,
    height: 600,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  // Keeps our own badges out of the OCR capture (and out of recordings).
  overlay.setContentProtection(settings.get().hideFromCapture);
  pipeConsole(overlay, 'overlay');
  overlay.loadFile(path.join(RENDERER, 'overlay.html'));
}

function createChampPanel() {
  champPanel = new BrowserWindow({
    width: 330,
    height: 720,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    backgroundColor: '#0b0f17',
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  champPanel.setAlwaysOnTop(true, 'floating');
  pipeConsole(champPanel, 'champselect');
  champPanel.loadFile(path.join(RENDERER, 'champselect.html'));
  // The ✕ button hides the panel for the rest of this champ select.
  champPanel.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    champPanel.hide();
    champDismissed = true;
  });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip('ARAM Helper');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '開啟主視窗', click: () => showDashboard() },
      { type: 'separator' },
      { label: '結束', click: () => app.quit() },
    ])
  );
  tray.on('double-click', () => showDashboard());
}

function showDashboard() {
  if (!dashboard) createDashboard();
  dashboard.show();
  dashboard.focus();
}

// physical px -> DIP relative to the overlay window
function physToDip(rect) {
  return screen.screenToDipRect(null, rect);
}

let lastOverlayBounds = null;
function layoutOverlay(state) {
  if (!overlay) return;
  const gw = state.gameWindow;
  if (!state.game || !gw) {
    if (overlay.isVisible()) overlay.hide();
    lastOverlayBounds = null;
    return;
  }
  const bounds = physToDip({ x: gw.x, y: gw.y, width: gw.w, height: gw.h });
  const key = JSON.stringify(bounds);
  if (key !== lastOverlayBounds) {
    lastOverlayBounds = key;
    overlay.setBounds(bounds);
  }
  if (!overlay.isVisible()) {
    overlay.showInactive();
    overlay.setAlwaysOnTop(true, 'screen-saver');
  }
}

function overlayRect(box) {
  const d = physToDip({ x: box.x, y: box.y, width: box.w, height: box.h });
  const b = lastOverlayBounds ? JSON.parse(lastOverlayBounds) : { x: 0, y: 0 };
  return { x: d.x - b.x, y: d.y - b.y, w: d.width, h: d.height };
}

function layoutChampPanel(state) {
  if (!champPanel) return;
  const cs = state.champSelect;
  if (!cs) champDismissed = false;
  if (!cs || champDismissed || !settings.get().champSelectPanel) {
    if (champPanel.isVisible()) champPanel.hide();
    return;
  }
  const cw = state.clientWindow;
  const width = 330;
  if (cw) {
    const c = physToDip({ x: cw.x, y: cw.y, width: cw.w, height: cw.h });
    const display = screen.getDisplayMatching(c).workArea;
    let x = c.x + c.width + 4;
    if (x + width > display.x + display.width) x = Math.max(display.x, c.x - width - 4);
    if (x < display.x) x = c.x + c.width - width; // no room on either side: overlap the client edge
    champPanel.setBounds({ x: Math.round(x), y: Math.round(c.y), width, height: Math.round(Math.max(560, c.height)) });
  }
  if (!champPanel.isVisible()) champPanel.showInactive();
}

let toastTimer;
function broadcast(state) {
  for (const w of [dashboard, overlay, champPanel]) if (w && !w.isDestroyed()) w.webContents.send('state', state);
  layoutOverlay(state);
  layoutChampPanel(state);
  if (state.toast && !toastTimer) {
    toastTimer = setTimeout(() => {
      toastTimer = null;
      controller.patch({ toast: null });
    }, 3000);
  }
}

function notifyData(kind, extra) {
  for (const w of [dashboard, overlay, champPanel]) if (w && !w.isDestroyed()) w.webContents.send('data-changed', { kind, ...extra });
}

function registerIpc() {
  ipcMain.handle('state:get', () => controller.state);
  ipcMain.handle('tables:get', () => data.tables);
  ipcMain.handle('champion:get', async (_e, id, opts) => {
    try {
      return await data.getChampion(id, opts || {});
    } catch (e) {
      return { error: e.message };
    }
  });
  ipcMain.handle('settings:get', () => settings.get());
  ipcMain.handle('settings:set', (_e, patch) => settings.set(patch));
  ipcMain.handle('guides:list', () => guides.list());
  ipcMain.handle('guides:save', (_e, g) => {
    const saved = guides.save(g);
    notifyData('guides');
    return saved;
  });
  ipcMain.handle('guides:delete', (_e, id) => {
    guides.remove(id);
    notifyData('guides');
  });
  ipcMain.handle('game:setPicked', (_e, ids) => controller.setPicked(ids));
  ipcMain.handle('data:refresh', () => data.checkVersion());
  ipcMain.handle('data:clearCache', () => data.clearCache().then(() => data.checkVersion()));
  ipcMain.handle('detector:testFile', async () => {
    const r = await dialog.showOpenDialog(dashboard, { title: '選擇海克斯選擇畫面的截圖', properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'bmp'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    const size = nativeImage.createFromPath(file).getSize();
    if (!size.width) return { error: '無法讀取圖片' };
    try {
      return await controller.testScan({ x: 0, y: 0, w: size.width, h: size.height }, file, { file });
    } catch (e) {
      return { error: e.message };
    }
  });
  ipcMain.handle('detector:test', async () => {
    const p = screen.getPrimaryDisplay();
    const phys = screen.dipToScreenRect(null, p.bounds);
    const file = path.join(app.getPath('userData'), 'last-scan.png');
    try {
      return await controller.testScan({ x: phys.x, y: phys.y, w: phys.width, h: phys.height }, file, { save: file });
    } catch (e) {
      return { error: e.message };
    }
  });
  ipcMain.handle('lcu:applySpells', async (_e, a, b) => {
    try {
      await lcu.applySpells(a, b);
      return { ok: true };
    } catch (e) {
      return { error: e.message };
    }
  });
  ipcMain.handle('app:openExternal', (_e, url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });
  ipcMain.handle('app:openPath', (_e, p) => shell.openPath(p));
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), userData: app.getPath('userData') }));
  ipcMain.handle('guides:export', async () => {
    const r = await dialog.showSaveDialog(dashboard, { defaultPath: 'aram-guides.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return null;
    require('fs').writeFileSync(r.filePath, JSON.stringify(guides.list(), null, 2));
    return r.filePath;
  });
  ipcMain.handle('guides:import', async () => {
    const r = await dialog.showOpenDialog(dashboard, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePaths[0]) return 0;
    const list = JSON.parse(require('fs').readFileSync(r.filePaths[0], 'utf8'));
    let n = 0;
    for (const g of Array.isArray(list) ? list : []) {
      guides.save({ ...g, id: undefined });
      n++;
    }
    notifyData('guides');
    return n;
  });
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  settings = new Settings(path.join(userData, 'settings.json'), [process.cwd(), path.dirname(process.execPath), path.join(app.getAppPath(), '..')]);
  data = new DataStore({ dir: path.join(userData, 'aram-data'), settings, log });
  native = new NativeHelper(log);
  lcu = new LcuClient({ native, settings, log });
  detector = new AugmentDetector({ native, settings, log });
  guides = new GuideStore(path.join(userData, 'guides.json'));
  input = new GlobalInput(log);
  controller = new Controller({ settings, data, lcu, native, detector, guides, input, historyFile: path.join(userData, 'history.json'), log });
  controller.toOverlayRect = overlayRect;

  await data.init();
  data.on('tables', () => notifyData('tables'));
  data.on('champion', (id) => notifyData('champion', { id }));
  settings.on('change', (v, patch) => {
    if ('hideFromCapture' in patch) overlay?.setContentProtection(v.hideFromCapture);
    if ('locale' in patch) data.clearMemory().then(() => data.checkVersion());
    if ('apiKey' in patch) data.checkVersion();
    notifyData('settings');
  });
  controller.on('state', broadcast);

  registerIpc();
  createDashboard();
  createOverlay();
  createChampPanel();
  createTray();

  native.start().catch((e) => log.error('[helper] failed to start', e));
  input.start();
  controller.start();
  if (process.env.ARAM_SIM) {
    const b = screen.dipToScreenRect(null, screen.getPrimaryDisplay().bounds);
    controller.startSimulation(process.env.ARAM_SIM, { x: b.x, y: b.y, w: b.width, h: b.height }, { tab: !!process.env.ARAM_SIM_TAB });
  }
  if (process.env.ARAM_SHOTS) require('./devshots').runDevShots(dashboard, process.env.ARAM_SHOTS);
  data.checkVersion();
  setInterval(() => data.checkVersion(), 30 * 60 * 1000);
});

app.on('second-instance', () => showDashboard());
app.on('before-quit', () => {
  quitting = true;
  input?.stop();
  controller?.stop();
  native?.stop();
});
app.on('window-all-closed', () => {});
