// Bundled plugins: the terminal, default tab bar, default splits, toasts and keys.
// Each can be replaced from the public API.
import { useEffect, useRef, useState } from 'react';
import type { Pane, Size, Split } from '../../shared/layout.ts';
import { getState } from '../client.ts';
import { focusTerminal, mountTerminal } from '../term.ts';
import type { Activate } from '../sdk.ts';

export const terminal: Activate = (bulb) => {
  bulb.views.register('terminal', function TerminalView(p: { sessionId: string; focused: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => mountTerminal(p.sessionId, ref.current!), [p.sessionId]);
    useEffect(() => { if (p.focused) focusTerminal(p.sessionId); }, [p.focused, p.sessionId]);
    return <div className="term-host" ref={ref} />;
  });
};

export const tabs: Activate = (bulb) => {
  bulb.slots.register('tabBar', function TabBar({ pane }: { pane: Pane }) {
    const notes = bulb.useNotifications();
    const unread = (session: string): number => notes.filter((n) => !n.read && n.session === session).length;
    if (pane.tabs.length < 2) return null; // a lone terminal stays just a terminal
    return (
      <div className="tabbar" role="tablist">
        {pane.tabs.map((t) => {
          const count = t.kind === 'terminal' ? unread(t.sessionId) : 0;
          return (
            <div key={t.id} role="tab" aria-selected={t.id === pane.active} className={`tabitem${t.id === pane.active ? ' active' : ''}`} onClick={() => void bulb.command('tab.activate', { tab: t.id })}>
              <span className="label">{t.title}</span>
              {count > 0 && <bulb.ui.Badge>{count}</bulb.ui.Badge>}
              <button className="tabclose" aria-label={`Close ${t.title}`} onClick={(e) => { e.stopPropagation(); void bulb.command('tab.close', { tab: t.id }); }}>×</button>
            </div>
          );
        })}
      </div>
    );
  });
};

export const splits: Activate = (bulb) => {
  const MIN = 80;
  bulb.slots.register('split', function SplitView({ node, children }: { node: Split; children: React.ReactNode[] }) {
    const ref = useRef<HTMLDivElement>(null);
    const [live, setLive] = useState<Size[] | null>(null);
    const [dragging, setDragging] = useState(-1);
    const sizes = live ?? node.sizes;
    const horizontal = node.dir === 'row';

    function startDrag(e: React.PointerEvent, index: number): void {
      e.preventDefault();
      const els = [...ref.current!.children].filter((c) => c.classList.contains('split-child')) as HTMLElement[];
      const px = els.map((el) => (horizontal ? el.offsetWidth : el.offsetHeight));
      const start = horizontal ? e.clientX : e.clientY;
      const compute = (ev: PointerEvent): Size[] => {
        const total = px[index]! + px[index + 1]!;
        const a = Math.min(total - MIN, Math.max(MIN, px[index]! + (horizontal ? ev.clientX : ev.clientY) - start));
        const next = [...px];
        next[index] = a;
        next[index + 1] = total - a;
        return node.sizes.map((s, i) => ('fixed' in s ? { fixed: next[i]! } : { flex: next[i]! }));
      };
      setDragging(index);
      const move = (ev: PointerEvent): void => setLive(compute(ev));
      const up = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        setDragging(-1);
        setLive(null);
        void bulb.command('split.resize', { split: node.id, sizes: compute(ev) });
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
    return (
      <div ref={ref} className={`split ${node.dir}`}>
        {node.children.map((child, i) => {
          const s = sizes[i]!;
          return (
            <div key={child.id} style={{ display: 'contents' }}>
              {i > 0 && <div className={`divider${dragging === i - 1 ? ' dragging' : ''}`} onPointerDown={(e) => startDrag(e, i - 1)} />}
              <div className="split-child" style={{ flex: 'fixed' in s ? `0 0 ${s.fixed}px` : `${s.flex} 1 0` }}>{children[i]}</div>
            </div>
          );
        })}
      </div>
    );
  });
};

export const toasts: Activate = (bulb) => {
  const TOAST_MS = 8000;
  bulb.slots.register('overlay', function Toasts() {
    const notes = bulb.useNotifications();
    const [, tick] = useState(0);
    const visible = notes.filter((n) => !n.read && Date.now() - n.at < TOAST_MS).slice(-4);
    useEffect(() => {
      if (visible.length === 0) return;
      const t = setTimeout(() => tick((x) => x + 1), 1000);
      return () => clearTimeout(t);
    });
    return (
      <div className="toasts" aria-live="polite">
        {visible.map((n) => (
          <button key={n.id} className="toast" onClick={() => void bulb.command('notify.open', { id: n.id })}>
            <b>{n.title}</b><span>{n.body}</span>
          </button>
        ))}
      </div>
    );
  });
};

export const keys: Activate = (bulb) => {
  const onKey = (e: KeyboardEvent): void => {
    if (!e.ctrlKey || !e.shiftKey || e.altKey) return;
    const layout = getState().layout;
    const pane = bulb.layout.panes(layout).find((p) => p.id === layout.focus);
    const actions: Record<string, () => unknown> = {
      D: () => bulb.command('split.new', { dir: 'row' }),
      E: () => bulb.command('split.new', { dir: 'column' }),
      T: () => bulb.command('tab.new'),
      W: () => (pane ? bulb.command('tab.close', { tab: pane.active }) : undefined),
      Z: () => bulb.command('layout.undo'),
      Y: () => bulb.command('layout.redo'),
    };
    const action = actions[e.key.toUpperCase()];
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    void Promise.resolve(action()).catch(() => {});
  };
  document.addEventListener('keydown', onKey, true);
  return () => { document.removeEventListener('keydown', onKey, true); };
};
