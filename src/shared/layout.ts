// Pure layout engine: every operation returns the next layout and its inverse.
export type Size = { fixed: number } | { flex: number };
export type Tab =
  | { id: string; title: string; kind: 'terminal'; sessionId: string; cwd: string }
  | { id: string; title: string; kind: 'view'; view: string; props?: Record<string, unknown> };
export type Pane = { type: 'pane'; id: string; tabs: Tab[]; active: string };
export type Split = { type: 'split'; id: string; dir: 'row' | 'column'; children: LayoutNode[]; sizes: Size[] };
export type LayoutNode = Pane | Split;
export type Layout = { root: LayoutNode | null; focus: string | null };

export type Op =
  | { op: 'add-tab'; pane: string; tab: Tab }
  | { op: 'close-tab'; tab: string }
  | { op: 'split'; target: string; dir: 'row' | 'column'; before?: boolean; tab: Tab; newPane: string; newSplit: string; size?: Size }
  | { op: 'activate'; tab: string }
  | { op: 'focus'; pane: string }
  | { op: 'resize'; split: string; sizes: Size[] }
  | { op: 'rename'; tab: string; title: string }
  | { op: 'restore'; layout: Layout };

export class LayoutError extends Error {}

export function* walk(node: LayoutNode | null): Generator<LayoutNode> {
  if (!node) return;
  yield node;
  if (node.type === 'split') for (const c of node.children) yield* walk(c);
}
export const panes = (l: Layout): Pane[] => [...walk(l.root)].filter((n): n is Pane => n.type === 'pane');
export const tabs = (l: Layout): Tab[] => panes(l).flatMap((p) => p.tabs);
export const paneOfTab = (l: Layout, tab: string): Pane | undefined => panes(l).find((p) => p.tabs.some((t) => t.id === tab));
export const tabOfSession = (l: Layout, session: string): Tab | undefined =>
  tabs(l).find((t) => t.kind === 'terminal' && t.sessionId === session);

function find(l: Layout, id: string): LayoutNode {
  for (const n of walk(l.root)) if (n.id === id) return n;
  throw new LayoutError(`no node with id ${id}`);
}
function findPane(l: Layout, id: string): Pane {
  const n = find(l, id);
  if (n.type !== 'pane') throw new LayoutError(`${id} is not a pane`);
  return n;
}
function requirePane(l: Layout, tab: string): Pane {
  const p = paneOfTab(l, tab);
  if (!p) throw new LayoutError(`no tab with id ${tab}`);
  return p;
}
/** Rebuilds the tree, replacing nodes via fn. Returning null removes a node. */
function mapTree(node: LayoutNode, fn: (n: LayoutNode) => LayoutNode | null): LayoutNode | null {
  if (node.type === 'pane') return fn(node);
  const children: LayoutNode[] = [];
  const sizes: Size[] = [];
  node.children.forEach((c, i) => {
    const next = mapTree(c, fn);
    if (next) { children.push(next); sizes.push(node.sizes[i]!); }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return fn(children[0]!); // collapse single-child splits
  return fn({ ...node, children, sizes });
}
const replace = (l: Layout, fn: (n: LayoutNode) => LayoutNode | null): LayoutNode | null => (l.root ? mapTree(l.root, fn) : null);

function validSizes(sizes: Size[], count: number): void {
  if (sizes.length !== count) throw new LayoutError(`expected ${count} sizes, got ${sizes.length}`);
  for (const s of sizes) {
    const v = 'fixed' in s ? s.fixed : s.flex;
    if (!Number.isFinite(v) || v <= 0) throw new LayoutError('sizes must be positive numbers');
  }
}

export function apply(l: Layout, op: Op): { layout: Layout; inverse: Op } {
  const restore: Op = { op: 'restore', layout: l };
  switch (op.op) {
    case 'restore':
      return { layout: op.layout, inverse: restore };
    case 'add-tab': {
      findPane(l, op.pane);
      const root = replace(l, (n) => (n.id === op.pane && n.type === 'pane' ? { ...n, tabs: [...n.tabs, op.tab], active: op.tab.id } : n));
      return { layout: { root, focus: op.pane }, inverse: restore };
    }
    case 'close-tab': {
      const pane = requirePane(l, op.tab);
      const root = replace(l, (n) => {
        if (n.id !== pane.id || n.type !== 'pane') return n;
        const idx = n.tabs.findIndex((t) => t.id === op.tab);
        const rest = n.tabs.filter((t) => t.id !== op.tab);
        if (rest.length === 0) return null;
        return { ...n, tabs: rest, active: n.active === op.tab ? rest[Math.max(0, idx - 1)]!.id : n.active };
      });
      const next: Layout = { root, focus: l.focus };
      if (!panes(next).some((p) => p.id === next.focus)) next.focus = panes(next)[0]?.id ?? null;
      return { layout: next, inverse: restore };
    }
    case 'split': {
      const target = find(l, op.target);
      const fresh: Pane = { type: 'pane', id: op.newPane, tabs: [op.tab], active: op.tab.id };
      const size = op.size ?? { flex: 1 };
      const parent = [...walk(l.root)].find((n): n is Split => n.type === 'split' && n.children.some((c) => c.id === target.id));
      const asSibling = target.type === 'split' && target.dir === op.dir ? target : parent?.dir === op.dir ? parent : null;
      let root: LayoutNode | null;
      if (asSibling) {
        root = replace(l, (n) => {
          if (n.id !== asSibling.id || n.type !== 'split') return n;
          const children = [...n.children];
          const sizes = [...n.sizes];
          let at = n.id === target.id ? (op.before ? 0 : children.length) : children.findIndex((c) => c.id === target.id) + (op.before ? 0 : 1);
          at = Math.max(0, at);
          children.splice(at, 0, fresh);
          sizes.splice(at, 0, size);
          return { ...n, children, sizes };
        });
      } else {
        root = replace(l, (n) => {
          if (n.id !== target.id) return n;
          const children = op.before ? [fresh, n] : [n, fresh];
          const sizes: Size[] = op.before ? [size, { flex: 1 }] : [{ flex: 1 }, size];
          return { type: 'split', id: op.newSplit, dir: op.dir, children, sizes };
        });
      }
      // Fixed panes are chrome such as sidebars, so they don't take focus.
      return { layout: { root, focus: 'fixed' in size ? l.focus : op.newPane }, inverse: restore };
    }
    case 'activate': {
      const pane = requirePane(l, op.tab);
      const root = replace(l, (n) => (n.id === pane.id && n.type === 'pane' ? { ...n, active: op.tab } : n));
      return { layout: { root, focus: pane.id }, inverse: restore };
    }
    case 'focus':
      findPane(l, op.pane);
      return { layout: { ...l, focus: op.pane }, inverse: restore };
    case 'resize': {
      const s = find(l, op.split);
      if (s.type !== 'split') throw new LayoutError(`${op.split} is not a split`);
      validSizes(op.sizes, s.children.length);
      return { layout: { ...l, root: replace(l, (n) => (n.id === op.split && n.type === 'split' ? { ...n, sizes: op.sizes } : n)) }, inverse: restore };
    }
    case 'rename': {
      const pane = requirePane(l, op.tab);
      const root = replace(l, (n) =>
        n.id === pane.id && n.type === 'pane' ? { ...n, tabs: n.tabs.map((t) => (t.id === op.tab ? { ...t, title: op.title } : t)) } : n);
      return { layout: { ...l, root }, inverse: restore };
    }
  }
}
