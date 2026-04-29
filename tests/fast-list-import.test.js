const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCompanyAliasTerms,
  buildFastResolveQueryPlan,
  bucketFastResolveLead,
  classifySaveFailure,
  deriveListNameFromSource,
  extractPublicLinkedInSlug,
  fastResolveLeads,
  buildFastResolveQueryTerms,
  isRetryableSaveError,
  inferFullNameFromLinkedInSlug,
  loadCoverageImportPlan,
  loadFailedFastListImportPlan,
  loadFastListImportSource,
  loadFastListImportSources,
  parseMarkdownLeadRows,
  renderFastListImportMarkdown,
  renderFastResolveMarkdown,
  resolveLeadsWithCoverage,
  resolveLeadIdentity,
  saveFastListImport,
  scoreFastResolveCandidate,
  normalizeSaveResult,
  appendCompanyAliasConfigEntry,
  writeLearnedLeadResolutionSuggestions,
} = require('../src/core/fast-list-import');

test('deriveListNameFromSource uses the source filename stem', () => {
  assert.equal(
    deriveListNameFromSource('/tmp/2026-04-06_calling_list_example-audio_example-network_mop.md'),
    '2026-04-06_calling_list_example-audio_example-network_mop',
  );
});

test('parseMarkdownLeadRows extracts lead rows and LinkedIn URLs', () => {
  const rows = parseMarkdownLeadRows(`
| # | Account | Name | Titel | Score | Tier | LinkedIn | Standort |
|---|---|---|---|---|---|---|---|
| 1 | Example Audio Co | Taylor Cloud | Head of Cloud | 80 | 1 | [linkedin.com/in/thorsten](https://linkedin.com/in/thorsten) | Wedemark |
| 1 | Example Audio Co | Taylor Cloud | Head of Cloud | 80 | 1 | [linkedin.com/in/thorsten](https://linkedin.com/in/thorsten) | Wedemark |
`);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].accountName, 'Example Audio Co');
  assert.equal(rows[0].fullName, 'Taylor Cloud');
  assert.equal(rows[0].publicLinkedInUrl, 'https://linkedin.com/in/thorsten');
});

test('parseMarkdownLeadRows classifies Sales Navigator lead URLs including query strings', () => {
  const rows = parseMarkdownLeadRows(`
| # | Name | LinkedIn |
|---|---|---|
| 1 | Lead One | [SN](https://www.linkedin.com/sales/lead/abc123?_ntb=1) |
`);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].salesNavigatorUrl, 'https://www.linkedin.com/sales/lead/abc123?_ntb=1');
});

test('resolveLeadsWithCoverage fills Sales Nav URLs by account and normalized name', () => {
  const coverageIndex = {
    byNameAndAccount: new Map([
      ['example network co::nora platform', {
        fullName: 'Nora Platform',
        accountName: 'Example Network Co',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/123',
        evidence: 'coverage:example-network.json',
      }],
    ]),
    byName: new Map(),
  };

  const leads = resolveLeadsWithCoverage([
    { accountName: 'Example Network Co', fullName: 'Nora Platform' },
  ], coverageIndex);

  assert.equal(leads[0].resolutionStatus, 'resolved');
  assert.equal(leads[0].salesNavigatorUrl, 'https://www.linkedin.com/sales/lead/123');
  assert.equal(leads[0].resolutionEvidence, 'coverage:example-network.json');
});

test('loadFastListImportSource reads coverage candidates and filters by bucket and score', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const sourcePath = path.join(os.tmpdir(), `coverage-import-${Date.now()}.json`);
  fs.writeFileSync(sourcePath, JSON.stringify({
    accountName: 'Example Marketplace A',
    candidates: [
      {
        fullName: 'Ada Platform',
        title: 'Head of Platform',
        company: 'Example Marketplace A',
        coverageBucket: 'direct_observability',
        score: 72,
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ada-platform',
      },
      {
        fullName: 'Ben Adjacent',
        title: 'Security Manager',
        company: 'Example Marketplace A',
        coverageBucket: 'technical_adjacent',
        score: 55,
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ben-adjacent',
      },
      {
        fullName: 'Cora Low',
        title: 'SRE',
        company: 'Example Marketplace A',
        coverageBucket: 'direct_observability',
        score: 30,
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/cora-low',
      },
    ],
  }));

  const plan = loadFastListImportSource(sourcePath, {
    listName: 'Coverage Import',
    bucket: 'direct_observability',
    minScore: 40,
  });

  assert.equal(plan.detectedRows, 1);
  assert.equal(plan.uniqueLeads, 1);
  assert.equal(plan.resolvedLeads, 1);
  assert.equal(plan.leads[0].fullName, 'Ada Platform');
  assert.equal(plan.leads[0].accountName, 'Example Marketplace A');
  assert.equal(plan.leads[0].resolutionStatus, 'resolved');
});

test('loadFastListImportSources merges comma-separated sources and dedupes by Sales Nav URL', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const first = path.join(os.tmpdir(), `coverage-import-a-${Date.now()}.json`);
  const second = path.join(os.tmpdir(), `coverage-import-b-${Date.now()}.json`);
  fs.writeFileSync(first, JSON.stringify({
    accountName: 'Example Marketplace A',
    candidates: [
      {
        fullName: 'Ada Platform',
        company: 'Example Marketplace A',
        coverageBucket: 'direct_observability',
        score: 70,
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ada-platform?x=1',
      },
    ],
  }));
  fs.writeFileSync(second, JSON.stringify({
    accountName: 'Example SaaS Marketplace',
    candidates: [
      {
        fullName: 'Ada Platform',
        company: 'Example SaaS Marketplace',
        coverageBucket: 'direct_observability',
        score: 70,
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ada-platform?x=2',
      },
      {
        fullName: 'Dora SRE',
        company: 'Example SaaS Marketplace',
        coverageBucket: 'direct_observability',
        score: 68,
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/dora-sre',
      },
    ],
  }));

  const plan = loadFastListImportSources(`${first},${second}`, {
    listName: 'Merged Coverage Import',
    bucket: 'direct_observability',
  });

  assert.equal(plan.sourcePaths.length, 2);
  assert.equal(plan.detectedRows, 2);
  assert.equal(plan.uniqueLeads, 2);
  assert.deepEqual(plan.leads.map((lead) => lead.fullName), ['Ada Platform', 'Dora SRE']);
});

test('loadCoverageImportPlan builds a list import plan from account coverage artifacts', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const coverageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-import-plan-'));
  fs.writeFileSync(path.join(coverageDir, 'example-marketplace-a.json'), JSON.stringify({
    accountName: 'Example Marketplace A',
    candidates: [
      {
        fullName: 'Vera Platform',
        company: 'Example Marketplace A',
        coverageBucket: 'direct_observability',
        score: 80,
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/vera-platform',
      },
    ],
  }));
  fs.writeFileSync(path.join(coverageDir, 'example-saas-marketplace.json'), JSON.stringify({
    accountName: 'Example SaaS Marketplace',
    candidates: [
      {
        fullName: 'David Cloud',
        company: 'Example SaaS Marketplace',
        coverageBucket: 'technical_adjacent',
        score: 50,
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/david-cloud',
      },
    ],
  }));

  const plan = loadCoverageImportPlan({
    accounts: 'example-marketplace-a,example-saas-marketplace',
    coverageDir,
    bucket: 'direct_observability',
    listName: 'DD_CEE_Sweep3_2026-04-28',
  });

  assert.equal(plan.listName, 'DD_CEE_Sweep3_2026-04-28');
  assert.equal(plan.sourceType, 'coverage_artifacts');
  assert.equal(plan.detectedRows, 1);
  assert.equal(plan.leads[0].fullName, 'Vera Platform');
});

test('loadFailedFastListImportPlan builds a retry-only plan from failed save rows', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const artifactPath = path.join(os.tmpdir(), `failed-fast-import-${Date.now()}.json`);
  fs.writeFileSync(artifactPath, JSON.stringify({
    listName: 'Retry Target List',
    results: [
      {
        accountName: 'Example Marketplace A',
        fullName: 'Saved Lead',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/saved',
        resolutionStatus: 'resolved',
        status: 'saved',
      },
      {
        accountName: 'Example Marketplace A',
        fullName: 'Rate Limited Lead',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/rate-limited',
        resolutionStatus: 'resolved',
        status: 'failed_rate_limit',
        failureCategory: 'rate_limit',
        note: 'Too many requests',
      },
      {
        accountName: 'Example SaaS Marketplace',
        fullName: 'Cooldown Lead',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/cooldown',
        resolutionStatus: 'resolved',
        status: 'skipped_rate_limit_cooldown',
      },
      {
        accountName: 'Example SaaS Marketplace',
        fullName: 'Manual Lead',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/manual',
        resolutionStatus: 'resolved',
        status: 'manual_review',
      },
    ],
  }));

  const plan = loadFailedFastListImportPlan(artifactPath);

  assert.equal(plan.listName, 'Retry Target List');
  assert.equal(plan.sourceType, 'retry_failed_fast_import');
  assert.equal(plan.detectedRows, 4);
  assert.equal(plan.uniqueLeads, 2);
  assert.deepEqual(plan.leads.map((lead) => lead.fullName), ['Rate Limited Lead', 'Cooldown Lead']);
  assert.deepEqual(plan.leads.map((lead) => lead.retrySourceStatus), ['failed_rate_limit', 'skipped_rate_limit_cooldown']);
  assert.equal(plan.leads[0].status, undefined);
  assert.equal(plan.leads[0].resolutionStatus, 'resolved');
});

test('saveFastListImport plans without live-save and never requires a driver', async () => {
  const result = await saveFastListImport({
    importPlan: {
      listName: 'Calling List',
      leads: [
        {
          accountName: 'Example Network Co',
          fullName: 'Nora Platform',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/123',
          resolutionStatus: 'resolved',
        },
      ],
    },
    liveSave: false,
  });

  assert.equal(result.liveSave, false);
  assert.equal(result.results[0].status, 'planned');
});

test('saveFastListImport retries lead-detail render failures once', async () => {
  let attempts = 0;
  const driver = {
    async saveCandidateToList() {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('Lead detail did not render for Nora Platform');
      }
      return { status: 'saved', selectionMode: 'existing_list' };
    },
  };

  const result = await saveFastListImport({
    driver,
    liveSave: true,
    maxRetries: 1,
    importPlan: {
      listName: 'Calling List',
      leads: [
        {
          accountName: 'Example Network Co',
          fullName: 'Nora Platform',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/123',
          resolutionStatus: 'resolved',
        },
      ],
    },
  });

  assert.equal(attempts, 2);
  assert.equal(result.status, 'completed');
  assert.equal(result.saved, 1);
  assert.equal(result.results[0].attempt, 2);
});

test('saveFastListImport leaves unresolved rows out of live mutation', async () => {
  let attempts = 0;
  const result = await saveFastListImport({
    driver: {
      async saveCandidateToList() {
        attempts += 1;
      },
    },
    liveSave: true,
    importPlan: {
      listName: 'Calling List',
      leads: [
        {
          accountName: 'Example Network Co',
          fullName: 'Unknown Person',
          resolutionStatus: 'unresolved',
        },
      ],
    },
  });

  assert.equal(attempts, 0);
  assert.equal(result.status, 'completed_with_followup');
  assert.equal(result.unresolved, 1);
});

test('saveFastListImport skips already-saved leads from a preflight snapshot', async () => {
  let attempts = 0;
  const result = await saveFastListImport({
    driver: {
      async saveCandidateToList() {
        attempts += 1;
        throw new Error('snapshot preflight should skip driver save');
      },
    },
    liveSave: true,
    existingLeadUrls: ['https://www.linkedin.com/sales/lead/123'],
    importPlan: {
      listName: 'Calling List',
      leads: [
        {
          accountName: 'Example Network Co',
          fullName: 'Nora Platform',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/123?trk=foo',
          resolutionStatus: 'resolved',
        },
      ],
    },
  });

  assert.equal(attempts, 0);
  assert.equal(result.status, 'completed');
  assert.equal(result.saved, 0);
  assert.equal(result.confirmedSaved, 0);
  assert.equal(result.alreadySaved, 1);
  assert.equal(result.snapshotSkipped, 1);
  assert.equal(result.results[0].status, 'already_saved');
  assert.equal(result.results[0].saveRecoveryPath, 'snapshot_preflight');
});

test('saveFastListImport stops after rate-limit failure instead of burning remaining saves', async () => {
  let attempts = 0;
  const progress = [];
  let waitedMs = 0;
  const result = await saveFastListImport({
    driver: {
      async saveCandidateToList() {
        attempts += 1;
        if (attempts === 1) {
          return { status: 'saved', selectionMode: 'existing_list' };
        }
        throw new Error('LinkedIn says Too many requests. Please wait before trying again.');
      },
    },
    liveSave: true,
    maxRetries: 0,
    rateLimitBackoffMs: 250,
    wait(ms) {
      waitedMs += ms;
    },
    onProgress(row) {
      progress.push(row.status);
    },
    importPlan: {
      listName: 'Calling List',
      leads: [
        {
          accountName: 'Example Network Co',
          fullName: 'Nora Platform',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/123',
          resolutionStatus: 'resolved',
        },
        {
          accountName: 'Example Network Co',
          fullName: 'Rate Limited Lead',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/456',
          resolutionStatus: 'resolved',
        },
        {
          accountName: 'Example Network Co',
          fullName: 'Skipped Lead',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/789',
          resolutionStatus: 'resolved',
        },
      ],
    },
  });

  assert.equal(attempts, 2);
  assert.equal(waitedMs, 250);
  assert.deepEqual(progress, ['saved', 'failed_rate_limit', 'skipped_rate_limit_cooldown']);
  assert.equal(result.status, 'completed_with_followup');
  assert.equal(result.failed, 1);
  assert.equal(result.rateLimitSkipped, 1);
  assert.equal(result.nextAction, 'wait_10_min_and_retry_failed');
  assert.equal(result.failureBreakdown.rate_limit, 1);
  assert.equal(result.failureBreakdown.rate_limit_cooldown, 1);
});

test('saveFastListImport aborts when the target list is missing and creation is disabled', async () => {
  let attempts = 0;
  await assert.rejects(
    saveFastListImport({
      driver: {
        async saveCandidateToList() {
          attempts += 1;
          throw new Error('List Calling List was not found. Creation is disabled in safe mode.');
        },
      },
      liveSave: true,
      allowListCreate: false,
      importPlan: {
        listName: 'Calling List',
        leads: [
          {
            accountName: 'Example Network Co',
            fullName: 'Nora Platform',
            salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/123',
            resolutionStatus: 'resolved',
          },
          {
            accountName: 'Example Network Co',
            fullName: 'Second Lead',
            salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/456',
            resolutionStatus: 'resolved',
          },
        ],
      },
    }),
    /Create the list in Sales Navigator first or rerun with --allow-list-create/,
  );

  assert.equal(attempts, 1);
});

test('renderFastListImportMarkdown shows operator-safe status and no connects', () => {
  const markdown = renderFastListImportMarkdown({
    generatedAt: '2026-04-24T12:00:00Z',
    listName: 'Calling List',
    status: 'completed',
    liveSave: true,
    resolvedLeads: 1,
    unresolvedLeads: 0,
    saved: 1,
    confirmedSaved: 1,
    alreadySaved: 0,
    snapshotSkipped: 0,
    failed: 0,
    results: [
      {
        accountName: 'Example Network Co',
        fullName: 'Nora Platform',
        status: 'saved',
        resolutionEvidence: 'coverage:example-network.json',
      },
    ],
  });

  assert.match(markdown, /Fast List Import Report/);
  assert.match(markdown, /Live connect: `no`/);
  assert.match(markdown, /Nora Platform/);
});

test('isRetryableSaveError recognizes transient lead rendering issues', () => {
  assert.equal(isRetryableSaveError('Lead detail did not render for Pedro'), true);
  assert.equal(isRetryableSaveError('Current company filter toggle not found'), true);
  assert.equal(isRetryableSaveError('List was not found'), false);
});

test('normalizeSaveResult maps results-row fallback into an explicit final status', () => {
  assert.deepEqual(normalizeSaveResult({
    status: 'saved',
    selectionMode: 'results_row_fallback',
  }), {
    status: 'results_row_fallback_saved',
    recoveryPath: 'results_row_fallback',
  });
});

test('classifySaveFailure keeps UI recovery exhaustion separate from runtime failures', () => {
  assert.equal(classifySaveFailure('Current company filter toggle not found').status, 'failed_ui_state');
  assert.equal(classifySaveFailure('Current company filter toggle not found').failureCategory, 'save_ui_state');
  assert.equal(classifySaveFailure('Too many requests, try again later').status, 'failed_rate_limit');
  assert.equal(classifySaveFailure('net::ERR_CONNECTION_RESET').status, 'failed_network');
  assert.equal(classifySaveFailure('Target closed while saving').status, 'failed_runtime');
});

test('renderFastListImportMarkdown shows failure breakdown and next action', () => {
  const markdown = renderFastListImportMarkdown({
    generatedAt: '2026-04-28T12:00:00Z',
    listName: 'Calling List',
    status: 'completed_with_followup',
    liveSave: true,
    resolvedLeads: 2,
    unresolvedLeads: 0,
    confirmedSaved: 1,
    alreadySaved: 0,
    snapshotSkipped: 0,
    rateLimitSkipped: 1,
    failed: 1,
    nextAction: 'wait_10_min_and_retry_failed',
    failureBreakdown: {
      rate_limit: 1,
      rate_limit_cooldown: 1,
    },
    results: [
      {
        accountName: 'Example Network Co',
        fullName: 'Nora Platform',
        status: 'failed_rate_limit',
        failureCategory: 'rate_limit',
        note: 'Too many requests',
        nextAction: 'wait_10_min_and_retry_failed',
      },
    ],
  });

  assert.match(markdown, /Rate-limit cooldown skips: `1`/);
  assert.match(markdown, /Next action: `wait_10_min_and_retry_failed`/);
  assert.match(markdown, /Failure breakdown: `rate_limit=1, rate_limit_cooldown=1`/);
});

test('extractPublicLinkedInSlug reads public profile slugs', () => {
  assert.equal(
    extractPublicLinkedInSlug('https://pl.linkedin.com/in/piotr-cyburski-b9214444?trk=public_profile'),
    'piotr-cyburski-b9214444',
  );
});

test('inferFullNameFromLinkedInSlug expands abbreviated names from public profile slugs', () => {
  assert.equal(
    inferFullNameFromLinkedInSlug('Alex V.', 'https://www.linkedin.com/in/halexvaldez'),
    'Alex Valdez',
  );
  assert.equal(
    inferFullNameFromLinkedInSlug('Alex V.', 'https://www.linkedin.com/in/alex-valdez'),
    'Alex Valdez',
  );
  assert.equal(inferFullNameFromLinkedInSlug('Alex Valdez', 'https://www.linkedin.com/in/halexvaldez'), null);
});

test('resolveLeadIdentity exposes search names, confidence, and evidence for truncated inputs', () => {
  const identity = resolveLeadIdentity({
    fullName: 'Alex V.',
    publicLinkedInUrl: 'https://www.linkedin.com/in/halexvaldez',
  });

  assert.deepEqual(identity.searchNames, ['Alex Valdez', 'Alex V.']);
  assert.equal(identity.primaryName, 'Alex Valdez');
  assert.equal(identity.needsManualReview, false);
  assert.ok(identity.evidence.includes('linkedin_slug_name_fallback'));
});

test('buildCompanyAliasTerms includes curated aliases and LinkedIn URL slugs', () => {
  const terms = buildCompanyAliasTerms('Rossmann Poland', {
    accounts: {
      'rossmann poland': {
        companyFilterAliases: ['Rossmann Polska'],
        linkedinCompanyUrls: ['https://www.linkedin.com/company/rossmann-polska'],
      },
    },
  });

  assert.deepEqual(terms, ['Rossmann Poland', 'Rossmann Polska']);
});

test('buildCompanyAliasTerms maps EXORG to the full Sales Navigator organization name', () => {
  const terms = buildCompanyAliasTerms('EXORG');

  assert.ok(terms.includes('Example Industry Association'));
});

test('buildFastResolveQueryTerms appends a guarded name-only fallback query', () => {
  const terms = buildFastResolveQueryTerms('EXORG', {
    accounts: {
      exorg: {
        companyFilterAliases: ['Example Industry Association'],
      },
    },
  });

  assert.equal(terms.at(-1), '');
  assert.ok(terms.includes('Example Industry Association'));
});

test('buildFastResolveQueryPlan runs company-target queries before one guarded name-only query', () => {
  const plan = buildFastResolveQueryPlan({
    lead: { accountName: 'EXORG', fullName: 'Terry Smith' },
    identityResolution: {
      sourceName: 'Terry Smith',
      primaryName: 'Terry Smith',
      searchNames: ['Terry Smith'],
    },
    companyResolution: {
      status: 'resolved_exact',
      targets: [{ linkedinName: 'Example Industry Association' }],
    },
    aliasConfig: {
      accounts: {
        exorg: { companyFilterAliases: ['Example Industry Association'] },
      },
    },
  });

  assert.equal(plan[0].query, 'Terry Smith Example Industry Association');
  assert.equal(plan.at(-1).query, 'Terry Smith');
  assert.equal(plan.at(-1).guardedNameOnly, true);
  assert.equal(plan.filter((entry) => entry.guardedNameOnly).length, 1);
});

test('scoreFastResolveCandidate uses exact name, slug, title, and company match', () => {
  const scored = scoreFastResolveCandidate({
    fullName: 'Owen Miller',
    title: 'DevOps Engineer',
    accountName: 'Rossmann Poland',
    publicLinkedInUrl: 'https://www.linkedin.com/in/owen-miller',
  }, {
    fullName: 'Owen Miller',
    title: 'DevOps Engineer',
    company: 'Rossmann Polska',
  }, ['Rossmann Poland', 'Rossmann Polska']);

  assert.equal(scored.exactName, true);
  assert.equal(scored.slugMatch, true);
  assert.equal(scored.companyMatch, true);
  assert.equal(scored.score >= 90, true);
});

test('bucketFastResolveLead emits resolved_safe_to_save only for safe matches', () => {
  const lead = {
    fullName: 'Owen Miller',
    accountName: 'Rossmann Poland',
    publicLinkedInUrl: 'https://www.linkedin.com/in/oskar-muller',
  };
  const bucketed = bucketFastResolveLead(lead, [{
    candidate: {
      fullName: 'Owen Miller',
      company: 'Rossmann Polska',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/123',
    },
    score: 100,
    exactName: true,
    slugMatch: true,
    companyMatch: true,
    titleMatch: false,
  }], ['Rossmann Poland', 'Rossmann Polska']);

  assert.equal(bucketed.resolutionBucket, 'resolved_safe_to_save');
  assert.equal(bucketed.resolutionStatus, 'resolved');
});

test('bucketFastResolveLead blocks manual-review identity from resolved_safe_to_save', () => {
  const bucketed = bucketFastResolveLead({
    fullName: 'T. Smith',
    accountName: 'Example Account',
    identityResolution: {
      needsManualReview: true,
      confidence: 0.35,
      evidence: ['truncated_name_without_slug'],
    },
  }, [{
    candidate: {
      fullName: 'T. Smith',
      company: 'Example Account',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/manual-identity',
    },
    score: 100,
    exactName: true,
    slugMatch: false,
    companyMatch: true,
    titleMatch: true,
    additionalSignals: 3,
  }], ['Example Account']);

  assert.notEqual(bucketed.resolutionBucket, 'resolved_safe_to_save');
  assert.equal(bucketed.resolutionStatus, 'unresolved');
  assert.equal(bucketed.salesNavigatorUrl, null);
  assert.equal(bucketed.resolutionEvidence, 'identity_manual_review');
});

test('bucketFastResolveLead sends same-name wrong-company matches to alias retry', () => {
  const bucketed = bucketFastResolveLead({
    fullName: 'Peter Cloud',
    accountName: 'RTV Euro AGD',
  }, [{
    candidate: {
      fullName: 'Peter Cloud',
      company: 'ALAB laboratoria',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/wrong',
    },
    score: 55,
    exactName: true,
    slugMatch: false,
    companyMatch: false,
    titleMatch: false,
  }], ['RTV Euro AGD']);

  assert.equal(bucketed.resolutionBucket, 'needs_company_alias_retry');
  assert.equal(bucketed.resolutionStatus, 'unresolved');
  assert.equal(bucketed.salesNavigatorUrl, null);
});

test('bucketFastResolveLead only allows name-only safe matches with multiple supporting signals', () => {
  const lead = {
    fullName: 'Terry Smith',
    accountName: 'EXORG',
    title: 'Observability Platform Owner',
    publicLinkedInUrl: 'https://www.linkedin.com/in/tobias-schmitz',
  };
  const weak = bucketFastResolveLead(lead, [{
    candidate: {
      fullName: 'Terry Smith',
      title: 'Unrelated Role',
      company: 'Unknown',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/tobias-weak',
    },
    score: 60,
    exactName: true,
    slugMatch: false,
    companyMatch: false,
    titleMatch: false,
    hasSalesNavigatorUrl: true,
    additionalSignals: 1,
    queryPlanEntry: { guardedNameOnly: true, queryType: 'guarded_name_only' },
  }], ['EXORG']);
  const strong = bucketFastResolveLead(lead, [{
    candidate: {
      fullName: 'Terry Smith',
      title: 'Observability Platform Owner',
      company: 'Example Industry Association',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/tobias-strong',
    },
    score: 85,
    exactName: true,
    slugMatch: true,
    companyMatch: false,
    titleMatch: true,
    hasSalesNavigatorUrl: true,
    additionalSignals: 3,
    queryPlanEntry: { guardedNameOnly: true, queryType: 'guarded_name_only' },
  }], ['EXORG']);

  assert.notEqual(weak.resolutionBucket, 'resolved_safe_to_save');
  assert.equal(strong.resolutionBucket, 'resolved_safe_to_save');
});

test('fastResolveLeads writes safe, alias-retry, and manual-review buckets', async () => {
  const calls = [];
  const driver = {
    async openPeopleSearch() {},
    async applySearchTemplate(template) {
      calls.push(template.keywords[0]);
    },
    async scrollAndCollectCandidates(account, template, context) {
      assert.equal(context.resultTimeoutMs, 4000);
      const query = template.keywords[0];
      if (/Owen Miller/.test(query)) {
        return [{
          fullName: 'Owen Miller',
          title: 'DevOps Engineer',
          company: 'Rossmann Polska',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/oskar',
        }];
      }
      if (/Peter Cloud/.test(query)) {
        return [{
          fullName: 'Peter Cloud',
          title: 'IT Director',
          company: 'ALAB laboratoria',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/piotr-wrong',
        }];
      }
      return [{
        fullName: 'Ambiguous Persona',
        title: 'Engineer',
        company: 'Ambiguous Subsidiary',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ambiguous',
      }];
    },
  };
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const sourcePath = path.join(os.tmpdir(), `fast-resolve-${Date.now()}.md`);
  fs.writeFileSync(sourcePath, `
| # | Account | Name | Titel | Score | Tier | LinkedIn |
|---|---|---|---|---|---|---|
| 1 | Rossmann Poland | Owen Miller | DevOps Engineer | 54 | Tier 2 | [linkedin.com/in/oskar-muller](https://www.linkedin.com/in/oskar-muller) |
| 2 | RTV Euro AGD | Peter Cloud | Director of IT Operations | 67 | Tier 1 | [linkedin.com/in/piotr-cyburski-b9214444](https://pl.linkedin.com/in/piotr-cyburski-b9214444) |
| 3 | Ambiguous Co | Ambiguous Person | Engineer | 50 | Tier 2 | [linkedin.com/in/ambiguous-person](https://www.linkedin.com/in/ambiguous-person) |
`);

  const artifact = await fastResolveLeads({
    driver,
    sourcePath,
    aliasConfig: {
      accounts: {
        'rossmann poland': { companyFilterAliases: ['Rossmann Polska'] },
        'ambiguous co': { companyFilterAliases: ['Ambiguous Co', 'Ambiguous Subsidiary'], resolutionStatus: 'resolved_exact' },
      },
    },
    searchTimeoutMs: 8000,
  });

  assert.equal(calls.length >= 3, true);
  assert.equal(artifact.bucketCounts.resolved_safe_to_save, 1);
  assert.equal(artifact.bucketCounts.needs_company_alias_retry, 1);
  assert.equal(artifact.bucketCounts.manual_review, 1);
  assert.match(renderFastResolveMarkdown(artifact), /resolved_safe_to_save/);
});

test('fastResolveLeads resolves multiple same-company leads from one grouped company pool search', async () => {
  const calls = [];
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const sourcePath = path.join(os.tmpdir(), `fast-resolve-grouped-${Date.now()}.md`);
  fs.writeFileSync(sourcePath, `
| # | Account | Name | Titel | Score | Tier | LinkedIn |
|---|---|---|---|---|---|---|
| 1 | Example Observability Co | Ada Platform | Platform Engineer | 70 | Tier 1 | [linkedin.com/in/ada-platform](https://www.linkedin.com/in/ada-platform) |
| 2 | Example Observability Co | Ben Cloud | Cloud Platform Lead | 68 | Tier 1 | [linkedin.com/in/ben-cloud](https://www.linkedin.com/in/ben-cloud) |
| 3 | Example Observability Co | Cora SRE | SRE Manager | 65 | Tier 2 | [linkedin.com/in/cora-sre](https://www.linkedin.com/in/cora-sre) |
`);
  const driver = {
    async openPeopleSearch() {},
    async applySearchTemplate(template) {
      calls.push(template.keywords[0]);
    },
    async scrollAndCollectCandidates(account, template) {
      if (template.id !== 'fast-resolve-company-pool') {
        return [];
      }
      return [
        {
          fullName: 'Ada Platform',
          title: 'Platform Engineer',
          company: 'Example Observability Co',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ada-platform',
        },
        {
          fullName: 'Ben Cloud',
          title: 'Cloud Platform Lead',
          company: 'Example Observability Co',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ben-cloud',
        },
        {
          fullName: 'Cora SRE',
          title: 'SRE Manager',
          company: 'Example Observability Co',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/cora-sre',
        },
      ];
    },
  };

  const artifact = await fastResolveLeads({
    driver,
    sourcePath,
    aliasConfig: {
      accounts: {
        'acme observability': { companyFilterAliases: ['Example Observability Co'] },
      },
    },
    searchTimeoutMs: 8000,
  });

  assert.deepEqual(calls, ['Example Observability Co']);
  assert.equal(artifact.bucketCounts.resolved_safe_to_save, 3);
  assert.equal(artifact.resolutionPathCounts.grouped_company_pool, 3);
  assert.equal(artifact.leads.every((lead) => lead.resolutionPath === 'grouped_company_pool'), true);
});

test('fastResolveLeads keeps grouped rows collision-safe when source row ids repeat', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const sourcePath = path.join(os.tmpdir(), `fast-resolve-collision-${Date.now()}.json`);
  fs.writeFileSync(sourcePath, JSON.stringify({
    listName: 'Collision Test',
    leads: [
      {
        row: 1,
        accountName: 'Example Observability Co',
        fullName: 'Alex Platform',
        title: 'Platform Engineer',
        publicLinkedInUrl: 'https://www.linkedin.com/in/alex-platform',
      },
      {
        row: 1,
        accountName: 'Example Observability Co',
        fullName: 'Riley SRE',
        title: 'SRE Manager',
        publicLinkedInUrl: 'https://www.linkedin.com/in/riley-sre',
      },
    ],
  }));
  const driver = {
    async openPeopleSearch() {},
    async applySearchTemplate() {},
    async scrollAndCollectCandidates(account, template) {
      if (template.id !== 'fast-resolve-company-pool') {
        return [];
      }
      return [
        {
          fullName: 'Alex Platform',
          title: 'Platform Engineer',
          company: 'Example Observability Co',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/alex-platform',
        },
        {
          fullName: 'Riley SRE',
          title: 'SRE Manager',
          company: 'Example Observability Co',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/riley-sre',
        },
      ];
    },
  };

  const artifact = await fastResolveLeads({
    driver,
    sourcePath,
    searchTimeoutMs: 8000,
  });

  assert.equal(artifact.bucketCounts.resolved_safe_to_save, 2);
  assert.equal(artifact.leads.filter((lead) => ['Alex Platform', 'Riley SRE'].includes(lead.fullName)).length, 2);
  assert.deepEqual(
    artifact.leads.map((lead) => lead.salesNavigatorUrl).sort(),
    [
      'https://www.linkedin.com/sales/lead/alex-platform',
      'https://www.linkedin.com/sales/lead/riley-sre',
    ],
  );
});

test('fastResolveLeads uses slug name fallback and guarded name-only company retry', async () => {
  const calls = [];
  const driver = {
    async openPeopleSearch() {},
    async applySearchTemplate(template) {
      calls.push(template.keywords[0]);
    },
    async scrollAndCollectCandidates(account, template) {
      const query = template.keywords[0];
      if (/Alex Valdez Example Semiconductor Co/i.test(query)) {
        return [{
          fullName: 'Alex Valdez',
          title: 'Platform Engineer',
          company: 'Example Semiconductor Co',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/alex-valdez',
        }];
      }
      if (query === 'Terry Smith') {
        return [{
          fullName: 'Terry Smith',
          title: 'Observability Platform Owner',
          company: 'Example Industry Association',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/tobias-schmitz',
        }];
      }
      return [];
    },
  };
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const sourcePath = path.join(os.tmpdir(), `fast-resolve-slug-fallback-${Date.now()}.md`);
  fs.writeFileSync(sourcePath, `
| # | Account | Name | Titel | Score | Tier | LinkedIn |
|---|---|---|---|---|---|---|
| 1 | Example Semiconductor Co | Alex V. | Platform Engineer | 60 | Tier 1 | [linkedin.com/in/halexvaldez](https://www.linkedin.com/in/halexvaldez) |
| 2 | EXORG | Terry Smith | Observability Platform Owner | 58 | Tier 2 | [linkedin.com/in/tobias-schmitz](https://www.linkedin.com/in/tobias-schmitz) |
`);

  const artifact = await fastResolveLeads({
    driver,
    sourcePath,
    aliasConfig: {
      accounts: {
        'example-semiconductor': { companyFilterAliases: ['Example Semiconductor Co'] },
        exorg: { companyFilterAliases: ['Example Industry Association'] },
      },
    },
    searchTimeoutMs: 8000,
  });

  assert.ok(calls.includes('Alex Valdez Example Semiconductor Co'));
  assert.ok(calls.includes('Terry Smith'));
  assert.equal(artifact.bucketCounts.resolved_safe_to_save, 2);
  assert.equal(artifact.leads[0].sourceFullName, 'Alex V.');
  assert.equal(artifact.leads[0].fullName, 'Alex Valdez');
  assert.equal(artifact.leads[0].nameResolutionEvidence, 'linkedin_slug_name_fallback');
});

test('fastResolveLeads researches missing company aliases once and retries unresolved leads', async () => {
  const calls = [];
  const aliasCalls = [];
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-resolve-alias-research-'));
  const aliasConfigPath = path.join(tempDir, 'account-aliases.json');
  fs.writeFileSync(aliasConfigPath, JSON.stringify({ version: '1.0.0', accounts: {} }, null, 2));
  const sourcePath = path.join(tempDir, 'calling-list.md');
  fs.writeFileSync(sourcePath, `
| # | Account | Name | Titel | Score | Tier | LinkedIn |
|---|---|---|---|---|---|---|
| 1 | EXORG | Terry Smith | Observability Platform Owner | 58 | Tier 2 | [linkedin.com/in/tobias-schmitz](https://www.linkedin.com/in/tobias-schmitz) |
| 2 | EXORG | Tina Platform | Platform Engineering Lead | 61 | Tier 1 | [linkedin.com/in/tina-plattform](https://www.linkedin.com/in/tina-plattform) |
| 3 | EXORG | Tim Kernel | Cloud Platform Owner | 63 | Tier 1 | [linkedin.com/in/timo-kern](https://www.linkedin.com/in/timo-kern) |
| 4 | EXORG | Thea Metrics | Infrastructure Lead | 59 | Tier 2 | [linkedin.com/in/thea-merten](https://www.linkedin.com/in/thea-merten) |
| 5 | EXORG | Tom Beacon | Observability Lead | 57 | Tier 2 | [linkedin.com/in/tom-becker](https://www.linkedin.com/in/tom-becker) |
`);
  const driver = {
    async openPeopleSearch() {},
    async applySearchTemplate(template) {
      calls.push(template.keywords[0]);
    },
    async scrollAndCollectCandidates(account, template) {
      const query = template.keywords[0];
      if (/Example Industry Association/i.test(query)) {
        const name = query.replace(/\s+Example Industry Association.*/i, '');
        return [{
          fullName: name,
          title: query.startsWith('Tobias') ? 'Observability Platform Owner' : 'Platform Engineering Lead',
          company: 'Example Industry Association',
          salesNavigatorUrl: `https://www.linkedin.com/sales/lead/${name.toLowerCase().replace(/\s+/g, '-')}`,
        }];
      }
      return [];
    },
    async resolveCompanyAlias(accountName) {
      aliasCalls.push(accountName);
      return {
        linkedinName: 'Example Industry Association',
        linkedinCompanyUrl: 'https://www.linkedin.com/company/berufsgenossenschaft-holz-und-metall',
        evidence: ['linkedin_company_search'],
      };
    },
  };

  const artifact = await fastResolveLeads({
    driver,
    sourcePath,
    aliasConfig: { accounts: {} },
    aliasConfigPath,
    searchTimeoutMs: 8000,
  });
  const writtenAlias = JSON.parse(fs.readFileSync(aliasConfigPath, 'utf8'));

  assert.equal(aliasCalls.length, 1);
  assert.deepEqual(aliasCalls, ['EXORG']);
  assert.ok(calls.includes('Terry Smith EXORG'));
  assert.ok(calls.includes('Terry Smith Example Industry Association'));
  assert.ok(calls.includes('Tina Platform Example Industry Association'));
  assert.equal(artifact.bucketCounts.resolved_via_alias_research, 5);
  assert.equal(artifact.bucketCounts.needs_company_alias_retry, 0);
  assert.equal(artifact.resolvedLeads, 5);
  assert.equal(artifact.leads[0].resolutionBucket, 'resolved_via_alias_research');
  assert.equal(artifact.leads[0].resolutionEvidence, 'linkedin_company_search_alias_research');
  assert.equal(writtenAlias.accounts.exorg.targets[0].linkedinName, 'Example Industry Association');
});

test('fastResolveLeads leaves alias retry unchanged when company alias research has no match', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fast-resolve-alias-miss-'));
  const aliasConfigPath = path.join(tempDir, 'account-aliases.json');
  fs.writeFileSync(aliasConfigPath, JSON.stringify({ version: '1.0.0', accounts: {} }, null, 2));
  const sourcePath = path.join(tempDir, 'calling-list.md');
  fs.writeFileSync(sourcePath, `
| # | Account | Name | Titel | Score | Tier | LinkedIn |
|---|---|---|---|---|---|---|
| 1 | UNKNOWNCO | Uma Unknown | Platform Owner | 58 | Tier 2 | [linkedin.com/in/uma-unknown](https://www.linkedin.com/in/uma-unknown) |
`);
  const driver = {
    async openPeopleSearch() {},
    async applySearchTemplate() {},
    async scrollAndCollectCandidates() {
      return [];
    },
    async resolveCompanyAlias() {
      return null;
    },
  };

  const artifact = await fastResolveLeads({
    driver,
    sourcePath,
    aliasConfig: { accounts: {} },
    aliasConfigPath,
    searchTimeoutMs: 8000,
  });
  const writtenAlias = JSON.parse(fs.readFileSync(aliasConfigPath, 'utf8'));

  assert.equal(artifact.bucketCounts.needs_company_alias_retry, 1);
  assert.equal(artifact.bucketCounts.resolved_via_alias_research, 0);
  assert.deepEqual(writtenAlias.accounts, {});
});

test('appendCompanyAliasConfigEntry merges aliases append-only without overwriting existing fields', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'append-company-alias-'));
  const aliasConfigPath = path.join(tempDir, 'account-aliases.json');
  fs.writeFileSync(aliasConfigPath, JSON.stringify({
    version: '1.0.0',
    accounts: {
      'example retail': {
        accountSearchAliases: ['Example Retail SE'],
        resolutionNotes: 'keep me',
        customField: 'preserve',
      },
    },
  }, null, 2));

  const updated = appendCompanyAliasConfigEntry({
    accountName: 'Example Retail',
    resolvedAlias: {
      linkedinName: 'Example Retail',
      linkedinCompanyUrl: 'https://www.linkedin.com/company/example-retail',
      evidence: ['linkedin_company_search'],
    },
    configPath: aliasConfigPath,
    now: new Date('2026-04-27T10:00:00.000Z'),
  });

  assert.equal(updated.accounts['example retail'].customField, 'preserve');
  assert.equal(updated.accounts['example retail'].resolutionNotes, 'keep me');
  assert.deepEqual(updated.accounts['example retail'].accountSearchAliases, ['Example Retail SE', 'Example Retail']);
  assert.deepEqual(updated.accounts['example retail'].companyFilterAliases, ['Example Retail']);
  assert.deepEqual(updated.accounts['example retail'].linkedinCompanyUrls, ['https://www.linkedin.com/company/example-retail']);
  assert.equal(updated.accounts['example retail'].targets[0].linkedinName, 'Example Retail');
  assert.equal(updated.accounts['example retail'].resolutionStatus, 'resolved_exact');
});

test('writeLearnedLeadResolutionSuggestions writes suggest-only runtime learning records', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const outputPath = path.join(os.tmpdir(), `learned-lead-suggestions-${Date.now()}.json`);

  const written = writeLearnedLeadResolutionSuggestions({
    learningSuggestions: [
      {
        type: 'identity_name_fallback',
        sourceName: 'Alex V.',
        suggestedName: 'Example Operator Villarreal',
        evidence: ['linkedin_slug'],
      },
    ],
  }, outputPath);

  const parsed = JSON.parse(fs.readFileSync(written, 'utf8'));
  assert.equal(parsed.suggestions.length, 1);
  assert.equal(parsed.suggestions[0].disposition, 'suggest_only');
});
