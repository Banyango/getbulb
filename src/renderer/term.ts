// xterm instances live outside React, so moving a pane never touches a session.
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { command, setHandlers, subscribe, getState } from './client.ts';

type Entry = { term: Terminal; fit: FitAddon; el: HTMLDivElement; lastSize: string };
const entries = new Map<string, Entry>();
const cssVar = (n: string): string => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const theme = () => ({ background: cssVar('--bulb-bg'), foreground: cssVar('--bulb-text'), cursor: cssVar('--bulb-text'), selectionBackground: '#214283' });
export const refreshTerminalTheme = (): void => { for (const e of entries.values()) e.term.options.theme = theme(); };

function entryFor(session: string): Entry {
  const existing = entries.get(session);
  if (existing) return existing;
  const el = document.createElement('div');
  el.className = 'term-el';
  const term = new Terminal({ fontFamily: cssVar('--bulb-font-mono'), fontSize: 13, scrollback: 10000, allowProposedApi: true, theme: theme() });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const entry: Entry = { term, fit, el, lastSize: '' };
  entries.set(session, entry);
  term.onData((data) => { void command('session.input', { session, data }).catch(() => {}); });
  term.onBinary((data) => { void command('session.input', { session, data }).catch(() => {}); });
  void command('session.attach', { session }).catch(() => {});
  return entry;
}

function fitEntry(session: string, e: Entry): void {
  // Never send a degenerate size: a collapsed pane must not disturb the program inside.
  if (!e.el.isConnected || e.el.clientWidth < 80 || e.el.clientHeight < 40) return;
  e.fit.fit();
  const size = `${e.term.cols}x${e.term.rows}`;
  if (size !== e.lastSize) {
    e.lastSize = size;
    void command('session.resize', { session, cols: e.term.cols, rows: e.term.rows }).catch(() => {});
  }
}

/** Mounts a session's terminal in host and returns the unmount function. */
export function mountTerminal(session: string, host: HTMLElement): () => void {
  const e = entryFor(session);
  host.appendChild(e.el);
  if (!e.term.element) {
    e.term.open(e.el);
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      e.term.loadAddon(gl);
    } catch { /* falls back to the DOM renderer */ }
  }
  let frame = 0;
  const ro = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => fitEntry(session, e)); });
  ro.observe(host);
  fitEntry(session, e);
  return () => { ro.disconnect(); cancelAnimationFrame(frame); if (e.el.parentElement === host) host.removeChild(e.el); };
}
export const focusTerminal = (session: string): void => entries.get(session)?.term.focus();

setHandlers({
  output: (session, data) => entries.get(session)?.term.write(data),
  reconnected: () => {
    for (const [session, e] of entries) {
      e.term.reset();
      void command('session.attach', { session }).catch(() => {});
    }
  },
});
// Dispose terminals whose sessions have ended.
subscribe(() => {
  const s = getState();
  if (!s.connected) return;
  const live = new Set(s.sessions.map((x) => x.id));
  for (const [session, e] of entries) {
    if (!live.has(session)) { e.term.dispose(); e.el.remove(); entries.delete(session); }
  }
});
