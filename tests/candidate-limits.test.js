const test = require('node:test');
const assert = require('node:assert/strict');

const {
  hasCandidateLimit,
  limitCandidatesByTemplate,
  normalizeCandidateLimit,
} = require('../src/core/candidate-limits');

test('candidate limits are absent by default so coverage sweeps can exhaust results', () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({ index }));

  assert.equal(normalizeCandidateLimit(undefined), null);
  assert.equal(normalizeCandidateLimit(null), null);
  assert.equal(hasCandidateLimit({}), false);
  assert.equal(limitCandidatesByTemplate(candidates, {}).length, 12);
});

test('explicit maxCandidates still caps callers that intentionally request a small set', () => {
  const candidates = Array.from({ length: 12 }, (_, index) => ({ index }));

  assert.equal(normalizeCandidateLimit(8), 8);
  assert.equal(hasCandidateLimit({ maxCandidates: 8 }), true);
  assert.deepEqual(limitCandidatesByTemplate(candidates, { maxCandidates: 8 }), candidates.slice(0, 8));
});
