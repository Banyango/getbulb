// The public agent interface. Everything here uses the commands the UI uses.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WebSocket } from 'ws';
import { ensureDaemon, readInfo } from './shared/connect.ts';

const USAGE = `bulb - control the running Bulb workspace

  bulb project list | open DIR [TAB]       list projects or prepare a project
  bulb inspect                            layout, sessions, plugins, theme, errors (JSON)
  bulb tab new [tab options] [--pane ID]
  bulb tab close|activate TAB
  bulb tab rename TAB TITLE
  bulb split --dir row|column [--target ID | --root] [--before] [--fixed PX] [tab options]
  bulb focus PANE
  bulb undo | redo
  bulb send SESSION TEXT                  type into a session
  bulb read SESSION                       print a session's scrollback
  bulb notify TITLE [BODY]                notify from the current session
  bulb notify-open ID                     go to a notification's pane
  bulb plugin install FILE.js | remove NAME | list
  bulb screenshot OUT.png                 capture the app window (Electron only)
  bulb daemon start|stop|status

  tab options: --title T --cwd DIR --cmd "command" --view NAME --props JSON
  global: --project DIR (default: $BULB_PROJECT, then the current directory)`;

const { values: o, positionals: p } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string' }, pane: { type: 'string' }, target: { type: 'string' }, root: { type: 'boolean' },
    dir: { type: 'string' }, before: { type: 'boolean' }, fixed: { type: 'string' }, title: { type: 'string' },
    cwd: { type: 'string' }, cmd: { type: 'string' }, view: { type: 'string' }, props: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  },
});
const [a0, a1, a2] = p;
if (o.help || !a0) { console.log(USAGE); process.exit(a0 || o.help ? 0 : 1); }

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tabOpts = () => ({ title: o.title, cwd: o.cwd && resolve(o.cwd), command: o.cmd, view: o.view, props: o.props ? JSON.parse(o.props) : undefined });

if (a0 === 'daemon' && a1 === 'status') { console.log(readInfo() ? `running, pid ${readInfo()!.pid}` : 'not running'); process.exit(0); }
if (a0 === 'daemon' && a1 === 'stop' && !readInfo()) { console.log('not running'); process.exit(0); }

const info = await ensureDaemon(appRoot);
if (a0 === 'daemon' && a1 === 'start') { console.log(`running, pid ${info.pid}`); process.exit(0); }

const ws = new WebSocket(`ws://127.0.0.1:${info.port}/?token=${info.token}`, { maxPayload: 64 * 1024 * 1024 });
await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
let seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.id === undefined) return;
  const w = pending.get(m.id);
  pending.delete(m.id);
  if (m.ok) w?.res(m.result); else w?.rej(new Error(m.error));
});
const call = (cmd: string, args: object = {}): Promise<any> => new Promise((res, rej) => {
  const i = ++seq;
  pending.set(i, { res, rej });
  ws.send(JSON.stringify({ id: i, cmd, args }));
});

function need(v: string | undefined, what: string): string {
  if (!v) throw new Error(`missing ${what}\n\n${USAGE}`);
  return v;
}

async function main(): Promise<unknown> {
  if (a0 === 'daemon' && a1 === 'stop') return call('daemon.stop');
  if (a0 === 'plugin') {
    if (a1 === 'list') return call('plugin.list');
    if (a1 === 'remove') return call('plugin.remove', { name: need(a2, 'NAME') });
    if (a1 === 'install') {
      const file = need(a2, 'FILE');
      const r = await call('plugin.install', { name: basename(file).replace(/\.m?js$/, ''), source: readFileSync(file, 'utf8') });
      if (!r.live) process.exitCode = 1;
      return r;
    }
    throw new Error(USAGE);
  }
  await call('hello', { project: resolve(o.project ?? process.env.BULB_PROJECT ?? process.cwd()) });
  switch (a0) {
    case 'project':
      if (a1 === 'list') return call('project.list');
      if (a1 === 'open') return call('project.open', { project: resolve(need(a2, 'DIR')), tab: p[3] });
      throw new Error(USAGE);
    case 'inspect': return call('inspect');
    case 'tab':
      if (a1 === 'new') return call('tab.new', { ...tabOpts(), pane: o.pane });
      if (a1 === 'close') return call('tab.close', { tab: need(a2, 'TAB') });
      if (a1 === 'activate') return call('tab.activate', { tab: need(a2, 'TAB') });
      if (a1 === 'rename') return call('tab.rename', { tab: need(a2, 'TAB'), title: need(p[3], 'TITLE') });
      throw new Error(USAGE);
    case 'split': return call('split.new', { ...tabOpts(), target: o.target, root: o.root, dir: o.dir, before: o.before, fixed: o.fixed });
    case 'focus': return call('pane.focus', { pane: need(a1, 'PANE') });
    case 'undo': return call('layout.undo');
    case 'redo': return call('layout.redo');
    case 'send': return call('session.input', { session: need(a1, 'SESSION'), data: need(a2, 'TEXT') });
    case 'read': process.stdout.write((await call('session.read', { session: need(a1, 'SESSION') })).data); return undefined;
    case 'notify': return call('notify', { title: need(a1, 'TITLE'), body: a2 ?? '', session: process.env.BULB_SESSION });
    case 'notify-open': return call('notify.open', { id: need(a1, 'ID') });
    case 'screenshot': {
      const out = need(a1, 'OUT.png');
      const { png } = await call('screenshot');
      writeFileSync(out, Buffer.from(png, 'base64'));
      return { written: resolve(out) };
    }
    default: throw new Error(`unknown command ${a0}\n\n${USAGE}`);
  }
}
try {
  const r = await main();
  if (r !== undefined) console.log(JSON.stringify(r, null, 2));
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
ws.close();
