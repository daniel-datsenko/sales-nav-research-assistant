const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildBackgroundEnvironmentBlockArtifact,
  buildBackgroundListName,
  classifyBackgroundEnvironmentHealth,
  classifyAccountDeferral,
  executeBackgroundListMaintenanceLoop,
  findLatestBackgroundLoopReport,
  isCoverageArtifactFresh,
  renderBackgroundLoopReportMarkdown,
  readLatestBackgroundLoopReport,
  selectBackgroundMaintenanceBatch,
  summarizeBackgroundQueueDeferrals,
  summarizeAccountProductivity,
} = require('../src/core/background-list-maintenance');

test('selectBackgroundMaintenanceBatch skips already processed accounts', () => {
  const queueSpec = {
    queue: [
      { accountId: 'a-1', accountName: 'Acme' },
      { accountId: 'a-2', accountName: 'Beta' },
      { accountId: 'a-3', accountName: 'Gamma' },
    ],
  };
  const checkpoint = {
    processedAccountIds: ['a-1'],
  };

  const batch = selectBackgroundMaintenanceBatch(queueSpec, checkpoint, 2);
  assert.equal(batch.length, 2);
  assert.equal(batch[0].accountName, 'Beta');
  assert.equal(batch[1].accountName, 'Gamma');
});

test('selectBackgroundMaintenanceBatch prefers accounts with successful prior patterns', () => {
  const queueSpec = {
    queue: [
      { accountId: 'a-1', accountName: 'Noisy Co', stalePriorityScore: 100 },
      { accountId: 'a-2', accountName: 'Productive Co', stalePriorityScore: 50 },
    ],
  };

  const batch = selectBackgroundMaintenanceBatch(queueSpec, { processedAccountIds: [] }, 2, {
    accountPatterns: {
      'Productive Co': { saveSuccessCount: 3, saveButtonMissingCount: 0 },
      'Noisy Co': { saveSuccessCount: 0, saveButtonMissingCount: 2 },
    },
  });

  assert.equal(batch[0].accountName, 'Productive Co');
  assert.equal(batch[1].accountName, 'Noisy Co');
});

test('selectBackgroundMaintenanceBatch defers recently noisy accounts and repeated save-button failures', () => {
  const queueSpec = {
    retryPolicy: {
      sparseAccountCooldownDays: 2,
      noisyAccountCooldownDays: 7,
      saveButtonMissingThreshold: 2,
      saveButtonMissingCooldownDays: 7,
    },
    queue: [
      { accountId: 'a-1', accountName: 'Noisy Co', stalePriorityScore: 100 },
      { accountId: 'a-2', accountName: 'Missing Save Co', stalePriorityScore: 90 },
      { accountId: 'a-3', accountName: 'Healthy Co', stalePriorityScore: 80 },
    ],
  };

  const checkpoint = {
    processedAccountIds: [],
    accountInsights: {
      'a-1': {
        lastProcessedAt: '2026-04-22T12:00:00.000Z',
        productivity: { classification: 'noisy' },
      },
    },
  };

  const batch = selectBackgroundMaintenanceBatch(queueSpec, checkpoint, 3, {
    accountPatterns: {
      'Missing Save Co': {
        saveSuccessCount: 0,
        saveButtonMissingCount: 2,
        lastObservedAt: '2026-04-22T12:00:00.000Z',
      },
    },
  }, new Date('2026-04-23T00:00:00.000Z'));

  assert.equal(batch.length, 1);
  assert.equal(batch[0].accountName, 'Healthy Co');
});

test('summarizeBackgroundQueueDeferrals makes noisy cooldowns visible for operator reports', () => {
  const queueSpec = {
    retryPolicy: {
      sparseAccountCooldownDays: 2,
      noisyAccountCooldownDays: 7,
      saveButtonMissingThreshold: 2,
      saveButtonMissingCooldownDays: 7,
    },
    queue: [
      { accountId: 'a-noisy', accountName: 'Noisy Co' },
      { accountId: 'a-sparse', accountName: 'Sparse Co' },
      { accountId: 'a-healthy', accountName: 'Healthy Co' },
    ],
  };
  const checkpoint = {
    processedAccountIds: [],
    accountInsights: {
      'a-noisy': {
        lastProcessedAt: '2026-04-24T08:00:00.000Z',
        productivity: { classification: 'noisy' },
        coverageError: null,
      },
      'a-sparse': {
        lastProcessedAt: '2026-04-24T08:00:00.000Z',
        productivity: { classification: 'sparse' },
        coverageError: null,
      },
    },
  };

  const summary = summarizeBackgroundQueueDeferrals(
    queueSpec,
    checkpoint,
    null,
    new Date('2026-04-24T12:00:00.000Z'),
  );

  assert.equal(summary.total, 2);
  assert.deepEqual(summary.reasonCounts, {
    noisy_cooldown: 1,
    sparse_cooldown: 1,
  });
  assert.equal(summary.accounts[0].accountName, 'Noisy Co');
  assert.equal(summary.accounts[0].reason, 'noisy_cooldown');
  assert.equal(summary.accounts[0].operatorNextAction, 'wait_for_cooldown_or_review_account_scope');
});

test('buildBackgroundListName stays deterministic per account', () => {
  assert.equal(
    buildBackgroundListName({ ownerName: 'Example Operator', accountName: 'Marc O\'Polo SE' }),
    'Marc O\'Polo SE Coverage',
  );
});

test('classifyBackgroundEnvironmentHealth distinguishes browser, harness, and auth blockers', () => {
  assert.deepEqual(
    classifyBackgroundEnvironmentHealth({
      error: new Error('bootstrap_check_in failed: Permission denied (1100)'),
    }),
    {
      ok: false,
      state: 'browser_launch_blocked',
      detail: 'bootstrap_check_in failed: Permission denied (1100)',
      nextAction: 'allow_browser_runtime_then_retry',
    },
  );

  assert.deepEqual(
    classifyBackgroundEnvironmentHealth({
      error: new Error('RuntimeError: no close frame received or sent'),
    }),
    {
      ok: false,
      state: 'harness_transport_blocked',
      detail: 'RuntimeError: no close frame received or sent',
      nextAction: 'restart_browser_harness_then_retry',
    },
  );

  assert.deepEqual(
    classifyBackgroundEnvironmentHealth({
      health: { ok: false, state: 'reauth_required' },
    }),
    {
      ok: false,
      state: 'reauth_required',
      detail: 'reauth_required',
      nextAction: 'reauthenticate_linkedin_then_retry',
    },
  );
});

test('buildBackgroundEnvironmentBlockArtifact records a non-queue environment failure separately', () => {
  const artifact = buildBackgroundEnvironmentBlockArtifact({
    owner: { name: 'Example Operator' },
    queueArtifactPath: '/tmp/queue.json',
    checkpointPath: '/tmp/checkpoint.json',
    variationRegistryPath: '/tmp/registry.json',
    liveSave: false,
    driver: 'playwright',
    environment: {
      ok: false,
      state: 'browser_launch_blocked',
      detail: 'Permission denied',
    },
  });

  assert.equal(artifact.status, 'environment_blocked');
  assert.equal(artifact.environment.state, 'browser_launch_blocked');
  assert.equal(artifact.metrics.accountsAttempted, 0);
  assert.deepEqual(artifact.results, []);
});

test('renderBackgroundLoopReportMarkdown makes environment blockers readable without raw JSON', () => {
  const markdown = renderBackgroundLoopReportMarkdown(buildBackgroundEnvironmentBlockArtifact({
    owner: { name: 'Example Operator' },
    liveSave: false,
    driver: 'playwright',
    environment: {
      ok: false,
      state: 'browser_launch_blocked',
      detail: 'bootstrap_check_in org.chromium.Chromium.MachPortRendezvousServer: Permission denied',
    },
  }));

  assert.match(markdown, /Status: `environment_blocked`/);
  assert.match(markdown, /Environment: `browser_launch_blocked`/);
  assert.match(markdown, /Operator disposition: `environment_blocked`/);
  assert.match(markdown, /Next action: `allow_browser_runtime_then_retry`/);
  assert.match(markdown, /Accounts attempted: `0`/);
});

test('isCoverageArtifactFresh respects max age and empty-artifact reuse policy', () => {
  const fresh = isCoverageArtifactFresh({
    generatedAt: new Date().toISOString(),
    candidateCount: 3,
  }, {
    enabled: true,
    maxAgeDays: 7,
    reuseEmptyArtifacts: false,
  });
  const stale = isCoverageArtifactFresh({
    generatedAt: '2026-01-01T00:00:00.000Z',
    candidateCount: 3,
  }, {
    enabled: true,
    maxAgeDays: 7,
    reuseEmptyArtifacts: false,
  }, new Date('2026-04-22T00:00:00.000Z'));
  const empty = isCoverageArtifactFresh({
    generatedAt: new Date().toISOString(),
    candidateCount: 0,
  }, {
    enabled: true,
    maxAgeDays: 7,
    reuseEmptyArtifacts: false,
  });

  assert.equal(fresh, true);
  assert.equal(stale, false);
  assert.equal(empty, false);
});

test('isCoverageArtifactFresh supports legacy queue artifacts without cache policy', () => {
  const artifact = {
    generatedAt: '2026-04-23T00:00:00.000Z',
    candidateCount: 1,
  };

  assert.equal(
    isCoverageArtifactFresh(artifact, undefined, new Date('2026-04-24T00:00:00.000Z')),
    true,
  );
  assert.equal(
    isCoverageArtifactFresh({ ...artifact, candidateCount: 0 }, undefined, new Date('2026-04-24T00:00:00.000Z')),
    false,
  );
  assert.equal(
    isCoverageArtifactFresh({ ...artifact, candidateCount: 0 }, { reuseEmptyArtifacts: true }, new Date('2026-04-24T00:00:00.000Z')),
    true,
  );
});

test('summarizeAccountProductivity classifies productive and sparse accounts', () => {
  assert.equal(summarizeAccountProductivity({
    candidateCount: 10,
    listCandidateCount: 3,
  }, {
    minListCandidates: 2,
    minCandidateCount: 5,
    productiveRatio: 0.2,
  }).classification, 'productive');

  assert.equal(summarizeAccountProductivity({
    candidateCount: 4,
    listCandidateCount: 0,
  }, {
    minListCandidates: 2,
    minCandidateCount: 5,
    productiveRatio: 0.2,
  }).classification, 'sparse');
});

test('classifyAccountDeferral reports the deferral reason for noisy cooldown and save-button cooldown', () => {
  assert.deepEqual(
    classifyAccountDeferral(
      { accountId: 'a-1', accountName: 'Noisy Co' },
      {
        accountInsights: {
          'a-1': {
            lastProcessedAt: '2026-04-22T12:00:00.000Z',
            productivity: { classification: 'noisy' },
          },
        },
      },
      null,
      { noisyAccountCooldownDays: 7 },
      new Date('2026-04-23T00:00:00.000Z'),
    ),
    { deferred: true, reason: 'noisy_cooldown' },
  );

  assert.deepEqual(
    classifyAccountDeferral(
      { accountId: 'a-2', accountName: 'Missing Save Co' },
      null,
      {
        accountPatterns: {
          'Missing Save Co': {
            saveSuccessCount: 0,
            saveButtonMissingCount: 3,
            lastObservedAt: '2026-04-22T12:00:00.000Z',
          },
        },
      },
      {
        saveButtonMissingThreshold: 2,
        saveButtonMissingCooldownDays: 7,
      },
      new Date('2026-04-23T00:00:00.000Z'),
    ),
    { deferred: true, reason: 'save_button_missing_cooldown' },
  );
});

test('executeBackgroundListMaintenanceLoop records timed-out live coverage as an account outcome', async () => {
  const queueSpec = {
    owner: { name: 'Example Operator' },
    queue: [
      { accountId: 'a-timeout', accountName: 'Timeout Co', stalePriorityScore: 100 },
    ],
    coverageCache: { enabled: false },
    productiveAccountRules: {
      minListCandidates: 2,
      minCandidateCount: 5,
      productiveRatio: 0.2,
    },
  };
  const driver = {
    closeCalled: false,
    async close() {
      this.closeCalled = true;
    },
  };
  let recovered = false;
  const warnings = [];

  const result = await executeBackgroundListMaintenanceLoop({
    driver,
    queueSpec,
    checkpoint: { processedAccountIds: [] },
    limit: 1,
    coverageConfig: {},
    icpConfig: {},
    priorityModel: null,
    accountTimeoutMs: 5,
    recoverDriverSession: async () => {
      recovered = true;
    },
    runCoverageWorkflow: async () => new Promise(() => {}),
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
  });

  assert.equal(result.accountsAttempted, 1);
  assert.equal(result.results[0].coverageStatus, 'timed_out');
  assert.equal(result.results[0].candidateCount, 0);
  assert.equal(result.results[0].productivity.classification, 'noisy');
  assert.equal(result.metrics.timedOutAccounts, 1);
  assert.equal(result.updatedCheckpoint.processedAccountIds.includes('a-timeout'), true);
  assert.equal(result.updatedCheckpoint.accountInsights['a-timeout'].coverageStatus, 'timed_out');
  assert.equal(driver.closeCalled, true);
  assert.equal(recovered, true);
  assert.match(warnings[0], /Background loop account timed out: Timeout Co/);
});

test('executeBackgroundListMaintenanceLoop surfaces empty failed sweeps as account coverage errors', async () => {
  const queueSpec = {
    owner: { name: 'Example Operator' },
    queue: [{ accountId: 'a-filter', accountName: 'Filter Co' }],
    coverageCache: { enabled: false },
    productiveAccountRules: {
      minListCandidates: 2,
      minCandidateCount: 5,
      productiveRatio: 0.2,
    },
  };

  const result = await executeBackgroundListMaintenanceLoop({
    driver: {},
    queueSpec,
    checkpoint: { processedAccountIds: [] },
    limit: 1,
    coverageConfig: {},
    icpConfig: {},
    priorityModel: null,
    runCoverageWorkflow: async () => ({
      account: { accountId: 'a-filter', name: 'Filter Co' },
      templates: [{ id: 'broad-crawl' }, { id: 'sweep-platform' }],
      sweepErrors: [
        { templateId: 'broad-crawl', message: 'Unable to scope people search to account filter for Filter Co' },
        { templateId: 'sweep-platform', message: 'Unable to scope people search to account filter for Filter Co' },
      ],
      result: {
        accountName: 'Filter Co',
        generatedAt: '2026-04-24T05:20:00.000Z',
        candidateCount: 0,
        candidates: [],
      },
      bucketSummary: {},
    }),
  });

  assert.equal(result.results[0].coverageStatus, 'live');
  assert.match(result.results[0].coverageError, /all_sweeps_failed/);
  assert.match(result.results[0].coverageError, /Unable to scope people search/);
  assert.equal(result.results[0].resolutionStatus, 'needs_company_resolution');
  assert.equal(result.results[0].resolutionNextAction, 'resolve_company_targets_then_retry');
  assert.equal(result.updatedCheckpoint.accountInsights['a-filter'].coverageError, result.results[0].coverageError);
  assert.equal(result.updatedCheckpoint.accountInsights['a-filter'].resolutionStatus, 'needs_company_resolution');
});

test('executeBackgroundListMaintenanceLoop sends failed resolution retries to manual review', async () => {
  const queueSpec = {
    owner: { name: 'Company Resolution Retry' },
    queue: [
      {
        accountId: 'a-retry',
        accountName: 'Retry Co',
        companyResolutionRetry: true,
        resolutionRetryAttempt: 1,
        beforeCoverageError: 'all_sweeps_failed: previous account filter failure',
      },
    ],
    coverageCache: { enabled: false },
  };

  const result = await executeBackgroundListMaintenanceLoop({
    driver: {},
    queueSpec,
    checkpoint: { processedAccountIds: [] },
    limit: 1,
    coverageConfig: {},
    icpConfig: {},
    priorityModel: null,
    runCoverageWorkflow: async () => ({
      account: { accountId: 'a-retry', name: 'Retry Co' },
      templates: [{ id: 'broad-crawl' }],
      sweepErrors: [
        { templateId: 'broad-crawl', message: 'Unable to scope people search to account filter for Retry Co' },
      ],
      result: {
        accountName: 'Retry Co',
        generatedAt: '2026-04-24T09:00:00.000Z',
        candidateCount: 0,
        candidates: [],
      },
      bucketSummary: {},
    }),
  });

  assert.equal(result.results[0].resolutionRetryStatus, 'manual_review');
  assert.equal(result.results[0].resolutionRetryAttempt, 1);
  assert.equal(result.results[0].resolutionStatus, 'needs_manual_company_review');
  assert.equal(result.results[0].resolutionNextAction, 'review_company_targets_manually');
  assert.equal(result.results[0].beforeCoverageError, 'all_sweeps_failed: previous account filter failure');
  assert.equal(result.updatedCheckpoint.accountInsights['a-retry'].resolutionRetryStatus, 'manual_review');
});

test('renderBackgroundLoopReportMarkdown exposes account coverage statuses for operators', () => {
  const markdown = renderBackgroundLoopReportMarkdown({
    processedAt: '2026-04-23T21:45:00.000Z',
    status: 'completed',
    driver: 'playwright',
    liveSave: false,
    environment: {
      state: 'healthy',
      sessionCheckSkipped: true,
      sessionCheckReason: 'cache_only',
    },
    metrics: {
      accountsAttempted: 2,
      productiveAccounts: 1,
      mixedAccounts: 0,
      sparseAccounts: 0,
      noisyAccounts: 1,
      cachedAccounts: 1,
      timedOutAccounts: 1,
      deferredAccounts: 2,
      totalCandidates: 12,
      totalListCandidates: 7,
    },
    deferredAccounts: {
      total: 2,
      reasonCounts: {
        noisy_cooldown: 1,
        sparse_cooldown: 1,
      },
      accounts: [
        {
          accountName: 'Noisy Co',
          reason: 'noisy_cooldown',
          operatorNextAction: 'wait_for_cooldown_or_review_account_scope',
        },
        {
          accountName: 'Sparse Co',
          reason: 'sparse_cooldown',
          operatorNextAction: 'wait_for_cooldown_or_review_account_scope',
        },
      ],
    },
    results: [
      {
        accountName: 'Productive Co',
        coverageStatus: 'cached',
        cacheUsed: true,
        candidateCount: 12,
        listCandidateCount: 7,
        productivity: { classification: 'productive' },
      },
      {
        accountName: 'Timeout Co',
        coverageStatus: 'timed_out',
        coverageError: 'background account coverage timed out for Timeout Co after 5000ms',
        resolutionStatus: 'needs_company_resolution',
        resolutionConfidence: 0.42,
        resolutionNextAction: 'resolve_company_targets_then_retry',
        resolutionRetryStatus: 'manual_review',
        resolutionRetryAttempt: 1,
        beforeCoverageError: 'all_sweeps_failed: previous account filter failure',
        afterCandidateCount: 0,
        afterListCandidateCount: 0,
        selectedCompanyTargets: ['Timeout Company'],
        candidateCount: 0,
        listCandidateCount: 0,
        productivity: { classification: 'noisy' },
      },
    ],
  });

  assert.match(markdown, /Timed out: `1`/);
  assert.match(markdown, /Deferred by cooldown: `2`/);
  assert.match(markdown, /Session check: `skipped \(cache_only\)`/);
  assert.match(markdown, /Productive Co: status=cached \| productivity=productive \| candidates=12 \| list_candidates=7 \| cache=reused/);
  assert.match(markdown, /Timeout Co: status=timed_out \| productivity=noisy \| candidates=0 \| list_candidates=0 \| error=background account coverage timed out/);
  assert.match(markdown, /resolution=needs_company_resolution/);
  assert.match(markdown, /retry=manual_review/);
  assert.match(markdown, /retry_attempt=1/);
  assert.match(markdown, /beforeCoverageError: `all_sweeps_failed: previous account filter failure`/);
  assert.match(markdown, /afterCandidateCount: `0`/);
  assert.match(markdown, /selectedTargets: `Timeout Company`/);
  assert.match(markdown, /Noisy Co: reason=noisy_cooldown \| next=wait_for_cooldown_or_review_account_scope/);
});

test('readLatestBackgroundLoopReport returns the newest runner markdown report', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'background-report-'));
  const older = path.join(tempDir, 'example-example-loop-2026-04-23T20-00-00-000Z.md');
  const newer = path.join(tempDir, 'example-example-loop-2026-04-23T21-00-00-000Z.md');
  fs.writeFileSync(older, '# Old Report\n', 'utf8');
  fs.writeFileSync(newer, '# New Report\n', 'utf8');

  const oldTime = new Date('2026-04-23T20:00:00.000Z');
  const newTime = new Date('2026-04-23T21:00:00.000Z');
  fs.utimesSync(older, oldTime, oldTime);
  fs.utimesSync(newer, newTime, newTime);

  assert.equal(findLatestBackgroundLoopReport(tempDir), newer);
  assert.deepEqual(readLatestBackgroundLoopReport(tempDir), {
    reportPath: newer,
    content: '# New Report\n',
  });
});
