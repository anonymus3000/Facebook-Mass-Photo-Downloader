'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu } = require('electron');
const path = require('path'), fs = require('fs');
const { pathToFileURL } = require('url');
const { Library } = require('./src/main/library');
const exporter = require('./src/main/exporter');

// pc://thumb/<file>  and  pc://full/<relative path>  serve images to the renderer.
protocol.registerSchemesAsPrivileged([{ scheme: 'pc', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const DEFAULTS = {
  keybinds: { g: 'funny', 'ctrl+g': 'funny', c: 'clipped', i: 'isaac' },
  thumbSize: 180, gridOpens: true, lastFolder: null,
};
let settings = { ...DEFAULTS }, settingsFile, win = null, lib = null;

const loadSettings = () => { try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch {} };
const saveSettings = () => fs.writeFile(settingsFile, JSON.stringify(settings, null, 2), () => {});

// Only the main frame of our own window may call IPC.
const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => {
  if (!win || e.sender !== win.webContents || e.senderFrame !== win.webContents.mainFrame) throw new Error('Untrusted sender');
  return fn(...a);
});

function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 900, backgroundColor: '#262628', title: 'Photo Culler',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true,
    },
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile('src/renderer/index.html');
}

async function openFolder(dir) {
  if (typeof dir !== 'string' || !fs.statSync(dir).isDirectory()) throw new Error('Not a folder');
  if (lib) lib.close();
  lib = new Library(dir);
  const photos = await lib.load();
  settings.lastFolder = dir; saveSettings();
  return { root: dir, photos, tags: lib.getAllTags(), pending: lib.pending.length };
}

handle('folder:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
  return r.canceled ? null : openFolder(r.filePaths[0]);
});
handle('folder:open', openFolder);
handle('scan:start', () => {
  if (!lib) return 0;
  const mine = lib; // ignore progress if another folder gets opened meanwhile
  mine.buildMissing((d) => { if (lib === mine && win) win.webContents.send('scan:progress', d); });
  return mine.pending.length;
});
handle('tags:apply', (ops) => { if (lib && Array.isArray(ops)) lib.applyOps(ops); });

handle('settings:get', () => settings);
handle('settings:set', (patch) => {
  if (patch.keybinds && typeof patch.keybinds === 'object')
    settings.keybinds = Object.fromEntries(Object.entries(patch.keybinds).filter(([k, v]) => typeof v === 'string'));
  if (typeof patch.thumbSize === 'number') settings.thumbSize = patch.thumbSize;
  if (typeof patch.gridOpens === 'boolean') settings.gridOpens = patch.gridOpens;
  saveSettings();
});

handle('dialog:dir', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
handle('export:run', (opts) => {
  if (!lib) throw new Error('No folder open');
  return exporter.run(lib, opts, (p) => win && win.webContents.send('export:progress', p));
});

handle('backup:export', async () => {
  if (!lib) return null;
  const r = await dialog.showSaveDialog(win, {
    defaultPath: `photoculler-tags-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled) return null;
  const tags = lib.getAllTags();
  fs.writeFileSync(r.filePath, JSON.stringify({
    app: 'photoculler', version: 1, exportedAt: new Date().toISOString(), folder: path.basename(lib.root), tags,
  }, null, 1));
  return { count: Object.keys(tags).length };
});
handle('backup:import', async () => {
  if (!lib) return null;
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return null;
  let data;
  try { data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { return { error: 'That file could not be read.' }; }
  if (!data || data.app !== 'photoculler' || typeof data.tags !== 'object') return { error: 'That is not a Photo Culler backup.' };
  const matched = {}; let missing = 0;
  for (const [rel, tags] of Object.entries(data.tags)) {
    const hit = lib.resolveRel(rel); // exact path first, then unique filename (folder was moved/renamed)
    if (!hit || !Array.isArray(tags)) { missing++; continue; }
    matched[hit] = tags.filter((t) => typeof t === 'string' && t).map((t) => t.toLowerCase());
  }
  return { matched, missing };
});

app.whenReady().then(() => {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  loadSettings();
  protocol.handle('pc', (req) => {
    if (!lib) return new Response('', { status: 404 });
    const u = new URL(req.url), rel = decodeURIComponent(u.pathname.slice(1));
    if (u.host === 'thumb') return net.fetch(pathToFileURL(path.join(lib.thumbDir, path.basename(rel))).href);
    if (u.host === 'full' && lib.relSet.has(rel)) return net.fetch(pathToFileURL(path.join(lib.root, rel)).href);
    return new Response('', { status: 403 });
  });
  // No Edit menu: Ctrl/Cmd+Z belongs to the app's own undo stack.
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'toggleDevTools' }] }])
    : null);
  createWindow();
});
app.on('before-quit', () => lib && lib.close());
app.on('window-all-closed', () => app.quit());
