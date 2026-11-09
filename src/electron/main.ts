import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { BrowserWindow, Menu, Notification, app, dialog, ipcMain } from 'electron';
import { bulbHome, ensureDaemon } from '../shared/connect.ts';

const lastFile = (): string => join(bulbHome(), 'last-project');

async function openWindow(project: string, recovery = false, reuse?: BrowserWindow): Promise<void> {
  const info = await ensureDaemon(app.getAppPath());
  mkdirSync(bulbHome(), { recursive: true });
  writeFileSync(lastFile(), project);
  const win = reuse ?? new BrowserWindow({
    width: 1280, height: 820, backgroundColor: '#1e1f22', title: `Bulb - ${project}`,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  if (!reuse) win.webContents.on('did-finish-load', () => {
    const current = currentProject(win);
    if (current) {
      writeFileSync(lastFile(), current);
      win.setTitle(`Bulb - ${current}`);
    }
  });
  const query: Record<string, string> = { port: String(info.port), token: info.token, project };
  if (recovery) query.recovery = '1';
  await win.loadFile(join(app.getAppPath(), 'dist/renderer/index.html'), { query });
}

async function chooseProject(): Promise<string | null> {
  const r = await dialog.showOpenDialog({ title: 'Open project', properties: ['openDirectory'] });
  return r.canceled ? null : (r.filePaths[0] ?? null);
}
function isDir(p: string): boolean { try { return statSync(p).isDirectory(); } catch { return false; } }
function initialProject(): string | null {
  const arg = process.argv.slice(1).find((a) => !a.startsWith('-') && a !== '.' && isDir(a));
  if (arg) return resolve(arg);
  if (existsSync(lastFile())) { const p = readFileSync(lastFile(), 'utf8').trim(); if (isDir(p)) return p; }
  return null;
}
function currentProject(win: BrowserWindow): string | null {
  return new URL(win.webContents.getURL()).searchParams.get('project');
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Open Project...', accelerator: 'CmdOrCtrl+Shift+O', click: async () => { const p = await chooseProject(); if (p) await openWindow(p); } },
      { role: 'quit' },
    ] },
    { label: 'View', submenu: [
      { label: 'Reload UI', accelerator: 'CmdOrCtrl+Alt+R', click: (_i, w) => { if (w instanceof BrowserWindow) w.webContents.reload(); } },
      { label: 'Recovery Mode', accelerator: 'CmdOrCtrl+Alt+Shift+R', click: async (_i, w) => {
        if (w instanceof BrowserWindow) { const p = currentProject(w); if (p) await openWindow(p, true, w); }
      } },
      { label: 'Normal Mode', click: async (_i, w) => {
        if (w instanceof BrowserWindow) { const p = currentProject(w); if (p) await openWindow(p, false, w); }
      } },
      { role: 'toggleDevTools' },
    ] },
  ]));
  ipcMain.handle('bulb:choose-project', () => chooseProject());
  ipcMain.handle('bulb:capture', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) throw new Error('no window');
    return (await win.webContents.capturePage()).toPNG().toString('base64');
  });
  ipcMain.on('bulb:daemon-lost', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const url = new URL(e.sender.getURL());
    const p = url.searchParams.get('project');
    if (win && p) void openWindow(p, url.searchParams.get('recovery') === '1', win);
  });
  ipcMain.on('bulb:notify', (e, n: { id: string; title: string; body: string }) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!Notification.isSupported()) return;
    const native = new Notification({ title: n.title, body: n.body });
    native.on('click', () => { if (win && !win.isDestroyed()) { win.show(); win.focus(); win.webContents.send('bulb:notification-click', n.id); } });
    native.show();
  });
  const project = initialProject() ?? (await chooseProject());
  if (!project) { app.quit(); return; }
  await openWindow(project);
});
// Quitting closes only the UI. Sessions keep running in the daemon.
app.on('window-all-closed', () => app.quit());
