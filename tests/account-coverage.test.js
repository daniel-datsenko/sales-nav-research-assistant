const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { readJson } = require('../src/lib/json');
const { resolveProjectPath } = require('../src/lib/paths');
const { buildPriorityModelV1 } = require('../src/core/priority-score');
const {
  applyDeepReviewResult,
  buildSweepTemplates,
  classifyReviewedCoverageBucket,
  consolidateCoverageCandidates,
  findAccountAliasEntry,
  loadAccountAliasConfig,
  normalizeAccountAliasKey,
  normalizeCandidateKey,
  normalizeSpeedProfile,
  runAccountCoverageWorkflow,
  selectCoverageListCandidates,
  writeAccountCoverageArtifact,
  selectDeepReviewCandidates,
  summarizeCoverageBuckets,
} = require('../src/core/account-coverage');
const { buildSweepCacheKey } = require('../src/core/sweep-cache');

test('buildSweepTemplates includes broad crawl and configured sweeps', () => {
  const config = readJson(resolveProjectPath('config', 'account-coverage', 'default.json'));
  const templates = buildSweepTemplates(config);

  assert.equal(templates[0].id, 'broad-crawl');
  assert.equal(templates[0].maxCandidates, undefined);
  assert.ok(templates.some((template) => template.id === 'sweep-architecture'));
});

test('buildSweepTemplates keeps explicit maxCandidates override backward compatible', () => {
  const config = readJson(resolveProjectPath('config', 'account-coverage', 'default.json'));
  const templates = buildSweepTemplates(config, 6);

  assert.equal(templates[0].maxCandidates, 6);
  assert.equal(templates.find((template) => template.id === 'sweep-engineering').maxCandidates, 6);
});

test('buildSweepTemplates applies speed profiles without adding hidden candidate caps', () => {
  const config = {
    broadCrawl: { enabled: true },
    sweeps: [
      { id: 'platform', keywords: ['platform engineering'] },
      { id: 'security', keywords: ['security'] },
      { id: 'data', keywords: ['data analytics'] },
    ],
  };

  const fast = buildSweepTemplates(config, null, { speedProfile: 'fast' });
  const balanced = buildSweepTemplates(config, null, { speedProfile: 'balanced' });

  assert.deepEqual(fast.map((template) => template.id), ['broad-crawl', 'sweep-platform']);
  assert.equal(fast.some((template) => Object.hasOwn(template, 'maxCandidates')), false);
  assert.deepEqual(balanced.map((template) => template.id), [
    'broad-crawl',
    'sweep-platform',
    'sweep-security',
    'sweep-data',
  ]);
  assert.equal(normalizeSpeedProfile('unknown'), 'balanced');
});

test('buildSweepCacheKey is stable for account targets and template keywords', () => {
  const first = buildSweepCacheKey({
    account: {
      name: 'Example Logistics Switzerland',
      salesNav: {
        companyTargets: [{ linkedinName: 'Example Logistics' }],
      },
    },
    template: { id: 'sweep-platform', keywords: ['Platform', 'Cloud'] },
    coverageConfigVersion: 'v1',
  });
  const second = buildSweepCacheKey({
    account: {
      name: 'Example Logistics Switzerland',
      salesNav: {
        companyTargets: [{ linkedinName: 'Example Logistics' }],
      },
    },
    template: { id: 'sweep-platform', keywords: ['cloud', 'platform'] },
    coverageConfigVersion: 'v1',
  });

  assert.equal(first, second);
});

test('default account coverage config has no maxCandidates ceiling', () => {
  const config = readJson(resolveProjectPath('config', 'account-coverage', 'default.json'));

  assert.equal(config.broadCrawl.maxCandidates, undefined);
  assert.equal(config.sweeps.some((sweep) => Object.hasOwn(sweep, 'maxCandidates')), false);
});

test('consolidateCoverageCandidates dedupes candidates and tracks sweep sources', () => {
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const coverageConfig = readJson(resolveProjectPath('config', 'account-coverage', 'default.json'));
  const priorityConfig = readJson(resolveProjectPath('config', 'priority-score', 'default.json'));
  const priorityModel = buildPriorityModelV1({
    config: priorityConfig,
    winningContactRows: [
      { title_family: 'architecture', won_opportunities: 20, total_won_amount: 5000000 },
      { title_family: 'platform', won_opportunities: 12, total_won_amount: 2200000 },
    ],
    hiddenInfluencerRows: [],
    conversation_intelligenceKeywordRows: [],
  });

  const result = consolidateCoverageCandidates([
    {
      templateId: 'sweep-architecture',
      candidates: [
        {
          fullName: 'Oliver Dawid',
          title: 'Group Expert Enterprise Architecture',
          company: 'Marc O’Polo SE',
          location: 'Germany',
          profileUrl: 'https://www.linkedin.com/in/oliver-dawid',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/oliver',
        },
      ],
    },
    {
      templateId: 'sweep-platform',
      candidates: [
        {
          fullName: 'Oliver Dawid',
          title: 'Group Expert Enterprise Architecture',
          company: 'Marc O’Polo SE',
          location: 'Germany',
          profileUrl: 'https://www.linkedin.com/in/oliver-dawid',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/oliver',
        },
        {
          fullName: 'Kilian Pfeifer',
          title: 'DevOps Cloud Engineer',
          company: 'Marc O’Polo SE',
          location: 'Germany',
          profileUrl: 'https://www.linkedin.com/in/kilian-pfeifer',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/kilian',
        },
      ],
    },
  ], {
    icpConfig,
    priorityModel,
    coverageConfig,
    accountName: 'Marc O’Polo SE',
  });

  assert.equal(result.candidateCount, 2);
  assert.deepEqual(result.candidates[0].sweeps.sort(), ['sweep-architecture', 'sweep-platform']);
  assert.ok(result.coverage);
});

test('summarizeCoverageBuckets counts buckets', () => {
  const counts = summarizeCoverageBuckets([
    { coverageBucket: 'direct_observability' },
    { coverageBucket: 'direct_observability' },
    { coverageBucket: 'technical_adjacent' },
  ]);

  assert.equal(counts.direct_observability, 2);
  assert.equal(counts.technical_adjacent, 1);
  assert.equal(counts.likely_noise, 0);
});

test('normalizeCandidateKey strips query-string noise from lead urls', () => {
  const key = normalizeCandidateKey({
    salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/abc123?_ntb=foo&trk=bar',
  });

  assert.equal(key, 'https://www.linkedin.com/sales/lead/abc123');
});

test('selectDeepReviewCandidates prioritizes adjacent and likely-noise technical titles', () => {
  const selected = selectDeepReviewCandidates({
    candidates: [
      { fullName: 'A', title: 'Data Engineer', coverageBucket: 'technical_adjacent', score: 30 },
      { fullName: 'B', title: 'Head of Buying', coverageBucket: 'likely_noise', score: 40 },
      { fullName: 'C', title: 'SAP Technology Manager', coverageBucket: 'likely_noise', score: 20 },
      { fullName: 'D', title: 'DevOps Engineer', coverageBucket: 'direct_observability', score: 70 },
    ],
  }, 3);

  assert.deepEqual(selected.map((candidate) => candidate.fullName), ['A', 'C']);
});

test('selectCoverageListCandidates can enforce core-only day-list selection', () => {
  const selected = selectCoverageListCandidates({
    candidates: [
      {
        fullName: 'Core Platform',
        title: 'Director of Platform Engineering',
        coverageBucket: 'direct_observability',
        roleFamily: 'platform_engineering',
        score: 64,
        priorityModel: { priorityScore: 90 },
      },
      {
        fullName: 'Security Adjacent',
        title: 'Information Security Manager',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'security',
        score: 52,
        priorityModel: { priorityScore: 80 },
      },
      {
        fullName: 'Logistics Adjacent',
        title: 'IT Logistics Platform Manager',
        coverageBucket: 'direct_observability',
        roleFamily: 'platform_engineering',
        score: 58,
        priorityModel: { priorityScore: 70 },
      },
      {
        fullName: 'Infra Cost',
        title: 'Infrastructure Cost Manager',
        coverageBucket: 'direct_observability',
        roleFamily: 'infrastructure',
        score: 58,
        priorityModel: { priorityScore: 60 },
      },
    ],
  }, {
    includeBuckets: ['direct_observability'],
    minScore: 35,
    excludeRoleFamilies: ['security', 'data'],
    excludeTitleKeywords: ['logistics', 'transport', 'supply chain', 'cost manager'],
  });

  assert.deepEqual(selected.map((candidate) => candidate.fullName), ['Core Platform']);
});

test('selectCoverageListCandidates excludes out-of-network profiles from list targets', () => {
  const selected = selectCoverageListCandidates({
    candidates: [
      {
        fullName: 'Reachable Platform',
        title: 'Director of Platform Engineering',
        coverageBucket: 'direct_observability',
        roleFamily: 'platform_engineering',
        score: 64,
        outOfNetwork: false,
      },
      {
        fullName: 'Out Of Network SRE',
        title: 'Head of SRE',
        coverageBucket: 'direct_observability',
        roleFamily: 'site_reliability',
        score: 70,
        outOfNetwork: true,
      },
    ],
  });

  assert.deepEqual(selected.map((candidate) => candidate.fullName), ['Reachable Platform']);
});

test('classifyReviewedCoverageBucket can promote signal-rich reviewed candidates', () => {
  const coverageConfig = readJson(resolveProjectPath('config', 'account-coverage', 'default.json'));
  const bucket = classifyReviewedCoverageBucket({
    roleFamily: 'unknown',
    score: 42,
    scoreBreakdown: {
      observabilitySignals: ['monitoring'],
      championSignals: ['platform operations'],
      profileReviewSignals: ['observability-platform'],
    },
  }, coverageConfig);

  assert.equal(bucket, 'direct_observability');
});

test('applyDeepReviewResult annotates reviewed candidate changes', () => {
  const updated = applyDeepReviewResult(
    {
      fullName: 'Taylor',
      title: 'IT System Engineer',
      coverageBucket: 'technical_adjacent',
      score: 30,
    },
    {
      score: 41,
      roleFamily: 'software_engineering',
      seniority: 'individual_contributor',
      breakdown: {
        observabilitySignals: ['monitoring'],
        championSignals: [],
        profileReviewSignals: [],
      },
    },
    { priorityTier: 'secondary', priorityScore: 25 },
    'technical_adjacent',
    { snippet: 'Owns monitoring and incident tooling.' },
  );

  assert.equal(updated.deepReview.previousBucket, 'technical_adjacent');
  assert.equal(updated.deepReview.reviewedBucket, 'technical_adjacent');
  assert.equal(updated.deepReview.reviewedScore, 41);
});

test('runAccountCoverageWorkflow uses resolved accounts from enumerateAccounts when available', async () => {
  const coverageConfig = readJson(resolveProjectPath('config', 'account-coverage', 'lean-observability.json'));
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  let receivedAccount = null;

  const driver = {
    async openAccountSearch() {},
    async enumerateAccounts(accounts) {
      assert.deepEqual(accounts[0].salesNav.linkedinCompanyUrls, [
        'https://www.linkedin.com/company/example-media-germany',
      ]);
      return accounts.map((account) => ({
        ...account,
        salesNav: {
          ...(account.salesNav || {}),
          accountUrl: 'https://www.linkedin.com/sales/company/mock-account',
        },
      }));
    },
    async openPeopleSearch(account) {
      receivedAccount = account;
    },
    async applySearchTemplate() {},
    async scrollAndCollectCandidates() {
      return [];
    },
  };

  const run = await runAccountCoverageWorkflow({
    driver,
    accountName: 'Example Media Group Germany',
    coverageConfig,
    icpConfig,
    priorityModel: null,
    maxCandidates: 3,
  });

  assert.equal(receivedAccount.salesNav.accountUrl, 'https://www.linkedin.com/sales/company/mock-account');
  assert.equal(run.account.salesNav.accountUrl, 'https://www.linkedin.com/sales/company/mock-account');
});

test('runAccountCoverageWorkflow records sweep failures for operator reporting', async () => {
  const accountName = 'Synthetic Sweep Failure Account';
  const coverageConfig = {
    broadCrawl: { enabled: true, maxCandidates: 3 },
    sweeps: [
      { id: 'sweep-platform', keywords: ['platform'], maxCandidates: 3 },
    ],
  };
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const warnings = [];

  const driver = {
    async openAccountSearch() {},
    async enumerateAccounts(accounts) {
      return accounts;
    },
    async openPeopleSearch() {
      throw new Error(`Unable to scope people search to account filter for ${accountName}`);
    },
    async applySearchTemplate() {},
    async scrollAndCollectCandidates() {
      return [];
    },
  };

  const run = await runAccountCoverageWorkflow({
    driver,
    accountName,
    coverageConfig,
    icpConfig,
    priorityModel: null,
    maxCandidates: 3,
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
  });

  assert.equal(run.result.candidateCount, 0);
  assert.equal(run.sweepErrors.length, 2);
  assert.equal(run.result.sweepErrors.length, 2);
  assert.match(run.sweepErrors[0].message, /Unable to scope people search/);
  assert.match(warnings[0], /Sweep broad-crawl failed/);
});

test('runAccountCoverageWorkflow upgrades failed company resolution when live sweeps return candidates', async () => {
  const accountName = `Live Scoped Unknown Account ${Date.now()}`;
  const coverageConfig = {
    broadCrawl: { enabled: true, maxCandidates: 3 },
    sweeps: [],
  };
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));

  const driver = {
    async openAccountSearch() {},
    async enumerateAccounts(accounts) {
      return accounts.map((account) => ({
        ...account,
        salesNav: {
          ...(account.salesNav || {}),
          accountUrl: 'https://www.linkedin.com/sales/company/live-scoped-unknown-account',
          selectedCompanyLabel: 'Live Scoped Unknown Account',
        },
      }));
    },
    async openPeopleSearch() {},
    async applySearchTemplate() {},
    async scrollAndCollectCandidates() {
      return [{
        fullName: 'Live Scoped Candidate',
        title: 'Head of Platform Engineering',
        company: accountName,
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/live-scoped-candidate',
      }];
    },
  };

  const run = await runAccountCoverageWorkflow({
    driver,
    accountName,
    coverageConfig,
    icpConfig,
    priorityModel: null,
  });

  assert.equal(run.result.candidateCount, 1);
  assert.equal(run.result.companyResolution.status, 'resolved_by_live_scope');
  assert.equal(run.result.companyResolution.confidence, 1);
  assert.equal(run.result.companyResolution.recommendedAction, 'run_people_sweeps');
  assert.deepEqual(run.result.companyResolution.selectedTargets, ['Live Scoped Unknown Account']);
});

test('runAccountCoverageWorkflow falls back to the last successful artifact when live coverage is empty', async () => {
  const coverageConfig = readJson(resolveProjectPath('config', 'account-coverage', 'lean-observability.json'));
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const accountName = 'Fallback Coverage Account';

  writeAccountCoverageArtifact(accountName, {
    accountName,
    generatedAt: '2026-04-22T00:00:00.000Z',
    candidateCount: 1,
    candidates: [
      {
        fullName: 'Saved Candidate',
        title: 'Platform Engineer',
        coverageBucket: 'direct_observability',
        score: 60,
      },
    ],
    coverage: null,
  });

  const driver = {
    async openAccountSearch() {},
    async enumerateAccounts(accounts) {
      return accounts;
    },
    async openPeopleSearch() {},
    async applySearchTemplate() {},
    async scrollAndCollectCandidates() {
      return [];
    },
  };

  const run = await runAccountCoverageWorkflow({
    driver,
    accountName,
    coverageConfig,
    icpConfig,
    priorityModel: null,
    maxCandidates: 3,
  });

  assert.equal(run.result.candidateCount, 1);
  assert.equal(run.result.candidates[0].fullName, 'Saved Candidate');
  assert.equal(run.result.fallback.reason, 'live_coverage_empty');

  fs.unlinkSync(resolveProjectPath('runtime', 'artifacts', 'coverage', 'fallback-coverage-account.json'));
});

test('runAccountCoverageWorkflow reuses sweep cache and exposes speed telemetry', async () => {
  const os = require('node:os');
  const path = require('node:path');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-cache-test-'));
  const coverageConfig = {
    version: 'test-speed-cache',
    broadCrawl: { enabled: false },
    sweeps: [
      { id: 'platform', keywords: ['platform'] },
    ],
  };
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const accountName = `Sweep Cache Account ${Date.now()}`;
  let scrollCalls = 0;
  const firstDriver = {
    async openAccountSearch() {},
    async enumerateAccounts(accounts) {
      return accounts;
    },
    async openPeopleSearch() {},
    async applySearchTemplate() {},
    async scrollAndCollectCandidates() {
      scrollCalls += 1;
      return [{
        fullName: 'Cache Candidate',
        title: 'Platform Engineer',
        company: accountName,
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/cache-candidate',
      }];
    },
  };
  await runAccountCoverageWorkflow({
    driver: firstDriver,
    accountName,
    coverageConfig,
    icpConfig,
    priorityModel: null,
    reuseSweepCache: true,
    sweepCacheDir: cacheDir,
  });

  let peopleSearchCalls = 0;
  const secondDriver = {
    async openAccountSearch() {},
    async enumerateAccounts(accounts) {
      return accounts;
    },
    async openPeopleSearch() {
      peopleSearchCalls += 1;
    },
    async applySearchTemplate() {},
    async scrollAndCollectCandidates() {
      throw new Error('cache miss should not navigate');
    },
  };
  const run = await runAccountCoverageWorkflow({
    driver: secondDriver,
    accountName,
    coverageConfig,
    icpConfig,
    priorityModel: null,
    reuseSweepCache: true,
    sweepCacheDir: cacheDir,
  });

  assert.equal(scrollCalls, 1);
  assert.equal(peopleSearchCalls, 0);
  assert.equal(run.cacheHits, 1);
  assert.equal(run.cacheMisses, 0);
  assert.equal(run.result.cacheHits, 1);
  assert.equal(run.result.speedProfile, 'balanced');
  assert.equal(typeof run.result.timings.totalMs, 'number');
  assert.equal(run.result.slowestSweeps[0].cacheHit, true);
});

test('runAccountCoverageWorkflow passes already-seen candidate keys into later sweeps', async () => {
  const coverageConfig = {
    version: 'seen-key-test',
    broadCrawl: { enabled: false },
    sweeps: [
      { id: 'platform', keywords: ['platform'] },
      { id: 'cloud', keywords: ['cloud'] },
    ],
  };
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const seenBySweep = [];

  const driver = {
    async openAccountSearch() {},
    async enumerateAccounts(accounts) {
      return accounts;
    },
    async openPeopleSearch() {},
    async applySearchTemplate() {},
    async scrollAndCollectCandidates(account, template, context) {
      seenBySweep.push({
        templateId: template.id,
        seen: Array.from(context.seenCandidateKeys || []),
      });
      if (template.id === 'sweep-platform') {
        return [{
          fullName: 'Already Found',
          title: 'Platform Engineer',
          company: account.name,
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/already-found?_ntb=noise',
        }];
      }
      return [{
        fullName: 'New Cloud',
        title: 'Cloud Engineer',
        company: account.name,
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/new-cloud',
      }];
    },
  };

  await runAccountCoverageWorkflow({
    driver,
    accountName: 'Seen Key Account',
    coverageConfig,
    icpConfig,
    priorityModel: null,
  });

  assert.deepEqual(seenBySweep[0], {
    templateId: 'sweep-platform',
    seen: [],
  });
  assert.deepEqual(seenBySweep[1], {
    templateId: 'sweep-cloud',
    seen: ['https://www.linkedin.com/sales/lead/already-found'],
  });
});

test('runAccountCoverageWorkflow applies optional inter-sweep delay between templates', async () => {
  const coverageConfig = {
    version: 'inter-sweep-delay-test',
    broadCrawl: { enabled: false },
    sweeps: [
      { id: 'platform', keywords: ['platform'] },
      { id: 'cloud', keywords: ['cloud'] },
    ],
  };
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const waits = [];
  const driver = {
    page: {
      async waitForTimeout(ms) {
        waits.push(ms);
      },
    },
    async openAccountSearch() {},
    async enumerateAccounts(accounts) {
      return accounts;
    },
    async openPeopleSearch() {},
    async applySearchTemplate() {},
    async scrollAndCollectCandidates() {
      return [];
    },
  };

  await runAccountCoverageWorkflow({
    driver,
    accountName: 'Inter Sweep Delay Account',
    coverageConfig,
    icpConfig,
    priorityModel: null,
    interSweepDelayMs: 2000,
  });

  assert.deepEqual(waits, [2000]);
});

test('runAccountCoverageWorkflow stops remaining sweeps when rate limited', async () => {
  const coverageConfig = {
    version: 'rate-limit-test',
    broadCrawl: { enabled: false },
    sweeps: [
      { id: 'platform', keywords: ['platform'] },
      { id: 'cloud', keywords: ['cloud'] },
    ],
  };
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const warnings = [];
  const attempted = [];
  const driver = {
    async openAccountSearch() {},
    async enumerateAccounts(accounts) {
      return accounts;
    },
    async openPeopleSearch() {},
    async applySearchTemplate(template) {
      attempted.push(template.id);
    },
    async scrollAndCollectCandidates() {
      const error = new Error('rate_limited: LinkedIn too many requests after backoff');
      error.code = 'rate_limited';
      throw error;
    },
  };

  const run = await runAccountCoverageWorkflow({
    driver,
    accountName: 'Rate Limited Account',
    coverageConfig,
    icpConfig,
    priorityModel: null,
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
  });

  assert.deepEqual(attempted, ['sweep-platform']);
  assert.equal(run.result.resolutionStatus, 'rate_limited');
  assert.equal(run.result.sweepErrors[0].errorCategory, 'rate_limited');
  assert.match(warnings[0], /rate limited/i);
});

test('loadAccountAliasConfig exposes configured aliases for hard accounts', () => {
  const config = loadAccountAliasConfig();

  assert.deepEqual(config.accounts['example-lists-first'].companyFilterAliases, [
    'Example Lists First Account',
    'Example Public Broadcaster',
  ]);
  assert.ok(config.accounts['example-manual-review'].accountSearchAliases.includes('example-manual-review.test'));
  assert.ok(config.accounts['example-media-group-germany'].companyFilterAliases.includes('Example Media Germany'));
  assert.ok(config.accounts['example-logistics-switzerland'].accountSearchAliases.includes('Example Logistics'));
  assert.match(config.accounts['example-logistics-switzerland'].linkedinCompanyUrls[0], /example-logistics/);
  assert.ok(config.accounts['example-broadcast-studio'].companyFilterAliases.includes('Example Broadcaster'));
  assert.ok(config.accounts['example-mobility-bus'].companyFilterAliases.includes('Example Mobility GmbH'));
  assert.match(config.accounts['example-mobility-se'].linkedinCompanyUrls[0], /example-mobility/);
});

test('findAccountAliasEntry tolerates legal suffix and punctuation variants', () => {
  const config = loadAccountAliasConfig();

  assert.equal(normalizeAccountAliasKey('Example Logistics Switzerland AG'), 'example logistics switzerland');
  assert.equal(
    findAccountAliasEntry(config, 'Example Logistics Switzerland AG').accountSearchAliases[0],
    'Example Logistics',
  );
  assert.equal(
    findAccountAliasEntry(config, 'Example Broadcast Studio').companyFilterAliases[0],
    'Example Broadcaster',
  );
});
