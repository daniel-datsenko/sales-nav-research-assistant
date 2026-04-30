const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildResearchQueue,
  normalizeResearchAccount,
  planResearchJobs,
} = require('../src/core/research-pipeline');

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
