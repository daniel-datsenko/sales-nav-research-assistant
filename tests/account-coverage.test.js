const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { readJson } = require('../src/lib/json');
const { resolveProjectPath } = require('../src/lib/paths');
const { buildPriorityModelV1 } = require('../src/core/priority-score');
const {
  applyDeepReviewResult,
  buildSweepTemplates,
  buildCoverageLanguageSplits,
  classifyReviewedCoverageBucket,
  consolidateCoverageCandidates,
  findAccountAliasEntry,
  loadAccountAliasConfig,
  normalizeAccountAliasKey,
  normalizeCandidateKey,
  normalizeResearchMode,
  normalizeSpeedProfile,
  runAccountCoverageWorkflow,
  selectCoverageListCandidates,
  writeAccountCoverageArtifact,
  selectDeepReviewCandidates,
  buildPersonaCoverageFollowUpPlan,
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
  const fastAdaptive = buildSweepTemplates(config, null, {
    speedProfile: 'fast',
    adaptiveSweepPruning: true,
  });
  const balanced = buildSweepTemplates(config, null, { speedProfile: 'balanced' });

  assert.deepEqual(fast.map((template) => template.id), ['broad-crawl', 'sweep-platform']);
  assert.deepEqual(fastAdaptive.map((template) => template.id), [
    'broad-crawl',
    'sweep-platform',
    'sweep-security',
    'sweep-data',
  ]);
  assert.equal(fastAdaptive.some((template) => Object.hasOwn(template, 'maxCandidates')), false);
  assert.equal(fast.some((template) => Object.hasOwn(template, 'maxCandidates')), false);
  assert.deepEqual(balanced.map((template) => template.id), [
    'broad-crawl',
    'sweep-platform',
    'sweep-security',
    'sweep-data',
  ]);
  assert.equal(normalizeSpeedProfile('unknown'), 'balanced');
});

test('buildSweepTemplates persona-led mode orders keyword packs by persona layer', () => {
  const templates = buildSweepTemplates({
    broadCrawl: { enabled: true },
    sweeps: [
      { id: 'devops', keywords: ['DevOps'] },
      { id: 'data-ai-buyers', keywords: ['CDO', 'Director Data'] },
      { id: 'architecture-operators', keywords: ['Enterprise Architecture'] },
      { id: 'security', keywords: ['security'] },
    ],
  }, null, { researchMode: 'persona-led', speedProfile: 'exhaustive' });

  assert.deepEqual(templates.map((template) => `${template.id}:${template.personaLayer}`), [
    'broad-crawl:broad',
    'sweep-data-ai-buyers:buyer',
    'sweep-architecture-operators:operator',
    'sweep-devops:user',
    'sweep-security:adjacent',
  ]);
  assert.equal(normalizeResearchMode('unknown'), 'persona-led');
});

test('buildSweepTemplates exhaustive research mode keeps all persona keyword packs', () => {
  const templates = buildSweepTemplates({
    broadCrawl: { enabled: true },
    sweeps: [
      { id: 'platform', keywords: ['platform engineering'] },
      { id: 'security', keywords: ['security'] },
      { id: 'data', keywords: ['data analytics'] },
    ],
  }, null, {
    researchMode: 'exhaustive',
    speedProfile: 'fast',
    adaptiveSweepPruning: true,
  });

  assert.deepEqual(templates.map((template) => template.id), [
    'broad-crawl',
    'sweep-platform',
    'sweep-security',
    'sweep-data',
  ]);
});

test('persona coverage flags many users without buyer as follow-up gap', () => {
  const plan = buildPersonaCoverageFollowUpPlan({
    buyer: { count: 0 },
    operator: { count: 2 },
    user: { count: 12 },
    coverageGaps: ['buyer_coverage_gap'],
  });

  assert.equal(plan.status, 'coverage_incomplete');
  assert.deepEqual(plan.missingLayers, ['buyer']);
  assert.equal(plan.nextAction, 'run_buyer_follow_up_sweeps');
  assert.equal(plan.followUpSweeps[0].personaLayer, 'buyer');
  assert.ok(plan.followUpSweeps[0].keywords.includes('CDO'));
});

test('persona coverage sufficient produces no follow-up sweeps', () => {
  const plan = buildPersonaCoverageFollowUpPlan({
    buyer: { count: 1 },
    operator: { count: 2 },
    user: { count: 3 },
    coverageGaps: [],
  });

  assert.equal(plan.status, 'coverage_sufficient');
  assert.deepEqual(plan.followUpSweeps, []);
});

test('buildSweepTemplates preserves title guard metadata for driver-side filtering', () => {
  const templates = buildSweepTemplates({
    broadCrawl: {
      enabled: true,
      titleExcludes: ['Brand Platform'],
    },
    sweeps: [
      {
        id: 'architecture',
        keywords: ['architect'],
        titleIncludes: ['Architect'],
        titleExcludes: ['Architecture & Construction'],
      },
    ],
  });

  assert.deepEqual(templates[0].titleExcludes, ['Brand Platform']);
  assert.deepEqual(templates[1].titleIncludes, ['Architect']);
  assert.deepEqual(templates[1].titleExcludes, ['Architecture & Construction']);
});

test('default account coverage config includes multilingual EMEA buyer and operator sweeps', () => {
  const config = readJson(resolveProjectPath('config', 'account-coverage', 'default.json'));
  const templates = buildSweepTemplates(config, null, { speedProfile: 'exhaustive' });
  const templateIds = templates.map((template) => template.id);
  const keywords = templates.flatMap((template) => template.keywords || []);

  assert.ok(templateIds.includes('sweep-emea-data-ai-buyers'));
  assert.ok(templateIds.includes('sweep-emea-it-governance-operators'));
  assert.ok(templateIds.includes('sweep-emea-localized-observability'));
  assert.ok(keywords.includes('CDO'));
  assert.ok(keywords.includes('Gouvernance SI'));
  assert.ok(keywords.includes('Observabilité'));
  assert.ok(keywords.includes('Leiter Digitale Transformation'));
  assert.ok(keywords.includes('Director de Datos'));
  assert.ok(keywords.includes('Direttore Dati'));
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

test('buildCoverageLanguageSplits produces DE and EN email-list buckets from selected coverage candidates', () => {
  const split = buildCoverageLanguageSplits({
    accountName: 'Example AG',
    candidates: [
      {
        fullName: 'Anna',
        title: 'Leiterin Cloud Plattform',
        profileLanguage: 'Deutsch',
        coverageBucket: 'direct_observability',
        roleFamily: 'platform_engineering',
        seniority: 'head',
        score: 70,
      },
      {
        fullName: 'Ben',
        title: 'Head of Platform',
        profileLanguage: 'English',
        coverageBucket: 'direct_observability',
        roleFamily: 'platform_engineering',
        seniority: 'head',
        score: 72,
      },
    ],
  }, { segment: 'platform-owner' });

  assert.equal(split.listNames.de, 'Example AG - platform-owner - DE');
  assert.equal(split.listNames.en, 'Example AG - platform-owner - EN');
  assert.deepEqual(split.buckets.de.map((candidate) => candidate.fullName), ['Anna']);
  assert.deepEqual(split.buckets.en.map((candidate) => candidate.fullName), ['Ben']);
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

test('selectCoverageListCandidates always keeps direct observability below the score gate', () => {
  const selected = selectCoverageListCandidates({
    candidates: [
      {
        fullName: 'Low Score DevOps',
        title: 'DevOps Engineer',
        coverageBucket: 'direct_observability',
        roleFamily: 'devops',
        seniority: 'individual_contributor',
        score: 12,
        scoreBreakdown: { components: { roleScore: 18, seniorityScore: 8, exclusionPenalty: -14 } },
      },
      {
        fullName: 'Adjacent Analyst',
        title: 'Data Analyst',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'data',
        seniority: 'individual_contributor',
        score: 80,
      },
    ],
  }, { minScore: 50 });

  assert.deepEqual(selected.map((candidate) => candidate.fullName), ['Low Score DevOps']);
  assert.equal(selected[0].listSelectionReason, 'direct_observability_always_include');
  assert.deepEqual(selected[0].topScoreComponents.slice(0, 2), [
    { component: 'roleScore', value: 18 },
    { component: 'exclusionPenalty', value: -14 },
  ]);
});

test('selectCoverageListCandidates force-includes CIO CTO and microservices builders', () => {
  const selected = selectCoverageListCandidates({
    candidates: [
      {
        fullName: 'Company CIO',
        title: 'CIO',
        coverageBucket: 'likely_noise',
        roleFamily: 'unknown',
        seniority: 'unknown',
        score: 0,
      },
      {
        fullName: 'Microservices Lead',
        title: 'Senior Microservices Developer',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'software_engineering',
        seniority: 'senior',
        score: 10,
      },
    ],
  }, { minScore: 50 });

  assert.deepEqual(selected.map((candidate) => candidate.fullName), ['Microservices Lead', 'Company CIO']);
  assert.deepEqual(selected.map((candidate) => candidate.listSelectionReason), [
    'microservices_observability_path',
    'executive_cto_cio_always_include',
  ]);
});

test('selectCoverageListCandidates narrows technical adjacent to ICP-positive subclasses', () => {
  const selected = selectCoverageListCandidates({
    candidates: [
      {
        fullName: 'VP Cloud',
        title: 'VP Cloud Engineering',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'executive_engineering',
        seniority: 'vp',
        score: 30,
      },
      {
        fullName: 'Head Cloud AI',
        title: 'Head of Cloud & AI',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'platform_engineering',
        seniority: 'head',
        score: 22,
      },
      {
        fullName: 'Principal Data AI',
        title: 'Principal Data & AI Transformation',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'data',
        seniority: 'principal',
        score: 18,
      },
      {
        fullName: 'BI Analyst',
        title: 'Senior BI Analyst',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'data',
        seniority: 'senior',
        score: 90,
      },
      {
        fullName: 'Security Manager',
        title: 'Information Security Manager',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'security',
        seniority: 'manager',
        score: 90,
      },
    ],
  }, { minScore: 50 });

  assert.deepEqual(selected.map((candidate) => candidate.fullName), [
    'VP Cloud',
    'Head Cloud AI',
    'Principal Data AI',
  ]);
  assert.deepEqual(selected.map((candidate) => candidate.listSelectionReason), [
    'technical_adjacent_executive_engineering',
    'technical_adjacent_core_technical_scope',
    'technical_adjacent_core_technical_scope',
  ]);
});

test('selectCoverageListCandidates broadly keeps technical-adjacent ICP personas', () => {
  const selected = selectCoverageListCandidates({
    candidates: [
      {
        fullName: 'Software Engineer',
        title: 'Senior Software Engineer',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'software_engineering',
        seniority: 'senior',
        score: 4,
      },
      {
        fullName: 'Executive Engineering',
        title: 'Engineering Executive',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'executive_engineering',
        seniority: 'unknown',
        score: 2,
      },
      {
        fullName: 'Architecture Owner',
        title: 'IT Architecture Lead',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'unknown',
        seniority: 'lead',
        score: 1,
      },
      {
        fullName: 'Engineering Leadership',
        title: 'Engineering Leadership',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'unknown',
        seniority: 'unknown',
        score: 0,
      },
      {
        fullName: 'Finance Leadership',
        title: 'Finance Leadership',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'unknown',
        seniority: 'unknown',
        score: 99,
      },
      {
        fullName: 'Security IC',
        title: 'Security Engineer',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'security',
        seniority: 'individual_contributor',
        score: 99,
      },
      {
        fullName: 'Corporate Security',
        title: 'Corporate Security Senior Event Resilience Manager',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'security',
        seniority: 'manager',
        score: 99,
      },
      {
        fullName: 'Commerce Cloud',
        title: 'Salesforce Commerce Cloud Developer',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'software_engineering',
        seniority: 'individual_contributor',
        score: 99,
      },
      {
        fullName: 'Supply Chain',
        title: 'Head of Supply Chain Projects',
        coverageBucket: 'direct_observability',
        roleFamily: 'platform_engineering',
        seniority: 'head',
        score: 99,
      },
      {
        fullName: 'Construction Architecture',
        title: 'Directeur Architecture & Construction',
        coverageBucket: 'direct_observability',
        roleFamily: 'platform_engineering',
        seniority: 'director',
        score: 99,
      },
      {
        fullName: 'Process Engineering',
        title: 'Senior Process Engineering Manager - CNC Machining',
        coverageBucket: 'direct_observability',
        roleFamily: 'platform_engineering',
        seniority: 'manager',
        score: 99,
      },
      {
        fullName: 'Brand Platform',
        title: 'Brand Platform Senior Project Manager',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'platform_engineering',
        seniority: 'manager',
        score: 99,
      },
      {
        fullName: 'Travel Retail',
        title: 'Commercial Integration and BD Director, Global Travel Retail',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'executive_engineering',
        seniority: 'director',
        score: 99,
      },
      {
        fullName: 'Workforce Ops',
        title: 'Director, Workforce Management and Process Improvement',
        coverageBucket: 'technical_adjacent',
        roleFamily: 'platform_engineering',
        seniority: 'director',
        score: 99,
      },
    ],
  }, { minScore: 50 });

  assert.deepEqual(selected.map((candidate) => candidate.fullName), [
    'Executive Engineering',
    'Software Engineer',
    'Architecture Owner',
    'Engineering Leadership',
  ]);
  assert.deepEqual(selected.map((candidate) => candidate.listSelectionReason), [
    'technical_adjacent_executive_engineering',
    'technical_adjacent_software_engineering',
    'technical_adjacent_core_technical_scope',
    'technical_adjacent_engineering_leadership',
  ]);
});

test('consolidateCoverageCandidates adds buyer operator user coverage warnings', () => {
  const coverageConfig = readJson(resolveProjectPath('config', 'account-coverage', 'default.json'));
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const result = consolidateCoverageCandidates([
    {
      templateId: 'sweep-devops',
      candidates: [
        {
          fullName: 'DevOps User',
          title: 'Cloud DevOps Engineer',
          company: 'Example Retail',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/user',
        },
      ],
    },
  ], {
    icpConfig,
    coverageConfig,
    priorityModel: null,
    accountName: 'Example Retail',
  });

  assert.equal(result.personaCoverage.buyer.count, 0);
  assert.equal(result.personaCoverage.operator.count, 0);
  assert.equal(result.personaCoverage.user.count, 1);
  assert.deepEqual(result.personaCoverage.warnings, ['buyer_coverage_gap', 'operator_coverage_gap']);
  assert.equal(result.candidates[0].personaTier, 'user');
});

test('consolidateCoverageCandidates recognizes multilingual EMEA buyer operator and user coverage', () => {
  const coverageConfig = readJson(resolveProjectPath('config', 'account-coverage', 'default.json'));
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const result = consolidateCoverageCandidates([
    {
      templateId: 'sweep-emea-data-ai-buyers',
      candidates: [
        {
          fullName: 'Buyer',
          title: 'Directrice Data Product',
          company: 'Example Retail',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/buyer',
        },
      ],
    },
    {
      templateId: 'sweep-emea-it-governance-operators',
      candidates: [
        {
          fullName: 'Operator',
          title: 'Responsable Domaine Direction Informatique et Production',
          company: 'Example Retail',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/operator',
        },
      ],
    },
    {
      templateId: 'sweep-emea-localized-observability',
      candidates: [
        {
          fullName: 'User',
          title: 'Consultant Cloud & DevSecOps',
          company: 'Example Retail',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/user',
        },
      ],
    },
  ], {
    icpConfig,
    coverageConfig,
    priorityModel: null,
    accountName: 'Example Retail',
  });

  assert.equal(result.personaCoverage.buyer.count, 1);
  assert.equal(result.personaCoverage.operator.count, 1);
  assert.equal(result.personaCoverage.user.count, 1);
  assert.deepEqual(result.personaCoverage.warnings, []);
  assert.deepEqual(
    result.candidates
      .map((candidate) => [candidate.fullName, candidate.personaTier])
      .sort((left, right) => left[0].localeCompare(right[0])),
    [
      ['Buyer', 'buyer'],
      ['Operator', 'operator'],
      ['User', 'user'],
    ],
  );
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

test('runAccountCoverageWorkflow keeps adaptiveSweepPruning off unless explicitly opted in', async () => {
  const coverageConfig = {
    version: 'adaptive-default-off',
    broadCrawl: { enabled: true, maxCandidates: 3 },
    sweeps: [
      { id: 'platform', keywords: ['platform engineering'], maxCandidates: 3 },
    ],
  };
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));

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
    accountName: 'Adaptive Default Off Account',
    coverageConfig,
    icpConfig,
    priorityModel: null,
    maxCandidates: 3,
    speedProfile: 'fast',
  });

  assert.equal(run.result.adaptivePruning.enabled, false);
  assert.equal(run.result.adaptivePruning.triggered, false);
});

test('adaptive pruning (fast): skips remaining low-yield rest sweep after broad + priority', async () => {
  const coverageConfig = {
    version: 'adaptive-prune-fast',
    broadCrawl: { enabled: true, maxCandidates: 3 },
    sweeps: [
      { id: 'platform', keywords: ['platform engineering'], maxCandidates: 3 },
      { id: 'security-noisy-rest', keywords: ['zzz-nonpriority-keyword'], maxCandidates: 3 },
    ],
  };
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const applyCalls = [];

  const driver = {
    async openAccountSearch() {},
    async enumerateAccounts(accounts) {
      return accounts;
    },
    async openPeopleSearch() {},
    async applySearchTemplate(template) {
      applyCalls.push(template.id);
    },
    async scrollAndCollectCandidates() {
      return [];
    },
  };

  const run = await runAccountCoverageWorkflow({
    driver,
    accountName: 'Adaptive Prune Fast Account',
    coverageConfig,
    icpConfig,
    priorityModel: null,
    maxCandidates: 3,
    speedProfile: 'fast',
    adaptiveSweepPruning: true,
  });

  assert.deepEqual(applyCalls, ['broad-crawl', 'sweep-platform']);
  assert.equal(run.result.adaptivePruning.enabled, true);
  assert.equal(run.result.adaptivePruning.triggered, true);
  assert.ok(run.result.adaptivePruning.reason.includes('low_yield'));
  assert.deepEqual(run.result.adaptivePruning.skippedTemplates, ['sweep-security-noisy-rest']);
  assert.deepEqual(run.result.adaptivePruning.executedTemplates, ['broad-crawl', 'sweep-platform']);
  assert.equal(run.result.sweepErrors?.length || 0, 0);
  assert.notEqual(run.result.resolutionStatus, 'needs_company_resolution');
});

test('adaptive pruning (exhaustive): runs every sweep and does not prune', async () => {
  const coverageConfig = {
    version: 'adaptive-prune-exhaustive',
    broadCrawl: { enabled: true, maxCandidates: 3 },
    sweeps: [
      { id: 'platform', keywords: ['platform'], maxCandidates: 3 },
      { id: 'data-rest', keywords: ['analytics_only_rest'], maxCandidates: 3 },
    ],
  };
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const applyCalls = [];

  const driver = {
    async openAccountSearch() {},
    async enumerateAccounts(accounts) {
      return accounts;
    },
    async openPeopleSearch() {},
    async applySearchTemplate(template) {
      applyCalls.push(template.id);
    },
    async scrollAndCollectCandidates() {
      return [];
    },
  };

  const run = await runAccountCoverageWorkflow({
    driver,
    accountName: 'Adaptive Prune Exhaustive Account',
    coverageConfig,
    icpConfig,
    priorityModel: null,
    maxCandidates: 3,
    speedProfile: 'exhaustive',
    adaptiveSweepPruning: true,
  });

  assert.deepEqual(applyCalls, ['broad-crawl', 'sweep-platform', 'sweep-data-rest']);
  assert.equal(run.result.adaptivePruning.enabled, false);
  assert.equal(run.result.adaptivePruning.triggered, false);
  assert.deepEqual(run.result.adaptivePruning.skippedTemplates || [], []);
});

test('adaptive pruning: skipped sweeps are not sweepErrors and do not force company-resolution summary', async () => {
  const coverageConfig = {
    version: 'adaptive-prune-clean',
    broadCrawl: { enabled: true, maxCandidates: 3 },
    sweeps: [
      { id: 'architecture', keywords: ['architecture'], maxCandidates: 3 },
      { id: 'noise-rest', keywords: ['zzz-rest-only'], maxCandidates: 3 },
    ],
  };
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));

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
    accountName: 'Adaptive Prune Clean Account',
    coverageConfig,
    icpConfig,
    priorityModel: null,
    maxCandidates: 3,
    speedProfile: 'fast',
    adaptiveSweepPruning: true,
  });

  assert.equal(run.sweepErrors.length, 0);
  assert.equal(run.result.sweepErrors?.length || 0, 0);
  assert.notEqual(run.result.resolutionStatus, 'needs_company_resolution');
});
