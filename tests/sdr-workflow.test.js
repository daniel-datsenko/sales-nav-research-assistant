const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSdrResearchBatchValues,
  buildSdrResearchListName,
  renderSdrResearchIntro,
} = require('../src/core/sdr-workflow');

test('buildSdrResearchListName creates a simple deterministic SDR list name', () => {
  const name = buildSdrResearchListName(['Thales Group', 'Skello', 'Oodrive'], {
    startedAt: '2026-05-05T09:15:00.000Z',
  });

  assert.equal(name, 'SDR Research 2026-05-05 0915 (Thales Group, Skello +1)');
});

test('buildSdrResearchBatchValues maps simple SDR input onto the guarded account batch flow', () => {
  const values = buildSdrResearchBatchValues({
    accounts: 'Thales Group, Skello, Oodrive',
    'list-name': 'Polly Score Accounts - Guillaume Nolot',
    'live-save': true,
  }, {
    startedAt: '2026-05-05T09:15:00.000Z',
  });

  assert.equal(values['account-names'], 'Thales Group, Skello, Oodrive');
  assert.equal(values['consolidate-list-name'], 'Polly Score Accounts - Guillaume Nolot');
  assert.equal(values.driver, 'playwright');
  assert.equal(values['session-mode'], 'persistent');
  assert.equal(values['coverage-config'], 'config/account-coverage/default.json');
  assert.equal(values['research-mode'], 'persona-led');
  assert.equal(values['speed-profile'], 'balanced');
  assert.equal(values['research-concurrency'], '1');
  assert.equal(values['live-save'], true);
  assert.equal(values['allow-list-create'], true);
  assert.equal(values['reuse-sweep-cache'], true);
  assert.equal(values['report-only-out-of-network'], true);
});

test('buildSdrResearchBatchValues supports exhaustive mode without exposing internal sweep flags', () => {
  const values = buildSdrResearchBatchValues({
    accounts: 'FnacDarty',
    exhaustive: true,
  });

  assert.equal(values['research-mode'], 'exhaustive');
  assert.equal(values['speed-profile'], 'exhaustive');
});

test('buildSdrResearchBatchValues preserves opt-in API read prefetch for guarded speed tests', () => {
  const values = buildSdrResearchBatchValues({
    accounts: 'Celonis',
    'api-read-prefetch': true,
    'api-prefetch-lead-count': '100',
  });

  assert.equal(values['api-read-prefetch'], true);
  assert.equal(values['api-prefetch-lead-count'], '100');
});

test('buildSdrResearchBatchValues refuses connect flags', () => {
  assert.throws(
    () => buildSdrResearchBatchValues({
      accounts: 'Thales Group',
      'live-connect': true,
    }),
    /never sends connects/,
  );
});

test('renderSdrResearchIntro makes live-save and connect behavior explicit', () => {
  const markdown = renderSdrResearchIntro({
    accountNames: ['Thales Group', 'Skello'],
    listName: 'Polly Score Accounts - Guillaume Nolot',
    liveSave: true,
  });

  assert.match(markdown, /Live save: `yes`/);
  assert.match(markdown, /Connects: `never in this command`/);
  assert.match(markdown, /create or update the Sales Navigator list/);
});
