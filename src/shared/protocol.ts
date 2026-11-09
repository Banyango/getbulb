import type { Layout } from './layout.ts';
export type SessionInfo = { id: string; cwd: string; pid: number; ephemeral: boolean };
export type Notification = { id: string; title: string; body: string; session?: string; read: boolean; at: number };
export type PluginFile = { name: string; version: string; source: string };
export type PluginStatus = { name: string; version: string; status: 'live' | 'failed'; error?: string };
export type UiReport = { plugins: PluginStatus[]; views: string[]; slots: Record<string, string>; renderErrors: { owner: string; error: string }[]; theme: Record<string, string> };
export type Snapshot = { project: string; layout: Layout; sessions: SessionInfo[]; notifications: Notification[]; plugins: PluginFile[] };
export type ServerEvent =
  | { ev: 'layout'; layout: Layout }
  | { ev: 'sessions'; sessions: SessionInfo[] }
  | { ev: 'output'; session: string; data: string }
  | { ev: 'notifications'; notifications: Notification[]; fresh?: Notification }
  | { ev: 'plugins'; plugins: PluginFile[] }
  | { ev: 'screenshot'; id: string };
