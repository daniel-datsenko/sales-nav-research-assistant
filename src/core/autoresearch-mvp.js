const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('../lib/json');
const {
  AUTORESEARCH_ARTIFACTS_DIR,
  BACKGROUND_RUNNER_ARTIFACTS_DIR,
  ACCOUNT_BATCH_ARTIFACTS_DIR,
  ensureDir,
  resolveProjectPath,
} = require('../lib/paths');
const { summarizeCompanyResolutionArtifacts } = require('./company-resolution');
const { summarizeCompanyResolutionRetryResults } = require('./company-resolution-retry');
const { readLatestConnectEvidenceArtifact } = require('./connect-evidence');

const FINAL_CONNECT_STATES = new Set([
  'sent',
  'already_sent',
  'already_connected',
  'email_required',
  'connect_unavailable',
  'manual_review',
  'skipped_by_policy',
]);

const GUARDED_REFERENCE_NAMES = new Set([
  'Example Guarded Lead',
  'Example Email Required Lead',
]);

const GUARDED_POLICY_CLASSES = new Set([
  'manual_review_required',
]);

const RUNNER_COVERAGE_TYPES = [
  'productive',
  'mixed',
  'sparse',
  'noisy',
  'all_sweeps_failed',
  'timed_out',
  'environment_blocked',
];

const HEALTHY_BACKGROUND_EVIDENCE_TARGET = 10;

const DEFAULT_ACCEPTANCE_ARTIFACT = path.join(
  ACCOUNT_BATCH_ARTIFACTS_DIR,
  'supervised-acceptance.json',
);

const SAFE_EVAL_COMMANDS = [
  'npm run print-mvp-morning-release-summary',
  'npm run print-latest-background-runner-report',
  'npm run test:release-readiness',
  'npm test',
];

function buildAutoresearchArtifactPath(now = new Date()) {
  ensureDir(AUTORESEARCH_ARTIFACTS_DIR, 0o700);
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(AUTORESEARCH_ARTIFACTS_DIR, `mvp-autoresearch-${timestamp}.json`);
}

function buildAutoresearchReportPath(jsonPath) {
  return String(jsonPath || buildAutoresearchArtifactPath()).replace(/\.json$/i, '.md');
}

function findLatestAutoresearchArtifact(artifactsDir = AUTORESEARCH_ARTIFACTS_DIR) {
  if (!fs.existsSync(artifactsDir)) {
    return null;
  }

  const artifacts = fs.readdirSync(artifactsDir)
    .filter((fileName) => /^mvp-autoresearch-.+\.json$/i.test(fileName))
    .map((fileName) => {
      const filePath = path.join(artifactsDir, fileName);
      const stat = fs.statSync(filePath);
      return {
        filePath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return artifacts[0]?.filePath || null;
}

function readLatestAutoresearchArtifact(artifactsDir = AUTORESEARCH_ARTIFACTS_DIR) {
  const artifactPath = findLatestAutoresearchArtifact(artifactsDir);
  if (!artifactPath) {
    return null;
  }

  return {
    artifactPath,
    artifact: readJson(artifactPath),
  };
}

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }
  return readJson(filePath);
}

function summarizeConnectShapes(acceptanceArtifact, evidencePath = DEFAULT_ACCEPTANCE_ARTIFACT) {
  const results = (acceptanceArtifact?.results || []).flatMap((account) => (
    account.connectResults || []
  ).map((result) => ({
    accountName: account.accountName,
    fullName: result.fullName,
    status: result.status,
    policyClass: result.policyClass || null,
    surfaceClassification: result.surfaceClassification || null,
    operatorDisposition: result.operatorDisposition || null,
    nextAction: result.nextAction || null,
    evidence: evidencePath,
  })));

  const nonFinal = results.filter((result) => !FINAL_CONNECT_STATES.has(result.status));
  const connectShapeMatrix = results.map((result) => {
    const guarded = GUARDED_POLICY_CLASSES.has(result.policyClass) || GUARDED_REFERENCE_NAMES.has(result.fullName);
    return {
      ...result,
      guarded,
      recommendation: guarded
        ? 'keep_guarded_supervised'
        : result.policyClass === 'connect_eligible'
          ? 'connect_eligible_supervised_only'
          : result.policyClass === 'lists_first_only'
            ? 'lists_first_only'
            : 'candidate_for_supervised_retest',
    };
  });
  const guarded = connectShapeMatrix.filter((result) => result.guarded);

  return {
    total: results.length,
    finalStates: results.length - nonFinal.length,
    nonFinal: nonFinal.map((result) => result.fullName),
    guardedReferences: guarded.map((result) => ({
      accountName: result.accountName,
      fullName: result.fullName,
      status: result.status,
      surfaceClassification: result.surfaceClassification,
      nextAction: result.nextAction,
      recommendation: result.recommendation,
    })),
    connectShapeMatrix,
    results,
  };
}

function listBackgroundLoopArtifacts(artifactsDir = BACKGROUND_RUNNER_ARTIFACTS_DIR) {
  if (!fs.existsSync(artifactsDir)) {
    return [];
  }

  return fs.readdirSync(artifactsDir)
    .filter((fileName) => /^.+-loop-.+\.json$/i.test(fileName))
    .map((fileName) => path.join(artifactsDir, fileName))
    .sort();
}

function summarizeBackgroundEvidence(artifactsDir = BACKGROUND_RUNNER_ARTIFACTS_DIR) {
  const artifacts = listBackgroundLoopArtifacts(artifactsDir)
    .map((artifactPath) => ({
      artifactPath,
      artifact: readJsonIfExists(artifactPath),
    }))
    .filter((entry) => entry.artifact);

  const completed = artifacts.filter((entry) => entry.artifact.status === 'completed');
  const environmentBlocked = artifacts.filter((entry) => entry.artifact.status === 'environment_blocked');
  const healthyLive = completed.filter((entry) => (
    entry.artifact.environment?.state === 'healthy'
    && entry.artifact.environment?.sessionCheckSkipped !== true
    && (entry.artifact.metrics?.accountsAttempted || 0) > 0
  ));
  const accountLevelErrors = completed.flatMap((entry) => (
    entry.artifact.results || []
  ).filter((result) => result.coverageError).map((result) => ({
    accountName: result.accountName,
    coverageStatus: result.coverageStatus,
    coverageError: result.coverageError,
  })));

  const latestHealthy = healthyLive.at(-1)?.artifact || null;
  const latestBlocked = environmentBlocked.at(-1)?.artifact || null;
  const runnerCoverageByType = buildRunnerCoverageByType({ completed, environmentBlocked });
  const noisyCooldownCandidates = buildNoisyCooldownCandidates(completed);
  const runnerCoverageTarget = buildRunnerCoverageTarget({
    healthyLiveRuns: healthyLive.length,
    runnerCoverageByType,
  });

  return {
    totalRuns: artifacts.length,
    completedRuns: completed.length,
    environmentBlockedRuns: environmentBlocked.length,
    healthyLiveRuns: healthyLive.length,
    latestHealthy: latestHealthy ? {
      artifactPath: healthyLive.at(-1).artifactPath,
      processedAt: latestHealthy.processedAt,
      metrics: latestHealthy.metrics,
      accounts: (latestHealthy.results || []).map((result) => ({
        accountName: result.accountName,
        coverageStatus: result.coverageStatus,
        productivity: result.productivity?.classification || 'unknown',
        candidateCount: result.candidateCount,
        listCandidateCount: result.listCandidateCount,
        coverageError: result.coverageError || null,
      })),
    } : null,
    latestEnvironmentBlock: latestBlocked ? {
      artifactPath: environmentBlocked.at(-1).artifactPath,
      processedAt: latestBlocked.processedAt,
      environment: latestBlocked.environment,
      metrics: latestBlocked.metrics,
    } : null,
    accountLevelErrors,
    noisyCooldownCandidates,
    runnerCoverageByType,
    runnerCoverageTarget,
  };
}

function buildNoisyCooldownCandidates(completed = []) {
  const byAccount = new Map();

  for (const entry of completed) {
    for (const result of entry.artifact.results || []) {
      const productivity = result.productivity?.classification || 'unknown';
      const isNoisy = productivity === 'noisy';
      const isSparse = productivity === 'sparse';
      if (!isNoisy && !isSparse) {
        continue;
      }

      const key = String(result.accountName || 'Unknown account').toLowerCase();
      const current = byAccount.get(key) || {
        accountName: result.accountName || 'Unknown account',
        noisyRuns: 0,
        sparseRuns: 0,
        coverageErrors: [],
        latestArtifactPath: entry.artifactPath,
        latestCoverageStatus: result.coverageStatus || null,
        latestProductivity: productivity,
      };
      if (isNoisy) {
        current.noisyRuns += 1;
      }
      if (isSparse) {
        current.sparseRuns += 1;
      }
      if (result.coverageError && !current.coverageErrors.includes(result.coverageError)) {
        current.coverageErrors.push(result.coverageError);
      }
      current.latestArtifactPath = entry.artifactPath;
      current.latestCoverageStatus = result.coverageStatus || null;
      current.latestProductivity = productivity;
      byAccount.set(key, current);
    }
  }

  return [...byAccount.values()]
    .filter((account) => account.noisyRuns >= 2 || (account.noisyRuns + account.sparseRuns) >= 3)
    .sort((left, right) => (
      (right.noisyRuns + right.sparseRuns) - (left.noisyRuns + left.sparseRuns)
      || right.noisyRuns - left.noisyRuns
      || String(left.accountName).localeCompare(String(right.accountName))
    ))
    .slice(0, 10)
    .map((account) => ({
      ...account,
      coverageErrors: account.coverageErrors.slice(0, 3),
      recommendedAction: 'cooldown_or_review_account_scope',
    }));
}

function buildRunnerCoverageTarget({ healthyLiveRuns = 0, runnerCoverageByType = {} } = {}) {
  const coveredTypes = RUNNER_COVERAGE_TYPES.filter((type) => (
    (runnerCoverageByType[type]?.count || 0) > 0
  ));
  const notObservedTypes = RUNNER_COVERAGE_TYPES.filter((type) => (
    (runnerCoverageByType[type]?.count || 0) <= 0
  ));

  return {
    healthyLiveAccountsTarget: HEALTHY_BACKGROUND_EVIDENCE_TARGET,
    healthyLiveAccountsObserved: healthyLiveRuns,
    healthyLiveAccountsRemaining: Math.max(0, HEALTHY_BACKGROUND_EVIDENCE_TARGET - healthyLiveRuns),
    coveredTypes,
    notObservedTypes,
  };
}

function buildRunnerCoverageByType({ completed = [], environmentBlocked = [] } = {}) {
  const coverage = Object.fromEntries(RUNNER_COVERAGE_TYPES.map((type) => [type, {
    count: 0,
    examples: [],
  }]));

  for (const entry of environmentBlocked) {
    coverage.environment_blocked.count += 1;
    if (coverage.environment_blocked.examples.length < 3) {
      coverage.environment_blocked.examples.push({
        artifactPath: entry.artifactPath,
        environment: entry.artifact.environment?.state || 'unknown',
        nextAction: entry.artifact.environment?.nextAction || null,
      });
    }
  }

  for (const entry of completed) {
    for (const result of entry.artifact.results || []) {
      const productivityType = result.productivity?.classification || 'noisy';
      recordRunnerCoverageExample(coverage, productivityType, entry.artifactPath, result);
      if (result.coverageStatus === 'timed_out') {
        recordRunnerCoverageExample(coverage, 'timed_out', entry.artifactPath, result);
      }
      if (/all_sweeps_failed/i.test(result.coverageError || '')) {
        recordRunnerCoverageExample(coverage, 'all_sweeps_failed', entry.artifactPath, result);
      }
    }
  }

  return coverage;
}

function recordRunnerCoverageExample(coverage, type, artifactPath, result) {
  if (!coverage[type]) {
    return;
  }
  coverage[type].count += 1;
  if (coverage[type].examples.length >= 3) {
    return;
  }
  coverage[type].examples.push({
    accountName: result.accountName || 'Unknown account',
    artifactPath,
    coverageStatus: result.coverageStatus || null,
    productivity: result.productivity?.classification || 'unknown',
    candidateCount: result.candidateCount || 0,
    listCandidateCount: result.listCandidateCount || 0,
    coverageError: result.coverageError || null,
  });
}

function assertDrySafeCommands(commands) {
  const unsafe = commands.filter((command) => /--live-save|--live-connect|allow-background-connects/i.test(command));
  if (unsafe.length > 0) {
    throw new Error(`Autoresearch command set is not dry-safe: ${unsafe.join(', ')}`);
  }
}

function decideAutoresearchOutcome({ connect, background }) {
  if (connect.nonFinal.length > 0) {
    return {
      decision: 'needs_followup',
      reason: 'connect_acceptance_has_non_final_statuses',
    };
  }

  if (background.healthyLiveRuns <= 0 && background.environmentBlockedRuns > 0) {
    return {
      decision: 'blocked',
      reason: 'browser_runtime_or_session_blocked',
    };
  }

  if (background.healthyLiveRuns < HEALTHY_BACKGROUND_EVIDENCE_TARGET) {
    return {
      decision: 'needs_followup',
      reason: 'needs_more_healthy_background_runner_evidence',
    };
  }

  return {
    decision: 'keep',
    reason: 'dry_safe_evidence_meets_current_mvp_fitness',
  };
}

function buildMvpAutoresearchArtifact({
  now = new Date(),
  acceptanceArtifactPath = DEFAULT_ACCEPTANCE_ARTIFACT,
  backgroundArtifactsDir = BACKGROUND_RUNNER_ARTIFACTS_DIR,
} = {}) {
  assertDrySafeCommands(SAFE_EVAL_COMMANDS);
  const acceptanceArtifact = readJsonIfExists(acceptanceArtifactPath);
  const connect = summarizeConnectShapes(acceptanceArtifact, acceptanceArtifactPath);
  const background = summarizeBackgroundEvidence(backgroundArtifactsDir);
  const companyResolution = summarizeCompanyResolutionArtifacts();
  const companyResolutionRetries = summarizeCompanyResolutionRetryResults(backgroundArtifactsDir);
  const connectEvidence = readLatestConnectEvidenceArtifact()?.artifact || null;
  const unresolvedAllSweepsFailures = getUnresolvedAllSweepsFailures({ background, companyResolutionRetries });
  const outcome = decideAutoresearchOutcome({ connect, background });

  return {
    goal: 'supervised_mvp_release_candidate',
    generatedAt: now.toISOString(),
    hypothesis: 'Small dry-safe measurement loops harden release readiness without widening live LinkedIn mutation scope.',
    decision: outcome.decision,
    reason: outcome.reason,
    drySafe: true,
    prohibitedMutationFlags: ['--live-save', '--live-connect', '--allow-background-connects'],
    commands: SAFE_EVAL_COMMANDS,
    operatorReadiness: buildOperatorReadiness({ connect, background, outcome }),
    fitness: {
      connectFinalStates: connect.total > 0 && connect.nonFinal.length === 0,
      healthyBackgroundEvidence: background.healthyLiveRuns,
      environmentBlocksSeparated: background.environmentBlockedRuns > 0,
      accountLevelErrorsVisible: background.accountLevelErrors.length > 0,
      operatorReportsReadable: true,
    },
    connect,
    connectEvidence,
    background,
    companyResolution: {
      ...companyResolution,
      nextActions: [
        ...companyResolution.nextActions,
        ...(unresolvedAllSweepsFailures.length > 0 ? ['resolve_company_targets_then_retry'] : []),
      ].filter((value, index, all) => all.indexOf(value) === index),
    },
    companyResolutionRetries,
    nextActions: buildAutoresearchNextActions({
      connect,
      background,
      outcome,
      companyResolutionRetries,
    }),
  };
}

function buildAutoresearchNextActions({
  connect,
  background,
  outcome,
  companyResolutionRetries = null,
}) {
  const actions = [];
  if (outcome.decision === 'blocked' && background.latestEnvironmentBlock?.environment?.nextAction) {
    actions.push(background.latestEnvironmentBlock.environment.nextAction);
  }
  if (background.healthyLiveRuns < HEALTHY_BACKGROUND_EVIDENCE_TARGET) {
    actions.push('continue_limit_1_or_2_background_dry_runs');
  }
  const unresolvedAllSweepsFailures = getUnresolvedAllSweepsFailures({ background, companyResolutionRetries });
  if (unresolvedAllSweepsFailures.length > 0) {
    actions.push('review_account_filter_aliases_for_all_sweeps_failed');
  }
  if ((background.runnerCoverageByType?.noisy?.count || 0) >= 3) {
    actions.push('cooldown_repeated_noisy_accounts');
  }
  if (unresolvedAllSweepsFailures.length > 0) {
    actions.push('resolve_company_targets_then_retry');
  }
  if (connect.guardedReferences.length > 0) {
    actions.push('keep_guarded_connect_shapes_supervised');
  }
  actions.push('do_not_run_live_save_or_live_connect_from_autoresearch');
  return [...new Set(actions)];
}

function buildOperatorReadiness({ connect, background, outcome }) {
  return {
    releaseCandidate: outcome.decision === 'keep' ? 'yes' : 'needs_followup',
    connect: connect.nonFinal.length === 0
      ? (connect.guardedReferences.length > 0 ? 'guarded_stable' : 'stable')
      : 'needs_review',
    runner: background.healthyLiveRuns >= HEALTHY_BACKGROUND_EVIDENCE_TARGET
      ? 'healthy'
      : background.healthyLiveRuns > 0
        ? 'needs_more_evidence'
        : 'blocked',
    liveMutations: 'disabled_supervised_only',
  };
}

function renderMvpAutoresearchMarkdown(artifact) {
  const lines = [];
  lines.push('# MVP Autoresearch Run');
  lines.push('');
  lines.push(`- Generated at: \`${artifact.generatedAt}\``);
  lines.push(`- Goal: \`${artifact.goal}\``);
  lines.push(`- Decision: \`${artifact.decision}\``);
  lines.push(`- Reason: \`${artifact.reason}\``);
  lines.push(`- Dry safe: \`${artifact.drySafe ? 'yes' : 'no'}\``);
  lines.push('');
  lines.push('## Operator Readiness');
  lines.push(`- Release candidate: \`${artifact.operatorReadiness.releaseCandidate}\``);
  lines.push(`- Connect: \`${artifact.operatorReadiness.connect}\``);
  lines.push(`- Runner: \`${artifact.operatorReadiness.runner}\``);
  lines.push(`- Live mutations: \`${artifact.operatorReadiness.liveMutations}\``);
  lines.push('');
  lines.push('## Fitness');
  lines.push(`- Connect final states: \`${artifact.fitness.connectFinalStates ? 'pass' : 'fail'}\``);
  lines.push(`- Healthy background evidence: \`${artifact.fitness.healthyBackgroundEvidence}\``);
  lines.push(`- Environment blocks separated: \`${artifact.fitness.environmentBlocksSeparated ? 'yes' : 'no'}\``);
  lines.push(`- Account-level errors visible: \`${artifact.fitness.accountLevelErrorsVisible ? 'yes' : 'no'}\``);
  lines.push('');
  lines.push('## Connect Shapes');
  lines.push(`- Results: \`${artifact.connect.total}\``);
  lines.push(`- Final states: \`${artifact.connect.finalStates}\``);
  lines.push(`- Non-final: \`${artifact.connect.nonFinal.length}\``);
  lines.push(`- Guarded references: \`${artifact.connect.guardedReferences.length}\``);
  if (artifact.connect.connectShapeMatrix?.length) {
    lines.push('');
    lines.push('| Account | Lead | Status | Policy | Surface | Operator | Next | Recommendation | Evidence |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of artifact.connect.connectShapeMatrix) {
      lines.push(`| ${escapeMarkdownCell(row.accountName)} | ${escapeMarkdownCell(row.fullName)} | ${escapeMarkdownCell(row.status)} | ${escapeMarkdownCell(row.policyClass || 'none')} | ${escapeMarkdownCell(row.surfaceClassification || 'unknown')} | ${escapeMarkdownCell(row.operatorDisposition || 'unknown')} | ${escapeMarkdownCell(row.nextAction || 'unknown')} | ${escapeMarkdownCell(row.recommendation)} | ${escapeMarkdownCell(row.evidence || 'none')} |`);
    }
  }
  lines.push('');
  lines.push('## Background Runner');
  lines.push(`- Total runs: \`${artifact.background.totalRuns}\``);
  lines.push(`- Completed runs: \`${artifact.background.completedRuns}\``);
  lines.push(`- Environment blocked runs: \`${artifact.background.environmentBlockedRuns}\``);
  lines.push(`- Healthy live runs: \`${artifact.background.healthyLiveRuns}\``);
  if (artifact.background.runnerCoverageTarget) {
    lines.push(`- Healthy live target: \`${artifact.background.runnerCoverageTarget.healthyLiveAccountsObserved}/${artifact.background.runnerCoverageTarget.healthyLiveAccountsTarget}\``);
    lines.push(`- Runner types not observed yet: \`${artifact.background.runnerCoverageTarget.notObservedTypes.join(', ') || 'none'}\``);
  }
  if (artifact.background.latestHealthy?.accounts?.length) {
    const account = artifact.background.latestHealthy.accounts[0];
    lines.push(`- Latest healthy account: \`${account.accountName}\` / \`${account.productivity}\``);
  }
  lines.push(`- Account-level errors: \`${artifact.background.accountLevelErrors.length}\``);
  lines.push(`- Noisy cooldown candidates: \`${artifact.background.noisyCooldownCandidates?.length || 0}\``);
  if (artifact.background.runnerCoverageByType) {
    lines.push('');
    lines.push('| Type | Count | Example |');
    lines.push('| --- | ---: | --- |');
    for (const type of RUNNER_COVERAGE_TYPES) {
      const bucket = artifact.background.runnerCoverageByType[type] || { count: 0, examples: [] };
      const example = bucket.examples[0]?.accountName || bucket.examples[0]?.environment || 'none';
      lines.push(`| ${type} | ${bucket.count} | ${escapeMarkdownCell(example)} |`);
    }
  }
  lines.push('');
  lines.push('## Company Resolution');
  lines.push(`- Total artifacts: \`${artifact.companyResolution?.total || 0}\``);
  lines.push(`- Resolved exact: \`${artifact.companyResolution?.resolvedExact || 0}\``);
  lines.push(`- Multi target: \`${artifact.companyResolution?.multiTarget || 0}\``);
  lines.push(`- Needs manual review: \`${artifact.companyResolution?.needsManualReview || 0}\``);
  lines.push(`- Failed: \`${artifact.companyResolution?.failed || 0}\``);
  lines.push(`- Next actions: \`${(artifact.companyResolution?.nextActions || []).join(', ') || 'none'}\``);
  lines.push('');
  lines.push('## Company Resolution Retries');
  lines.push(`- Attempted: \`${artifact.companyResolutionRetries?.attempted || 0}\``);
  lines.push(`- Recovered: \`${artifact.companyResolutionRetries?.recovered || 0}\``);
  lines.push(`- Manual review: \`${artifact.companyResolutionRetries?.manualReview || 0}\``);
  lines.push(`- Failed: \`${artifact.companyResolutionRetries?.failed || 0}\``);
  if (artifact.companyResolutionRetries?.latestArtifactPath) {
    lines.push(`- Latest artifact: \`${artifact.companyResolutionRetries.latestArtifactPath}\``);
  }
  for (const account of artifact.companyResolutionRetries?.latestAccounts || []) {
    lines.push(`- ${account.accountName}: retry=\`${account.resolutionRetryStatus}\` | candidates=\`${account.afterCandidateCount}\` | listCandidates=\`${account.afterListCandidateCount}\``);
  }
  lines.push('');
  lines.push('## Safe Commands');
  for (const command of artifact.commands) {
    lines.push(`- \`${command}\``);
  }
  lines.push('');
  lines.push('## Next Actions');
  for (const action of artifact.nextActions) {
    lines.push(`- \`${action}\``);
  }
  lines.push('');
  return `${lines.join('\n').trim()}\n`;
}

function escapeMarkdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function renderMvpOperatorDashboard(artifact) {
  const lines = [];
  lines.push('# MVP Control Center');
  lines.push('');
  if (!artifact) {
    lines.push('- Release candidate: `unknown`');
    lines.push('- Next: `run npm run autoresearch:mvp`');
    return `${lines.join('\n').trim()}\n`;
  }

  lines.push(`- Autoresearch decision: \`${artifact.decision}\``);
  lines.push(`- Release candidate: \`${artifact.operatorReadiness?.releaseCandidate || 'unknown'}\``);
  lines.push(`- Connect: \`${artifact.operatorReadiness?.connect || 'unknown'}\``);
  lines.push(`- Runner: \`${artifact.operatorReadiness?.runner || 'unknown'}\``);
  lines.push(`- Live mutations: \`${artifact.operatorReadiness?.liveMutations || 'disabled_supervised_only'}\``);
  lines.push(`- Healthy live dry-runs: \`${artifact.background?.healthyLiveRuns || 0}\``);
  lines.push(`- Company resolution retries recovered: \`${artifact.companyResolutionRetries?.recovered || 0}/${artifact.companyResolutionRetries?.attempted || 0}\``);
  if (artifact.background?.runnerCoverageTarget) {
    lines.push(`- Healthy runner target: \`${artifact.background.runnerCoverageTarget.healthyLiveAccountsObserved}/${artifact.background.runnerCoverageTarget.healthyLiveAccountsTarget}\``);
    lines.push(`- Runner type gaps: \`${artifact.background.runnerCoverageTarget.notObservedTypes.join(', ') || 'none'}\``);
  }
  const unresolvedFailures = getUnresolvedAllSweepsFailures(artifact);
  lines.push(`- Guarded connect references: \`${artifact.connect?.guardedReferences?.length || 0}\``);
  if (artifact.connectEvidence?.summary) {
    lines.push(`- Connect evidence guarded rows: \`${artifact.connectEvidence.summary.guarded}/${artifact.connectEvidence.summary.total}\``);
    lines.push(`- Connect retest candidates: \`${artifact.connectEvidence.summary.candidatesForSupervisedRetest}\``);
  }
  lines.push(`- Account-level errors: \`${artifact.background?.accountLevelErrors?.length || 0}\``);
  lines.push(`- Unresolved account-filter failures: \`${unresolvedFailures.length}\``);
  lines.push(`- Cooldown candidates: \`${artifact.background?.noisyCooldownCandidates?.length || 0}\``);
  lines.push('');
  lines.push('## Today');
  lines.push(`- Primary action: \`${getPrimaryOperatorAction(artifact)}\``);
  lines.push(`- Safe command: \`${getPrimarySafeCommand(artifact)}\``);
  lines.push('- Expected output: JSON + Markdown artifact, no LinkedIn mutation');
  lines.push('');
  lines.push('## Allowed Modes');
  lines.push('- `connect_eligible`: discovery, list-save, supervised connect');
  lines.push('- `lists_first_only`: discovery and list-save only');
  lines.push('- `manual_review_required`: discovery, list-save, dry diagnostics, supervised validation only');
  lines.push('- `email_required`: skip prospect; do not research missing email');
  lines.push('- `all_sweeps_failed`: run company-resolution retry before manual review');
  lines.push('');
  lines.push('## Evidence');
  if (artifact.artifactPath) {
    lines.push(`- Latest autoresearch: \`${artifact.artifactPath}\``);
  }
  if (artifact.reportPath) {
    lines.push(`- Latest autoresearch report: \`${artifact.reportPath}\``);
  }
  if (artifact.companyResolutionRetries?.latestArtifactPath) {
    lines.push(`- Latest company retry: \`${artifact.companyResolutionRetries.latestArtifactPath}\``);
  }
  if (artifact.connectEvidence?.artifactPath) {
    lines.push(`- Latest connect evidence: \`${artifact.connectEvidence.artifactPath}\``);
  }
  if (artifact.background?.latestHealthy?.artifactPath) {
    lines.push(`- Latest healthy runner: \`${artifact.background.latestHealthy.artifactPath}\``);
  }
  lines.push('');
  lines.push('## Operator Rules');
  lines.push('- Do not widen `connect_eligible` without repeated supervised evidence.');
  lines.push('- Do not run live-save or live-connect from autoresearch or AutoBrowse.');
  lines.push('- Treat visible LinkedIn state plus generated reports as ground truth.');
  lines.push('- Keep guarded connect shapes supervised.');
  if (unresolvedFailures.length === 0 && (artifact.background?.accountLevelErrors?.length || 0) > 0) {
    lines.push('- Historical account-filter failures are retained as evidence, but currently recovered by company-resolution retry.');
  }
  if ((artifact.background?.noisyCooldownCandidates || []).length > 0) {
    const examples = artifact.background.noisyCooldownCandidates
      .slice(0, 3)
      .map((account) => `${account.accountName} (${account.noisyRuns} noisy/${account.sparseRuns} sparse)`)
      .join(', ');
    lines.push(`- Cooldown candidates stay out of broad unattended retries unless reviewed: ${examples}.`);
  }
  lines.push('');
  lines.push('## Next Actions');
  for (const action of artifact.nextActions || []) {
    lines.push(`- \`${action}\``);
  }
  return `${lines.join('\n').trim()}\n`;
}

function getPrimaryOperatorAction(artifact) {
  if (artifact.decision === 'blocked') {
    return artifact.background?.latestEnvironmentBlock?.environment?.nextAction || 'inspect_environment_then_retry';
  }
  if (getUnresolvedAllSweepsFailures(artifact).length > 0) {
    return 'run_company_resolution_retries';
  }
  if ((artifact.background?.runnerCoverageTarget?.healthyLiveAccountsRemaining || 0) > 0) {
    return 'continue_small_background_dry_runs';
  }
  if ((artifact.background?.noisyCooldownCandidates || []).length > 0) {
    return 'cooldown_repeated_noisy_accounts';
  }
  if ((artifact.connect?.guardedReferences || []).length > 0) {
    return 'keep_connect_guarded_and_collect_supervised_evidence';
  }
  return 'continue_supervised_mvp_flow';
}

function getUnresolvedAllSweepsFailures(artifact) {
  const recovered = new Set((artifact.companyResolutionRetries?.latestAccounts || [])
    .filter((account) => account.resolutionRetryStatus === 'recovered')
    .map((account) => String(account.accountName || '').toLowerCase()));
  return (artifact.background?.accountLevelErrors || []).filter((error) => (
    /all_sweeps_failed/i.test(error.coverageError || '')
    && !recovered.has(String(error.accountName || '').toLowerCase())
  ));
}

function getPrimarySafeCommand(artifact) {
  const action = getPrimaryOperatorAction(artifact);
  switch (action) {
    case 'run_company_resolution_retries':
      return 'node src/cli.js run-company-resolution-retries --limit=3 --driver=hybrid --max-candidates=25';
    case 'continue_small_background_dry_runs':
      return 'node src/cli.js run-background-territory-loop --driver=hybrid --limit=1 --account-timeout-ms=180000';
    case 'cooldown_repeated_noisy_accounts':
      return 'npm run autoresearch:mvp';
    case 'inspect_environment_then_retry':
    case 'allow_browser_runtime_then_retry':
    case 'fix_browser_runtime_then_retry':
    case 'restart_browser_harness_then_retry':
    case 'reauthenticate_linkedin_then_retry':
      return 'npm run check-driver-session -- --driver=hybrid';
    default:
      return 'npm run autoresearch:mvp';
  }
}

function writeMvpAutoresearchRun(options = {}) {
  const artifact = buildMvpAutoresearchArtifact(options);
  const artifactPath = options.artifactPath || buildAutoresearchArtifactPath(new Date(artifact.generatedAt));
  const reportPath = options.reportPath || buildAutoresearchReportPath(artifactPath);
  writeJson(artifactPath, {
    ...artifact,
    artifactPath,
    reportPath,
  });
  fs.writeFileSync(reportPath, renderMvpAutoresearchMarkdown(artifact), {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(reportPath, 0o600);
  } catch {
    // best effort
  }
  return {
    artifact: {
      ...artifact,
      artifactPath,
      reportPath,
    },
    artifactPath,
    reportPath,
  };
}

module.exports = {
  SAFE_EVAL_COMMANDS,
  HEALTHY_BACKGROUND_EVIDENCE_TARGET,
  assertDrySafeCommands,
  buildAutoresearchArtifactPath,
  buildAutoresearchReportPath,
  buildMvpAutoresearchArtifact,
  renderMvpAutoresearchMarkdown,
  findLatestAutoresearchArtifact,
  readLatestAutoresearchArtifact,
  renderMvpOperatorDashboard,
  buildRunnerCoverageTarget,
  buildRunnerCoverageByType,
  summarizeBackgroundEvidence,
  summarizeConnectShapes,
  writeMvpAutoresearchRun,
};
