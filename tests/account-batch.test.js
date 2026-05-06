const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  applyGeoFocusToCandidates,
  assessCandidateGeoFocus,
  buildAccountBatchArtifactPath,
  buildAccountBatchReportPath,
  buildAccountBatchListName,
  deriveSdrCoverageStatus,
  deriveConnectOperatorGuidance,
  formatAccountBatchDuration,
  limitBatchCandidates,
  parseAccountNames,
  renderAccountBatchReportMarkdown,
  renderAccountBatchListNameTemplate,
  summarizeSdrResearchOutcome,
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
          {
            fullName: 'Philipp Weidinger',
            status: 'saved_and_verified',
            score: 64,
            coverageBucket: 'direct_observability',
            personaTier: 'operator',
            scoreBreakdown: { components: { roleScore: 18, seniorityScore: 16, observabilityScore: 24 } },
          },
          { fullName: 'Ralf Koppitz', status: 'failed', note: 'selector issue' },
          {
            fullName: 'Missing Save',
            title: 'Platform Lead',
            status: 'save_clicked_unverified',
            failureCategory: 'missing_after_save',
            verificationStatus: 'missing_after_save',
            nextAction: 'retry_or_manual_review_list_membership',
            note: 'save clicked but missing from list',
            score: 58,
            coverageBucket: 'direct_observability',
            personaTier: 'operator',
          },
        ],
        notSavedExamples: [
          {
            fullName: 'Dropped Candidate',
            title: 'IT Platform Specialist',
            coverageBucket: 'technical_adjacent',
            score: 24,
            reason: 'below_icp_selection_threshold',
            nextAction: 'review_if_persona_looks_relevant',
            scoreBreakdown: { components: { roleScore: 16, seniorityScore: 8 } },
          },
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
  assert.match(markdown, /SDR summary: found=`20` \| selected=`8` \| saved_verified=`1` \| save_unverified=`1` \| failed_save=`2` \| manual_review=`0` \| out_of_network=`0` \| failed_sweeps=`0` \| not_auto_saved=`12`/);
  assert.match(markdown, /Coverage status: `completed`/);
  assert.match(markdown, /Next action: `verify_list_membership, manual_review`/);
  assert.match(markdown, /Philipp Weidinger: `saved_and_verified` - score=64 \| bucket=direct_observability \| tier=operator \| score_breakdown=observabilityScore:24,roleScore:18,seniorityScore:16/);
  assert.match(markdown, /Ralf Koppitz: `failed` - selector issue/);
  assert.match(markdown, /### Save Discrepancies/);
  assert.match(markdown, /Missing Save: `save_clicked_unverified` - Platform Lead \| reason=missing_after_save \| verification=missing_after_save \| next=retry_or_manual_review_list_membership/);
  assert.match(markdown, /### Not Saved Examples/);
  assert.match(markdown, /Dropped Candidate: `technical_adjacent` - IT Platform Specialist \| reason=below_icp_selection_threshold \| next=review_if_persona_looks_relevant \| score=24/);
});

test('summarizeSdrResearchOutcome explains found vs saved gaps for SDRs', () => {
  const summary = summarizeSdrResearchOutcome({
    candidateCount: 30,
    listCandidateCount: 6,
    selectedForListSaveCount: 6,
    strongButNotAutoSavedCount: 4,
    attemptedSweepsCount: 20,
    failedSweepsCount: 8,
    saveResults: [
      { status: 'saved_and_verified' },
      { status: 'saved' },
      { status: 'failed' },
    ],
  });

  assert.deepEqual(summary, {
    found: 30,
    selectedForList: 6,
    selectedForLiveSave: 6,
    savedVerified: 1,
    saveClickedUnverified: 1,
    failedSave: 1,
    manualReview: 0,
    strongButNotAutoSaved: 4,
    outOfNetwork: 4,
    notAutoSaved: 24,
    relativeRankFallbackApplied: false,
    attemptedSweeps: 20,
    failedSweeps: 8,
    coverageStatus: 'needs_company_scope_review',
    nextActions: ['retry_company_scope', 'review_strong_not_saved', 'verify_list_membership', 'manual_review'],
  });
});

test('deriveSdrCoverageStatus separates clean runs from scope-review runs', () => {
  assert.equal(deriveSdrCoverageStatus({ attemptedSweepsCount: 20, failedSweepsCount: 0 }), 'completed');
  assert.equal(deriveSdrCoverageStatus({ attemptedSweepsCount: 20, failedSweepsCount: 2 }), 'completed_with_sweep_warnings');
  assert.equal(deriveSdrCoverageStatus({ attemptedSweepsCount: 20, failedSweepsCount: 8 }), 'needs_company_scope_review');
  assert.equal(deriveSdrCoverageStatus({ resolutionStatus: 'needs_company_resolution' }), 'needs_company_scope_review');
});

test('renderAccountBatchReportMarkdown shows strong report-only candidates and not-saved reasons', () => {
  const markdown = renderAccountBatchReportMarkdown({
    generatedAt: '2026-05-05T10:00:00Z',
    driver: 'playwright',
    liveSave: true,
    liveConnect: false,
    accountNames: ['Skello'],
    results: [
      {
        accountName: 'Skello',
        listName: 'SDR Research Skello',
        candidateCount: 30,
        listCandidateCount: 6,
        selectedForListSaveCount: 6,
        attemptedSweepsCount: 20,
        failedSweepsCount: 8,
        relativeRankFallbackApplied: true,
        companyScope: {
          warning: 'cross_company_contamination_detected',
          unrelatedCompanies: ['Deutsche Bank'],
        },
        strongButNotAutoSavedCount: 2,
        apiReadPrefetch: {
          companyResolution: {
            status: 'resolved_multi_target_api',
            selectedTargets: [
              { name: 'EDEKA IT', entityPriority: 'it_digital_first' },
              { name: 'EDEKA', entityPriority: 'parent_buyer_scope' },
            ],
          },
          leadCandidateCount: 30,
          uiSweepsSkipped: true,
        },
        saveResults: [],
        strongButNotAutoSavedCandidates: [
          {
            fullName: 'Nicolas di Giuseppe',
            title: 'Senior Engineering Manager - AI & Scheduling Squads',
            coverageBucket: 'direct_observability',
            score: 72,
            personaTier: 'operator',
            scoreBreakdown: { components: { roleScore: 18, seniorityScore: 12, observabilityScore: 24 } },
            reason: 'strong_but_not_auto_saved',
            nextAction: 'review_strong_not_saved',
          },
        ],
        manualReviewCandidates: [
          {
            fullName: 'Relative Rank Candidate',
            title: 'IT Platform Specialist',
            coverageBucket: 'broad_it_stakeholder',
            score: 24,
            reason: 'relative_rank_manual_review',
            nextAction: 'review_before_save',
            scoreBreakdown: { components: { roleScore: 16, seniorityScore: 8 } },
          },
        ],
        notSavedReasonCounts: {
          strong_but_not_auto_saved: 2,
          below_icp_selection_threshold: 22,
        },
      },
    ],
  });

  assert.match(markdown, /SDR summary: found=`30` \| selected=`6` .* out_of_network=`2` \| failed_sweeps=`8`/);
  assert.match(markdown, /Coverage status: `needs_company_scope_review`/);
  assert.match(markdown, /Entity priority: `EDEKA IT=it_digital_first, EDEKA=parent_buyer_scope`/);
  assert.match(markdown, /Company scope warning: `cross_company_contamination_detected` \(Deutsche Bank\)/);
  assert.match(markdown, /Manual review fallback: `top candidates shown because no candidate passed the normal save threshold`/);
  assert.match(markdown, /Sweeps: `12\/20 succeeded`/);
  assert.match(markdown, /Next action: `retry_company_scope, review_strong_not_saved, review_relative_rank_candidates`/);
  assert.match(markdown, /### Strong but not auto-saved/);
  assert.match(markdown, /Nicolas di Giuseppe: `direct_observability` - Senior Engineering Manager - AI & Scheduling Squads \| reason=strong_but_not_auto_saved \| next=review_strong_not_saved \| score=72 \| bucket=direct_observability \| tier=operator/);
  assert.match(markdown, /strong_but_not_auto_saved: `2`/);
  assert.match(markdown, /### Review Before Saving/);
  assert.match(markdown, /Relative Rank Candidate: `broad_it_stakeholder` - IT Platform Specialist \| reason=relative_rank_manual_review \| next=review_before_save \| score=24/);
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
