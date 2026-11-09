import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, panes, type Layout, type Tab } from '../src/shared/layout.ts';

const t = (id: string): Tab => ({ id, title: id, kind: 'terminal', sessionId: `s${id}`, cwd: '/' });
const base = (): Layout => ({ root: { type: 'pane', id: 'p1', tabs: [t('a')], active: 'a' }, focus: 'p1' });
const split = (l: Layout, target: string, n: string, dir: 'row' | 'column' = 'row', extra = {}) =>
  apply(l, { op: 'split', target, dir, tab: t(n), newPane: `p${n}`, newSplit: `sp${n}`, ...extra }).layout;

test('split wraps a pane, keeps its id, and focuses the new pane', () => {
  const l = split(base(), 'p1', 'b');
  assert.equal(l.root?.type, 'split');
  assert.deepEqual(panes(l).map((p) => p.id), ['p1', 'pb']);
  assert.equal(l.focus, 'pb');
});
test('a same-direction split joins the parent; a cross split nests', () => {
  const l = split(split(base(), 'p1', 'b'), 'p1', 'c');
  assert.deepEqual(panes(l).map((p) => p.id), ['p1', 'pc', 'pb']);
  assert.equal(l.root?.type === 'split' && l.root.children.length, 3);
  const n = split(l, 'pc', 'd', 'column');
  assert.equal(n.root?.type === 'split' && n.root.children[1]?.type, 'split');
});
test('a fixed sidebar around the root does not take focus', () => {
  const l = split(split(base(), 'p1', 'b', 'column'), 'spb', 'side', 'row', { before: true, size: { fixed: 240 } });
  assert.equal(l.root?.type === 'split' && l.root.dir, 'row');
  assert.deepEqual(l.root?.type === 'split' && l.root.sizes[0], { fixed: 240 });
  assert.equal(panes(l)[0]?.id, 'pside');
  assert.equal(l.focus, 'pb');
});
test('closing the last tab collapses the pane and split', () => {
  const l = split(base(), 'p1', 'b');
  const r = apply(l, { op: 'close-tab', tab: 'b' }).layout;
  assert.equal(r.root?.type, 'pane');
  assert.equal(r.root?.id, 'p1');
  assert.equal(r.focus, 'p1');
  assert.equal(apply(r, { op: 'close-tab', tab: 'a' }).layout.root, null);
});
test('closing the active tab activates a neighbour', () => {
  const l = apply(base(), { op: 'add-tab', pane: 'p1', tab: t('b') }).layout;
  const r = apply(l, { op: 'close-tab', tab: 'b' }).layout;
  assert.equal(r.root?.type === 'pane' && r.root.active, 'a');
});
test('every operation inverts exactly', () => {
  const l = split(base(), 'p1', 'b');
  const { layout, inverse } = apply(l, { op: 'close-tab', tab: 'a' });
  assert.notDeepEqual(layout, l);
  assert.deepEqual(apply(layout, inverse).layout, l);
});
test('input layouts are not mutated', () => {
  const l = base();
  const copy = structuredClone(l);
  split(l, 'p1', 'b');
  assert.deepEqual(l, copy);
});
test('unknown ids and bad sizes are rejected', () => {
  assert.throws(() => apply(base(), { op: 'close-tab', tab: 'x' }));
  const l = split(base(), 'p1', 'b');
  assert.throws(() => apply(l, { op: 'resize', split: 'spb', sizes: [{ flex: 1 }] }));
  assert.throws(() => apply(l, { op: 'resize', split: 'spb', sizes: [{ flex: -1 }, { flex: 1 }] }));
});
