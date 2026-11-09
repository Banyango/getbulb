// Serves the renderer to an ordinary browser, for machines without a usable Electron display.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { ensureDaemon } from '../src/shared/connect.ts';

const appRoot = resolve(import.meta.dirname, '..');
const dist = join(appRoot, 'dist/renderer');
const project = resolve(process.argv[2] ?? process.cwd());
const info = await ensureDaemon(appRoot);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  const file = normalize(join(dist, path === '/' ? 'index.html' : path));
  if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => {
  const q = new URLSearchParams({ port: String(info.port), token: info.token, project });
  console.log(`http://127.0.0.1:${server.address().port}/?${q}`);
});
