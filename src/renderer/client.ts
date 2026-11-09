// Connection to the daemon, plus the small store React reads from.
// Terminal output deliberately bypasses this store and React.
import { useSyncExternalStore } from 'react';
import type { Layout } from '../shared/layout.ts';
import type { Notification, PluginFile, ServerEvent, SessionInfo, Snapshot } from '../shared/protocol.ts';

declare global {
  interface Window {
    bulbNative?: {
      capture(): Promise<string>;
      chooseProject(): Promise<string | null>;
      notify(n: { id: string; title: string; body: string }): void;
      onNotificationClick(cb: (id: string) => void): void;
      daemonLost(): void;
    };
  }
}
const params = new URLSearchParams(location.search);
export const project = params.get('project') ?? '';
export const recoveryMode = params.get('recovery') === '1';

export type State = { connected: boolean; layout: Layout; sessions: SessionInfo[]; notifications: Notification[] };
let state: State = { connected: false, layout: { root: null, focus: null }, sessions: [], notifications: [] };
const listeners = new Set<() => void>();
const set = (patch: Partial<State>): void => { state = { ...state, ...patch }; listeners.forEach((l) => l()); };
export const getState = (): State => state;
export const subscribe = (l: () => void): (() => void) => { listeners.add(l); return () => listeners.delete(l); };
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

type Handlers = {
  output: (session: string, data: string) => void;
  plugins: (plugins: PluginFile[]) => void;
  reconnected: () => void;
  event: (name: string, payload: unknown) => void;
};
const handlers: Handlers = { output: () => {}, plugins: () => {}, reconnected: () => {}, event: () => {} };
export const setHandlers = (h: Partial<Handlers>): void => { Object.assign(handlers, h); };

let ws: WebSocket | null = null;
let seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();

export function command<T = any>(cmd: string, args: object = {}): Promise<T> {
  if (cmd === 'project.choose') {
    const chosen = window.bulbNative?.chooseProject()
      ?? Promise.resolve(window.prompt('Project directory (absolute path)'));
    return chosen.then((path) => path?.trim()
      ? command<T>('project.open', { project: path.trim() }) : null as T);
  }
  const result = new Promise<T>((res, rej) => {
    if (ws?.readyState !== WebSocket.OPEN) { rej(new Error('not connected to the daemon')); return; }
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, cmd, args }));
  });
  if (cmd === 'project.open') {
    return result.then((value) => {
      const next = value as { project: string };
      const url = new URL(location.href);
      url.searchParams.set('project', next.project);
      location.replace(url.href);
      return value;
    });
  }
  return result;
}

function onEvent(e: ServerEvent): void {
  switch (e.ev) {
    case 'layout': set({ layout: e.layout }); break;
    case 'sessions': set({ sessions: e.sessions }); break;
    case 'output': handlers.output(e.session, e.data); return;
    case 'plugins': handlers.plugins(e.plugins); return;
    case 'notifications':
      set({ notifications: e.notifications });
      if (e.fresh) window.bulbNative?.notify({ id: e.fresh.id, title: e.fresh.title, body: e.fresh.body });
      break;
    case 'screenshot':
      (window.bulbNative?.capture() ?? Promise.reject(new Error('screenshots need the Electron app')))
        .then((png) => command('screenshot.result', { id: e.id, png }))
        .catch((err: Error) => command('screenshot.result', { id: e.id, error: err.message }));
      return;
  }
  handlers.event(e.ev, e);
}

let connectedOnce = false;
let failures = 0;
export function connect(onReady: (snap: Snapshot) => void): void {
  ws = new WebSocket(`ws://127.0.0.1:${params.get('port')}/?token=${params.get('token')}`);
  ws.onopen = async () => {
    failures = 0;
    const snap = await command<Snapshot>('hello', { project, ui: !recoveryMode });
    set({ connected: true, layout: snap.layout, sessions: snap.sessions, notifications: snap.notifications });
    onReady(snap);
    if (connectedOnce) handlers.reconnected();
    connectedOnce = true;
  };
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data as string);
    if (msg.ev) { onEvent(msg); return; }
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.ok) p?.res(msg.result); else p?.rej(new Error(msg.error));
  };
  ws.onclose = () => {
    set({ connected: false });
    for (const p of pending.values()) p.rej(new Error('connection lost'));
    pending.clear();
    // A restarted daemon has a new port and token, so Electron reloads with fresh ones.
    if (++failures >= 2 && window.bulbNative) { window.bulbNative.daemonLost(); return; }
    setTimeout(() => connect(onReady), 1000);
  };
}
