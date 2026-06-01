const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSdrResearchBatchValues,
  buildSdrResearchListName,
  renderSdrResearchIntro,
  validateSalesNavListName,
  SALES_NAV_LIST_NAME_MAX,
} = require('../src/core/sdr-workflow');

test('buildSdrResearchListName produces a list name within the Sales Nav UI cap', () => {
  const name = buildSdrResearchListName(['Example Account A', 'Example Account B', 'Example Account C'], {
    startedAt: '2026-05-05T09:15:00.000Z',
  });

  assert.ok(name.length <= SALES_NAV_LIST_NAME_MAX, `list name "${name}" exceeds ${SALES_NAV_LIST_NAME_MAX} chars`);
  assert.match(name, /2026-05-05/);
});

test('validateSalesNavListName throws on names that would be truncated by Sales Nav UI', () => {
  assert.throws(
    () => validateSalesNavListName('Example SDR - Account A Account B Account C Account D'),
    /truncates beyond 32 chars/,
  );
});

test('validateSalesNavListName accepts a 32-char list name', () => {
  const okName = 'a'.repeat(32);
  assert.equal(validateSalesNavListName(okName), okName);
});

test('buildSdrResearchBatchValues maps simple SDR input onto the guarded account batch flow', () => {
  const values = buildSdrResearchBatchValues({
    accounts: 'Example Account A, Example Account B, Example Account C',
    'list-name': 'Polly DDS Score Accts',
    'live-save': true,
  }, {
    startedAt: '2026-05-05T09:15:00.000Z',
  });

  assert.equal(values['account-names'], 'Example Account A, Example Account B, Example Account C');
  assert.equal(values['consolidate-list-name'], 'Polly DDS Score Accts');
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
    accounts: 'Example Retail Chain',
    exhaustive: true,
  });

  assert.equal(values['research-mode'], 'exhaustive');
  assert.equal(values['speed-profile'], 'exhaustive');
});

test('buildSdrResearchBatchValues preserves opt-in API read prefetch for guarded speed tests', () => {
  const values = buildSdrResearchBatchValues({
    accounts: 'Example Analytics Co',
    'api-read-prefetch': true,
    'api-prefetch-lead-count': '100',
  });

  assert.equal(values['api-read-prefetch'], true);
  assert.equal(values['api-prefetch-lead-count'], '100');
});

test('buildSdrResearchBatchValues preserves opt-in Voyager deep profile flags', () => {
  const values = buildSdrResearchBatchValues({
    accounts: 'Example Analytics Co',
    'deep-profile-pass': true,
    'profile-read-method': 'voyager',
    'deep-profile-limit': '12',
    'scaleup-selection-expanded': true,
  });

  assert.equal(values['deep-profile-pass'], true);
  assert.equal(values['profile-read-method'], 'voyager');
  assert.equal(values['deep-profile-limit'], '12');
  assert.equal(values['scaleup-selection-expanded'], true);
});

test('buildSdrResearchBatchValues refuses connect flags', () => {
  assert.throws(
    () => buildSdrResearchBatchValues({
      accounts: 'Example Account A',
      'live-connect': true,
    }),
    /never sends connects/,
  );
});

test('renderSdrResearchIntro makes live-save and connect behavior explicit', () => {
  const markdown = renderSdrResearchIntro({
    accountNames: ['Example Account A', 'Example Account B'],
    listName: 'Polly DDS Score Accts',
    liveSave: true,
  });

  assert.match(markdown, /Live save: `yes`/);
  assert.match(markdown, /Connects: `never in this command`/);
  assert.match(markdown, /create or update the Sales Navigator list/);
});

test('renderSdrResearchIntro explains when Voyager deep profile review is enabled', () => {
  const markdown = renderSdrResearchIntro({
    accountNames: ['Example Account A'],
    listName: 'Polly DDS Score Accts',
    deepProfilePass: true,
    profileReadMethod: 'voyager',
  });

  assert.match(markdown, /Deep profile review: `voyager`/);
});

test('renderSdrResearchIntro explains scaleup selection expansion', () => {
  const markdown = renderSdrResearchIntro({
    accountNames: ['Skello'],
    listName: 'Skello Research',
    scaleupSelectionExpanded: true,
  });

  assert.match(markdown, /Scaleup selection expansion: `on`/);
});
