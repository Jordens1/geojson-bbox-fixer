export const MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_POSITIONS = 200_000;
export const MAX_DEPTH = 64;
const EPSILON = 1e-9;
const GEOMETRY_TYPES = new Set([
  'Point', 'MultiPoint', 'LineString', 'MultiLineString',
  'Polygon', 'MultiPolygon', 'GeometryCollection',
]);

export class GeoJSONError extends Error {
  constructor(message, path = '$') {
    super(message);
    this.name = 'GeoJSONError';
    this.path = path;
  }
}

function fail(message, path) {
  throw new GeoJSONError(message, path);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function checkJSONDepth(root) {
  const stack = [{ value: root, depth: 0 }];
  let containers = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (value === null || typeof value !== 'object') continue;
    if (depth > MAX_DEPTH) fail('JSON nesting exceeds 64 levels.', '$');
    containers++;
    if (containers > 500_000) fail('JSON contains too many nested containers.', '$');
    if (Array.isArray(value)) {
      for (const child of value) if (child !== null && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
    } else {
      for (const key of Object.keys(value)) {
        const child = value[key];
        if (child !== null && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
      }
    }
  }
}

function makeCoverage() {
  return { intervals: [], south: Infinity, north: -Infinity, low: Infinity, high: -Infinity, positions: 0 };
}

function appendCoverage(target, child) {
  for (const interval of child.intervals) target.intervals.push(interval);
  target.south = Math.min(target.south, child.south);
  target.north = Math.max(target.north, child.north);
  target.low = Math.min(target.low, child.low);
  target.high = Math.max(target.high, child.high);
  target.positions += child.positions;
}

function addPosition(coverage, position, path, state) {
  if (!Array.isArray(position) || (position.length !== 2 && position.length !== 3)) {
    fail('Each position must contain longitude, latitude, and optional elevation.', path);
  }
  if (!position.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    fail('Coordinates must be finite numbers.', path);
  }
  const [lon, lat, elevation] = position;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    fail('Longitude must be within −180…180 and latitude within −90…90 (WGS84).', path);
  }
  if (state.dimensions !== null && state.dimensions !== position.length) {
    fail('Mixed 2D and 3D positions cannot be repaired reliably.', path);
  }
  state.dimensions = position.length;
  state.positions++;
  if (state.positions > MAX_POSITIONS) fail(`This file exceeds the ${MAX_POSITIONS.toLocaleString()}-position limit.`, path);
  coverage.positions++;
  coverage.south = Math.min(coverage.south, lat);
  coverage.north = Math.max(coverage.north, lat);
  if (position.length === 3) {
    coverage.low = Math.min(coverage.low, elevation);
    coverage.high = Math.max(coverage.high, elevation);
  }
  return lon;
}

function addLine(coverage, positions, path, state, ring = false) {
  if (!Array.isArray(positions)) fail('Expected an array of positions.', path);
  if (positions.length === 0) return;
  if (positions.length < (ring ? 4 : 2)) fail(ring ? 'A polygon ring needs at least four positions.' : 'A line needs at least two positions.', path);
  if (ring && JSON.stringify(positions[0]) !== JSON.stringify(positions.at(-1))) {
    fail('A polygon ring must end at its first position.', path);
  }
  let previous;
  for (let index = 0; index < positions.length; index++) {
    const lon = addPosition(coverage, positions[index], `${path}[${index}]`, state);
    if (previous !== undefined) coverage.intervals.push([Math.min(previous, lon), Math.max(previous, lon)]);
    previous = lon;
  }
}

function addPoints(coverage, positions, path, state) {
  if (!Array.isArray(positions)) fail('Expected an array of positions.', path);
  for (let index = 0; index < positions.length; index++) {
    const lon = addPosition(coverage, positions[index], `${path}[${index}]`, state);
    coverage.intervals.push([lon, lon]);
  }
}

function readGeometry(geometry, path, parts, depth, state, visit) {
  const coverage = makeCoverage();
  const values = geometry.coordinates;
  const kind = geometry.type;
  if (kind === 'GeometryCollection') {
    if (!Array.isArray(geometry.geometries)) fail('GeometryCollection needs a geometries array.', `${path}.geometries`);
    geometry.geometries.forEach((child, index) => {
      if (!isObject(child) || !GEOMETRY_TYPES.has(child.type)) fail('Expected a Geometry object.', `${path}.geometries[${index}]`);
      appendCoverage(coverage, visit(child, `${path}.geometries[${index}]`, [...parts, 'geometries', index], depth + 1));
    });
    return coverage;
  }
  if (!Array.isArray(values)) fail(`${kind} needs a coordinates array.`, `${path}.coordinates`);
  if (kind === 'Point') {
    if (values.length) {
      const lon = addPosition(coverage, values, `${path}.coordinates`, state);
      coverage.intervals.push([lon, lon]);
    }
  } else if (kind === 'MultiPoint') {
    addPoints(coverage, values, `${path}.coordinates`, state);
  } else if (kind === 'LineString') {
    addLine(coverage, values, `${path}.coordinates`, state);
  } else if (kind === 'MultiLineString') {
    values.forEach((line, index) => addLine(coverage, line, `${path}.coordinates[${index}]`, state));
  } else if (kind === 'Polygon') {
    values.forEach((ring, index) => addLine(coverage, ring, `${path}.coordinates[${index}]`, state, true));
  } else if (kind === 'MultiPolygon') {
    values.forEach((polygon, polygonIndex) => {
      if (!Array.isArray(polygon)) fail('Expected a polygon array.', `${path}.coordinates[${polygonIndex}]`);
      polygon.forEach((ring, ringIndex) => addLine(coverage, ring, `${path}.coordinates[${polygonIndex}][${ringIndex}]`, state, true));
    });
  }
  return coverage;
}

function longitudeBounds(intervals, south, north) {
  if (south === -90 || north === 90) return [-180, 180];
  // A line segment occupies the whole interval between its endpoints in RFC 7946.
  // Taking the complement of the largest uncovered circular gap allows already-cut
  // geometries on either side of the antimeridian to use a short spanning bbox.
  const normalized = intervals.map(([west, east]) => [west + 180, east + 180]);
  normalized.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const interval of normalized) {
    const last = merged.at(-1);
    if (last && interval[0] <= last[1] + EPSILON) last[1] = Math.max(last[1], interval[1]);
    else merged.push([...interval]);
  }
  const planarWest = merged[0][0] - 180;
  const planarEast = merged.at(-1)[1] - 180;
  const planarWidth = planarEast - planarWest;
  let largestGap = -1;
  let arcStart = planarWest;
  let arcEnd = planarEast;
  for (let index = 0; index < merged.length; index++) {
    const current = merged[index];
    const next = merged[(index + 1) % merged.length];
    const gap = (index === merged.length - 1 ? next[0] + 360 : next[0]) - current[1];
    if (gap > largestGap) {
      largestGap = gap;
      arcStart = next[0] - 180;
      arcEnd = current[1] - 180;
    }
  }
  const shortestWidth = 360 - largestGap;
  if (shortestWidth >= planarWidth - EPSILON) return [planarWest, planarEast];
  return [arcStart, arcEnd];
}

function calculatedBox(coverage, dimensions) {
  if (coverage.positions === 0) return null;
  const [west, east] = longitudeBounds(coverage.intervals, coverage.south, coverage.north);
  return dimensions === 3
    ? [west, coverage.south, coverage.low, east, coverage.north, coverage.high]
    : [west, coverage.south, east, coverage.north];
}

function matches(declared, calculated) {
  return Array.isArray(declared)
    && declared.length === calculated.length
    && declared.every((value, index) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value - calculated[index]) <= EPSILON);
}

export function analyzeText(text) {
  if (typeof text !== 'string') fail('Paste GeoJSON or choose a file first.', '$');
  if (new TextEncoder().encode(text).length > MAX_INPUT_BYTES) fail('Input exceeds the 5 MiB limit.', '$');
  if (text.trim() === '') fail('Paste GeoJSON or choose a file first.', '$');
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    fail(`JSON syntax error: ${error.message}`, '$');
  }
  if (!isObject(document)) fail('The top level must be a GeoJSON object.', '$');
  checkJSONDepth(document);
  const state = { dimensions: null, positions: 0, rows: [], uncheckable: 0 };
  const visit = (node, path, parts, depth) => {
    if (depth > MAX_DEPTH) fail(`GeoJSON nesting exceeds ${MAX_DEPTH} levels.`, path);
    if (!isObject(node)) fail('Expected a GeoJSON object.', path);
    const coverage = makeCoverage();
    if (GEOMETRY_TYPES.has(node.type)) {
      appendCoverage(coverage, readGeometry(node, path, parts, depth, state, visit));
    } else if (node.type === 'Feature') {
      if (!own(node, 'geometry')) fail('Feature needs a geometry member.', `${path}.geometry`);
      if (node.geometry !== null) {
        if (!isObject(node.geometry) || !GEOMETRY_TYPES.has(node.geometry.type)) fail('Feature geometry must be a Geometry object or null.', `${path}.geometry`);
        appendCoverage(coverage, visit(node.geometry, `${path}.geometry`, [...parts, 'geometry'], depth + 1));
      }
    } else if (node.type === 'FeatureCollection') {
      if (!Array.isArray(node.features)) fail('FeatureCollection needs a features array.', `${path}.features`);
      node.features.forEach((feature, index) => {
        if (!isObject(feature) || feature.type !== 'Feature') fail('Expected a Feature object.', `${path}.features[${index}]`);
        appendCoverage(coverage, visit(feature, `${path}.features[${index}]`, [...parts, 'features', index], depth + 1));
      });
    } else {
      fail('Unknown GeoJSON type.', `${path}.type`);
    }
    if (own(node, 'bbox')) {
      const computed = calculatedBox(coverage, state.dimensions);
      const status = computed === null ? 'uncheckable' : matches(node.bbox, computed) ? 'match' : 'different';
      if (status === 'uncheckable') state.uncheckable++;
      state.rows.push({ path, parts, declared: node.bbox, computed, status });
    }
    return coverage;
  };
  const rootCoverage = visit(document, '$', [], 0);
  const rootBox = calculatedBox(rootCoverage, state.dimensions);
  return {
    document,
    rows: state.rows,
    rootBox,
    rootMissing: !own(document, 'bbox'),
    positions: state.positions,
    dimensions: state.dimensions,
    differences: state.rows.filter((row) => row.status === 'different').length,
    uncheckable: state.uncheckable,
    canRepair: state.uncheckable === 0 && (state.rows.some((row) => row.status === 'different') || (!own(document, 'bbox') && rootBox !== null)),
  };
}

export function repairAnalysis(analysis, { addRoot = false } = {}) {
  if (analysis.uncheckable > 0) fail('A declared bbox has no checkable coordinates; repair is blocked.', '$');
  if (addRoot && !analysis.rootMissing) fail('The root already has a bbox.', '$');
  if (addRoot && analysis.rootBox === null) fail('The root has no coordinates from which to create a bbox.', '$');
  const fixed = JSON.parse(JSON.stringify(analysis.document));
  let changed = 0;
  for (const row of analysis.rows) {
    if (row.status !== 'different') continue;
    let node = fixed;
    for (const part of row.parts) node = node[part];
    node.bbox = [...row.computed];
    changed++;
  }
  if (addRoot) {
    fixed.bbox = [...analysis.rootBox];
    changed++;
  }
  return { document: fixed, text: `${JSON.stringify(fixed, null, 2)}\n`, changed };
}
