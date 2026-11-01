// Dev-only: ARAM_SHOTS=<dir> walks the dashboard tabs and saves a screenshot of each.
// With ARAM_SIM it also captures the overlay during and after a scan.
const fs = require('fs');
const path = require('path');

const STEPS = [
  ['overview', `document.querySelector('[data-tab=overview]').click()`],
  ['champions', `document.querySelector('[data-tab=champions]').click(); setTimeout(() => document.querySelectorAll('tr.clickable')[0]?.click(), 100)`],
  ['champion-266', `(() => { const i = document.querySelector('.toolbar input'); i.value = '厄薩斯'; i.dispatchEvent(new Event('input')); setTimeout(() => document.querySelector('tr.clickable')?.click(), 100); })()`],
  ['augments', `document.querySelector('[data-tab=augments]').click()`],
  ['guides', `document.querySelector('[data-tab=guides]').click(); setTimeout(() => document.querySelector('.guide-list .g')?.click(), 100)`],
  ['item-picker', `[...document.querySelectorAll('button')].find((b) => b.textContent.includes('加入裝備'))?.click()`],
  ['settings', `document.getElementById('modal').classList.add('hidden'); document.querySelector('[data-tab=settings]').click()`],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(win, dir, name) {
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
}

async function runDevShots(win, dir, overlay, champPanel) {
  fs.mkdirSync(dir, { recursive: true });
  await sleep(2500);
  if (champPanel && process.env.ARAM_SIM_CS) {
    await shot(champPanel, dir, 'champselect');
    await champPanel.webContents.executeJavaScript(`document.getElementById('main').scrollTop = 99999; document.querySelector('.build-select .bs-head')?.click()`).catch(() => {});
    await sleep(500);
    await shot(champPanel, dir, 'champselect-builds');
  } else if (overlay && process.env.ARAM_SIM) {
    await overlay.webContents.executeJavaScript('void window.api.manualScan()').catch(() => {});
    await sleep(80);
    await shot(overlay, dir, 'overlay-scanning');
    await sleep(1500);
    await shot(overlay, dir, 'overlay-result');
    await overlay.webContents.executeJavaScript(`document.querySelector('#tab .build-select .bs-head')?.click()`).catch(() => {});
    await sleep(400);
    await shot(overlay, dir, 'overlay-build-dropdown');
    // Drag the builds panel 500px left / 200px down, capture, then restore the default spot.
    await overlay.webContents
      .executeJavaScript(
        `(() => {
          const bar = document.querySelector('#tab .drag-bar');
          const r = bar.getBoundingClientRect();
          const fire = (el, type, x, y) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
          fire(bar, 'mousedown', r.left + 30, r.top + 6);
          fire(document, 'mousemove', r.left - 470, r.top + 206);
          fire(document, 'mouseup', r.left - 470, r.top + 206);
        })()`
      )
      .catch((e) => console.warn('[devshots] drag', e.message));
    await sleep(600);
    await shot(overlay, dir, 'overlay-dragged');
    await overlay.webContents.executeJavaScript('window.api.setSettings({ tabPanelPos: {} })').catch(() => {});
  }
  for (const [name, js] of STEPS) {
    await win.webContents.executeJavaScript(js).catch((e) => console.warn('[devshots]', name, e.message));
    await sleep(1500);
    await shot(win, dir, name);
  }
  console.log('[devshots] done');
  if (process.env.ARAM_SHOTS_QUIT) require('electron').app.quit();
}

module.exports = { runDevShots };
