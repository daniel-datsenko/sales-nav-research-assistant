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
  writeMvpAutoresearchRun,
} = require('../src/core/autoresearch-mvp');
const { buildResearchLoopPlan } = require('../src/core/research-loop-planner');

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
