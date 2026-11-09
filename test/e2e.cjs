// End-to-end check: the real renderer and daemon, driven only by the public CLI.
// Runs offscreen in Electron, so it needs no display. Screenshots go to BULB_E2E_OUT.
const { app, BrowserWindow } = require('electron');
const { execFile } = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bulb-e2e-'));
const out = process.env.BULB_E2E_OUT || tmp;
const project = path.join(tmp, 'project');
fs.mkdirSync(project);
const env = { ...process.env, BULB_HOME: path.join(tmp, 'home'), BULB_PROJECT: project };
delete env.BULB_SESSION;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const raw = (...args) => new Promise((res) => execFile(path.join(root, 'bin/bulb'), args, { env }, (err, stdout, stderr) => res({ code: err ? err.code : 0, stdout, stderr })));
async function bulb(...args) {
  const r = await raw(...args);
  if (r.code !== 0) throw new Error(`bulb ${args.join(' ')}: ${r.stderr}${r.stdout}`);
  const t = r.stdout.trim();
  return t.startsWith('{') || t.startsWith('[') ? JSON.parse(t) : r.stdout;
}
async function until(what, fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}
let win, frame;
function newWindow() {
  win = new BrowserWindow({ width: 1200, height: 760, show: true, webPreferences: { offscreen: true } });
  win.setContentSize(1200, 760);
  win.webContents.setFrameRate(10);
  win.webContents.on('paint', (_e, _d, image) => { frame = image; });
}
async function load() {
  const { port, token } = JSON.parse(fs.readFileSync(path.join(env.BULB_HOME, 'daemon.json'), 'utf8'));
  await win.loadFile(path.join(root, 'dist/renderer/index.html'), { query: { port: String(port), token, project } });
}
const js = (code) => win.webContents.executeJavaScript(code);
const shot = async (name) => { await sleep(800); if (frame) fs.writeFileSync(path.join(out, `${name}.png`), frame.toPNG()); };
const plugin = (name, src) => { const f = path.join(tmp, `${name}.js`); fs.writeFileSync(f, src); return raw('plugin', 'install', f); };
const check = async (name, fn) => { await fn(); console.log(`ok - ${name}`); };
function* walkTabs(n) { if (n.type === 'pane') yield* n.tabs; else for (const c of n.children) yield* walkTabs(c); }
const allTabs = (d) => [...walkTabs(d.layout.root)];

async function main() {
  await bulb('daemon', 'start');
  newWindow();
  await load();

  await check('first launch is one terminal with the guide', async () => {
    await until('UI', async () => (await bulb('inspect')).uiConnected);
    const d = await bulb('inspect');
    assert.equal(d.layout.root.type, 'pane');
    assert.equal(d.sessions.length, 1);
    assert.match(await bulb('read', d.sessions[0].id), /Bulb/);
    await until('xterm', async () => (await js(`document.querySelectorAll('.xterm').length`)) === 1);
    assert.equal(await js(`document.querySelectorAll('.tabbar').length`), 0);
    await shot('1-first-launch');
  });

  let side;
  await check('an agent builds the sidebar through the public API', async () => {
    const r = await bulb('plugin', 'install', path.join(root, 'examples/session-sidebar.js'));
    assert.equal(r.live, true);
    await bulb('split', '--dir', 'row', '--title', 'agent');
    await bulb('split', '--root', '--dir', 'row', '--before', '--fixed', '220', '--view', 'sessions', '--title', 'Sessions');
    await until('sidebar items', async () => (await js(`document.querySelectorAll('.bulb-list-item').length`)) === 2);
    side = await bulb('inspect');
    await shot('2-sidebar');
  });

  await check('session input and output round-trip', async () => {
    const s = side.sessions[0].id;
    await bulb('send', s, 'echo marker-$((40+2))\n');
    await until('output', async () => /marker-42/.test(await bulb('read', s)));
  });

  await check('OSC 9 and 777 notify, and clicking opens the right pane', async () => {
    const d = await bulb('inspect');
    const first = d.layout.root.children[1];
    await bulb('tab', 'new', '--pane', first.id, '--title', 'other');
    const noisy = first.tabs[0].sessionId;
    await bulb('send', noisy, `printf '\\033]9;tests done\\a\\033]777;notify;Build;it passed\\a'\n`);
    const notes = await until('notifications', async () => { const n = await bulb('inspect'); return n.notifications.length === 2 && n.notifications; });
    assert.equal(notes[0].body, 'tests done');
    assert.equal(notes[1].title, 'Build');
    await until('toasts', async () => (await js(`document.querySelectorAll('.toast').length`)) === 2);
    await shot('3-notification');
    await js(`document.querySelector('.toast').click()`);
    const after = await until('activation', async () => {
      const n = await bulb('inspect');
      const p = n.layout.root.children[1];
      return p.tabs.find((t) => t.id === p.active).sessionId === noisy && n;
    });
    assert.equal(after.layout.focus, first.id);
    assert.ok(after.notifications.every((n) => n.read));
  });

  await check('a broken update keeps the old plugin and reports the error', async () => {
    assert.equal((await plugin('hello', `export default (b) => b.views.register('hello', () => b.h('b', null, 'v1'))`)).code, 0);
    const bad = await plugin('hello', `export default (b) => { throw new Error('boom') }`);
    assert.notEqual(bad.code, 0);
    assert.match(bad.stdout, /boom/);
    assert.ok((await bulb('inspect')).ui.views.includes('hello'));
    assert.notEqual((await plugin('syntax', `this is not js`)).code, 0);
    await bulb('plugin', 'remove', 'syntax');
    await bulb('plugin', 'remove', 'hello');
  });

  await check('a crashing tab bar falls back to the bundled one; sessions live on', async () => {
    const before = (await bulb('inspect')).sessions.map((s) => s.pid);
    await plugin('badbar', `export default (b) => b.slots.register('tabBar', () => { throw new Error('bar broke') })`);
    await until('reported crash', async () => (await bulb('inspect')).ui.renderErrors.some((e) => /bar broke/.test(e.error)));
    await until('fallback tab bar', async () => (await js(`document.querySelectorAll('.tabbar').length`)) > 0);
    assert.deepEqual((await bulb('inspect')).sessions.map((s) => s.pid), before);
    await bulb('plugin', 'remove', 'badbar');
  });

  await check('undo and redo', async () => {
    const a = allTabs(await bulb('inspect')).length;
    await bulb('tab', 'new');
    assert.equal(allTabs(await bulb('inspect')).length, a + 1);
    await bulb('undo');
    assert.equal(allTabs(await bulb('inspect')).length, a);
    await bulb('redo');
    assert.equal(allTabs(await bulb('inspect')).length, a + 1);
    await bulb('undo');
  });

  await check('a session that exits closes its tab', async () => {
    const r = await bulb('tab', 'new', '--cmd', 'exit 0', '--title', 'short');
    await until('tab closed', async () => !allTabs(await bulb('inspect')).some((t) => t.id === r.id));
  });

  await check('sessions and layout survive reopening the UI', async () => {
    const before = await bulb('inspect');
    const s = before.sessions[0].id;
    win.destroy();
    await until('UI gone', async () => !(await bulb('inspect')).uiConnected);
    await bulb('send', s, 'echo while-closed\n');
    newWindow();
    await load();
    await until('reconnected', async () => (await bulb('inspect')).uiConnected);
    const after = await bulb('inspect');
    assert.deepEqual(after.sessions.map((x) => x.pid), before.sessions.map((x) => x.pid));
    assert.deepEqual(after.layout, before.layout);
    await until('output kept', async () => /while-closed/.test(await bulb('read', s)));
    await shot('4-reopened');
  });

  await check('project sidebar switches saved tabs while sessions keep running', async () => {
    const before = await bulb('inspect');
    const originalSession = before.sessions[0];
    const other = path.join(tmp, 'second-project');
    fs.mkdirSync(other);
    await bulb('--project', other, 'tab', 'new', '--title', 'second-tab');
    await until('second project listed', async () => js(`!!document.querySelector('button[title="${other}"]')`));
    await js(`document.querySelector('button[title="${other}"]').click()`);
    await until('project switched', async () => (await js(`new URL(location.href).searchParams.get('project')`)) === other);
    await until('project tabs rendered', async () => js(`Array.from(document.querySelectorAll('.bulb-list-item')).some(el => el.textContent === 'second-tab')`));
    const second = await bulb('--project', other, 'inspect');
    assert.equal(second.sessions.length, 2);
    assert.ok(allTabs(second).some(t => t.kind === 'view' && t.view === 'sessions'));
    await bulb('send', originalSession.id, 'echo project-switch-alive\n');
    await until('background session output', async () => /project-switch-alive/.test(await bulb('read', originalSession.id)));
    const otherPid = second.sessions[0].pid;
    await js(`document.querySelector('button[title="${project}"]').click()`);
    await until('original project restored', async () => (await js(`new URL(location.href).searchParams.get('project')`)) === project);
    await until('original sidebar rendered', async () => js(`!!document.querySelector('button[title="${other}"]')`));
    assert.equal((await bulb('inspect')).sessions.find(s => s.id === originalSession.id).pid, originalSession.pid);
    assert.equal((await bulb('--project', other, 'inspect')).sessions[0].pid, otherPid);
    // Selecting a nested tab also switches projects and activates that exact tab.
    await js(`Array.from(document.querySelectorAll('.bulb-list-item')).find(el => el.textContent === 'second-tab').click()`);
    await until('nested tab project switched', async () => (await js(`new URL(location.href).searchParams.get('project')`)) === other);
    const activated = await bulb('--project', other, 'inspect');
    const target = allTabs(activated).find(t => t.title === 'second-tab');
    assert.equal(activated.layout.root.children[1].active, target.id);
    await until('other sidebar ready', async () => js(`!!document.querySelector('button[title="${project}"]')`));
    await js(`document.querySelector('button[title="${project}"]').click()`);
    await until('back to original', async () => (await js(`new URL(location.href).searchParams.get('project')`)) === project);
    await until('original terminal mounted', async () => js(`!!document.querySelector('.xterm')`));
  });

  await check('after a daemon crash, the layout returns with new shells', async () => {
    const before = await bulb('inspect');
    process.kill(JSON.parse(fs.readFileSync(path.join(env.BULB_HOME, 'daemon.json'), 'utf8')).pid, 'SIGKILL');
    await sleep(200);
    await bulb('daemon', 'start');
    await load();
    await until('reconnected', async () => (await bulb('inspect')).uiConnected);
    const after = await bulb('inspect');
    assert.deepEqual(after.layout, before.layout);
    assert.equal(after.sessions.length, before.sessions.length);
    assert.notDeepEqual(after.sessions.map((x) => x.pid), before.sessions.map((x) => x.pid));
  });
}

app.on('window-all-closed', () => {}); // the reopen test closes the only window
app.whenReady().then(main).then(() => 0, (e) => { console.error(`FAILED: ${e.stack || e}`); return 1; }).then(async (code) => {
  await raw('daemon', 'stop').catch(() => {});
  console.log(code ? 'e2e failed' : 'e2e passed');
  app.exit(code);
});
