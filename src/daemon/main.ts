// The daemon owns sessions and layouts. UIs and agents use the same commands.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';
import { apply, panes, paneOfTab, tabOfSession, tabs, type Layout, type Op, type Size, type Tab } from '../shared/layout.ts';
import type { Notification, PluginFile, ServerEvent, SessionInfo, Snapshot, UiReport } from '../shared/protocol.ts';
import { bulbHome, readInfo } from '../shared/connect.ts';

const HOME = bulbHome();
const APP_ROOT = process.env.BULB_APP_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '../..');
const PLUGINS = join(HOME, 'plugins');
const PROJECTS = join(HOME, 'projects');
mkdirSync(PLUGINS, { recursive: true });
mkdirSync(PROJECTS, { recursive: true, mode: 0o700 });
if (readInfo()) process.exit(0);

const MAX_SCROLLBACK = 1024 * 1024;
const MAX_NOTIFICATIONS = 100;
const id = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;

const GUIDE = [
  '\x1b[1;33m  Bulb\x1b[0m starts as just this terminal. Your agent grows the rest.',
  '',
  '  Start your agent here and tell it what you want, for example:',
  '  \x1b[36m"Read $BULB_DOCS, then add a sidebar listing my sessions."\x1b[0m',
  '', '',
].join('\r\n');

type Client = { ws: WebSocket; project: string | null; ui: boolean; attached: Set<string>; report?: UiReport };
const clients = new Set<Client>();
const send = (c: Client, ev: ServerEvent | object): void => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(ev)); };

type Session = { info: SessionInfo; project: string; proc: pty.IPty; scrollback: string; oscTail: string };
const sessions = new Map<string, Session>();

class Workspace {
  project: string;
  file: string;
  layout: Layout = { root: null, focus: null };
  undoStack: Op[] = [];
  redoStack: Op[] = [];
  notifications: Notification[] = [];

  constructor(project: string) {
    this.project = project;
    this.file = join(PROJECTS, `${createHash('sha256').update(project).digest('hex').slice(0, 16)}.json`);
    let fresh = true;
    if (existsSync(this.file)) {
      try {
        this.layout = (JSON.parse(readFileSync(this.file, 'utf8')) as { layout: Layout }).layout;
        fresh = false;
      } catch (e) {
        console.error(`could not read layout for ${project}`, e);
      }
    }
    this.reconcile();
    this.ensureNotEmpty(fresh ? GUIDE : '');
  }
  broadcast(ev: ServerEvent): void {
    for (const c of clients) if (c.project === this.project) send(c, ev);
  }
  terminalTab(args: { title?: string; cwd?: string; command?: string }, banner = ''): Tab {
    const cwd = args.cwd && isDir(args.cwd) ? args.cwd : this.project;
    const sessionId = id('s');
    spawnSession(sessionId, this.project, cwd, args.command, banner);
    return { id: id('tab'), kind: 'terminal', sessionId, cwd, title: args.title ?? (args.command ?? basename(cwd)) };
  }
  ensureNotEmpty(banner = ''): void {
    if (this.layout.root) return;
    const tab = this.terminalTab({}, banner);
    const pane = id('pane');
    this.layout = { root: { type: 'pane', id: pane, tabs: [tab], active: tab.id }, focus: pane };
  }
  /** Any terminal tab without a live session gets a new shell in the same directory. */
  reconcile(): void {
    const wanted = new Set<string>();
    for (const t of tabs(this.layout)) {
      if (t.kind !== 'terminal') continue;
      wanted.add(t.sessionId);
      if (!sessions.has(t.sessionId)) spawnSession(t.sessionId, this.project, isDir(t.cwd) ? t.cwd : this.project);
    }
    for (const s of sessions.values()) {
      if (s.project === this.project && !s.info.ephemeral && !wanted.has(s.info.id)) { sessions.delete(s.info.id); s.proc.kill(); }
    }
  }
  run(op: Op, undoable = true): void {
    const { layout, inverse } = apply(this.layout, op);
    this.layout = layout;
    if (undoable) { this.undoStack.push(inverse); this.redoStack = []; if (this.undoStack.length > 200) this.undoStack.shift(); }
    this.commit();
  }
  commit(): void {
    this.reconcile();
    this.ensureNotEmpty();
    writeFileSync(this.file, JSON.stringify({ project: this.project, layout: this.layout }), { mode: 0o600 });
    this.broadcast({ ev: 'layout', layout: this.layout });
    this.broadcast({ ev: 'sessions', sessions: this.sessionList() });
  }
  history(from: Op[], to: Op[]): void {
    const op = from.pop();
    if (!op) throw new Error('nothing to do');
    const { layout, inverse } = apply(this.layout, op);
    this.layout = layout;
    to.push(inverse);
    this.commit();
  }
  sessionList(): SessionInfo[] {
    return [...sessions.values()].filter((s) => s.project === this.project).map((s) => s.info);
  }
  notify(title: string, body: string, session?: string): Notification {
    const n: Notification = { id: id('n'), title, body, session, read: false, at: Date.now() };
    this.notifications = [...this.notifications, n].slice(-MAX_NOTIFICATIONS);
    this.broadcast({ ev: 'notifications', notifications: this.notifications, fresh: n });
    return n;
  }
  markRead(pred: (n: Notification) => boolean): void {
    if (!this.notifications.some((n) => !n.read && pred(n))) return;
    this.notifications = this.notifications.map((n) => (pred(n) ? { ...n, read: true } : n));
    this.broadcast({ ev: 'notifications', notifications: this.notifications });
  }
}
const isDir = (p: string): boolean => { try { return statSync(p).isDirectory(); } catch { return false; } };

const workspaces = new Map<string, Workspace>();
function workspace(project: string): Workspace {
  let w = workspaces.get(project);
  if (!w) {
    if (!isDir(project)) throw new Error(`project is not a directory: ${project}`);
    w = new Workspace(project);
    workspaces.set(project, w);
  }
  return w;
}

function parseNotifications(s: Session, data: string): void {
  const text = s.oscTail + data;
  s.oscTail = '';
  const re = /\x1b\](9|777);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    last = re.lastIndex;
    const payload = m[2] ?? '';
    const w = workspaces.get(s.project);
    if (!w) continue;
    if (m[1] === '9') {
      if (!/^\d+;/.test(payload)) w.notify('Terminal', payload, s.info.id); // numeric OSC 9 forms are ConEmu extensions
    } else {
      const [kind, title = 'Terminal', ...body] = payload.split(';');
      if (kind === 'notify') w.notify(title, body.join(';'), s.info.id);
    }
  }
  const open = text.lastIndexOf('\x1b]');
  if (open >= last && text.length - open < 4096) s.oscTail = text.slice(open);
}

function spawnSession(sid: string, project: string, cwd: string, command?: string, banner = '', ephemeral = false): Session {
  const win = process.platform === 'win32';
  const shell = win ? (process.env.COMSPEC ?? 'powershell.exe') : (process.env.SHELL ?? '/bin/sh');
  const args = command ? (win ? ['/c', command] : ['-lc', command]) : [];
  const sep = win ? ';' : ':';
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>), TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'bulb',
    BULB_PROJECT: project, BULB_SESSION: sid, BULB_DOCS: join(APP_ROOT, 'docs/AGENTS.md'),
    PATH: `${join(APP_ROOT, 'bin')}${sep}${process.env.PATH ?? ''}`,
  };
  const proc = pty.spawn(shell, args, { name: 'xterm-256color', cols: 100, rows: 30, cwd, env });
  const s: Session = { info: { id: sid, cwd, pid: proc.pid, ephemeral }, project, proc, scrollback: banner, oscTail: '' };
  sessions.set(sid, s);
  proc.onData((data) => {
    s.scrollback = (s.scrollback + data).slice(-MAX_SCROLLBACK);
    parseNotifications(s, data);
    for (const c of clients) if (c.attached.has(sid)) send(c, { ev: 'output', session: sid, data });
  });
  proc.onExit(() => {
    if (sessions.get(sid) !== s) return; // deliberately removed or replaced
    sessions.delete(sid);
    const w = workspaces.get(project);
    if (!w) return;
    const tab = tabOfSession(w.layout, sid);
    if (tab) w.run({ op: 'close-tab', tab: tab.id }, false);
    else w.broadcast({ ev: 'sessions', sessions: w.sessionList() });
  });
  return s;
}

// ---- plugins ----
const pluginFiles = new Map<string, PluginFile>();
function scanPlugins(): boolean {
  const seen = new Map<string, PluginFile>();
  for (const f of readdirSync(PLUGINS)) {
    if (!f.endsWith('.js')) continue;
    const source = readFileSync(join(PLUGINS, f), 'utf8');
    const name = f.slice(0, -3);
    seen.set(name, { name, source, version: createHash('sha256').update(source).digest('hex').slice(0, 12) });
  }
  const changed = seen.size !== pluginFiles.size || [...seen].some(([k, v]) => pluginFiles.get(k)?.version !== v.version);
  if (changed) {
    pluginFiles.clear();
    for (const [k, v] of seen) pluginFiles.set(k, v);
    for (const c of clients) if (c.ui) send(c, { ev: 'plugins', plugins: [...pluginFiles.values()] });
  }
  return changed;
}
scanPlugins();
let scanTimer: NodeJS.Timeout | undefined;
watch(PLUGINS, () => { clearTimeout(scanTimer); scanTimer = setTimeout(scanPlugins, 50); });

const uiClients = (project?: string): Client[] => [...clients].filter((c) => c.ui && (!project || c.project === project));
type Waiter = { name: string; version: string; resolve: (v: unknown) => void };
const installWaiters = new Set<Waiter>();
function settleInstalls(): void {
  for (const w of installWaiters) {
    for (const c of uiClients()) {
      const st = c.report?.plugins.find((p) => p.name === w.name && p.version === w.version);
      if (st) { installWaiters.delete(w); w.resolve({ live: st.status === 'live', ...st }); break; }
    }
  }
}
function installPlugin(name: string, source: string): Promise<unknown> {
  if (!/^[\w-]+$/.test(name)) throw new Error('plugin names may only contain letters, digits, _ and -');
  writeFileSync(join(PLUGINS, `${name}.js`), source);
  scanPlugins();
  const version = pluginFiles.get(name)!.version;
  if (uiClients().length === 0) return Promise.resolve({ live: false, name, version, status: 'installed', error: 'no UI connected, so it has not loaded' });
  return new Promise((resolve) => {
    const w: Waiter = { name, version, resolve };
    installWaiters.add(w);
    settleInstalls();
    setTimeout(() => { if (installWaiters.delete(w)) resolve({ live: false, name, version, status: 'unknown', error: 'UI did not report within 5s' }); }, 5000);
  });
}

const screenshots = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

// ---- commands: one surface for the UI and for agents ----
type Args = Record<string, any>;
type TabArgs = { title?: string; cwd?: string; command?: string; view?: string; props?: Record<string, unknown> };
function makeTab(w: Workspace, a: TabArgs): Tab {
  if (a.view) return { id: id('tab'), kind: 'view', view: a.view, title: a.title ?? a.view, props: a.props };
  return w.terminalTab(a);
}
function commands(c: Client, name: string, a: Args): unknown {
  if (name === 'hello') {
    if (typeof a.project !== 'string') throw new Error('hello needs a project');
    const w = workspace(a.project);
    c.project = a.project;
    c.ui = !!a.ui;
    const snap: Snapshot = { project: w.project, layout: w.layout, sessions: w.sessionList(), notifications: w.notifications, plugins: [...pluginFiles.values()] };
    return snap;
  }
  if (name === 'daemon.stop') { setTimeout(shutdown, 20); return { stopping: true }; }
  if (name === 'plugin.list') return [...pluginFiles.values()].map(({ name, version }) => ({ name, version }));
  if (name === 'plugin.install') return installPlugin(a.name, a.source);
  if (name === 'plugin.remove') {
    if (!pluginFiles.has(a.name)) throw new Error(`no plugin named ${a.name}`);
    rmSync(join(PLUGINS, `${a.name}.js`));
    scanPlugins();
    return { removed: a.name };
  }
  if (!c.project) throw new Error('call hello first');
  const w = workspace(c.project);
  const owned = (sid: string): Session => {
    const s = sessions.get(sid);
    if (!s || s.project !== w.project) throw new Error(`no session ${sid}`);
    return s;
  };
  switch (name) {
    case 'project.list': {
      // Read saved layouts without starting shells for inactive projects.
      const known = new Map<string, Layout>();
      for (const file of readdirSync(PROJECTS).filter((f) => f.endsWith('.json'))) {
        try {
          const saved = JSON.parse(readFileSync(join(PROJECTS, file), 'utf8'));
          if (typeof saved.project === 'string' && isDir(saved.project) && saved.layout) known.set(saved.project, saved.layout);
        } catch { /* Ignore an unreadable saved workspace. */ }
      }
      for (const [project, workspace] of workspaces) known.set(project, workspace.layout);
      return [...known].map(([project, layout]) => ({
        project, title: basename(project),
        tabs: tabs(layout).filter((t) => !(t.kind === 'view' && t.view === 'sessions')),
        active: panes(layout).find((p) => p.id === layout.focus)?.active,
      })).sort((a, b) => a.project.localeCompare(b.project));
    }
    case 'project.open': {
      if (typeof a.project !== 'string' || !a.project.trim()) throw new Error('project.open needs a directory');
      const next = workspace(resolve(a.project));
      // Keep the project navigator available after switching workspaces.
      if (!tabs(next.layout).some((t) => t.kind === 'view' && t.view === 'sessions') &&
          tabs(w.layout).some((t) => t.kind === 'view' && t.view === 'sessions')) {
        next.run({ op: 'split', target: next.layout.root!.id, dir: 'row', before: true,
          tab: { id: id('tab'), kind: 'view', view: 'sessions', title: 'Projects' },
          newPane: id('pane'), newSplit: id('split'), size: { fixed: 220 } });
      }
      if (a.tab) next.run({ op: 'activate', tab: a.tab }, false);
      next.commit();
      return { project: next.project };
    }
    case 'inspect': {
      const report = uiClients(w.project)[0]?.report ?? null;
      return { project: w.project, layout: w.layout, sessions: w.sessionList(), notifications: w.notifications, ui: report, uiConnected: uiClients(w.project).length > 0 };
    }
    case 'tab.new': {
      const pane = a.pane ?? w.layout.focus ?? panes(w.layout)[0]?.id;
      const tab = makeTab(w, a);
      w.run({ op: 'add-tab', pane, tab });
      return tab;
    }
    case 'split.new': {
      const target = a.root ? w.layout.root?.id : (a.target ?? w.layout.focus);
      if (a.dir !== 'row' && a.dir !== 'column') throw new Error('dir must be row or column');
      const tab = makeTab(w, a);
      const size: Size | undefined = a.fixed ? { fixed: Number(a.fixed) } : undefined;
      const newPane = id('pane');
      w.run({ op: 'split', target, dir: a.dir, before: !!a.before, tab, newPane, newSplit: id('split'), size });
      return { pane: newPane, tab };
    }
    case 'tab.close': w.run({ op: 'close-tab', tab: a.tab }); return w.layout;
    case 'tab.rename': w.run({ op: 'rename', tab: a.tab, title: a.title }, false); return w.layout;
    case 'tab.activate': {
      w.run({ op: 'activate', tab: a.tab }, false);
      const t = tabs(w.layout).find((x) => x.id === a.tab);
      if (t?.kind === 'terminal') w.markRead((n) => n.session === t.sessionId);
      return w.layout;
    }
    case 'pane.focus': {
      w.run({ op: 'focus', pane: a.pane }, false);
      const p = panes(w.layout).find((x) => x.id === a.pane);
      const t = p?.tabs.find((x) => x.id === p.active);
      if (t?.kind === 'terminal') w.markRead((n) => n.session === t.sessionId);
      return w.layout;
    }
    case 'split.resize': w.run({ op: 'resize', split: a.split, sizes: a.sizes }, false); return w.layout;
    case 'layout.undo': w.history(w.undoStack, w.redoStack); return w.layout;
    case 'layout.redo': w.history(w.redoStack, w.undoStack); return w.layout;
    case 'session.attach': {
      const s = owned(a.session);
      c.attached.add(a.session);
      send(c, { ev: 'output', session: a.session, data: s.scrollback });
      return { ok: true };
    }
    case 'session.detach': c.attached.delete(a.session); return { ok: true };
    case 'session.input': owned(a.session).proc.write(String(a.data)); return { ok: true };
    case 'session.resize': {
      const cols = Number(a.cols), rows = Number(a.rows);
      if (cols >= 2 && rows >= 1) owned(a.session).proc.resize(Math.min(cols, 1000), Math.min(rows, 500));
      return { ok: true };
    }
    case 'session.recovery': {
      const s = spawnSession(id('s'), w.project, w.project, undefined, '', true);
      w.broadcast({ ev: 'sessions', sessions: w.sessionList() });
      return s.info;
    }
    case 'session.read': return { data: owned(a.session).scrollback };
    case 'notify': return w.notify(String(a.title ?? 'Bulb'), String(a.body ?? ''), a.session);
    case 'notify.list': return w.notifications;
    case 'notify.open': {
      const n = w.notifications.find((x) => x.id === a.id);
      if (!n) throw new Error(`no notification ${a.id}`);
      w.markRead((x) => x.id === n.id || (!!n.session && x.session === n.session));
      const t = n.session ? tabOfSession(w.layout, n.session) : undefined;
      if (t && paneOfTab(w.layout, t.id)) w.run({ op: 'activate', tab: t.id }, false);
      return w.layout;
    }
    case 'ui.report': {
      c.report = a.report as UiReport;
      settleInstalls();
      return { ok: true };
    }
    case 'screenshot': {
      const ui = uiClients(w.project)[0];
      if (!ui) throw new Error('no UI connected');
      const sid = id('shot');
      send(ui, { ev: 'screenshot', id: sid });
      return new Promise((resolve, reject) => {
        screenshots.set(sid, { resolve, reject });
        setTimeout(() => { if (screenshots.delete(sid)) reject(new Error('screenshot timed out')); }, 10000);
      });
    }
    case 'screenshot.result': {
      const p = screenshots.get(a.id);
      if (p) { screenshots.delete(a.id); if (a.error) p.reject(new Error(a.error)); else p.resolve({ png: a.png }); }
      return { ok: true };
    }
    default:
      throw new Error(`unknown command ${name}`);
  }
}

// ---- server ----
const token = randomBytes(24).toString('hex');
const wss = new WebSocketServer({
  host: '127.0.0.1', port: 0, maxPayload: 64 * 1024 * 1024,
  verifyClient: ({ req }: { req: { url?: string } }) => new URL(req.url ?? '/', 'http://x').searchParams.get('token') === token,
});
const INFO_FILE = join(HOME, 'daemon.json');
wss.on('listening', () => {
  const addr = wss.address();
  if (typeof addr === 'string' || !addr) throw new Error('unexpected address');
  writeFileSync(INFO_FILE, JSON.stringify({ port: addr.port, token, pid: process.pid }), { mode: 0o600 });
});
wss.on('connection', (ws) => {
  const c: Client = { ws, project: null, ui: false, attached: new Set() };
  clients.add(c);
  ws.on('close', () => clients.delete(c));
  ws.on('message', async (raw) => {
    let msg: { id?: number; cmd: string; args?: Args };
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    try {
      const result = await commands(c, msg.cmd, msg.args ?? {});
      send(c, { id: msg.id, ok: true, result });
    } catch (e) {
      send(c, { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
});
function shutdown(): void {
  rmSync(INFO_FILE, { force: true });
  for (const s of [...sessions.values()]) { sessions.delete(s.info.id); s.proc.kill(); }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
