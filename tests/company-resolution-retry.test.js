const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildCompanyResolutionRetryQueue,
  collectAllSweepsFailedAccounts,
  prepareCompanyResolutionRetryCandidates,
  summarizeCompanyResolutionRetryResults,
  updateCompanyResolutionRetryCheckpoint,
} = require('../src/core/company-resolution-retry');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

test('collectAllSweepsFailedAccounts reads background artifacts and checkpoints', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolution-retry-'));
  writeJson(path.join(tempDir, 'example-loop-1.json'), {
    status: 'completed',
    results: [
      {
        accountId: 'a-media',
        accountName: 'Example Media Group Germany',
        source: 'territory',
        coverageError: 'all_sweeps_failed: Unable to scope people search',
      },
      {
        accountId: 'a-ok',
        accountName: 'Healthy Co',
        coverageError: null,
      },
    ],
  });

  const failures = collectAllSweepsFailedAccounts({
    artifactsDir: tempDir,
    checkpoint: {
      accountInsights: {
        'a-logistics': {
          accountName: 'Example Logistics Switzerland',
          source: 'territory',
          coverageError: 'all_sweeps_failed: Unable to scope people search',
        },
      },
    },
  });

  assert.equal(failures.length, 2);
  assert.deepEqual(failures.map((failure) => failure.accountName).sort(), [
    'Example Logistics Switzerland',
    'Example Media Group Germany',
  ]);
});

test('prepareCompanyResolutionRetryCandidates only retries safe resolution statuses', () => {
  const failures = [
    { accountName: 'Exact Co', accountKey: 'exact-co', beforeCoverageError: 'all_sweeps_failed' },
    { accountName: 'Review Co', accountKey: 'review-co', beforeCoverageError: 'all_sweeps_failed' },
  ];
  const prepared = prepareCompanyResolutionRetryCandidates({
    failures,
    retryCheckpoint: { accounts: {} },
    maxRetries: 1,
    buildResolution: (failure) => ({
      accountName: failure.accountName,
      status: failure.accountName === 'Exact Co' ? 'resolved_exact' : 'needs_manual_company_review',
      confidence: failure.accountName === 'Exact Co' ? 0.95 : 0.55,
      recommendedAction: failure.accountName === 'Exact Co' ? 'run_people_sweeps' : 'review_company_targets_before_retry',
      selectedTargets: [failure.accountName],
    }),
    writeResolution: (resolution) => ({
      artifactPath: `/tmp/${resolution.accountName}.json`,
      reportPath: `/tmp/${resolution.accountName}.md`,
    }),
  });

  assert.equal(prepared[0].retryable, true);
  assert.equal(prepared[0].nextAction, 'run_people_sweeps');
  assert.equal(prepared[1].retryable, false);
  assert.equal(prepared[1].skipReason, 'resolution_not_retryable');
  assert.equal(prepared[1].nextAction, 'review_company_targets_manually');
});

test('buildCompanyResolutionRetryQueue creates a dry-safe cache-bypassing queue', () => {
  const queue = buildCompanyResolutionRetryQueue({
    candidates: [
      {
        accountName: 'Example Media Group Germany',
        accountKey: 'example-media-group-germany',
        source: 'territory',
        retryable: true,
        beforeCoverageError: 'all_sweeps_failed',
        resolutionStatus: 'resolved_exact',
        resolutionConfidence: 0.95,
        selectedCompanyTargets: ['Example Media Germany'],
      },
    ],
  });

  assert.equal(queue.connectPolicy.allowBackgroundConnects, false);
  assert.equal(queue.coverageCache.enabled, false);
  assert.equal(queue.queue.length, 1);
  assert.equal(queue.queue[0].companyResolutionRetry, true);
  assert.equal(queue.queue[0].beforeCoverageError, 'all_sweeps_failed');
});

test('updateCompanyResolutionRetryCheckpoint records attempts and terminal retry status', () => {
  const checkpoint = updateCompanyResolutionRetryCheckpoint({
    checkpoint: { accounts: {} },
    prepared: [
      {
        accountName: 'Retry Co',
        accountKey: 'retry-co',
        retryable: true,
        resolutionStatus: 'resolved_exact',
        resolutionConfidence: 0.91,
      },
    ],
    results: [
      {
        accountName: 'Retry Co',
        resolutionRetryStatus: 'manual_review',
        coverageError: 'all_sweeps_failed again',
        candidateCount: 0,
        listCandidateCount: 0,
      },
    ],
  });

  assert.equal(checkpoint.accounts['retry-co'].attempts, 1);
  assert.equal(checkpoint.accounts['retry-co'].lastRetryStatus, 'manual_review');
  assert.equal(checkpoint.accounts['retry-co'].lastResolutionStatus, 'resolved_exact');
});

test('summarizeCompanyResolutionRetryResults counts recovered and manual-review runs', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resolution-retry-summary-'));
  writeJson(path.join(tempDir, 'company-resolution-retry-loop-2026-04-24T08-00-00-000Z.json'), {
    status: 'completed',
    results: [
      {
        accountName: 'Recovered Co',
        resolutionRetryStatus: 'recovered',
        resolutionRetryAttempt: 1,
        candidateCount: 12,
        listCandidateCount: 7,
      },
      {
        accountName: 'Manual Co',
        resolutionRetryStatus: 'manual_review',
        resolutionRetryAttempt: 1,
        candidateCount: 0,
        listCandidateCount: 0,
      },
    ],
  });

  const summary = summarizeCompanyResolutionRetryResults(tempDir);
  assert.equal(summary.attempted, 2);
  assert.equal(summary.recovered, 1);
  assert.equal(summary.manualReview, 1);
  assert.equal(summary.failed, 0);
  assert.equal(summary.latestAccounts.length, 2);
});
