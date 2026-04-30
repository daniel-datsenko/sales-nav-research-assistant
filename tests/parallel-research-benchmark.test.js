const test = require('node:test');
const assert = require('node:assert/strict');

const { createBrowserWorkerLock } = require('../src/core/browser-worker-lock');
const {
  attachSweepCacheState,
  buildResearchPipelineArtifact,
  buildResearchQueue,
  executeBrowserSweepJobs,
  planResearchJobs,
  scoreResearchCandidates,
} = require('../src/core/research-pipeline');

/**
 * Deterministic “benchmark”: fake delays via injected counters, no wall-clock assertions.
 */
test('pipeline skips browser work on sweep cache hits', async () => {
  const queue = buildResearchQueue({
    accounts: [{ accountId: 'a1', accountName: 'BenchCo' }],
    runId: 'bench',
  });
  const plan = planResearchJobs({
    queue,
    coverageConfig: {
      broadCrawl: { enabled: true },
      sweeps: [{ id: 'x', keywords: ['obs'] }],
    },
  });

  const hydrated = await attachSweepCacheState({
    jobs: plan.jobs,
    readCache: () => ({ candidates: [{ fullName: 'C', title: 'VP Platform Engineering' }] }),
  });

  let browserCalls = 0;
  const driver = {
    async openPeopleSearch() {
      browserCalls += 1;
    },
    async applySearchTemplate() {},
    async scrollAndCollectCandidates() {
      browserCalls += 1;
      return [];
    },
  };

  const lock = createBrowserWorkerLock();
  await executeBrowserSweepJobs({
    jobs: hydrated,
    driver,
    lock,
    runId: 'bench',
  });

  assert.equal(browserCalls, 0);
  const sweepCount = hydrated.filter((j) => j.type === 'sweep').length;
  assert.ok(sweepCount >= 1);
  assert.equal(hydrated.filter((j) => j.type === 'sweep' && j.cacheHit).length, sweepCount);
});

test('browser worker telemetry records serial execution order', async () => {
  const lock = createBrowserWorkerLock();
  await Promise.all([
    lock.runExclusive('j1', async () => {
      await Promise.resolve();
    }),
    lock.runExclusive('j2', async () => {
      await Promise.resolve();
    }),
  ]);
  const tel = lock.getTelemetry();
  assert.deepEqual(tel.map((t) => t.jobId), ['j1', 'j2']);
});

test('local scoring concurrency preserves merged ordering', async () => {
  const rawResults = [];
  for (let i = 0; i < 8; i += 1) {
    rawResults.push({
      templateId: `t-${String(i).padStart(2, '0')}`,
      candidates: [{
        fullName: `Person ${i}`,
        title: 'VP Platform Engineering',
        salesNavigatorUrl: `https://www.linkedin.com/sales/lead/${i}`,
      }],
    });
  }

  const icpConfig = {
    titleIncludeKeywords: ['platform'],
    seniorityWeights: { vp: 10 },
    roleFamilyWeights: { platform_engineering: 30 },
  };
  const coverageConfig = {
    bucketRules: {
      directObservabilityRoleFamilies: ['platform_engineering'],
      adjacentRoleFamilies: [],
    },
  };

  const s1 = await scoreResearchCandidates({
    accountName: 'BenchCo',
    rawResults,
    icpConfig,
    coverageConfig,
    priorityModel: null,
    localConcurrency: 2,
  });
  const s2 = await scoreResearchCandidates({
    accountName: 'BenchCo',
    rawResults,
    icpConfig,
    coverageConfig,
    priorityModel: null,
    localConcurrency: 8,
  });

  assert.deepEqual(
    s1.consolidated.candidates.map((c) => c.fullName),
    s2.consolidated.candidates.map((c) => c.fullName),
  );
});

test('merge artifact exposes cache vs browser counters', async () => {
  const queue = buildResearchQueue({
    accounts: [{ accountId: 'a1', accountName: 'BenchCo' }],
    runId: 'bench',
  });
  const plan = planResearchJobs({
    queue,
    coverageConfig: {
      broadCrawl: { enabled: true },
      sweeps: [{ id: 'y', keywords: ['obs'] }],
    },
  });

  const hydrated = await attachSweepCacheState({
    jobs: plan.jobs,
    readCache: (job) => (
      job.templateId === 'broad-crawl'
        ? { candidates: [] }
        : null
    ),
  });

  const lock = createBrowserWorkerLock();
  const browser = await executeBrowserSweepJobs({
    jobs: hydrated,
    driver: {
      async openPeopleSearch() {},
      async applySearchTemplate() {},
      async scrollAndCollectCandidates() {
        return [{ fullName: 'Z', title: 'VP Platform Engineering' }];
      },
    },
    lock,
    runId: 'bench',
  });

  const rawResults = [];
  for (const job of hydrated) {
    if (job.type !== 'sweep') continue;
    if (job.cacheHit) {
      rawResults.push({ templateId: job.templateId, candidates: job.cacheCandidates || [] });
    }
  }
  for (const row of browser.results) {
    if (row.status === 'completed') {
      rawResults.push({ templateId: row.templateId, candidates: row.candidates || [] });
    }
  }

  const scoring = await scoreResearchCandidates({
    accountName: 'BenchCo',
    rawResults,
    icpConfig: {
      titleIncludeKeywords: ['platform'],
      seniorityWeights: { vp: 10 },
      roleFamilyWeights: { platform_engineering: 30 },
    },
    coverageConfig: {
      bucketRules: {
        directObservabilityRoleFamilies: ['platform_engineering'],
        adjacentRoleFamilies: [],
      },
    },
    priorityModel: null,
    localConcurrency: 4,
  });

  const artifact = buildResearchPipelineArtifact({
    queue,
    plannedJobs: plan,
    cacheResults: hydrated,
    browserResults: browser,
    scoringResults: scoring,
    lockTelemetry: lock.getTelemetry(),
    startedAt: 0,
    finishedAt: 100,
    localConcurrency: 4,
  });

  assert.equal(artifact.browserConcurrency, 1);
  assert.equal(artifact.metrics.browserJobsSkippedByCache, artifact.metrics.cacheHits);
  assert.equal(artifact.metrics.browserJobsExecuted, 1);
});
