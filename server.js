import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8788);
const host = process.env.BBOX_HOST || '127.0.0.1';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const allowed = new Set(['index.html', 'styles.css', 'favicon.svg', 'src/app.js', 'src/worker.js', 'src/engine.js']);
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self'; connect-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Content-Security-Policy', csp);
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  try {
    const url = new URL(request.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === '/' || pathname === '/geojson-bbox-mismatch-fixer/'
      ? 'index.html'
      : pathname.replace(/^\/geojson-bbox-mismatch-fixer\//, '').replace(/^\/+/, '');
    const path = resolve(root, relative);
    if (!allowed.has(relative) || !path.startsWith(root + sep)) throw new Error('Not found');
    const info = await stat(path);
    if (!info.isFile() || !types[extname(path)]) throw new Error('Not found');
    response.writeHead(200, { 'Content-Type': types[extname(path)], 'Cache-Control': 'no-store' });
    if (request.method === 'HEAD') response.end();
    else response.end(await readFile(path));
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, host, () => {
  process.stdout.write('GeoJSON bbox fixer: http://' + host + ':' + port + '/\n');
});
