import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, 'dist');
const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const readSource = (path) => readFile(join(root, path), 'utf8');
function replaceRequired(source, oldValue, newValue) {
  if (!source.includes(oldValue)) throw new Error(`Build reference not found: ${oldValue}`);
  return source.replace(oldValue, newValue);
}

await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'src'), { recursive: true });
for (const file of ['favicon.svg', '_headers', 'robots.txt', 'sitemap.xml']) {
  await cp(join(root, file), join(output, file));
}

const engine = await readSource('src/engine.js');
const engineVersion = fingerprint(engine);
await writeFile(join(output, 'src/engine.js'), engine);

const worker = replaceRequired(await readSource('src/worker.js'), "from './engine.js'", `from './engine.js?v=${engineVersion}'`);
const workerVersion = fingerprint(worker);
await writeFile(join(output, 'src/worker.js'), worker);

let app = replaceRequired(await readSource('src/app.js'), "from './engine.js'", `from './engine.js?v=${engineVersion}'`);
app = replaceRequired(app, "new URL('./worker.js', import.meta.url)", `new URL('./worker.js?v=${workerVersion}', import.meta.url)`);
const appVersion = fingerprint(app);
await writeFile(join(output, 'src/app.js'), app);

const styles = await readSource('styles.css');
await writeFile(join(output, 'styles.css'), styles);
let html = replaceRequired(await readSource('index.html'), 'href="./styles.css"', `href="./styles.css?v=${fingerprint(styles)}"`);
html = replaceRequired(html, 'src="./src/app.js"', `src="./src/app.js?v=${appVersion}"`);
await writeFile(join(output, 'index.html'), html);
process.stdout.write('Static site built in dist/\n');
