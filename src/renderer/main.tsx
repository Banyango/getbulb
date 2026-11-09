import { Component, createElement, useEffect, useRef, useState, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { LayoutNode, Pane, Tab } from '../shared/layout.ts';
import { command, connect, recoveryMode, useStore } from './client.ts';
import * as builtin from './plugins/builtin.tsx';
import { builtinFor, loadBuiltin, lookup, registryRevision, reportRenderError, subscribeRegistry, syncPlugins } from './sdk.ts';
import { focusTerminal, mountTerminal } from './term.ts';
import './style.css';

class Boundary extends Component<{ owner: string; resetKey: unknown; fallback?: ComponentType<any> | null; fallbackProps?: object; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { reportRenderError(this.props.owner, error.message); }
  componentDidUpdate(prev: { resetKey: unknown }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    const Fallback = this.props.fallback;
    if (Fallback) return createElement(Fallback, this.props.fallbackProps);
    return <div className="plugin-error" role="alert">Plugin "{this.props.owner}" crashed. Your sessions are still running.<pre>{this.state.error.message}</pre></div>;
  }
}

const useRegistry = (): number => useSyncExternalStore(subscribeRegistry, registryRevision);

function Slot({ name, ...props }: { name: string } & Record<string, unknown>) {
  const rev = useRegistry();
  const found = lookup('slot', name);
  if (!found) return null;
  return <Boundary owner={found.owner} resetKey={rev} fallback={found.owner.startsWith('builtin:') ? null : builtinFor('slot', name)} fallbackProps={props}>{createElement(found.component, props)}</Boundary>;
}

function TabContent({ tab, focused }: { tab: Tab; focused: boolean }) {
  const rev = useRegistry();
  const name = tab.kind === 'terminal' ? 'terminal' : tab.view;
  const found = lookup('view', name);
  if (!found) return <div className="placeholder">No plugin provides the view "{name}".</div>;
  const props = tab.kind === 'terminal' ? { sessionId: tab.sessionId, tab, focused } : { ...tab.props, tab, focused };
  return <Boundary owner={found.owner} resetKey={rev}>{createElement(found.component, props)}</Boundary>;
}

function PaneView({ pane, focused }: { pane: Pane; focused: boolean }) {
  const active = pane.tabs.find((t) => t.id === pane.active);
  const attention = useStore((s) => pane.tabs.some((t) => t.kind === 'terminal' && s.notifications.some((n) => !n.read && n.session === t.sessionId)));
  return (
    <div className={`pane${focused ? ' focused' : ''}${attention ? ' attention' : ''}`} data-pane={pane.id} onMouseDownCapture={() => { if (!focused) void command('pane.focus', { pane: pane.id }); }}>
      <Slot name="tabBar" pane={pane} />
      <div className="pane-body">{active && <TabContent key={active.id} tab={active} focused={focused} />}</div>
    </div>
  );
}

function NodeView({ node, focus }: { node: LayoutNode; focus: string | null }) {
  if (node.type === 'pane') return <PaneView pane={node} focused={node.id === focus} />;
  return <Slot name="split" node={node}>{node.children.map((c) => <NodeView key={c.id} node={c} focus={focus} />)}</Slot>;
}

function App() {
  const layout = useStore((s) => s.layout);
  useRegistry();
  return (
    <div className="app">
      {layout.root && <NodeView key={layout.root.id} node={layout.root} focus={layout.focus} />}
      <Slot name="overlay" />
    </div>
  );
}

/** Recovery mode loads no plugins and uses its own terminal, so a bad edit can't lock the user out. */
function Recovery() {
  const [session, setSession] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const connected = useStore((s) => s.connected);
  useEffect(() => {
    if (connected && !session) void command<{ id: string }>('session.recovery').then((s) => setSession(s.id));
  }, [connected, session]);
  useEffect(() => {
    if (!session || !ref.current) return;
    const off = mountTerminal(session, ref.current);
    focusTerminal(session);
    return off;
  }, [session]);
  return (
    <div className="recovery">
      <header>Recovery mode: no plugins are loaded. Fix or remove plugins in ~/.bulb/plugins, then choose View &gt; Normal Mode.</header>
      <div className="pane-body"><div className="term-host" ref={ref} /></div>
    </div>
  );
}

if (!recoveryMode) {
  for (const [name, activate] of Object.entries(builtin)) loadBuiltin(name, activate);
}
let first = true;
connect((snap) => {
  void syncPlugins(snap.plugins);
  if (first) {
    first = false;
    createRoot(document.getElementById('root')!).render(recoveryMode ? <Recovery /> : <App />);
    window.bulbNative?.onNotificationClick((id) => void command('notify.open', { id }));
  }
});
