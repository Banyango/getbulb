import { build } from 'esbuild';
const common = { bundle: true, platform: 'node', format: 'cjs', external: ['electron'], target: 'node20', logLevel: 'warning' };
await build({ ...common, entryPoints: ['src/electron/main.ts'], outfile: 'dist/electron/main.cjs' });
await build({ ...common, entryPoints: ['src/electron/preload.ts'], outfile: 'dist/electron/preload.cjs' });
