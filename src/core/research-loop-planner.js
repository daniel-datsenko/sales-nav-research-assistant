const PROHIBITED_MUTATION_FLAGS = /--live-save|--live-connect|allow-background-connects/i;

function buildResearchLoopPlan(artifact = {}, { generatedAt = new Date().toISOString() } = {}) {
  const steps = [];
  const unresolvedFilterFailures = getUnresolvedAllSweepsFailures(artifact);
  const environmentNextAction = artifact.background?.latestEnvironmentBlock?.environment?.nextAction || null;
  const environmentCurrentlyBlocked = Boolean(environmentNextAction) && isEnvironmentBlockCurrent(artifact);

  if (environmentCurrentlyBlocked) {
    steps.push({
      id: 'environment-check',
      type: 'preflight',
      command: 'npm run check-driver-session -- --driver=hybrid',
      reason: environmentNextAction,
      gate: 'operator_must_restore_browser_runtime_before_research',
    });
  }

  if (unresolvedFilterFailures.length > 0) {
    steps.push({
      id: 'company-resolution-retry',
      type: 'dry_cli',
      command: 'node src/cli.js run-company-resolution-retries --limit=3 --driver=hybrid --max-candidates=25',
      reason: 'unresolved_all_sweeps_failed_company_scope',
      inputs: unresolvedFilterFailures.map((failure) => failure.accountName).filter(Boolean).slice(0, 10),
      gate: 'review_retry_artifact_before_fast_resolve',
    });
  }

  const remainingHealthyRuns = artifact.background?.runnerCoverageTarget?.healthyLiveAccountsRemaining || 0;
  if (remainingHealthyRuns > 0 && !environmentCurrentlyBlocked) {
    steps.push({
      id: 'background-dry-run',
      type: 'dry_cli',
      command: 'node src/cli.js run-background-territory-loop --driver=hybrid --limit=1 --account-timeout-ms=180000',
      reason: 'collect_more_healthy_background_runner_evidence',
      targetRemaining: remainingHealthyRuns,
      runnerTypeGaps: artifact.background?.runnerCoverageTarget?.notObservedTypes || [],
      gate: 'inspect_background_runner_report_before_next_iteration',
    });
  }

  const cooldownCandidates = artifact.background?.noisyCooldownCandidates || [];
  if (cooldownCandidates.length > 0) {
    steps.push({
      id: 'operator-review',
      type: 'manual_gate',
      command: null,
      reason: 'review_noisy_or_sparse_accounts_before_unattended_retry',
      inputs: cooldownCandidates.map((candidate) => candidate.accountName).filter(Boolean).slice(0, 10),
      gate: 'operator_marks_scope_or_cooldown_decision',
    });
  }

  if (steps.length === 0) {
    steps.push({
      id: 'autoresearch-refresh',
      type: 'dry_cli',
      command: 'npm run autoresearch:mvp',
      reason: 'refresh_dry_safe_autoresearch_evidence',
      gate: 'inspect_autoresearch_report',
    });
  }

  assertResearchLoopPlanDrySafe(steps);

  return {
    version: 1,
    generatedAt,
    sourceGeneratedAt: artifact.generatedAt || null,
    drySafe: true,
    prohibitedMutationFlags: ['--live-save', '--live-connect', '--allow-background-connects'],
    steps,
  };
}

function isEnvironmentBlockCurrent(artifact = {}) {
  if (artifact.decision === 'blocked' || (artifact.background?.healthyLiveRuns || 0) <= 0) {
    return true;
  }
  const blockedAt = Date.parse(artifact.background?.latestEnvironmentBlock?.processedAt || '');
  const healthyAt = Date.parse(artifact.background?.latestHealthy?.processedAt || '');
  if (Number.isFinite(blockedAt) && Number.isFinite(healthyAt)) {
    return blockedAt > healthyAt;
  }
  return false;
}

function getUnresolvedAllSweepsFailures(artifact = {}) {
  const recovered = new Set((artifact.companyResolutionRetries?.latestAccounts || [])
    .filter((account) => account.resolutionRetryStatus === 'recovered')
    .map((account) => String(account.accountName || '').toLowerCase()));
  return (artifact.background?.accountLevelErrors || []).filter((error) => (
    /all_sweeps_failed/i.test(error.coverageError || '')
    && !recovered.has(String(error.accountName || '').toLowerCase())
  ));
}

function assertResearchLoopPlanDrySafe(steps = []) {
  const unsafe = steps
    .map((step) => step.command || '')
    .filter((command) => PROHIBITED_MUTATION_FLAGS.test(command));
  if (unsafe.length > 0) {
    throw new Error(`Research loop plan is not dry-safe: ${unsafe.join(', ')}`);
  }
}

module.exports = {
  assertResearchLoopPlanDrySafe,
  buildResearchLoopPlan,
};
