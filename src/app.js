import { MAX_INPUT_BYTES } from './engine.js';

const el = (id) => document.getElementById(id);
const input = el('geojson-input');
const status = el('status');
const rows = el('row-list');
const sample = {
  type: 'FeatureCollection',
  bbox: [0, 0, 1, 1],
  features: [{
    type: 'Feature',
    properties: { name: 'Demo parcel', owner: 'Synthetic example only' },
    bbox: [0, 0, 1, 1],
    geometry: { type: 'Polygon', coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]] },
  }],
};
let worker;
let sequence = 0;
let analysisId = null;
let sourceName = 'geojson';
let output = '';

function makeNode(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KiB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MiB';
}

function setStatus(message, kind = '') {
  status.textContent = message;
  status.className = ('status ' + kind).trim();
}

function resetResult() {
  analysisId = null;
  output = '';
  el('result-caption').textContent = 'Awaiting input';
  el('empty-state').hidden = false;
  el('result-content').hidden = true;
  el('output-panel').hidden = true;
  el('repair-button').hidden = true;
  el('add-root-button').hidden = true;
  el('extent-preview').hidden = true;
  rows.replaceChildren();
}

function resetWorker() {
  if (worker) worker.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('message', onWorkerMessage);
}

function invalidate() {
  sequence++;
  resetWorker();
  resetResult();
  setStatus('Ready to inspect your GeoJSON.');
  el('input-size').textContent = formatBytes(new Blob([input.value]).size);
}

function formatBox(value) {
  if (value === null) return 'No coordinates to calculate';
  if (value === undefined) return 'Not declared';
  if (!Array.isArray(value)) return 'Invalid bbox (expected a numeric array)';
  const display = value.slice(0, 8).map((entry) => Number.isFinite(entry) ? String(entry) : '[non-number]');
  return '[' + display.join(', ') + (value.length > 8 ? ', …' : '') + ']';
}

function longitudeSegments(box) {
  if (!Array.isArray(box) || ![4, 6].includes(box.length) || !box.every(Number.isFinite)) return [];
  const west = box[0];
  const east = box[box.length / 2];
  if (west < -180 || west > 180 || east < -180 || east > 180) return [];
  return west <= east ? [[west, east]] : [[west, 180], [-180, east]];
}

function paintTrack(track, box, color) {
  track.querySelectorAll('.range-segment').forEach((segment) => segment.remove());
  for (const [west, east] of longitudeSegments(box)) {
    const segment = makeNode('span', 'range-segment ' + color);
    segment.style.left = ((west + 180) / 360) * 100 + '%';
    segment.style.width = Math.max(((east - west) / 360) * 100, 0.5) + '%';
    track.append(segment);
  }
}

function showPreview(row) {
  const preview = el('extent-preview');
  preview.hidden = row.computed === null;
  if (preview.hidden) return;
  el('preview-path').textContent = row.path;
  paintTrack(el('declared-track'), row.declared, 'declared');
  paintTrack(el('computed-track'), row.computed, 'computed');
}

function renderRow(row) {
  const item = makeNode('article', 'result-row ' + row.status);
  const top = makeNode('div', 'result-row-top');
  top.append(makeNode('code', 'result-path', row.path));
  top.append(makeNode('span', 'result-badge', row.status === 'match' ? 'MATCHES' : row.status === 'uncheckable' ? 'UNVERIFIABLE' : 'DIFFERENT'));
  item.append(top);
  const comparison = makeNode('div', 'comparison');
  const declared = makeNode('div', 'comparison-value');
  declared.append(makeNode('span', '', 'DECLARED'), makeNode('code', '', formatBox(row.declared)));
  const computed = makeNode('div', 'comparison-value');
  computed.append(makeNode('span', '', 'CALCULATED'), makeNode('code', '', formatBox(row.computed)));
  comparison.append(declared, computed);
  item.append(comparison);
  if (row.computed) {
    const inspect = makeNode('button', 'row-inspect', 'View longitude extent ↗');
    inspect.type = 'button';
    inspect.addEventListener('click', () => showPreview(row));
    item.append(inspect);
  }
  return item;
}

function renderAnalysis(data) {
  el('empty-state').hidden = true;
  el('result-content').hidden = false;
  el('result-caption').textContent = data.dimensions ? data.dimensions + 'D GeoJSON' : 'No coordinates';
  el('position-count').textContent = data.positions.toLocaleString();
  el('box-count').textContent = data.rows.length.toLocaleString();
  el('difference-count').textContent = data.differences.toLocaleString();
  el('no-bbox-note').hidden = !(data.rows.length === 0 && data.rootBox);
  el('uncheckable-note').hidden = data.uncheckable === 0;
  rows.replaceChildren();
  if (data.rows.length === 0) rows.append(makeNode('p', 'no-rows', data.rootBox ? 'No declared bbox found. You can add a root bbox below.' : 'No coordinate extent or declared bbox is available.'));
  data.rows.forEach((row) => rows.append(renderRow(row)));
  const first = data.rows.find((row) => row.status === 'different' && row.computed) || data.rows.find((row) => row.computed);
  if (first) showPreview(first);
  el('repair-button').hidden = !(data.differences > 0 && data.uncheckable === 0);
  el('repair-button').querySelector('span').textContent = 'Fix ' + data.differences + ' mismatched bbox ' + (data.differences === 1 ? 'value' : 'values');
  el('add-root-button').hidden = !(data.rootMissing && data.rootBox && data.uncheckable === 0);
  el('add-root-button').textContent = data.differences > 0 ? 'Fix mismatches and add a root bbox' : 'Add a root bbox';
  if (data.uncheckable > 0) setStatus('Some boxes have no coordinate extent. Automatic repair is blocked.', 'warning');
  else if (data.differences > 0) setStatus(data.differences + ' bbox ' + (data.differences === 1 ? 'value differs' : 'values differ') + ' from the calculated extent.', 'attention');
  else if (data.rows.length > 0) setStatus('All declared bbox values match the calculated extent.', 'success');
  else if (data.rootBox) setStatus('No bbox is declared. A root bbox can be added.', 'attention');
  else setStatus('No coordinates or declared bbox were found.', 'warning');
}

function onWorkerMessage({ data }) {
  if (data.id !== sequence) return;
  el('analyze-button').disabled = false;
  el('repair-button').disabled = false;
  el('add-root-button').disabled = false;
  if (data.action === 'error') {
    setStatus(data.path + ': ' + data.message, 'error');
  } else if (data.action === 'analyzed') {
    analysisId = data.id;
    renderAnalysis(data);
  } else if (data.action === 'repaired') {
    output = data.text;
    el('output-text').value = output;
    el('output-caption').textContent = data.changed + ' bbox ' + (data.changed === 1 ? 'change' : 'changes') + ' · verified again';
    el('result-caption').textContent = 'Original input audit';
    el('repair-button').hidden = true;
    el('add-root-button').hidden = true;
    el('output-panel').hidden = false;
    el('output-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('Repaired ' + data.changed + ' bbox ' + (data.changed === 1 ? 'value' : 'values') + ' and verified the result.', 'success');
  }
}

function analyze() {
  const bytes = new Blob([input.value]).size;
  if (bytes > MAX_INPUT_BYTES) return setStatus('Input exceeds the 5 MiB limit. Choose a smaller GeoJSON file.', 'error');
  if (!input.value.trim()) {
    setStatus('Paste GeoJSON or choose a file first.', 'error');
    input.focus();
    return;
  }
  sequence++;
  resetResult();
  el('analyze-button').disabled = true;
  setStatus('Inspecting coordinate extents…');
  worker.postMessage({ id: sequence, action: 'analyze', text: input.value });
}

function repair(addRoot) {
  if (analysisId === null) return;
  sequence++;
  el('repair-button').disabled = true;
  el('add-root-button').disabled = true;
  setStatus('Updating bbox values and verifying the result…');
  worker.postMessage({ id: sequence, action: 'repair', analysisId, addRoot });
}

function safeDownloadName() {
  const base = sourceName.replace(/\.(geojson|json)$/i, '').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^\.+/, '').slice(0, 80) || 'geojson';
  return base + '-bbox-fixed.geojson';
}

async function loadFile(file) {
  if (!file) return;
  if (!/\.(geojson|json)$/i.test(file.name)) return setStatus('Choose a .geojson or .json file.', 'error');
  if (file.size > MAX_INPUT_BYTES) return setStatus('File exceeds the 5 MiB limit.', 'error');
  try {
    input.value = await file.text();
    sourceName = file.name;
    el('source-name').textContent = file.name;
    invalidate();
  } catch {
    setStatus('This file could not be read. Choose another file.', 'error');
  }
}

resetWorker();
input.addEventListener('input', () => { sourceName = 'geojson'; el('source-name').textContent = 'Unsaved input'; invalidate(); });
el('file-input').addEventListener('change', (event) => loadFile(event.target.files?.[0]));
const dropZone = el('drop-zone');
dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); loadFile(event.dataTransfer?.files?.[0]); });
el('sample-button').addEventListener('click', () => { input.value = JSON.stringify(sample, null, 2) + '\n'; sourceName = 'sample'; el('source-name').textContent = 'Synthetic example'; invalidate(); });
el('clear-button').addEventListener('click', () => { input.value = ''; el('file-input').value = ''; sourceName = 'geojson'; el('source-name').textContent = 'Unsaved input'; invalidate(); input.focus(); });
el('analyze-button').addEventListener('click', analyze);
el('repair-button').addEventListener('click', () => repair(false));
el('add-root-button').addEventListener('click', () => repair(true));
el('download-button').addEventListener('click', () => {
  if (!output) return;
  const url = URL.createObjectURL(new Blob([output], { type: 'application/geo+json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = safeDownloadName();
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
});
el('copy-button').addEventListener('click', async () => {
  if (!output) return;
  try {
    await navigator.clipboard.writeText(output);
    el('copy-button').textContent = 'Copied';
    window.setTimeout(() => { el('copy-button').textContent = 'Copy JSON'; }, 1800);
  } catch {
    el('output-text').focus();
    el('output-text').select();
    setStatus('Clipboard access is unavailable. The output is selected for manual copying.', 'warning');
  }
});
