import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = dirname(fileURLToPath(import.meta.url));
const root = process.argv.includes('--dist') ? join(project, 'dist') : project;
const port = Number(process.env.PORT || 8788);
const host = process.env.BBOX_HOST || '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};
const pages = new Map([['/', 'index.html'], ['/geojson-bbox-format/', 'geojson-bbox-format/index.html']]);
const assets = new Set(['/styles.css', '/favicon.svg', '/favicon.png', '/bbox-example.png', '/robots.txt', '/sitemap.xml', '/src/app.js', '/src/worker.js', '/src/engine.js']);
const redirects = new Map([
  ['/index.html', '/'], ['/geojson-bbox-mismatch-fixer', '/'], ['/geojson-bbox-mismatch-fixer/', '/'],
  ['/geojson-bbox-format', '/geojson-bbox-format/'], ['/geojson-bbox-format/index.html', '/geojson-bbox-format/'],
]);
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
    const destination = redirects.get(pathname);
    if (destination) {
      response.writeHead(301, { Location: destination + url.search }).end();
      return;
    }
    const asset = pathname.replace(/^\/geojson-bbox-mismatch-fixer\//, '/');
    const file = pages.get(pathname) ?? (assets.has(asset) ? asset.slice(1) : undefined);
    const relative = file ?? '404.html';
    const body = await readFile(join(root, relative));
    response.writeHead(file ? 200 : 404, { 'Content-Type': types[extname(relative)], 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, host, () => {
  process.stdout.write('GeoJSON bbox fixer: http://' + host + ':' + port + '/\n');
});
