// The plugin SDK and registry. Bundled plugins use exactly this API.
import { createElement, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import type { PluginFile, PluginStatus, UiReport } from '../shared/protocol.ts';
import * as layoutLib from '../shared/layout.ts';
import { command, recoveryMode, setHandlers, useStore, project } from './client.ts';
import { refreshTerminalTheme } from './term.ts';
import * as ui from './ui.tsx';

export type Registration = { kind: 'view' | 'slot'; name: string; component: ComponentType<any> };
type Loaded = { owner: string; version: string; regs: Registration[]; dispose?: () => void };
const loaded = new Map<string, Loaded>(); // insertion order decides precedence: later wins
const statuses = new Map<string, PluginStatus>();
const renderErrors = new Map<string, string>();
let revision = 0;
const revListeners = new Set<() => void>();
const bumped = (): void => { revision++; revListeners.forEach((l) => l()); scheduleReport(); };
export const subscribeRegistry = (l: () => void): (() => void) => { revListeners.add(l); return () => revListeners.delete(l); };
export const registryRevision = (): number => revision;

export function lookup(kind: Registration['kind'], name: string): { component: ComponentType<any>; owner: string } | null {
  let found: { component: ComponentType<any>; owner: string } | null = null;
  for (const p of loaded.values()) for (const r of p.regs) if (r.kind === kind && r.name === name) found = { component: r.component, owner: p.owner };
  return found;
}
/** The fallback when a replacement crashes: the bundled implementation. */
export function builtinFor(kind: Registration['kind'], name: string): ComponentType<any> | null {
  for (const p of loaded.values()) if (p.owner.startsWith('builtin:')) for (const r of p.regs) if (r.kind === kind && r.name === name) return r.component;
  return null;
}

const tokens: Record<string, string> = {};
function setTheme(next: Record<string, string>): void {
  for (const [k, v] of Object.entries(next)) {
    const name = k.startsWith('--') ? k : `--bulb-${k}`;
    document.documentElement.style.setProperty(name, v);
    tokens[name] = v;
  }
  refreshTerminalTheme();
  scheduleReport();
}
function themeTokens(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
        for (const prop of rule.style) if (prop.startsWith('--bulb-')) out[prop] = rule.style.getPropertyValue(prop).trim();
      }
    }
  }
  return { ...out, ...tokens };
}

const eventListeners = new Map<string, Set<(p: unknown) => void>>();
setHandlers({ event: (name, payload) => eventListeners.get(name)?.forEach((l) => l(payload)), plugins: (p) => { void syncPlugins(p); } });

function makeApi(regs: Registration[]) {
  return {
    React: { createElement, useEffect, useMemo, useRef, useState },
    h: createElement,
    ui,
    layout: layoutLib,
    project,
    views: { register: (name: string, component: ComponentType<any>) => { regs.push({ kind: 'view', name, component }); } },
    slots: { register: (name: 'tabBar' | 'split' | 'overlay', component: ComponentType<any>) => { regs.push({ kind: 'slot', name, component }); } },
    theme: { set: setTheme, tokens: themeTokens },
    command,
    on: (event: string, cb: (payload: unknown) => void) => {
      let set = eventListeners.get(event);
      if (!set) eventListeners.set(event, (set = new Set()));
      set.add(cb);
      return () => set.delete(cb);
    },
    useLayout: () => useStore((s) => s.layout),
    useSessions: () => useStore((s) => s.sessions),
    useNotifications: () => useStore((s) => s.notifications),
  };
}
export type BulbApi = ReturnType<typeof makeApi>;
export type Activate = (bulb: BulbApi) => void | (() => void);

export function loadBuiltin(name: string, activate: Activate): void {
  const regs: Registration[] = [];
  const dispose = activate(makeApi(regs)) ?? undefined;
  loaded.set(`builtin:${name}`, { owner: `builtin:${name}`, version: 'bundled', regs, dispose });
  bumped();
}

/** Activates first and swaps only on success, so a broken update leaves the old version running. */
async function loadUser(file: PluginFile): Promise<void> {
  const regs: Registration[] = [];
  const url = URL.createObjectURL(new Blob([file.source], { type: 'text/javascript' }));
  try {
    const mod = await import(/* @vite-ignore */ url);
    if (typeof mod.default !== 'function') throw new Error('a plugin must `export default function (bulb) {...}`');
    const dispose = (mod.default as Activate)(makeApi(regs)) ?? undefined;
    const prev = loaded.get(file.name);
    try { prev?.dispose?.(); } catch (e) { console.error(e); }
    loaded.delete(file.name);
    loaded.set(file.name, { owner: file.name, version: file.version, regs, dispose });
    renderErrors.delete(file.name);
    statuses.set(file.name, { name: file.name, version: file.version, status: 'live' });
  } catch (e) {
    statuses.set(file.name, { name: file.name, version: file.version, status: 'failed', error: e instanceof Error ? `${e.message}` : String(e) });
  } finally {
    URL.revokeObjectURL(url);
  }
}

let sync: Promise<void> = Promise.resolve();
export function syncPlugins(files: PluginFile[]): Promise<void> {
  if (recoveryMode) return Promise.resolve();
  sync = sync.then(async () => {
    const names = new Set(files.map((f) => f.name));
    for (const [name, p] of [...loaded]) {
      if (p.owner.startsWith('builtin:') || names.has(name)) continue;
      try { p.dispose?.(); } catch (e) { console.error(e); }
      loaded.delete(name);
      statuses.delete(name);
      renderErrors.delete(name);
    }
    for (const f of files) if (statuses.get(f.name)?.version !== f.version) await loadUser(f);
    bumped();
  });
  return sync;
}

export function reportRenderError(owner: string, error: string): void {
  renderErrors.set(owner, error);
  scheduleReport();
}

let reportTimer = 0;
function scheduleReport(): void {
  clearTimeout(reportTimer);
  reportTimer = window.setTimeout(sendReport, 30);
}
function sendReport(): void {
  if (recoveryMode) return;
  const views = new Set<string>();
  const slots: Record<string, string> = {};
  for (const p of loaded.values()) for (const r of p.regs) { if (r.kind === 'view') views.add(r.name); else slots[r.name] = p.owner; }
  const report: UiReport = {
    plugins: [...statuses.values()], views: [...views], slots,
    renderErrors: [...renderErrors].map(([owner, error]) => ({ owner, error })), theme: themeTokens(),
  };
  void command('ui.report', { report }).catch(() => {});
}
