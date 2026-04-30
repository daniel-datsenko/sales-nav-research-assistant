const test = require('node:test');
const assert = require('node:assert/strict');

const {
  attachSweepCacheState,
  buildResearchPipelineArtifact,
  buildResearchQueue,
  executeBrowserSweepJobs,
  normalizeResearchAccount,
  planResearchJobs,
  scoreResearchCandidates,
} = require('../src/core/research-pipeline');
const { createBrowserWorkerLock } = require('../src/core/browser-worker-lock');

test('buildResearchQueue creates deterministic account jobs with dry-safe defaults', () => {
  const queue = buildResearchQueue({
    accounts: [
      { accountId: 'a1', accountName: 'Example AG' },
      { accountId: 'a2', accountName: 'Example GmbH' },
    ],
    runId: 'research-run-1',
    generatedAt: '2026-04-30T12:00:00Z',
  });

  assert.equal(queue.version, '1.0.0');
  assert.equal(queue.runId, 'research-run-1');
  assert.equal(queue.generatedAt, '2026-04-30T12:00:00Z');
  assert.equal(queue.mode, 'dry-safe');
  assert.equal(queue.safety.liveSaveAllowed, false);
  assert.equal(queue.safety.liveConnectAllowed, false);
  assert.deepEqual(queue.accounts.map((job) => job.accountKey), ['a1', 'a2']);
});

test('normalizeResearchAccount falls back to stable name key', () => {
  const account = normalizeResearchAccount({ accountName: 'Example AG' });
  assert.equal(account.accountKey, 'example-ag');
  assert.equal(account.accountName, 'Example AG');
});

test('normalizeResearchAccount prefers accountId as accountKey', () => {
  const account = normalizeResearchAccount({ accountId: '  x9  ', accountName: 'Other' });
  assert.equal(account.accountKey, 'x9');
  assert.equal(account.accountName, 'Other');
});

test('normalizeResearchAccount uses name then companyName for display', () => {
  const fromName = normalizeResearchAccount({ name: 'Acme Corp' });
  assert.equal(fromName.accountKey, 'acme-corp');
  assert.equal(fromName.accountName, 'Acme Corp');

  const fromCompany = normalizeResearchAccount({ companyName: 'Beta LLC' });
  assert.equal(fromCompany.accountKey, 'beta-llc');
  assert.equal(fromCompany.accountName, 'Beta LLC');
});

test('buildResearchQueue sorts accounts by accountKey for determinism', () => {
  const queue = buildResearchQueue({
    accounts: [
      { accountId: 'z', accountName: 'Zed' },
      { accountId: 'a', accountName: 'Aye' },
    ],
    runId: 'r1',
  });
  assert.deepEqual(queue.accounts.map((a) => a.accountKey), ['a', 'z']);
});

test('planResearchJobs emits scoped sweep jobs without live mutation permissions', () => {
  const plan = planResearchJobs({
    queue: buildResearchQueue({
      accounts: [{ accountId: 'a1', accountName: 'Example AG' }],
      runId: 'research-run-1',
    }),
    coverageConfig: {
      broadCrawl: { enabled: true },
      sweeps: [{ id: 'platform', keywords: ['platform'] }],
    },
  });

  assert.ok(plan.jobs.some((job) => job.type === 'company_resolution'));
  const sweepJobs = plan.jobs.filter((job) => job.type === 'sweep');
  assert.equal(sweepJobs.length, 2);
  assert.equal(sweepJobs.every((job) => job.requiresBrowser === true), true);
  assert.equal(sweepJobs.every((job) => job.safety.companyScopeRequired === true), true);
  assert.equal(sweepJobs.every((job) => job.safety.liveSaveAllowed === false), true);
  assert.equal(sweepJobs.every((job) => job.safety.liveConnectAllowed === false), true);
  assert.equal(plan.safety.liveSaveAllowed, false);
  assert.equal(plan.safety.liveConnectAllowed, false);
});

test('planResearchJobs includes template fields on sweep jobs', () => {
  const plan = planResearchJobs({
    queue: buildResearchQueue({
      accounts: [{ accountId: 'a1', accountName: 'Example AG' }],
      runId: 'r',
    }),
    coverageConfig: {
      broadCrawl: { enabled: true, titleIncludes: ['VP'] },
      sweeps: [{ id: 'platform', keywords: ['platform'], titleIncludes: ['Engineer'] }],
    },
  });
  const broad = plan.jobs.find((j) => j.type === 'sweep' && j.templateId === 'broad-crawl');
  const platform = plan.jobs.find((j) => j.type === 'sweep' && j.templateId === 'sweep-platform');
  assert.ok(broad);
  assert.ok(platform);
  assert.deepEqual(broad.keywords, []);
  assert.deepEqual(broad.titleIncludes, ['VP']);
  assert.deepEqual(platform.keywords, ['platform']);
  assert.deepEqual(platform.titleIncludes, ['Engineer']);
  assert.equal(broad.accountKey, 'a1');
  assert.equal(broad.accountName, 'Example AG');
  assert.equal(platform.accountKey, 'a1');
  assert.equal(platform.accountName, 'Example AG');
});

test('planResearchJobs emits one company_resolution per account in deterministic order', () => {
  const plan = planResearchJobs({
    queue: buildResearchQueue({
      accounts: [
        { accountId: 'b2', accountName: 'B' },
        { accountId: 'a1', accountName: 'A' },
      ],
      runId: 'r',
    }),
    coverageConfig: {
      broadCrawl: { enabled: true },
      sweeps: [],
    },
  });
  const cr = plan.jobs.filter((j) => j.type === 'company_resolution');
  assert.equal(cr.length, 2);
  assert.deepEqual(cr.map((j) => j.accountKey), ['a1', 'b2']);
  assert.equal(cr.every((j) => j.safety.liveSaveAllowed === false), true);
  assert.equal(cr.every((j) => j.safety.liveConnectAllowed === false), true);
  const expectedIds = plan.jobs.map((j) => j.id);
  const sorted = [...expectedIds].sort();
  assert.deepEqual(expectedIds, sorted, 'job ids should be sorted for stable ordering');
});

test('planResearchJobs passes maxCandidates and options into buildSweepTemplates', () => {
  const plan = planResearchJobs({
    queue: buildResearchQueue({
      accounts: [{ accountId: 'x', accountName: 'X' }],
      runId: 'r',
    }),
    coverageConfig: {
      broadCrawl: { enabled: true },
      sweeps: [{ id: 's1', keywords: ['k'] }],
    },
    maxCandidates: 5,
    options: { speedProfile: 'exhaustive' },
  });
  const sweeps = plan.jobs.filter((j) => j.type === 'sweep');
  assert.equal(sweeps.length, 2);
  assert.equal(sweeps[0].maxCandidates, 5);
  assert.equal(sweeps[1].maxCandidates, 5);
});

test('attachSweepCacheState calls readCache for sweep jobs only', async () => {
  const plan = planResearchJobs({
    queue: buildResearchQueue({
      accounts: [{ accountId: 'a1', accountName: 'Acme' }],
      runId: 'r',
    }),
    coverageConfig: {
      broadCrawl: { enabled: true },
      sweeps: [{ id: 's1', keywords: ['k'] }],
    },
  });
  const calls = [];
  const jobs = await attachSweepCacheState({
    jobs: plan.jobs,
    readCache: (job) => {
      calls.push(job.type);
      return null;
    },
  });
  assert.deepEqual(calls, ['sweep', 'sweep']);
  assert.equal(jobs.filter((j) => j.type === 'company_resolution').length, 1);
});

test('attachSweepCacheState marks cache hits without browser', async () => {
  const plan = planResearchJobs({
    queue: buildResearchQueue({
      accounts: [{ accountId: 'a1', accountName: 'Acme' }],
      runId: 'r',
    }),
    coverageConfig: {
      broadCrawl: { enabled: true },
      sweeps: [],
    },
  });
  const sweepId = plan.jobs.find((j) => j.type === 'sweep').id;
  const jobs = await attachSweepCacheState({
    jobs: plan.jobs,
    readCache: (job) => {
      if (job.id === sweepId) {
        return { candidates: [{ fullName: 'A', title: 'VP Platform Engineering' }] };
      }
      return null;
    },
  });
  const hit = jobs.find((j) => j.id === sweepId);
  assert.equal(hit.cacheHit, true);
  assert.equal(hit.requiresBrowser, false);
  assert.equal(hit.cacheCandidates.length, 1);
});

test('attachSweepCacheState treats thrown readCache as cache miss', async () => {
  const plan = planResearchJobs({
    queue: buildResearchQueue({
      accounts: [{ accountId: 'a1', accountName: 'Acme' }],
      runId: 'r',
    }),
    coverageConfig: {
      broadCrawl: { enabled: true },
      sweeps: [],
    },
  });
  const jobs = await attachSweepCacheState({
    jobs: plan.jobs,
    readCache: () => {
      throw new Error('bad cache');
    },
  });
  const sweep = jobs.find((j) => j.type === 'sweep');
  assert.equal(sweep.cacheHit, false);
  assert.equal(sweep.requiresBrowser, true);
});

test('executeBrowserSweepJobs skips cache-hit jobs and serializes driver calls', async () => {
  const plan = planResearchJobs({
    queue: buildResearchQueue({
      accounts: [{ accountId: 'a1', accountName: 'Acme' }],
      runId: 'r',
    }),
    coverageConfig: {
      broadCrawl: { enabled: true },
      sweeps: [{ id: 's2', keywords: ['obs'] }],
    },
  });
  const withCache = await attachSweepCacheState({
    jobs: plan.jobs,
    readCache: (job) => {
      if (String(job.templateId) === 'broad-crawl') {
        return { candidates: [{ fullName: 'Cached', title: 'Director SRE' }] };
      }
      return null;
    },
  });

  const events = [];
  const driver = {
    async openPeopleSearch() {
      events.push('open');
    },
    async applySearchTemplate(t) {
      events.push(`tpl:${t.id}`);
    },
    async scrollAndCollectCandidates(account, template) {
      events.push(`collect:${template.id}`);
      return [{ fullName: 'Live', title: 'VP Platform Engineering', company: account.accountName }];
    },
  };

  const lock = createBrowserWorkerLock();
  const out = await executeBrowserSweepJobs({
    jobs: withCache,
    driver,
    lock,
    runId: 'run1',
  });

  assert.equal(out.browserJobsExecuted, 1);
  assert.deepEqual(events.filter((e) => e.startsWith('collect:')), ['collect:sweep-s2']);
});

test('executeBrowserSweepJobs stops on rate limit when stopOnRateLimit is true', async () => {
  const plan = planResearchJobs({
    queue: buildResearchQueue({
      accounts: [{ accountId: 'a1', accountName: 'Acme' }],
      runId: 'r',
    }),
    coverageConfig: {
      broadCrawl: { enabled: true },
      sweeps: [{ id: 's2', keywords: ['obs'] }],
    },
  });
  let n = 0;
  const driver = {
    async openPeopleSearch() {},
    async applySearchTemplate() {},
    async scrollAndCollectCandidates() {
      n += 1;
      if (n === 1) {
        const err = new Error('too many requests');
        err.code = 'rate_limited';
        throw err;
      }
      return [{ fullName: 'X', title: 'VP Platform Engineering' }];
    },
  };
  const lock = createBrowserWorkerLock();
  const out = await executeBrowserSweepJobs({
    jobs: plan.jobs,
    driver,
    lock,
    runId: 'run1',
    stopOnRateLimit: true,
  });
  assert.equal(out.rateLimitHitCount, 1);
  assert.equal(out.browserJobsExecuted, 0);
  const skipped = out.results.filter((r) => r.status === 'skipped');
  assert.ok(skipped.length >= 1);
});

test('scoreResearchCandidates dedupes and matches consolidate ordering across concurrency', async () => {
  const icpConfig = {
    titleExcludeKeywords: ['buildings'],
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
  const rawResults = [
    {
      templateId: 'broad-crawl',
      candidates: [
        {
          fullName: 'Jane',
          title: 'VP Platform Engineering',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/foo',
        },
      ],
    },
    {
      templateId: 'sweep-x',
      candidates: [
        {
          fullName: 'Jane',
          title: 'VP Platform Engineering',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/foo',
        },
        {
          fullName: 'Bob',
          title: 'Director Corporate Buildings Strategy',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/bar',
        },
      ],
    },
  ];

  const one = await scoreResearchCandidates({
    accountName: 'Acme',
    rawResults,
    icpConfig,
    coverageConfig,
    priorityModel: null,
    localConcurrency: 1,
  });
  const four = await scoreResearchCandidates({
    accountName: 'Acme',
    rawResults,
    icpConfig,
    coverageConfig,
    priorityModel: null,
    localConcurrency: 4,
  });

  assert.equal(one.metrics.candidatesRaw, 3);
  assert.equal(one.metrics.candidatesUnique, 2);
  assert.equal(one.consolidated.candidates.length, four.consolidated.candidates.length);
  assert.deepEqual(
    one.consolidated.candidates.map((c) => c.fullName),
    four.consolidated.candidates.map((c) => c.fullName),
  );
  assert.ok(one.rejected.some((c) => c.scoringEligible === false));
});

test('buildResearchPipelineArtifact includes browserConcurrency and metrics', () => {
  const queue = buildResearchQueue({
    accounts: [{ accountId: 'x', accountName: 'X' }],
    runId: 'rid',
  });
  const plan = planResearchJobs({
    queue,
    coverageConfig: { broadCrawl: { enabled: true }, sweeps: [] },
  });
  const jobsWithCache = [
    ...plan.jobs.map((j) => {
      if (j.type !== 'sweep') return j;
      return { ...j, requiresBrowser: false, cacheHit: true, cacheCandidates: [] };
    }),
  ];
  const browserResults = {
    results: [],
    rateLimitHitCount: 0,
    browserJobsExecuted: 0,
  };
  const scoringResults = {
    metrics: {
      candidatesRaw: 10,
      candidatesUnique: 5,
      selectedForList: 3,
      manualReviewCount: 1,
    },
  };
  const art = buildResearchPipelineArtifact({
    queue,
    plannedJobs: plan,
    cacheResults: jobsWithCache,
    browserResults,
    scoringResults,
    lockTelemetry: [],
    startedAt: '2026-04-30T12:00:00.000Z',
    finishedAt: '2026-04-30T12:01:40.000Z',
    localConcurrency: 4,
  });

  assert.equal(art.browserConcurrency, 1);
  assert.equal(art.localConcurrency, 4);
  assert.equal(art.metrics.cacheHits, 1);
  assert.equal(art.metrics.cacheMisses, 0);
  assert.equal(art.metrics.browserJobsSkippedByCache, 1);
  assert.equal(art.metrics.browserJobsExecuted, 0);
  assert.equal(art.metrics.totalMs, 100000);
  assert.equal(art.metrics.selectedForList, 3);
  assert.equal(art.metrics.manualReviewCount, 1);
  assert.equal(art.metrics.rateLimitHitCount, 0);
  assert.equal(art.safety.liveSaveAllowed, false);
  assert.equal(art.safety.liveConnectAllowed, false);
  assert.equal(art.safety.browserWorkerLock, 'held_serially');
});
