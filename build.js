import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const output = join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(join(output, 'src'), { recursive: true });
for (const file of ['index.html', 'styles.css', 'favicon.svg', '_headers']) {
  await cp(join(root, file), join(output, file));
}
for (const file of ['app.js', 'worker.js', 'engine.js']) {
  await cp(join(root, 'src', file), join(output, 'src', file));
}
process.stdout.write('Static site built in dist/\n');
