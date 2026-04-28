const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  loadPersonaModes,
  getPersonaModeById,
  expandModeSearchTemplates,
} = require('../src/core/persona-modes');

test('loadPersonaModes loads configured persona modes', () => {
  const modes = loadPersonaModes(path.join(process.cwd(), 'config', 'modes', 'default.json'));

  assert.ok(Array.isArray(modes));
  assert.ok(modes.length >= 5);
  assert.ok(modes.some((mode) => mode.id === 'technical-champion-mode'));
});

test('getPersonaModeById returns the requested mode', () => {
  const modes = loadPersonaModes(path.join(process.cwd(), 'config', 'modes', 'default.json'));
  const mode = getPersonaModeById(modes, 'hidden-influencer-mode');

  assert.ok(mode);
  assert.equal(mode.name, 'Hidden Influencer Mode');
  assert.equal(mode.deepProfileReview, 'mandatory');
});

test('expandModeSearchTemplates returns templates in configured order', () => {
  const mode = {
    id: 'example',
    searchTemplateIds: ['b', 'a', 'missing'],
  };
  const templates = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
  ];

  const expanded = expandModeSearchTemplates(mode, templates);
  assert.deepEqual(expanded.map((template) => template.id), ['b', 'a']);
});
