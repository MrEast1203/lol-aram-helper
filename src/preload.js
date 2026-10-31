const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args);

contextBridge.exposeInMainWorld('api', {
  getState: () => invoke('state:get'),
  getTables: () => invoke('tables:get'),
  getChampion: (id, opts) => invoke('champion:get', id, opts),
  getSettings: () => invoke('settings:get'),
  setSettings: (patch) => invoke('settings:set', patch),
  listGuides: () => invoke('guides:list'),
  saveGuide: (g) => invoke('guides:save', g),
  deleteGuide: (id) => invoke('guides:delete', id),
  exportGuides: () => invoke('guides:export'),
  importGuides: () => invoke('guides:import'),
  setPicked: (ids) => invoke('game:setPicked', ids),
  refreshData: () => invoke('data:refresh'),
  clearCache: () => invoke('data:clearCache'),
  testScan: () => invoke('detector:test'),
  testScanFile: () => invoke('detector:testFile'),
  applySpells: (a, b) => invoke('lcu:applySpells', a, b),
  openExternal: (url) => invoke('app:openExternal', url),
  openPath: (p) => invoke('app:openPath', p),
  appInfo: () => invoke('app:info'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onDataChanged: (cb) => ipcRenderer.on('data-changed', (_e, d) => cb(d)),
});
