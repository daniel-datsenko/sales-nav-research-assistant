const test = require('node:test');
const assert = require('node:assert/strict');

const { maybeFallbackToLeadPageConnect } = require('../src/core/connect-fallback');

test('maybeFallbackToLeadPageConnect returns original result when fallback is not needed', async () => {
  const result = await maybeFallbackToLeadPageConnect({
    initialResult: { status: 'already_sent', note: 'pending already visible' },
    driver: {
      async sendConnect() {
        throw new Error('should not be called');
      },
    },
    row: { fullName: 'Test User', salesNavigatorUrl: 'https://example.com/lead/1' },
    accountKey: 'Example Connect Eligible Account',
  });

  assert.deepEqual(result, { status: 'already_sent', note: 'pending already visible' });
});

test('maybeFallbackToLeadPageConnect returns original result when the lead URL is missing', async () => {
  const result = await maybeFallbackToLeadPageConnect({
    initialResult: { status: 'menu_empty', note: 'row menu opened without visible actions' },
    driver: {
      async sendConnect() {
        throw new Error('should not be called');
      },
    },
    row: { fullName: 'Test User' },
    accountKey: 'Example Manual Review Account',
  });

  assert.deepEqual(result, { status: 'menu_empty', note: 'row menu opened without visible actions' });
});

test('maybeFallbackToLeadPageConnect uses the lead-page connect fallback for menu_empty states', async () => {
  const calls = [];
  const result = await maybeFallbackToLeadPageConnect({
    initialResult: { status: 'menu_empty', note: 'row menu opened without visible actions' },
    driver: {
      async sendConnect(candidate, context) {
        calls.push({ candidate, context });
        return { status: 'already_connected', note: 'lead already connected', driver: 'playwright' };
      },
    },
    row: { fullName: 'Asko Tamm', salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/123' },
    accountKey: 'Example Manual Review Account',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    candidate: {
      fullName: 'Asko Tamm',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/123',
      profileUrl: 'https://www.linkedin.com/sales/lead/123',
    },
    context: {
      runId: 'pilot-connect-batch-list-row-fallback',
      accountKey: 'Example Manual Review Account',
      dryRun: false,
    },
  });
  assert.deepEqual(result, {
    status: 'already_connected',
    note: 'lead already connected | lead-page fallback after menu_empty',
    driver: 'playwright',
    connectPath: 'lead_page_fallback',
    fallbackTriggeredBy: 'menu_empty',
    initialStatus: 'menu_empty',
    initialNote: 'row menu opened without visible actions',
  });
});


test('maybeFallbackToLeadPageConnect awaits promise-based initial results from lead-list connect attempts', async () => {
  const result = await maybeFallbackToLeadPageConnect({
    initialResult: Promise.resolve({ status: 'already_sent', note: 'pending already visible' }),
    driver: {
      async sendConnect() {
        throw new Error('should not be called');
      },
    },
    row: { fullName: 'Promise User', salesNavigatorUrl: 'https://example.com/lead/2' },
    accountKey: 'Example Connect Eligible Account',
  });

  assert.deepEqual(result, { status: 'already_sent', note: 'pending already visible' });
});

test('maybeFallbackToLeadPageConnect can fallback after a promise-based menu_empty result', async () => {
  const calls = [];
  const result = await maybeFallbackToLeadPageConnect({
    initialResult: Promise.resolve({ status: 'menu_empty', note: 'row menu opened without visible actions' }),
    driver: {
      async sendConnect(candidate, context) {
        calls.push({ candidate, context });
        return { status: 'already_connected', note: 'lead already connected', driver: 'browser-harness' };
      },
    },
    row: { fullName: 'Promise Fallback', salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/456' },
    accountKey: 'Example Manual Review Account',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(result, {
    status: 'already_connected',
    note: 'lead already connected | lead-page fallback after menu_empty',
    driver: 'browser-harness',
    connectPath: 'lead_page_fallback',
    fallbackTriggeredBy: 'menu_empty',
    initialStatus: 'menu_empty',
    initialNote: 'row menu opened without visible actions',
  });
});


test('maybeFallbackToLeadPageConnect preserves the original lead-list status when connect fallback runs after connect_unavailable', async () => {
  const result = await maybeFallbackToLeadPageConnect({
    initialResult: { status: 'connect_unavailable', note: 'connect action not available on list row' },
    driver: {
      async sendConnect() {
        return { status: 'connect_unavailable', note: 'connect button not found on lead page', driver: 'playwright' };
      },
    },
    row: { fullName: 'Example Manual Review Account Lead', salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/789' },
    accountKey: 'Example Manual Review Account',
  });

  assert.deepEqual(result, {
    status: 'connect_unavailable',
    note: 'connect button not found on lead page | lead-page fallback after connect_unavailable',
    driver: 'playwright',
    connectPath: 'lead_page_fallback',
    fallbackTriggeredBy: 'connect_unavailable',
    initialStatus: 'connect_unavailable',
    initialNote: 'connect action not available on list row',
  });
});


test('maybeFallbackToLeadPageConnect preserves custom run context values when falling back', async () => {
  const calls = [];
  const result = await maybeFallbackToLeadPageConnect({
    initialResult: { status: 'connect_unavailable', note: 'row actions not found' },
    driver: {
      async sendConnect(candidate, context) {
        calls.push({ candidate, context });
        return { status: 'connect_unavailable', note: 'connect button not found on lead page', driver: 'playwright' };
      },
    },
    row: { fullName: 'Ralf Koppitz', salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/456' },
    accountKey: 'Example Manual Review Account Coverage',
    runId: 'connect-lead-list-row-fallback',
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].context, {
    runId: 'connect-lead-list-row-fallback',
    accountKey: 'Example Manual Review Account Coverage',
    dryRun: false,
  });
  assert.equal(result.connectPath, 'lead_page_fallback');
  assert.equal(result.fallbackTriggeredBy, 'connect_unavailable');
});


test('maybeFallbackToLeadPageConnect preserves the original row result when the lead-page fallback throws', async () => {
  const result = await maybeFallbackToLeadPageConnect({
    initialResult: { status: 'menu_empty', note: 'row menu opened without visible actions' },
    driver: {
      async sendConnect() {
        throw new Error('connect_not_verified');
      },
    },
    row: { fullName: 'Fallback Error', salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/999' },
    accountKey: 'Example Manual Review Account',
  });

  assert.deepEqual(result, {
    status: 'menu_empty',
    note: 'row menu opened without visible actions | lead-page fallback failed: connect_not_verified',
    connectPath: 'lead_page_fallback_failed',
    fallbackTriggeredBy: 'menu_empty',
    fallbackError: 'connect_not_verified',
    initialStatus: 'menu_empty',
    initialNote: 'row menu opened without visible actions',
  });
});

test('maybeFallbackToLeadPageConnect preserves the original row result when the lead-page fallback returns no structured result', async () => {
  const result = await maybeFallbackToLeadPageConnect({
    initialResult: { status: 'connect_unavailable', note: 'connect action not available on list row' },
    driver: {
      async sendConnect() {
        return null;
      },
    },
    row: { fullName: 'Fallback Empty', salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/1000' },
    accountKey: 'Example Manual Review Account',
  });

  assert.deepEqual(result, {
    status: 'connect_unavailable',
    note: 'connect action not available on list row | lead-page fallback failed: lead-page fallback returned no structured result',
    connectPath: 'lead_page_fallback_failed',
    fallbackTriggeredBy: 'connect_unavailable',
    fallbackError: 'lead-page fallback returned no structured result',
    initialStatus: 'connect_unavailable',
    initialNote: 'connect action not available on list row',
  });
});
