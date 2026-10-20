'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const listen = (ch) => (cb) => {
  const h = (_e, data) => cb(data);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

// The renderer gets this narrow API and nothing else (no Node, no ipcRenderer).
contextBridge.exposeInMainWorld('api', {
  pickFolder: call('folder:pick'),
  openFolder: call('folder:open'),
  startScan: call('scan:start'),
  applyTags: call('tags:apply'),
  getSettings: call('settings:get'),
  setSettings: call('settings:set'),
  pickDir: call('dialog:dir'),
  runExport: call('export:run'),
  exportBackup: call('backup:export'),
  importBackup: call('backup:import'),
  onScan: listen('scan:progress'),
  onExport: listen('export:progress'),
});
