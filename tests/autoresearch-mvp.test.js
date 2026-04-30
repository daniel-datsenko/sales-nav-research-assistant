const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  SAFE_EVAL_COMMANDS,
  assertDrySafeCommands,
  buildRunnerCoverageTarget,
  buildRunnerCoverageByType,
  buildMvpAutoresearchArtifact,
  renderMvpAutoresearchMarkdown,
  renderMvpOperatorDashboard,
  renderMvpGateReport,
  writeMvpAutoresearchRun,
} = require('../src/core/autoresearch-mvp');
const { buildResearchLoopPlan } = require('../src/core/research-loop-planner');
const { buildResearchEvaluationMetrics } = require('../src/core/research-evaluation-metrics');
const { buildResearchExecutionGate } = require('../src/core/research-execution-gate');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeAcceptanceArtifact(filePath) {
  writeJson(filePath, {
    results: [
      {
        accountName: 'Example Connect Eligible Account',
        connectResults: [
          {
            fullName: 'Connect Eligible',
            status: 'already_sent',
            policyClass: 'connect_eligible',
            surfaceClassification: 'already_covered_pending',
            operatorDisposition: 'already_covered',
            nextAction: 'monitor',
          },
        ],
      },
      {
        accountName: 'Example Manual Review Account',
        connectResults: [
          {
            fullName: 'Guarded Shape',
            status: 'manual_review',
            policyClass: 'manual_review_required',
            surfaceClassification: 'overflow_only_connect',
            operatorDisposition: 'manual_review',
            nextAction: 'review_ui_variant',
          },
        ],
      },
    ],
  });
}

function makeBackgroundArtifact(filePath, payload) {
  writeJson(filePath, {
    processedAt: '2026-04-24T05:00:00.000Z',
    ...payload,
  });
}

test('SAFE_EVAL_COMMANDS are dry-safe and reject live mutation flags', () => {
  assert.doesNotThrow(() => assertDrySafeCommands(SAFE_EVAL_COMMANDS));
  assert.throws(
    () => assertDrySafeCommands(['node src/cli.js run-background-territory-loop --live-save']),
    /not dry-safe/,
  );
  assert.throws(
    () => assertDrySafeCommands(['node src/cli.js pilot-connect-batch --live-connect']),
    /not dry-safe/,
  );
});

test('buildMvpAutoresearchArtifact summarizes connect, runner, and next actions', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-autoresearch-'));
  const acceptancePath = path.join(tempDir, 'acceptance.json');
  const backgroundDir = path.join(tempDir, 'background');
  fs.mkdirSync(backgroundDir);
  makeAcceptanceArtifact(acceptancePath);
  makeBackgroundArtifact(path.join(backgroundDir, 'example-loop-1.json'), {
    status: 'environment_blocked',
    environment: {
      ok: false,
      state: 'browser_launch_blocked',
      nextAction: 'allow_browser_runtime_then_retry',
    },
    metrics: { accountsAttempted: 0 },
    results: [],
  });
  makeBackgroundArtifact(path.join(backgroundDir, 'example-loop-2.json'), {
    status: 'completed',
    environment: { ok: true, state: 'healthy', sessionCheckSkipped: false },
    metrics: { accountsAttempted: 1, productiveAccounts: 1 },
    results: [
      {
        accountName: 'SAP Deutschland SE',
        coverageStatus: 'live',
        candidateCount: 16,
        listCandidateCount: 7,
        productivity: { classification: 'productive' },
      },
      {
        accountName: 'Example Media Group Germany',
        coverageStatus: 'live',
        coverageError: 'all_sweeps_failed: Unable to scope people search',
        candidateCount: 0,
        listCandidateCount: 0,
        productivity: { classification: 'noisy' },
      },
    ],
  });
  makeBackgroundArtifact(path.join(backgroundDir, 'company-resolution-retry-loop-1.json'), {
    status: 'completed',
    environment: { ok: true, state: 'healthy', sessionCheckSkipped: false },
    metrics: { accountsAttempted: 1, productiveAccounts: 1 },
    results: [
      {
        accountName: 'Example Media Group Germany',
        coverageStatus: 'live',
        resolutionRetryStatus: 'recovered',
        resolutionRetryAttempt: 1,
        candidateCount: 31,
        listCandidateCount: 24,
        productivity: { classification: 'productive' },
      },
    ],
  });

  const artifact = buildMvpAutoresearchArtifact({
    now: new Date('2026-04-24T06:00:00.000Z'),
    acceptanceArtifactPath: acceptancePath,
    backgroundArtifactsDir: backgroundDir,
  });

  assert.equal(artifact.drySafe, true);
  assert.equal(artifact.decision, 'needs_followup');
  assert.equal(artifact.connect.total, 2);
  assert.equal(artifact.connect.nonFinal.length, 0);
  assert.equal(artifact.connect.guardedReferences.length, 1);
  assert.equal(artifact.connect.connectShapeMatrix.length, 2);
  assert.equal(artifact.connect.connectShapeMatrix[1].recommendation, 'keep_guarded_supervised');
  assert.equal(artifact.connect.connectShapeMatrix[0].evidence, acceptancePath);
  assert.equal(artifact.background.healthyLiveRuns, 2);
  assert.equal(artifact.background.accountLevelErrors.length, 1);
  assert.equal(artifact.background.runnerCoverageByType.productive.count, 2);
  assert.equal(artifact.background.runnerCoverageByType.noisy.count, 1);
  assert.equal(artifact.background.runnerCoverageByType.all_sweeps_failed.count, 1);
  assert.equal(artifact.background.runnerCoverageTarget.healthyLiveAccountsTarget, 10);
  assert.equal(artifact.background.runnerCoverageTarget.healthyLiveAccountsRemaining, 8);
  assert.equal(artifact.background.runnerCoverageTarget.coveredTypes.includes('productive'), true);
  assert.equal(artifact.companyResolutionRetries.attempted, 1);
  assert.equal(artifact.companyResolutionRetries.recovered, 1);
  assert.equal(artifact.operatorReadiness.connect, 'guarded_stable');
  assert.equal(artifact.operatorReadiness.runner, 'needs_more_evidence');
  assert.equal(artifact.nextActions.includes('continue_limit_1_or_2_background_dry_runs'), true);
  assert.equal(artifact.nextActions.includes('do_not_run_live_save_or_live_connect_from_autoresearch'), true);
});

test('buildRunnerCoverageByType counts productive, timed-out, all-sweeps, and environment buckets', () => {
  const coverage = buildRunnerCoverageByType({
    environmentBlocked: [
      {
        artifactPath: '/tmp/env.json',
        artifact: {
          environment: {
            state: 'browser_launch_blocked',
            nextAction: 'allow_browser_runtime_then_retry',
          },
        },
      },
    ],
    completed: [
      {
        artifactPath: '/tmp/completed.json',
        artifact: {
          results: [
            {
              accountName: 'Productive Co',
              coverageStatus: 'live',
              productivity: { classification: 'productive' },
              candidateCount: 12,
              listCandidateCount: 7,
            },
            {
              accountName: 'Timeout Co',
              coverageStatus: 'timed_out',
              productivity: { classification: 'noisy' },
              coverageError: 'background account coverage timed out',
            },
            {
              accountName: 'Filter Co',
              coverageStatus: 'live',
              productivity: { classification: 'noisy' },
              coverageError: 'all_sweeps_failed: unable to scope',
            },
          ],
        },
      },
    ],
  });

  assert.equal(coverage.productive.count, 1);
  assert.equal(coverage.noisy.count, 2);
  assert.equal(coverage.timed_out.count, 1);
  assert.equal(coverage.all_sweeps_failed.count, 1);
  assert.equal(coverage.environment_blocked.count, 1);
  assert.equal(coverage.environment_blocked.examples[0].nextAction, 'allow_browser_runtime_then_retry');

  const target = buildRunnerCoverageTarget({
    healthyLiveRuns: 4,
    runnerCoverageByType: coverage,
  });
  assert.equal(target.healthyLiveAccountsTarget, 10);
  assert.equal(target.healthyLiveAccountsObserved, 4);
  assert.equal(target.healthyLiveAccountsRemaining, 6);
  assert.equal(target.coveredTypes.includes('timed_out'), true);
});

test('buildMvpAutoresearchArtifact surfaces repeated noisy accounts as cooldown candidates', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-autoresearch-noisy-'));
  const acceptancePath = path.join(tempDir, 'acceptance.json');
  const backgroundDir = path.join(tempDir, 'background');
  fs.mkdirSync(backgroundDir);
  makeAcceptanceArtifact(acceptancePath);
  makeBackgroundArtifact(path.join(backgroundDir, 'example-loop-1.json'), {
    status: 'completed',
    environment: { ok: true, state: 'healthy', sessionCheckSkipped: false },
    metrics: { accountsAttempted: 1, noisyAccounts: 1 },
    results: [
      {
        accountName: 'Noisy Co',
        coverageStatus: 'live',
        candidateCount: 0,
        listCandidateCount: 0,
        productivity: { classification: 'noisy' },
      },
    ],
  });
  makeBackgroundArtifact(path.join(backgroundDir, 'example-loop-2.json'), {
    status: 'completed',
    environment: { ok: true, state: 'healthy', sessionCheckSkipped: false },
    metrics: { accountsAttempted: 1, noisyAccounts: 1 },
    results: [
      {
        accountName: 'Noisy Co',
        coverageStatus: 'live',
        coverageError: 'all_sweeps_failed: Unable to scope people search',
        candidateCount: 0,
        listCandidateCount: 0,
        productivity: { classification: 'noisy' },
      },
    ],
  });

  const artifact = buildMvpAutoresearchArtifact({
    now: new Date('2026-04-24T06:30:00.000Z'),
    acceptanceArtifactPath: acceptancePath,
    backgroundArtifactsDir: backgroundDir,
  });

  assert.equal(artifact.background.noisyCooldownCandidates.length, 1);
  assert.equal(artifact.background.noisyCooldownCandidates[0].accountName, 'Noisy Co');
  assert.equal(artifact.background.noisyCooldownCandidates[0].noisyRuns, 2);
  assert.equal(artifact.background.noisyCooldownCandidates[0].recommendedAction, 'cooldown_or_review_account_scope');
  assert.match(renderMvpOperatorDashboard(artifact), /Cooldown candidates: `1`/);
});

test('research evaluation metrics compute manual review, duplicate, alias disagreement, and noise rates', () => {
  const metrics = buildResearchEvaluationMetrics({
    fastResolveArtifacts: [{
      leads: [
        { fullName: 'Ada', salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ada', resolutionBucket: 'resolved_safe_to_save' },
        { fullName: 'Ada Duplicate', salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ada', resolutionBucket: 'resolved_safe_to_save' },
        { fullName: 'Manual', resolutionBucket: 'manual_review' },
        { fullName: 'Alias', resolutionBucket: 'needs_company_alias_retry' },
      ],
      bucketCounts: {
        resolved_safe_to_save: 2,
        manual_review: 1,
        needs_company_alias_retry: 1,
      },
    }],
    background: {
      runnerCoverageByType: {
        productive: { count: 2 },
        noisy: { count: 1 },
        sparse: { count: 1 },
        all_sweeps_failed: { count: 1 },
      },
    },
    companyResolution: {
      total: 5,
      needsManualReview: 1,
      failed: 1,
      multiTarget: 1,
    },
  });

  assert.equal(metrics.fastResolve.totalLeads, 4);
  assert.equal(metrics.fastResolve.manualReviewRate, 0.25);
  assert.equal(metrics.fastResolve.duplicateRate, 0.25);
  assert.equal(metrics.fastResolve.companyAliasRetryRate, 0.25);
  assert.equal(metrics.companyResolution.aliasDisagreementRate, 0.6);
  assert.equal(metrics.background.noiseRate, 0.5);
  assert.equal(metrics.overall.riskLevel, 'medium');
});

test('buildMvpAutoresearchArtifact includes evaluation metrics in JSON and Markdown', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-autoresearch-metrics-'));
  const acceptancePath = path.join(tempDir, 'acceptance.json');
  const backgroundDir = path.join(tempDir, 'background');
  const fastResolveDir = path.join(tempDir, 'account-batches');
  fs.mkdirSync(backgroundDir);
  fs.mkdirSync(fastResolveDir);
  writeJson(path.join(fastResolveDir, 'example-fast-resolve-2026.json'), {
    leads: [
      { fullName: 'Manual', resolutionBucket: 'manual_review' },
      { fullName: 'Safe', salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/safe', resolutionBucket: 'resolved_safe_to_save' },
    ],
  });
  makeAcceptanceArtifact(acceptancePath);
  makeBackgroundArtifact(path.join(backgroundDir, 'example-loop-1.json'), {
    status: 'completed',
    environment: { ok: true, state: 'healthy', sessionCheckSkipped: false },
    metrics: { accountsAttempted: 1, productiveAccounts: 1 },
    results: [
      {
        accountName: 'Noisy Co',
        coverageStatus: 'live',
        candidateCount: 2,
        listCandidateCount: 0,
        productivity: { classification: 'noisy' },
      },
    ],
  });

  const artifact = buildMvpAutoresearchArtifact({
    now: new Date('2026-04-24T06:00:00.000Z'),
    acceptanceArtifactPath: acceptancePath,
    backgroundArtifactsDir: backgroundDir,
    fastResolveArtifactsDir: fastResolveDir,
  });
  const markdown = renderMvpAutoresearchMarkdown(artifact);

  assert.equal(artifact.evaluationMetrics.drySafe, true);
  assert.equal(artifact.evaluationMetrics.fastResolve.manualReviewRate, 0.5);
  assert.equal(typeof artifact.evaluationMetrics.background.noiseRate, 'number');
  assert.match(markdown, /## Evaluation Metrics/);
  assert.match(markdown, /Risk level:/);
});

test('research execution gate blocks live save until company resolution blockers clear', () => {
  const gate = buildResearchExecutionGate({
    researchLoopPlan: {
      drySafe: true,
      steps: [
        { id: 'company-resolution-retry', gate: 'review_retry_artifact_before_fast_resolve' },
      ],
    },
    evaluationMetrics: {
      drySafe: true,
      overall: { riskLevel: 'low', indicators: [] },
    },
    mutationReview: {
      drySafe: true,
      summary: { intendedAdds: 3, alreadySavedSkips: 0, exclusions: 0, duplicateWarnings: 0 },
    },
  });

  assert.equal(gate.drySafe, true);
  assert.equal(gate.decision, 'blocked_until_company_resolution');
  assert.equal(gate.liveSaveEligible, false);
  assert.ok(gate.reasons.includes('company_resolution_retry_pending'));
});

test('research execution gate requires operator review for review warnings and only allows clean low-risk artifacts', () => {
  const needsReview = buildResearchExecutionGate({
    researchLoopPlan: { drySafe: true, steps: [{ id: 'autoresearch-refresh' }] },
    evaluationMetrics: {
      drySafe: true,
      overall: { riskLevel: 'medium', indicators: ['duplicate_sales_nav_urls'] },
    },
    mutationReview: {
      drySafe: true,
      summary: { intendedAdds: 2, alreadySavedSkips: 1, exclusions: 0, duplicateWarnings: 1 },
    },
  });
  const clean = buildResearchExecutionGate({
    researchLoopPlan: { drySafe: true, steps: [{ id: 'autoresearch-refresh' }] },
    evaluationMetrics: {
      drySafe: true,
      overall: { riskLevel: 'low', indicators: [] },
    },
    mutationReview: {
      drySafe: true,
      summary: { intendedAdds: 2, alreadySavedSkips: 0, exclusions: 0, duplicateWarnings: 0 },
    },
  });

  assert.equal(needsReview.decision, 'requires_operator_review');
  assert.equal(needsReview.liveSaveEligible, false);
  assert.equal(clean.decision, 'eligible_for_live_save');
  assert.equal(clean.liveSaveEligible, true);
  assert.doesNotMatch(clean.allowedCommandTemplate, /--live-connect|allow-background-connects/i);
});

test('research execution gate rejects implicit live mutation commands for non-live decisions', () => {
  assert.throws(
    () => buildResearchExecutionGate({
      researchLoopPlan: {
        drySafe: true,
        steps: [
          { id: 'unsafe-live-command', command: 'node src/cli.js pilot-live-save-batch --account-names=Example' },
        ],
      },
      evaluationMetrics: {
        drySafe: true,
        overall: { riskLevel: 'high', indicators: ['background_noise_rate'] },
      },
      mutationReview: null,
    }),
    /implicit live mutation command/i,
  );
});

test('buildMvpAutoresearchArtifact includes execution gate in JSON and Markdown', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-autoresearch-gate-'));
  const acceptancePath = path.join(tempDir, 'acceptance.json');
  const backgroundDir = path.join(tempDir, 'background');
  fs.mkdirSync(backgroundDir);
  makeAcceptanceArtifact(acceptancePath);

  const artifact = buildMvpAutoresearchArtifact({
    now: new Date('2026-04-24T06:00:00.000Z'),
    acceptanceArtifactPath: acceptancePath,
    backgroundArtifactsDir: backgroundDir,
    fastResolveArtifactsDir: tempDir,
  });
  const markdown = renderMvpAutoresearchMarkdown(artifact);

  assert.equal(artifact.executionGate.drySafe, true);
  assert.equal(artifact.executionGate.decision, 'allow_dry_run_only');
  assert.equal(artifact.executionGate.liveSaveEligible, false);
  assert.match(markdown, /## Execution Gate/);
  assert.match(markdown, /Decision:/);
});

test('renderMvpGateReport gives an operator-facing read-only gate summary', () => {
  const report = renderMvpGateReport({
    artifactPath: '/tmp/mvp-autoresearch.json',
    reportPath: '/tmp/mvp-autoresearch.md',
    generatedAt: '2026-04-24T06:00:00.000Z',
    executionGate: {
      drySafe: true,
      decision: 'blocked_until_company_resolution',
      liveSaveEligible: false,
      requiresOperatorApproval: false,
      riskLevel: 'medium',
      reasons: ['company_resolution_retry_pending', 'mutation_review_artifact_missing'],
      allowedCommandTemplate: 'node src/cli.js run-company-resolution-retries --limit=3 --driver=hybrid --max-candidates=25',
      checkpoints: ['do_not_run_live_save_until_gate_is_eligible'],
    },
    evaluationMetrics: {
      overall: { riskLevel: 'medium', indicators: ['company_resolution_failure_rate'] },
      fastResolve: { manualReviewRate: 0.25, duplicateRate: 0.1 },
      background: { noiseRate: 0.2 },
      companyResolution: { aliasDisagreementRate: 0.1 },
    },
    researchLoopPlan: {
      drySafe: true,
      steps: [
        {
          id: 'company-resolution-retry',
          type: 'cli_command',
          command: 'node src/cli.js run-company-resolution-retries --limit=3 --driver=hybrid --max-candidates=25',
          reason: 'retry failed scoped company resolution',
        },
        { id: 'operator-review', type: 'manual_gate', command: null, reason: 'review blockers' },
      ],
    },
  });

  assert.match(report, /# Autoresearch Execution Gate/);
  assert.match(report, /Decision: `blocked_until_company_resolution`/);
  assert.match(report, /Live save eligible: `no`/);
  assert.match(report, /Primary command: `node src\/cli\.js run-company-resolution-retries/);
  assert.match(report, /Operator stance: `dry_run_only`/);
  assert.match(report, /company_resolution_retry_pending/);
  assert.match(report, /## Why Blocked or Gated/);
  assert.match(report, /## Evidence/);
  assert.doesNotMatch(report, /--live-save/);
  assert.doesNotMatch(report, /--live-connect/);
});

test('renderMvpGateReport makes eligible live-save explicit but supervised', () => {
  const report = renderMvpGateReport({
    generatedAt: '2026-04-24T06:00:00.000Z',
    executionGate: {
      drySafe: true,
      decision: 'eligible_for_live_save',
      liveSaveEligible: true,
      requiresOperatorApproval: true,
      riskLevel: 'low',
      reasons: [],
      allowedCommandTemplate: 'node src/cli.js fast-list-import --source=<reviewed-source> --list-name=<reviewed-list> --live-save',
      checkpoints: ['operator_confirms_mutation_review_before_live_save'],
    },
    evaluationMetrics: {
      overall: { riskLevel: 'low', indicators: [] },
      fastResolve: { manualReviewRate: 0, duplicateRate: 0 },
      background: { noiseRate: 0 },
      companyResolution: { aliasDisagreementRate: 0 },
    },
    researchLoopPlan: { drySafe: true, steps: [] },
  });

  assert.match(report, /Decision: `eligible_for_live_save`/);
  assert.match(report, /Operator stance: `supervised_live_save_possible_after_human_approval`/);
  assert.match(report, /Primary command: `node src\/cli\.js fast-list-import --source=<reviewed-source> --list-name=<reviewed-list> --live-save`/);
  assert.match(report, /Required approval: `yes`/);
});

test('renderMvpGateReport suppresses unsafe commands in stale or malformed non-live artifacts', () => {
  const report = renderMvpGateReport({
    generatedAt: '2026-04-24T06:00:00.000Z',
    executionGate: {
      drySafe: true,
      decision: 'allow_dry_run_only',
      liveSaveEligible: false,
      requiresOperatorApproval: false,
      riskLevel: 'low',
      reasons: [],
      allowedCommandTemplate: 'node src/cli.js fast-list-import --source=/tmp/leads.md --live-save',
      checkpoints: [],
    },
    evaluationMetrics: { overall: { riskLevel: 'low', indicators: [] } },
    researchLoopPlan: {
      drySafe: true,
      steps: [
        {
          id: 'unsafe-connect',
          type: 'cli_command',
          command: 'node src/cli.js run-background-territory-loop --allow-background-connects --live-connect',
          reason: 'malformed stale artifact',
        },
      ],
    },
  });

  assert.match(report, /unsafe_command_suppressed/);
  assert.match(report, /unsafe command suppressed/);
  assert.doesNotMatch(report, /--live-save/);
  assert.doesNotMatch(report, /--live-connect/);
  assert.doesNotMatch(report, /allow-background-connects/);
});

test('research loop planner emits deterministic dry-safe CLI DAG from autoresearch evidence', () => {
  const artifact = {
    generatedAt: '2026-04-24T06:00:00.000Z',
    decision: 'needs_followup',
    nextActions: [
      'continue_limit_1_or_2_background_dry_runs',
      'resolve_company_targets_then_retry',
      'do_not_run_live_save_or_live_connect_from_autoresearch',
    ],
    background: {
      healthyLiveRuns: 4,
      latestEnvironmentBlock: null,
      runnerCoverageTarget: {
        healthyLiveAccountsRemaining: 6,
        notObservedTypes: ['mixed', 'sparse'],
      },
      accountLevelErrors: [
        {
          accountName: 'Filter Fail Co',
          coverageError: 'all_sweeps_failed: Unable to scope people search',
        },
      ],
      noisyCooldownCandidates: [
        { accountName: 'Noisy Co', recommendedAction: 'cooldown_or_review_account_scope' },
      ],
    },
    companyResolutionRetries: { latestAccounts: [] },
  };

  const plan = buildResearchLoopPlan(artifact, {
    generatedAt: '2026-04-24T06:01:00.000Z',
  });

  assert.equal(plan.version, 1);
  assert.equal(plan.drySafe, true);
  assert.equal(plan.steps.length, 3);
  assert.deepEqual(plan.steps.map((step) => step.id), [
    'company-resolution-retry',
    'background-dry-run',
    'operator-review',
  ]);
  assert.match(plan.steps[0].command, /run-company-resolution-retries/);
  assert.match(plan.steps[1].command, /run-background-territory-loop/);
  assert.equal(plan.steps[2].command, null);
  assert.doesNotMatch(plan.steps.map((step) => step.command || '').join(' '), /--live-save|--live-connect|allow-background-connects/i);
});

test('research loop planner ignores stale environment blocks after healthy evidence resumes', () => {
  const plan = buildResearchLoopPlan({
    generatedAt: '2026-04-24T06:00:00.000Z',
    decision: 'needs_followup',
    background: {
      healthyLiveRuns: 2,
      latestEnvironmentBlock: {
        environment: { nextAction: 'allow_browser_runtime_then_retry' },
      },
      runnerCoverageTarget: {
        healthyLiveAccountsRemaining: 8,
        notObservedTypes: ['mixed'],
      },
      accountLevelErrors: [],
      noisyCooldownCandidates: [],
    },
    companyResolutionRetries: { latestAccounts: [] },
  }, {
    generatedAt: '2026-04-24T06:01:00.000Z',
  });

  assert.equal(plan.steps.some((step) => step.id === 'environment-check'), false);
  assert.equal(plan.steps.some((step) => step.id === 'background-dry-run'), true);
});

test('research loop planner prioritizes environment check when latest block is newer than healthy evidence', () => {
  const plan = buildResearchLoopPlan({
    generatedAt: '2026-04-24T06:00:00.000Z',
    decision: 'needs_followup',
    background: {
      healthyLiveRuns: 2,
      latestHealthy: { processedAt: '2026-04-24T05:00:00.000Z' },
      latestEnvironmentBlock: {
        processedAt: '2026-04-24T06:00:00.000Z',
        environment: { nextAction: 'restart_browser_harness_then_retry' },
      },
      runnerCoverageTarget: {
        healthyLiveAccountsRemaining: 8,
        notObservedTypes: ['mixed'],
      },
      accountLevelErrors: [],
      noisyCooldownCandidates: [],
    },
    companyResolutionRetries: { latestAccounts: [] },
  }, {
    generatedAt: '2026-04-24T06:01:00.000Z',
  });

  assert.equal(plan.steps[0].id, 'environment-check');
  assert.equal(plan.steps.some((step) => step.id === 'background-dry-run'), false);
});

test('buildMvpAutoresearchArtifact includes a dry-safe research loop plan in JSON and Markdown', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-autoresearch-plan-'));
  const acceptancePath = path.join(tempDir, 'acceptance.json');
  const backgroundDir = path.join(tempDir, 'background');
  fs.mkdirSync(backgroundDir);
  makeAcceptanceArtifact(acceptancePath);
  makeBackgroundArtifact(path.join(backgroundDir, 'example-loop-1.json'), {
    status: 'completed',
    environment: { ok: true, state: 'healthy', sessionCheckSkipped: false },
    metrics: { accountsAttempted: 1, productiveAccounts: 1 },
    results: [
      {
        accountName: 'Filter Fail Co',
        coverageStatus: 'live',
        coverageError: 'all_sweeps_failed: Unable to scope people search',
        candidateCount: 0,
        listCandidateCount: 0,
        productivity: { classification: 'noisy' },
      },
    ],
  });

  const artifact = buildMvpAutoresearchArtifact({
    now: new Date('2026-04-24T06:00:00.000Z'),
    acceptanceArtifactPath: acceptancePath,
    backgroundArtifactsDir: backgroundDir,
  });
  const markdown = renderMvpAutoresearchMarkdown(artifact);

  assert.equal(artifact.researchLoopPlan.drySafe, true);
  assert.equal(artifact.researchLoopPlan.steps[0].id, 'company-resolution-retry');
  assert.match(markdown, /## Research Loop Plan/);
  assert.match(markdown, /company-resolution-retry/);
});


test('writeMvpAutoresearchRun writes JSON and Markdown reports', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mvp-autoresearch-write-'));
  const acceptancePath = path.join(tempDir, 'acceptance.json');
  const backgroundDir = path.join(tempDir, 'background');
  const artifactPath = path.join(tempDir, 'mvp-autoresearch.json');
  fs.mkdirSync(backgroundDir);
  makeAcceptanceArtifact(acceptancePath);
  makeBackgroundArtifact(path.join(backgroundDir, 'example-loop-1.json'), {
    status: 'completed',
    environment: { ok: true, state: 'healthy', sessionCheckSkipped: false },
    metrics: { accountsAttempted: 1, productiveAccounts: 1 },
    results: [
      {
        accountName: 'Productive Co',
        coverageStatus: 'live',
        candidateCount: 12,
        listCandidateCount: 7,
        productivity: { classification: 'productive' },
      },
    ],
  });

  const result = writeMvpAutoresearchRun({
    now: new Date('2026-04-24T06:00:00.000Z'),
    acceptanceArtifactPath: acceptancePath,
    backgroundArtifactsDir: backgroundDir,
    artifactPath,
  });
  const json = JSON.parse(fs.readFileSync(result.artifactPath, 'utf8'));
  const markdown = fs.readFileSync(result.reportPath, 'utf8');

  assert.equal(json.goal, 'supervised_mvp_release_candidate');
  assert.match(markdown, /# MVP Autoresearch Run/);
  assert.match(markdown, /Dry safe: `yes`/);
  assert.match(markdown, /Operator Readiness/);
  assert.match(markdown, /Recommendation/);
  assert.match(markdown, /Evidence/);
  assert.match(markdown, /Healthy live target: `1\/10`/);
  assert.match(markdown, /Background Runner/);
  assert.match(renderMvpAutoresearchMarkdown(json), /Safe Commands/);

  const dashboard = renderMvpOperatorDashboard(json);
  assert.match(dashboard, /# MVP Control Center/);
  assert.match(dashboard, /Healthy runner target: `1\/10`/);
  assert.match(dashboard, /Runner type gaps:/);
  assert.match(dashboard, /Primary action:/);
  assert.match(dashboard, /Allowed Modes/);
  assert.match(dashboard, /`email_required`: skip prospect/);
  assert.match(dashboard, /Operator Rules/);
});
