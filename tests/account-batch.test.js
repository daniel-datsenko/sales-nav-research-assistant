const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  applyGeoFocusToCandidates,
  assessCandidateGeoFocus,
  buildAccountBatchArtifactPath,
  buildAccountBatchReportPath,
  buildAccountBatchListName,
  deriveConnectOperatorGuidance,
  formatAccountBatchDuration,
  limitBatchCandidates,
  parseAccountNames,
  renderAccountBatchReportMarkdown,
  renderAccountBatchListNameTemplate,
} = require('../src/core/account-batch');
const { ACCOUNT_BATCH_ARTIFACTS_DIR } = require('../src/lib/paths');

test('parseAccountNames splits on commas and newlines and de-dupes case-insensitively', () => {
  const names = parseAccountNames('Marc O\'Polo SE, University of Stuttgart\nstc channels, marc o\'polo se');

  assert.deepEqual(names, [
    'Marc O\'Polo SE',
    'University of Stuttgart',
    'stc channels',
  ]);
});

test('buildAccountBatchListName defaults to coverage suffix', () => {
  assert.equal(buildAccountBatchListName('Marc O\'Polo SE'), 'Marc O\'Polo SE Coverage');
});

test('buildAccountBatchListName prefixes deterministic list names when requested', () => {
  assert.equal(
    buildAccountBatchListName('Marc O\'Polo SE', 'MVP'),
    'MVP - Marc O\'Polo SE',
  );
});

test('renderAccountBatchListNameTemplate resolves batch placeholders for consolidated lists', () => {
  assert.equal(
    renderAccountBatchListNameTemplate('Research {date} {start_time}-{end_time} ({duration}) {accounts}', {
      accountNames: ['Vinted', 'DocPlanner', 'OLX Group'],
      startedAt: '2026-04-28T10:27:00.000Z',
      endedAt: '2026-04-28T10:34:31.000Z',
    }),
    'Research 2026-04-28 1027-1034 (7m 31s) Vinted, DocPlanner +1',
  );
  assert.equal(formatAccountBatchDuration('2026-04-28T10:27:00.000Z', '2026-04-28T10:34:00.000Z'), '7m');
});

test('buildAccountBatchArtifactPath writes into the account batch artifacts directory', () => {
  const outputPath = buildAccountBatchArtifactPath('Example Operator Batch');

  assert.equal(path.dirname(outputPath), ACCOUNT_BATCH_ARTIFACTS_DIR);
  assert.match(path.basename(outputPath), /^example-operator-batch-\d{4}-\d{2}-\d{2}T/);
});

test('buildAccountBatchReportPath mirrors the json artifact name with markdown extension', () => {
  const reportPath = buildAccountBatchReportPath('/tmp/example-batch.json');

  assert.equal(reportPath, '/tmp/example-batch.md');
});

test('limitBatchCandidates caps selected save candidates per account', () => {
  const candidates = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];

  assert.deepEqual(limitBatchCandidates(candidates, 2), [{ name: 'a' }, { name: 'b' }]);
  assert.deepEqual(limitBatchCandidates(candidates, 0), candidates);
});

test('assessCandidateGeoFocus recognizes preferred SDR locations', () => {
  const decision = assessCandidateGeoFocus(
    { location: 'Munich, Bavaria, Germany' },
    {
      strictInclude: true,
      preferredLocationKeywords: ['germany', 'munich'],
      excludedLocationKeywords: [],
    },
  );

  assert.equal(decision.preferred, true);
  assert.equal(decision.eligible, true);
  assert.deepEqual(decision.matchedPreferredKeywords, ['germany', 'munich']);
});

test('applyGeoFocusToCandidates filters out non-territory leads in strict mode', () => {
  const filtered = applyGeoFocusToCandidates([
    { fullName: 'A', location: 'Los Angeles, California, United States' },
    { fullName: 'B', location: 'Berlin, Germany' },
    { fullName: 'C', location: 'Warsaw, Poland' },
  ], {
    strictInclude: true,
    preferredLocationKeywords: ['germany', 'poland', 'berlin', 'warsaw'],
    excludedLocationKeywords: [],
  });

  assert.deepEqual(filtered.map((candidate) => candidate.fullName), ['B', 'C']);
});

test('renderAccountBatchReportMarkdown includes pilot-friendly save summaries', () => {
  const markdown = renderAccountBatchReportMarkdown({
    generatedAt: '2026-04-22T10:00:00Z',
    driver: 'playwright',
    liveSave: true,
    liveConnect: false,
    consolidatedListName: 'Research Consolidated',
    listNameTemplate: 'Research {date}',
    maxListSavesPerAccount: 3,
    accountNames: ['Example Connect Eligible Account'],
    results: [
      {
        accountName: 'Example Connect Eligible Account',
        listName: 'Example Connect Eligible Account Coverage',
        coverageArtifactPath: '/tmp/example-connect-eligible.json',
        candidateCount: 20,
        listCandidateCount: 8,
        selectedForListSaveCount: 3,
        saveResults: [
          { fullName: 'Philipp Weidinger', status: 'saved' },
          { fullName: 'Ralf Koppitz', status: 'failed', note: 'selector issue' },
        ],
        connectResults: [],
      },
    ],
  });

  assert.match(markdown, /Account Batch Report/);
  assert.match(markdown, /Consolidated list: `Research Consolidated`/);
  assert.match(markdown, /List name template: `Research \{date\}`/);
  assert.match(markdown, /Max list saves per account: `3`/);
  assert.match(markdown, /Selected for live save: `3`/);
  assert.match(markdown, /Philipp Weidinger: `saved`/);
  assert.match(markdown, /Ralf Koppitz: `failed` - selector issue/);
});

test('renderAccountBatchReportMarkdown supports smoke-style artifacts with direct status fields', () => {
  const markdown = renderAccountBatchReportMarkdown({
    generatedAt: '2026-04-22T10:00:00Z',
    driver: 'playwright',
    liveSave: true,
    liveConnect: false,
    accountNames: ['Example Connect Eligible Account'],
    results: [
      {
        accountName: 'Example Connect Eligible Account',
        listName: 'Example Connect Eligible Account Coverage',
        fullName: 'Philipp Weidinger',
        title: 'Team Lead Data Architecture & Visualization',
        status: 'saved',
        selectionMode: 'existing_list',
      },
    ],
  });

  assert.match(markdown, /Save success: `1`/);
  assert.match(markdown, /Philipp Weidinger: `saved` - Team Lead Data Architecture & Visualization \| existing_list/);
});


test('renderAccountBatchReportMarkdown highlights lead-page fallback connect verification details', () => {
  const markdown = renderAccountBatchReportMarkdown({
    generatedAt: '2026-04-23T03:00:00Z',
    driver: 'playwright',
    liveSave: false,
    liveConnect: true,
    accountNames: ['Example Manual Review Account'],
    results: [
      {
        accountName: 'Example Manual Review Account',
        listName: 'Example Manual Review Account Coverage',
        selectionSource: 'lead_list',
        selectedForConnectCount: 1,
        saveResults: [],
        connectResults: [
          {
            fullName: 'Asko Tamm',
            status: 'connect_unavailable',
            note: 'connect button not found on lead page | lead-page fallback after connect_unavailable',
            connectPath: 'lead_page_fallback',
            fallbackTriggeredBy: 'connect_unavailable',
          },
        ],
      },
    ],
  });

  assert.match(markdown, /Asko Tamm: `connect_unavailable` - connect button not found on lead page \| lead-page fallback after connect_unavailable \| path=lead_page_fallback \| triggered_by=connect_unavailable \| operator=manual_review \| next=review_ui_variant/);
});

test('renderAccountBatchReportMarkdown exposes pilot policy class for skipped connects', () => {
  const markdown = renderAccountBatchReportMarkdown({
    generatedAt: '2026-04-23T09:30:00Z',
    driver: 'playwright',
    liveSave: false,
    liveConnect: true,
    accountNames: ['Example Manual Review Account'],
    results: [
      {
        accountName: 'Example Manual Review Account',
        listName: 'Example Manual Review Account Coverage',
        selectionSource: 'pilot_policy',
        selectedForConnectCount: 0,
        saveResults: [],
        connectResults: [
          {
            fullName: 'n/a',
            status: 'skipped_by_policy',
            note: 'Example Manual Review Account visible-action connect path is dry-verified, but keep first send supervised until the post-click flow is live-confirmed end-to-end.',
            policyClass: 'manual_review_required',
          },
        ],
      },
    ],
  });

  assert.match(markdown, /n\/a: `skipped_by_policy` - Example Manual Review Account visible-action connect path is dry-verified, but keep first send supervised until the post-click flow is live-confirmed end-to-end\. \| policy=manual_review_required \| operator=manual_review \| next=review_before_connect/);
});

test('renderAccountBatchReportMarkdown includes connect surface classification when present', () => {
  const markdown = renderAccountBatchReportMarkdown({
    generatedAt: '2026-04-23T09:45:00Z',
    driver: 'playwright',
    liveSave: false,
    liveConnect: true,
    accountNames: ['Example Regional Logistics Account'],
    results: [
      {
        accountName: 'Example Regional Logistics Account',
        listName: 'Example Regional Logistics Account Coverage',
        selectionSource: 'coverage_artifact',
        selectedForConnectCount: 1,
        saveResults: [],
        connectResults: [
          {
            fullName: 'Sorin Marius Oancea',
            status: 'connect_unavailable',
            note: 'connect action unavailable after open',
            surfaceClassification: 'overflow_only_connect',
          },
        ],
      },
    ],
  });

  assert.match(markdown, /Sorin Marius Oancea: `connect_unavailable` - connect action unavailable after open \| surface=overflow_only_connect \| operator=manual_review \| next=review_ui_variant/);
});

test('renderAccountBatchReportMarkdown treats email-required connects as final prospect skips', () => {
  const markdown = renderAccountBatchReportMarkdown({
    generatedAt: '2026-04-23T10:15:00Z',
    driver: 'playwright',
    liveSave: false,
    liveConnect: true,
    accountNames: ['Emerald AI'],
    results: [
      {
        accountName: 'Emerald AI',
        listName: 'Emerald AI Coverage',
        selectionSource: 'coverage_artifact',
        selectedForConnectCount: 1,
        saveResults: [],
        connectResults: [
          {
            fullName: 'Prospect With Email Gate',
            status: 'email_required',
            note: 'connect requires email address',
          },
        ],
      },
    ],
  });

  assert.match(markdown, /Prospect With Email Gate: `email_required` - connect requires email address \| operator=blocked_by_policy \| next=skip_requires_email/);
});

test('deriveConnectOperatorGuidance distinguishes policy blocks, covered leads, manual review, and retries', () => {
  assert.deepEqual(deriveConnectOperatorGuidance({
    status: 'skipped_by_policy',
    policyClass: 'manual_review_required',
  }), {
    disposition: 'manual_review',
    action: 'review_before_connect',
  });

  assert.deepEqual(deriveConnectOperatorGuidance({
    status: 'skipped_by_policy',
  }), {
    disposition: 'blocked_by_policy',
    action: 'no_action',
  });

  assert.deepEqual(deriveConnectOperatorGuidance({
    status: 'already_sent',
  }), {
    disposition: 'already_covered',
    action: 'no_action',
  });

  assert.deepEqual(deriveConnectOperatorGuidance({
    status: 'email_required',
    note: 'connect requires email address',
  }), {
    disposition: 'blocked_by_policy',
    action: 'skip_requires_email',
  });

  assert.deepEqual(deriveConnectOperatorGuidance({
    status: 'manual_review',
    note: 'connect outcome could not be verified',
  }), {
    disposition: 'manual_review',
    action: 'review_ui_variant',
  });

  assert.deepEqual(deriveConnectOperatorGuidance({
    status: 'connect_unavailable',
    note: 'connect button not found on lead page | lead-page fallback after connect_unavailable',
  }), {
    disposition: 'manual_review',
    action: 'review_ui_variant',
  });

  assert.deepEqual(deriveConnectOperatorGuidance({
    status: 'failed',
    note: 'temporary network issue',
  }), {
    disposition: 'retry_later',
    action: 'retry_after_review',
  });

  assert.deepEqual(deriveConnectOperatorGuidance({
    status: 'unknown_shape',
    surfaceClassification: 'overflow_only_connect',
  }), {
    disposition: 'manual_review',
    action: 'review_ui_variant',
  });
});
