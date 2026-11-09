import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const bulbHome = (): string => process.env.BULB_HOME ?? join(homedir(), '.bulb');
export type DaemonInfo = { port: number; token: string; pid: number };

export function readInfo(): DaemonInfo | null {
  const file = join(bulbHome(), 'daemon.json');
  if (!existsSync(file)) return null;
  try {
    const info = JSON.parse(readFileSync(file, 'utf8')) as DaemonInfo;
    process.kill(info.pid, 0);
    return info;
  } catch {
    return null;
  }
}

export async function ensureDaemon(appRoot: string): Promise<DaemonInfo> {
  const running = readInfo();
  if (running) return running;
  const child = spawn(process.env.BULB_NODE ?? 'node', [join(appRoot, 'src/daemon/main.ts')], {
    detached: true, stdio: 'ignore', cwd: homedir(), env: { ...process.env, BULB_APP_ROOT: appRoot },
  });
  child.unref();
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const info = readInfo();
    if (info) return info;
  }
  throw new Error('bulb daemon did not start');
}
