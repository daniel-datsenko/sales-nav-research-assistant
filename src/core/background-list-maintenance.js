const path = require('node:path');
const fs = require('node:fs');
const { readJson, writeJson } = require('../lib/json');
const { BACKGROUND_RUNNER_ARTIFACTS_DIR } = require('../lib/paths');
const {
  loadExistingAccountCoverageArtifact,
  runAccountCoverageWorkflow,
  selectCoverageListCandidates,
  writeAccountCoverageArtifact,
} = require('./account-coverage');
const { applyGeoFocusToCandidates } = require('./account-batch');

function loadBackgroundRunnerArtifact(filePath) {
  return readJson(filePath);
}

function defaultRunnerCheckpointPath(ownerName) {
  const ownerSlug = String(ownerName || 'owner')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return path.join(BACKGROUND_RUNNER_ARTIFACTS_DIR, `${ownerSlug}-loop-checkpoint.json`);
}

function loadBackgroundRunnerCheckpoint(filePath, queueSpec = null) {
  try {
    return readJson(filePath);
  } catch {
    return {
      owner: queueSpec?.owner || null,
      processedAccountIds: [],
      lastRunAt: null,
      batches: [],
    };
  }
}

function writeBackgroundRunnerCheckpoint(checkpoint, filePath) {
  writeJson(filePath, checkpoint);
  return filePath;
}

function defaultVariationRegistryPath(ownerName) {
  const ownerSlug = String(ownerName || 'owner')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return path.join(BACKGROUND_RUNNER_ARTIFACTS_DIR, `${ownerSlug}-variation-registry.json`);
}

function loadVariationRegistry(filePath, queueSpec = null) {
  try {
    return readJson(filePath);
  } catch {
    return {
      owner: queueSpec?.owner || null,
      observations: [],
      accountPatterns: {},
      updatedAt: null,
    };
  }
}

function writeVariationRegistry(registry, filePath) {
  writeJson(filePath, registry);
  return filePath;
}

function estimateArtifactAgeDays(generatedAt, now = new Date()) {
  if (!generatedAt) {
    return Number.POSITIVE_INFINITY;
  }
  const diffMs = new Date(now).getTime() - new Date(generatedAt).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return diffMs / (1000 * 60 * 60 * 24);
}

function isCoverageArtifactFresh(artifact, coverageCache = {}, now = new Date()) {
  const policy = {
    enabled: coverageCache?.enabled !== false,
    maxAgeDays: Number(coverageCache?.maxAgeDays ?? 7),
    reuseEmptyArtifacts: Boolean(coverageCache?.reuseEmptyArtifacts),
  };

  if (!policy.enabled || !artifact) {
    return false;
  }
  if (!policy.reuseEmptyArtifacts && Number(artifact.candidateCount || 0) <= 0) {
    return false;
  }
  const ageDays = estimateArtifactAgeDays(artifact.generatedAt, now);
  return ageDays <= policy.maxAgeDays;
}

function summarizeAccountProductivity({ candidateCount, listCandidateCount }, productiveAccountRules = {}) {
  const totalCandidates = Number(candidateCount || 0);
  const listCandidates = Number(listCandidateCount || 0);
  const ratio = totalCandidates > 0 ? listCandidates / totalCandidates : 0;
  const minListCandidates = Number(productiveAccountRules.minListCandidates ?? 2);
  const minCandidateCount = Number(productiveAccountRules.minCandidateCount ?? 5);
  const productiveRatio = Number(productiveAccountRules.productiveRatio ?? 0.2);

  let classification = 'noisy';
  if (totalCandidates >= minCandidateCount && listCandidates >= minListCandidates && ratio >= productiveRatio) {
    classification = 'productive';
  } else if (totalCandidates > 0 && listCandidates > 0) {
    classification = 'mixed';
  } else if (totalCandidates > 0) {
    classification = 'sparse';
  }

  return {
    candidateCount: totalCandidates,
    listCandidateCount: listCandidates,
    ratio,
    classification,
  };
}

function recordVariationObservation(registry, observation) {
  const next = registry || { observations: [], accountPatterns: {} };
  next.observations = [...(next.observations || []), observation].slice(-200);
  const accountKey = String(observation.accountName || 'unknown');
  const current = next.accountPatterns?.[accountKey] || {
    saveButtonMissingCount: 0,
    saveSuccessCount: 0,
    lastObservedAt: null,
  };
  if (observation.type === 'save_button_missing') {
    current.saveButtonMissingCount += 1;
  }
  if (observation.type === 'save_success') {
    current.saveSuccessCount += 1;
  }
  current.lastObservedAt = observation.observedAt;
  next.accountPatterns = {
    ...(next.accountPatterns || {}),
    [accountKey]: current,
  };
  next.updatedAt = observation.observedAt;
  return next;
}

function computeAccountPatternPriority(account, variationRegistry = null) {
  const pattern = variationRegistry?.accountPatterns?.[String(account?.accountName || 'unknown')] || null;
  if (!pattern) {
    return 0;
  }

  const saveSuccessCount = Number(pattern.saveSuccessCount || 0);
  const saveButtonMissingCount = Number(pattern.saveButtonMissingCount || 0);
  return (saveSuccessCount * 3) - (saveButtonMissingCount * 2);
}

function estimateDaysSinceTimestamp(timestamp, now = new Date()) {
  if (!timestamp) {
    return Number.POSITIVE_INFINITY;
  }
  const diffMs = new Date(now).getTime() - new Date(timestamp).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return Number.POSITIVE_INFINITY;
  }
  return diffMs / (1000 * 60 * 60 * 24);
}

function classifyAccountDeferral(account, checkpoint = null, variationRegistry = null, retryPolicy = {}, now = new Date()) {
  const accountId = String(account?.accountId || '');
  const accountName = String(account?.accountName || 'unknown');
  const insight = checkpoint?.accountInsights?.[accountId] || null;
  const pattern = variationRegistry?.accountPatterns?.[accountName] || null;

  const sparseCooldownDays = Number(retryPolicy.sparseAccountCooldownDays ?? 2);
  const noisyCooldownDays = Number(retryPolicy.noisyAccountCooldownDays ?? 7);
  const saveButtonMissingThreshold = Number(retryPolicy.saveButtonMissingThreshold ?? 2);
  const saveButtonMissingCooldownDays = Number(retryPolicy.saveButtonMissingCooldownDays ?? 7);

  const insightAgeDays = estimateDaysSinceTimestamp(insight?.lastProcessedAt, now);
  const productivityClass = String(insight?.productivity?.classification || '');
  if (productivityClass === 'noisy' && insightAgeDays < noisyCooldownDays) {
    return { deferred: true, reason: 'noisy_cooldown' };
  }
  if (productivityClass === 'sparse' && insightAgeDays < sparseCooldownDays) {
    return { deferred: true, reason: 'sparse_cooldown' };
  }

  const patternAgeDays = estimateDaysSinceTimestamp(pattern?.lastObservedAt, now);
  const missingCount = Number(pattern?.saveButtonMissingCount || 0);
  const saveSuccessCount = Number(pattern?.saveSuccessCount || 0);
  if (missingCount >= saveButtonMissingThreshold
    && saveSuccessCount <= 0
    && patternAgeDays < saveButtonMissingCooldownDays) {
    return { deferred: true, reason: 'save_button_missing_cooldown' };
  }

  return { deferred: false, reason: null };
}

function buildCooldownUntil(timestamp, days) {
  if (!timestamp || !Number.isFinite(Number(days))) {
    return null;
  }
  const base = new Date(timestamp);
  if (!Number.isFinite(base.getTime())) {
    return null;
  }
  return new Date(base.getTime() + (Number(days) * 24 * 60 * 60 * 1000)).toISOString();
}

function summarizeBackgroundQueueDeferrals(queueSpec, checkpoint = null, variationRegistry = null, now = new Date()) {
  const retryPolicy = queueSpec?.retryPolicy || {};
  const processed = new Set(checkpoint?.processedAccountIds || []);
  const accounts = [];

  for (const account of queueSpec?.queue || []) {
    if (processed.has(account.accountId)) {
      continue;
    }
    const deferral = classifyAccountDeferral(account, checkpoint, variationRegistry, retryPolicy, now);
    if (!deferral.deferred) {
      continue;
    }

    const insight = checkpoint?.accountInsights?.[String(account.accountId || '')] || null;
    const pattern = variationRegistry?.accountPatterns?.[String(account.accountName || 'unknown')] || null;
    const cooldownDays = deferral.reason === 'noisy_cooldown'
      ? Number(retryPolicy.noisyAccountCooldownDays ?? 7)
      : deferral.reason === 'sparse_cooldown'
        ? Number(retryPolicy.sparseAccountCooldownDays ?? 2)
        : Number(retryPolicy.saveButtonMissingCooldownDays ?? 7);
    const referenceTimestamp = deferral.reason === 'save_button_missing_cooldown'
      ? pattern?.lastObservedAt
      : insight?.lastProcessedAt;

    accounts.push({
      accountId: account.accountId || null,
      accountName: account.accountName || 'Unknown account',
      reason: deferral.reason,
      productivity: insight?.productivity?.classification || null,
      coverageStatus: insight?.coverageStatus || null,
      coverageError: insight?.coverageError || null,
      lastProcessedAt: insight?.lastProcessedAt || null,
      lastObservedAt: pattern?.lastObservedAt || null,
      cooldownUntil: buildCooldownUntil(referenceTimestamp, cooldownDays),
      operatorNextAction: 'wait_for_cooldown_or_review_account_scope',
    });
  }

  const reasonCounts = {};
  for (const account of accounts) {
    reasonCounts[account.reason] = (reasonCounts[account.reason] || 0) + 1;
  }

  return {
    total: accounts.length,
    reasonCounts,
    accounts,
  };
}

function selectBackgroundMaintenanceBatch(queueSpec, checkpoint, limit = 5, variationRegistry = null, now = new Date()) {
  const processed = new Set(checkpoint?.processedAccountIds || []);
  const sourceRank = {
    territory: 0,
    seed: 1,
    subsidiary: 2,
  };

  return (queueSpec?.queue || [])
    .filter((account) => !processed.has(account.accountId))
    .filter((account) => !classifyAccountDeferral(
      account,
      checkpoint,
      variationRegistry,
      queueSpec?.retryPolicy || {},
      now,
    ).deferred)
    .sort((left, right) => {
      const rightPatternPriority = computeAccountPatternPriority(right, variationRegistry);
      const leftPatternPriority = computeAccountPatternPriority(left, variationRegistry);
      if (rightPatternPriority !== leftPatternPriority) {
        return rightPatternPriority - leftPatternPriority;
      }

      const leftScore = Number(left.stalePriorityScore || 0);
      const rightScore = Number(right.stalePriorityScore || 0);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      const leftRank = sourceRank[left.source || 'territory'] ?? 9;
      const rightRank = sourceRank[right.source || 'territory'] ?? 9;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return String(left.accountName || '').localeCompare(String(right.accountName || ''));
    })
    .slice(0, Math.max(1, Number(limit) || 5));
}

function buildBackgroundListName({ ownerName, accountName }) {
  return `${accountName} Coverage`;
}

function buildBackgroundLoopArtifactPath(ownerName) {
  const ownerSlug = String(ownerName || 'owner')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(BACKGROUND_RUNNER_ARTIFACTS_DIR, `${ownerSlug}-loop-${timestamp}.json`);
}

function buildBackgroundLoopReportPath(jsonPath) {
  return String(jsonPath || buildBackgroundLoopArtifactPath('owner')).replace(/\.json$/i, '.md');
}

function renderBackgroundLoopReportMarkdown(artifact = {}) {
  const metrics = artifact.metrics || {};
  const lines = [];
  lines.push('# Background Runner Report');
  lines.push('');
  lines.push(`- Processed at: \`${artifact.processedAt || 'unknown'}\``);
  lines.push(`- Status: \`${artifact.status || 'unknown'}\``);
  lines.push(`- Driver: \`${artifact.driver || 'unknown'}\``);
  lines.push(`- Live save: \`${artifact.liveSave ? 'yes' : 'no'}\``);
  if (artifact.environment?.state) {
    lines.push(`- Environment: \`${artifact.environment.state}\``);
  }
  if (artifact.status === 'environment_blocked') {
    lines.push('- Operator disposition: `environment_blocked`');
    lines.push(`- Next action: \`${artifact.environment?.nextAction || getBackgroundEnvironmentNextAction(artifact.environment?.state, artifact.environment?.detail)}\``);
  }
  if (artifact.environment?.sessionCheckSkipped) {
    lines.push(`- Session check: \`skipped (${artifact.environment.sessionCheckReason || 'not_required'})\``);
  }
  lines.push(`- Accounts attempted: \`${metrics.accountsAttempted ?? 0}\``);
  lines.push(`- Productive: \`${metrics.productiveAccounts ?? 0}\``);
  lines.push(`- Mixed: \`${metrics.mixedAccounts ?? 0}\``);
  lines.push(`- Sparse: \`${metrics.sparseAccounts ?? 0}\``);
  lines.push(`- Noisy: \`${metrics.noisyAccounts ?? 0}\``);
  lines.push(`- Cached: \`${metrics.cachedAccounts ?? 0}\``);
  lines.push(`- Timed out: \`${metrics.timedOutAccounts ?? 0}\``);
  lines.push(`- Deferred by cooldown: \`${metrics.deferredAccounts ?? artifact.deferredAccounts?.total ?? 0}\``);
  lines.push(`- Total candidates: \`${metrics.totalCandidates ?? 0}\``);
  lines.push(`- Total list candidates: \`${metrics.totalListCandidates ?? 0}\``);
  lines.push('');

  if ((artifact.results || []).length > 0) {
    lines.push('## Accounts');
    for (const result of artifact.results || []) {
      const parts = [
        `status=${result.coverageStatus || (result.cacheUsed ? 'cached' : 'live')}`,
        `productivity=${result.productivity?.classification || 'unknown'}`,
        `candidates=${Number(result.candidateCount || 0)}`,
        `list_candidates=${Number(result.listCandidateCount || 0)}`,
      ];
      if (result.cacheUsed) {
        parts.push('cache=reused');
      }
      if (result.coverageError) {
        parts.push(`error=${String(result.coverageError).replace(/\s+/g, ' ').slice(0, 180)}`);
      }
      if (result.resolutionStatus) {
        parts.push(`resolution=${result.resolutionStatus}`);
      }
      if (result.resolutionConfidence !== undefined && result.resolutionConfidence !== null) {
        parts.push(`resolution_confidence=${result.resolutionConfidence}`);
      }
      if (result.resolutionNextAction) {
        parts.push(`next=${result.resolutionNextAction}`);
      }
      if (result.resolutionRetryStatus) {
        parts.push(`retry=${result.resolutionRetryStatus}`);
      }
      if (result.resolutionRetryAttempt) {
        parts.push(`retry_attempt=${result.resolutionRetryAttempt}`);
      }
      lines.push(`- ${result.accountName || 'Unknown account'}: ${parts.join(' | ')}`);
      if (result.beforeCoverageError) {
        lines.push(`  - beforeCoverageError: \`${String(result.beforeCoverageError).replace(/\s+/g, ' ').slice(0, 180)}\``);
      }
      if (result.afterCandidateCount !== undefined && result.afterCandidateCount !== null) {
        lines.push(`  - afterCandidateCount: \`${Number(result.afterCandidateCount || 0)}\``);
      }
      if (result.afterListCandidateCount !== undefined && result.afterListCandidateCount !== null) {
        lines.push(`  - afterListCandidateCount: \`${Number(result.afterListCandidateCount || 0)}\``);
      }
      if ((result.selectedCompanyTargets || []).length > 0) {
        lines.push(`  - selectedTargets: \`${result.selectedCompanyTargets.join(', ')}\``);
      }
    }
    lines.push('');
  }

  if ((artifact.deferredAccounts?.accounts || []).length > 0) {
    lines.push('## Deferred Accounts');
    for (const account of artifact.deferredAccounts.accounts || []) {
      const parts = [
        `reason=${account.reason || 'unknown'}`,
        `next=${account.operatorNextAction || 'wait_for_cooldown_or_review_account_scope'}`,
      ];
      if (account.cooldownUntil) {
        parts.push(`until=${account.cooldownUntil}`);
      }
      if (account.productivity) {
        parts.push(`productivity=${account.productivity}`);
      }
      if (account.coverageError) {
        parts.push(`error=${String(account.coverageError).replace(/\s+/g, ' ').slice(0, 140)}`);
      }
      lines.push(`- ${account.accountName || 'Unknown account'}: ${parts.join(' | ')}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

function getBackgroundEnvironmentNextAction(state, detail = '') {
  const loweredDetail = String(detail || '').toLowerCase();
  switch (state) {
    case 'browser_launch_blocked':
      if (
        loweredDetail.includes('bootstrap_check_in')
        || loweredDetail.includes('machportrendezvous')
        || loweredDetail.includes('permission denied')
      ) {
        return 'allow_browser_runtime_then_retry';
      }
      return 'fix_browser_runtime_then_retry';
    case 'harness_transport_blocked':
      return 'restart_browser_harness_then_retry';
    case 'reauth_required':
      return 'reauthenticate_linkedin_then_retry';
    default:
      return 'inspect_environment_then_retry';
  }
}

function writeBackgroundLoopReport(artifact, reportPath = null) {
  const targetPath = reportPath || buildBackgroundLoopReportPath(artifact?.artifactPath || null);
  fs.writeFileSync(targetPath, renderBackgroundLoopReportMarkdown(artifact), {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(targetPath, 0o600);
  } catch {
    // best effort
  }
  return targetPath;
}

function findLatestBackgroundLoopReport(artifactsDir = BACKGROUND_RUNNER_ARTIFACTS_DIR) {
  if (!fs.existsSync(artifactsDir)) {
    return null;
  }

  const reports = fs.readdirSync(artifactsDir)
    .filter((fileName) => /^.+-loop-.+\.md$/i.test(fileName))
    .map((fileName) => {
      const filePath = path.join(artifactsDir, fileName);
      const stat = fs.statSync(filePath);
      return {
        filePath,
        mtimeMs: stat.mtimeMs,
      };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return reports[0]?.filePath || null;
}

function readLatestBackgroundLoopReport(artifactsDir = BACKGROUND_RUNNER_ARTIFACTS_DIR) {
  const reportPath = findLatestBackgroundLoopReport(artifactsDir);
  if (!reportPath) {
    return null;
  }

  return {
    reportPath,
    content: fs.readFileSync(reportPath, 'utf8'),
  };
}

function summarizeCoverageSweepErrors(coverageRun) {
  const sweepErrors = coverageRun?.sweepErrors || coverageRun?.result?.sweepErrors || [];
  if (!Array.isArray(sweepErrors) || sweepErrors.length === 0) {
    return null;
  }

  const templateCount = Number(coverageRun?.templates?.length || 0);
  const prefix = templateCount > 0 && sweepErrors.length >= templateCount
    ? 'all_sweeps_failed'
    : 'sweeps_failed';
  const firstMessage = String(sweepErrors[0]?.message || 'unknown sweep failure').replace(/\s+/g, ' ');
  const suffix = sweepErrors.length > 1
    ? `; ${sweepErrors.length} sweep failures total`
    : '';
  return `${prefix}: ${firstMessage}${suffix}`.slice(0, 240);
}

function classifyBackgroundEnvironmentHealth({ health = null, error = null } = {}) {
  if (health?.ok) {
    return {
      ok: true,
      state: 'healthy',
      detail: null,
    };
  }

  const rawState = String(health?.state || '').trim().toLowerCase();
  const rawDetail = String(error?.message || health?.error || rawState || 'unknown environment failure').trim();
  const detail = rawDetail.length > 240
    ? `${rawDetail.slice(0, 237)}...`
    : rawDetail;
  const lowered = `${rawState}\n${rawDetail}`.toLowerCase();

  let state = 'session_check_failed';
  if (
    lowered.includes('browser_launch_blocked')
    || lowered.includes('sandboxdenied')
    || lowered.includes('operation not permitted')
    || lowered.includes('bootstrap_check_in')
    || lowered.includes('crashpad')
  ) {
    state = 'browser_launch_blocked';
  } else if (
    lowered.includes('no close frame received or sent')
    || lowered.includes('connection lost')
    || lowered.includes('websocket')
    || lowered.includes('broken pipe')
    || lowered.includes('browser-harness')
  ) {
    state = 'harness_transport_blocked';
  } else if (
    lowered.includes('reauth')
    || lowered.includes('login')
    || lowered.includes('signin')
    || lowered.includes('checkpoint')
    || lowered.includes('unauthenticated')
    || lowered.includes('not authenticated')
    || rawState === 'expired'
  ) {
    state = 'reauth_required';
  }

  return {
    ok: false,
    state,
    detail,
    nextAction: getBackgroundEnvironmentNextAction(state, rawDetail),
  };
}

function buildBackgroundEnvironmentBlockArtifact({
  owner = null,
  queueArtifactPath = null,
  checkpointPath = null,
  variationRegistryPath = null,
  liveSave = false,
  driver = null,
  environment = null,
}) {
  return {
    owner,
    driver,
    queueArtifactPath,
    checkpointPath,
    variationRegistryPath,
    liveSave,
    processedAt: new Date().toISOString(),
    status: 'environment_blocked',
    environment: environment || {
      ok: false,
      state: 'session_check_failed',
      detail: 'unknown environment failure',
    },
    metrics: {
      accountsAttempted: 0,
      productiveAccounts: 0,
      mixedAccounts: 0,
      sparseAccounts: 0,
      noisyAccounts: 0,
      cachedAccounts: 0,
      totalCandidates: 0,
      totalListCandidates: 0,
    },
    results: [],
  };
}

function buildTimedOutCoverageRun(account, timeoutMs) {
  const accountName = account?.accountName || 'Unknown account';
  const timeoutSeconds = Math.round(Number(timeoutMs || 0) / 1000);

  return {
    account,
    templates: [],
    bucketSummary: {
      direct_observability: 0,
      technical_adjacent: 0,
      broad_it_stakeholder: 0,
      likely_noise: 0,
    },
    cacheUsed: false,
    timedOut: true,
    result: {
      accountName,
      generatedAt: new Date().toISOString(),
      candidateCount: 0,
      candidates: [],
      coverage: null,
      backgroundRunner: {
        status: 'timed_out',
        reason: `account coverage exceeded ${timeoutSeconds}s timeout`,
        timeoutMs: Number(timeoutMs || 0),
      },
    },
  };
}

function withAccountTimeout(promise, timeoutMs, accountName) {
  const numericTimeout = Number(timeoutMs || 0);
  if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
    return promise;
  }

  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`background account coverage timed out for ${accountName} after ${numericTimeout}ms`);
      error.code = 'BACKGROUND_ACCOUNT_TIMEOUT';
      error.accountName = accountName;
      error.timeoutMs = numericTimeout;
      reject(error);
    }, numericTimeout);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function executeBackgroundListMaintenanceLoop({
  driver,
  queueSpec,
  checkpoint,
  limit = 5,
  coverageConfig,
  icpConfig,
  priorityModel,
  peopleSearchUrl = 'https://www.linkedin.com/sales/search/people?viewAllFilters=true',
  maxCandidates = null,
  speedProfile = 'balanced',
  reuseSweepCache = true,
  liveSave = false,
  allowBackgroundConnects = false,
  variationRegistry = null,
  logger = null,
  accountTimeoutMs = 0,
  recoverDriverSession = null,
  runCoverageWorkflow = runAccountCoverageWorkflow,
  now = new Date(),
}) {
  const deferredAccounts = summarizeBackgroundQueueDeferrals(queueSpec, checkpoint, variationRegistry, now);
  const batchAccounts = selectBackgroundMaintenanceBatch(queueSpec, checkpoint, limit, variationRegistry, now);
  const results = [];
  let nextVariationRegistry = variationRegistry;

  for (const account of batchAccounts) {
    const listName = buildBackgroundListName({
      ownerName: queueSpec?.owner?.name,
      accountName: account.accountName,
    });

    const existingArtifact = loadExistingAccountCoverageArtifact(account.accountName);
    const useCachedArtifact = isCoverageArtifactFresh(existingArtifact, queueSpec?.coverageCache);
    let coverageRun = null;
    let coverageStatus = useCachedArtifact ? 'cached' : 'live';
    let coverageError = null;
    if (useCachedArtifact) {
      coverageRun = {
        account: account,
        result: existingArtifact,
        bucketSummary: null,
        cacheUsed: true,
      };
    } else {
      try {
        coverageRun = await withAccountTimeout(runCoverageWorkflow({
          driver,
          accountName: account.accountName,
          peopleSearchUrl,
          coverageConfig,
          icpConfig,
          priorityModel,
          maxCandidates,
          speedProfile,
          reuseSweepCache,
          runId: 'background-list-maintenance',
          accountSource: account.source || 'territory',
          logger,
        }), accountTimeoutMs, account.accountName);
      } catch (error) {
        if (error?.code !== 'BACKGROUND_ACCOUNT_TIMEOUT') {
          throw error;
        }

        coverageStatus = 'timed_out';
        coverageError = error.message;
        if (logger && typeof logger.warn === 'function') {
          logger.warn(`Background loop account timed out: ${account.accountName} | ${error.message}`);
        }
        if (driver && typeof driver.close === 'function') {
          await driver.close().catch(() => {});
        }
        if (typeof recoverDriverSession === 'function') {
          await recoverDriverSession({ account, error });
        }
        coverageRun = buildTimedOutCoverageRun(account, error.timeoutMs);
      }
    }

    const artifactPath = useCachedArtifact
      ? path.join(BACKGROUND_RUNNER_ARTIFACTS_DIR, '..', 'coverage', `${String(account.accountName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`)
      : writeAccountCoverageArtifact(account.accountName, coverageRun.result);
    const listCandidates = applyGeoFocusToCandidates(
      selectCoverageListCandidates(coverageRun.result, queueSpec?.listCandidateSelection || {}),
      queueSpec?.geoFocus || null,
    );
    if (!coverageError && Number(coverageRun.result.candidateCount || 0) === 0) {
      coverageError = summarizeCoverageSweepErrors(coverageRun);
    }
    const companyResolution = coverageRun.result.companyResolution || null;
    const isResolutionRetry = Boolean(account.companyResolutionRetry);
    const resolutionRetryAttempt = isResolutionRetry ? Number(account.resolutionRetryAttempt || 1) : null;
    let resolutionStatus = /^all_sweeps_failed/i.test(coverageError || '')
      ? 'needs_company_resolution'
      : companyResolution?.status || null;
    let resolutionNextAction = /^all_sweeps_failed/i.test(coverageError || '')
      ? 'resolve_company_targets_then_retry'
      : companyResolution?.recommendedAction || null;
    let resolutionRetryStatus = null;
    if (isResolutionRetry) {
      if (/^all_sweeps_failed/i.test(coverageError || '')) {
        resolutionRetryStatus = 'manual_review';
        resolutionStatus = 'needs_manual_company_review';
        resolutionNextAction = 'review_company_targets_manually';
      } else if (coverageError) {
        resolutionRetryStatus = 'failed';
        resolutionStatus = resolutionStatus || 'resolution_retry_failed';
        resolutionNextAction = 'retry_after_review';
      } else {
        resolutionRetryStatus = 'recovered';
      }
    }
    const productivity = summarizeAccountProductivity({
      candidateCount: coverageRun.result.candidateCount,
      listCandidateCount: listCandidates.length,
    }, queueSpec?.productiveAccountRules);
    const saves = [];

    if (liveSave && listCandidates.length > 0) {
      await driver.ensureList(listName, {
        runId: 'background-list-maintenance',
        accountKey: account.accountId,
        dryRun: false,
      });

      for (const candidate of listCandidates) {
        try {
          const saveResult = await driver.saveCandidateToList(candidate, listName, {
            runId: 'background-list-maintenance',
            accountKey: account.accountId,
            dryRun: false,
          });
          saves.push({
            fullName: candidate.fullName,
            status: saveResult.status,
            note: saveResult.note || null,
          });
          nextVariationRegistry = recordVariationObservation(nextVariationRegistry, {
            observedAt: new Date().toISOString(),
            accountName: account.accountName,
            fullName: candidate.fullName,
            type: 'save_success',
            note: saveResult.note || null,
          });
        } catch (error) {
          saves.push({
            fullName: candidate.fullName,
            status: 'failed',
            note: error.message,
          });
          if (/save button not found/i.test(error.message || '')) {
            nextVariationRegistry = recordVariationObservation(nextVariationRegistry, {
              observedAt: new Date().toISOString(),
              accountName: account.accountName,
              fullName: candidate.fullName,
              type: 'save_button_missing',
              note: error.message,
            });
          }
        }
      }
    }

    const result = {
      accountId: account.accountId,
      accountName: account.accountName,
      source: account.source || 'territory',
      stalePriorityScore: account.stalePriorityScore || null,
      listName,
      coverageArtifactPath: artifactPath,
      candidateCount: coverageRun.result.candidateCount,
      listCandidateCount: listCandidates.length,
      cacheUsed: Boolean(useCachedArtifact),
      coverageStatus,
      coverageError,
      speedProfile: coverageRun.result.speedProfile || speedProfile,
      timings: coverageRun.result.timings || null,
      slowestSweeps: coverageRun.result.slowestSweeps || [],
      cacheHits: Number(coverageRun.result.cacheHits || 0),
      cacheMisses: Number(coverageRun.result.cacheMisses || 0),
      resolutionStatus,
      resolutionConfidence: companyResolution?.confidence ?? null,
      resolutionNextAction,
      selectedCompanyTargets: companyResolution?.selectedTargets || [],
      companyResolutionArtifactPath: companyResolution?.artifactPath || null,
      resolutionRetryStatus,
      resolutionRetryAttempt,
      beforeCoverageError: isResolutionRetry ? account.beforeCoverageError || null : null,
      afterCandidateCount: isResolutionRetry ? Number(coverageRun.result.candidateCount || 0) : null,
      afterListCandidateCount: isResolutionRetry ? listCandidates.length : null,
      geoFocusApplied: Boolean(queueSpec?.geoFocus),
      productivity,
      liveSave,
      connectsEnabled: Boolean(allowBackgroundConnects),
      saves,
    };
    results.push(result);

    if (logger && typeof logger.info === 'function') {
      logger.info(`Background loop processed ${account.accountName} | candidates=${result.candidateCount} | list_candidates=${result.listCandidateCount}${liveSave ? ` | list=${listName}` : ''}`);
    }
  }

  const processedAccountIds = [
    ...(checkpoint?.processedAccountIds || []),
    ...results.map((result) => result.accountId),
  ];
  const updatedCheckpoint = {
    owner: queueSpec?.owner || null,
    processedAccountIds,
    lastRunAt: new Date().toISOString(),
    accountInsights: {
      ...(checkpoint?.accountInsights || {}),
      ...Object.fromEntries(results.map((result) => [result.accountId, {
        accountName: result.accountName,
        candidateCount: result.candidateCount,
        listCandidateCount: result.listCandidateCount,
        productivity: result.productivity,
        cacheUsed: result.cacheUsed,
        coverageStatus: result.coverageStatus,
        coverageError: result.coverageError,
        resolutionStatus: result.resolutionStatus,
        resolutionConfidence: result.resolutionConfidence,
        resolutionNextAction: result.resolutionNextAction,
        selectedCompanyTargets: result.selectedCompanyTargets,
        companyResolutionArtifactPath: result.companyResolutionArtifactPath,
        resolutionRetryStatus: result.resolutionRetryStatus,
        resolutionRetryAttempt: result.resolutionRetryAttempt,
        beforeCoverageError: result.beforeCoverageError,
        afterCandidateCount: result.afterCandidateCount,
        afterListCandidateCount: result.afterListCandidateCount,
        lastProcessedAt: new Date().toISOString(),
      }])),
    },
    batches: [
      ...(checkpoint?.batches || []),
      {
        ranAt: new Date().toISOString(),
        processedAccountIds: results.map((result) => result.accountId),
      },
    ],
  };

  return {
    accountsAttempted: batchAccounts.length,
    results,
    updatedCheckpoint,
    updatedVariationRegistry: nextVariationRegistry,
    metrics: {
      accountsAttempted: batchAccounts.length,
      productiveAccounts: results.filter((result) => result.productivity.classification === 'productive').length,
      mixedAccounts: results.filter((result) => result.productivity.classification === 'mixed').length,
      sparseAccounts: results.filter((result) => result.productivity.classification === 'sparse').length,
      noisyAccounts: results.filter((result) => result.productivity.classification === 'noisy').length,
      cachedAccounts: results.filter((result) => result.cacheUsed).length,
      timedOutAccounts: results.filter((result) => result.coverageStatus === 'timed_out').length,
      deferredAccounts: deferredAccounts.total,
      totalCandidates: results.reduce((sum, result) => sum + Number(result.candidateCount || 0), 0),
      totalListCandidates: results.reduce((sum, result) => sum + Number(result.listCandidateCount || 0), 0),
    },
    deferredAccounts,
  };
}

module.exports = {
  buildBackgroundEnvironmentBlockArtifact,
  buildBackgroundListName,
  defaultRunnerCheckpointPath,
  defaultVariationRegistryPath,
  executeBackgroundListMaintenanceLoop,
  buildBackgroundLoopReportPath,
  classifyBackgroundEnvironmentHealth,
  isCoverageArtifactFresh,
  loadBackgroundRunnerArtifact,
  loadBackgroundRunnerCheckpoint,
  loadVariationRegistry,
  findLatestBackgroundLoopReport,
  readLatestBackgroundLoopReport,
  summarizeAccountProductivity,
  selectBackgroundMaintenanceBatch,
  classifyAccountDeferral,
  summarizeBackgroundQueueDeferrals,
  writeBackgroundRunnerCheckpoint,
  buildBackgroundLoopArtifactPath,
  buildTimedOutCoverageRun,
  renderBackgroundLoopReportMarkdown,
  writeBackgroundLoopReport,
  writeVariationRegistry,
};
