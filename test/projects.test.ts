import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tabs, panes } from '../src/shared/layout.ts';

const exec = promisify(execFile);
test('projects retain separate layouts and running sessions', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'bulb-project-test-'));
  const first = join(temp, 'first');
  const second = join(temp, 'second');
  mkdirSync(first);
  mkdirSync(second);
  const env = { ...process.env, BULB_HOME: join(temp, 'home'), BULB_PROJECT: first };
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const call = async (...args: string[]) => {
    const { stdout } = await exec(process.execPath, [cli, ...args], { env });
    return JSON.parse(stdout);
  };
  try {
    const before = await call('inspect');
    await call('split', '--root', '--dir', 'row', '--before', '--fixed', '220', '--view', 'sessions');
    const opened = await call('project', 'open', second);
    assert.equal(opened.project, second);
    const added = await call('--project', second, 'tab', 'new', '--title', 'second tab');
    const secondState = await call('--project', second, 'inspect');
    assert.equal(secondState.sessions.length, 2);
    assert.equal(tabs(secondState.layout).filter(t => t.kind === 'view' && t.view === 'sessions').length, 1);
    assert.ok(panes(secondState.layout).filter(p => p.tabs.some(t => t.kind === 'view' && t.view === 'sessions')).every(p => p.tabs.every(t => t.kind === 'view')));
    const listed = await call('project', 'list');
    assert.deepEqual(listed.map((p: any) => p.project), [first, second]);
    assert.ok(listed.find((p: any) => p.project === second).tabs.some((t: any) => t.id === added.id));
    assert.ok(listed.every((p: any) => p.tabs.every((t: any) => t.kind !== 'view' || t.view !== 'sessions')));
    await call('project', 'open', second, added.id);
    const selected = await call('--project', second, 'inspect');
    assert.equal(panes(selected.layout).find(p => p.id === selected.layout.focus)?.active, added.id);
    assert.deepEqual(selected.sessions, secondState.sessions);
    assert.deepEqual((await call('inspect')).sessions, before.sessions);
    await assert.rejects(call('project', 'open', join(temp, 'missing')));
  } finally {
    await call('daemon', 'stop');
  }
});
