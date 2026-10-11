import { analyzeText, repairAnalysis } from './engine.js';

let current = null;
let currentId = null;

self.onmessage = ({ data }) => {
  const { id, action } = data;
  try {
    if (action === 'analyze') {
      current = analyzeText(data.text);
      currentId = id;
      self.postMessage({
        id,
        action: 'analyzed',
        rows: current.rows.map(({ path, declared, computed, status, reason }) => ({ path, declared, computed, status, reason })),
        rootBox: current.rootBox,
        rootMissing: current.rootMissing,
        positions: current.positions,
        dimensions: current.dimensions,
        differences: current.differences,
        uncheckable: current.uncheckable,
      });
    } else if (action === 'repair') {
      if (!current || currentId !== data.analysisId) throw new Error('The input changed. Analyze it again before repairing.');
      const result = repairAnalysis(current, { addRoot: Boolean(data.addRoot) });
      const verified = analyzeText(result.text);
      if (verified.differences !== 0 || verified.uncheckable !== 0) throw new Error('The repaired file did not pass the second bbox check.');
      self.postMessage({ id, action: 'repaired', text: result.text, changed: result.changed });
    }
  } catch (error) {
    self.postMessage({ id, action: 'error', message: error.message || 'Unable to process this GeoJSON.', path: error.path || '$' });
  }
};
