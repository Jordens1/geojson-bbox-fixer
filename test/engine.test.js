import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeText, repairAnalysis, MAX_INPUT_BYTES } from '../src/engine.js';

const check = (object) => analyzeText(JSON.stringify(object));

test('finds a mismatch and changes only bbox data', () => {
  const input = {
    type: 'Feature',
    bbox: [0, 0, 1, 1],
    properties: { label: '<img src=x onerror=alert(1)>', nested: { bbox: [99] } },
    geometry: { type: 'Point', coordinates: [2, 3] },
  };
  const result = check(input);
  assert.equal(result.differences, 1);
  assert.deepEqual(result.rows[0].computed, [2, 3, 2, 3]);
  const fixed = repairAnalysis(result);
  assert.deepEqual(fixed.document.bbox, [2, 3, 2, 3]);
  assert.deepEqual(fixed.document.properties, input.properties);
  assert.deepEqual(input.bbox, [0, 0, 1, 1]);
  assert.equal(check(fixed.document).differences, 0);
});

test('inspects root, feature and geometry boxes separately', () => {
  const document = {
    type: 'FeatureCollection',
    bbox: [0, 0, 1, 1],
    features: [{
      type: 'Feature',
      bbox: [2, 2, 3, 3],
      properties: {},
      geometry: {
        type: 'Polygon',
        bbox: [0, 0, 1, 1],
        coordinates: [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]],
      },
    }],
  };
  const result = check(document);
  assert.equal(result.rows.length, 3);
  assert.equal(result.differences, 2);
  assert.deepEqual(result.rows.map((row) => row.path), ['$.features[0].geometry', '$.features[0]', '$']);
  const fixed = repairAnalysis(result);
  assert.equal(fixed.changed, 2);
  assert.deepEqual(fixed.document.features[0].bbox, [2, 2, 3, 3]);
  assert.equal(check(fixed.document).differences, 0);
});

test('can add a missing root bbox without adding child boxes', () => {
  const result = check({ type: 'FeatureCollection', features: [
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [-2, 4] } },
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [5, 7] } },
  ] });
  assert.equal(result.rootMissing, true);
  assert.deepEqual(result.rootBox, [-2, 4, 5, 7]);
  const fixed = repairAnalysis(result, { addRoot: true }).document;
  assert.deepEqual(fixed.bbox, [-2, 4, 5, 7]);
  assert.equal(Object.hasOwn(fixed.features[0], 'bbox'), false);
});

test('calculates a 3D bbox with elevation in axis order', () => {
  const result = check({ type: 'MultiPoint', bbox: [0, 0, 0, 1, 1, 1], coordinates: [[2, 3, 9], [4, 8, -5]] });
  assert.deepEqual(result.rootBox, [2, 3, -5, 4, 8, 9]);
  assert.deepEqual(repairAnalysis(result).document.bbox, [2, 3, -5, 4, 8, 9]);
});

test('uses a short crossing bbox for already-cut antimeridian geometry', () => {
  const result = check({
    type: 'MultiLineString',
    bbox: [177, -20, -178, -16],
    coordinates: [
      [[177, -20], [180, -18]],
      [[-180, -18], [-178, -16]],
    ],
  });
  assert.deepEqual(result.rootBox, [177, -20, -178, -16]);
  assert.equal(result.differences, 0);
});

test('does not turn an uncut long line into a short crossing bbox', () => {
  const result = check({ type: 'LineString', bbox: [100, 0, -100, 0], coordinates: [[-100, 0], [100, 0]] });
  assert.deepEqual(result.rootBox, [-100, 0, 100, 0]);
  assert.equal(result.differences, 1);
});

test('allows a larger box but describes it as a difference', () => {
  const result = check({ type: 'Point', bbox: [-10, -10, 10, 10], coordinates: [0, 0] });
  assert.equal(result.rows[0].status, 'different');
  assert.deepEqual(result.rootBox, [0, 0, 0, 0]);
});

test('accepts a tiny numeric rounding difference', () => {
  const result = check({ type: 'Point', bbox: [1 + 1e-10, 2, 1, 2], coordinates: [1, 2] });
  assert.equal(result.differences, 0);
});

test('null geometry with a declared bbox blocks all automatic repair', () => {
  const result = check({ type: 'Feature', bbox: [0, 0, 1, 1], properties: {}, geometry: null });
  assert.equal(result.uncheckable, 1);
  assert.equal(result.canRepair, false);
  assert.throws(() => repairAnalysis(result), /blocked/);
});

test('empty collection without bbox stays unmodified', () => {
  const result = check({ type: 'FeatureCollection', features: [] });
  assert.equal(result.rootBox, null);
  assert.equal(result.canRepair, false);
  assert.throws(() => repairAnalysis(result, { addRoot: true }), /no coordinates/);
});

test('rejects malformed structures, mixed dimensions and out-of-range coordinates', () => {
  assert.throws(() => analyzeText('{'), /JSON syntax error/);
  assert.throws(() => check({ type: 'FeatureCollection', features: [{ type: 'Point', coordinates: [0, 0] }] }), /Expected a Feature/);
  assert.throws(() => check({ type: 'Point', coordinates: [181, 0] }), /Longitude/);
  assert.throws(() => check({ type: 'MultiPoint', coordinates: [[0, 0], [1, 1, 3]] }), /Mixed 2D and 3D/);
  assert.throws(() => check({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] }), /must end/);
});

test('enforces the input byte limit', () => {
  assert.throws(() => analyzeText(' '.repeat(MAX_INPUT_BYTES + 1)), /5 MiB/);
});

test('rejects excessive nesting even in foreign properties', () => {
  let nested = {};
  for (let index = 0; index < 70; index++) nested = { next: nested };
  assert.throws(() => check({ type: 'Point', bbox: [0, 0, 1, 1], coordinates: [1, 1], metadata: nested }), /JSON nesting exceeds/);
});
