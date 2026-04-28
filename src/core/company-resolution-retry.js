const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('../lib/json');
const { BACKGROUND_RUNNER_ARTIFACTS_DIR, ensureDir } = require('../lib/paths');

const RETRYABLE_RESOLUTION_STATUSES = new Set([
  'resolved_exact',
  'resolved_multi_target',
]);

function slugify(value) {
  return String(value || 'unknown-account')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function defaultCompanyResolutionRetryCheckpointPath() {
  return path.join(BACKGROUND_RUNNER_ARTIFACTS_DIR, 'company-resolution-retry-checkpoint.json');
}

function defaultCompanyResolutionRetryQueuePath(now = new Date()) {
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(BACKGROUND_RUNNER_ARTIFACTS_DIR, `company-resolution-retry-queue-${timestamp}.json`);
}

function loadCompanyResolutionRetryCheckpoint(filePath = defaultCompanyResolutionRetryCheckpointPath()) {
  try {
    return readJson(filePath);
  } catch {
    return {
      version: '1.0.0',
      updatedAt: null,
      accounts: {},
    };
  }
}

function writeCompanyResolutionRetryCheckpoint(checkpoint, filePath = defaultCompanyResolutionRetryCheckpointPath()) {
  ensureDir(path.dirname(filePath), 0o700);
  writeJson(filePath, {
    version: checkpoint?.version || '1.0.0',
    updatedAt: new Date().toISOString(),
    accounts: checkpoint?.accounts || {},
  });
  return filePath;
}

function collectAllSweepsFailedAccounts({
  artifactsDir = BACKGROUND_RUNNER_ARTIFACTS_DIR,
  checkpoint = null,
} = {}) {
  const byAccount = new Map();
  if (fs.existsSync(artifactsDir)) {
    for (const fileName of fs.readdirSync(artifactsDir).filter((entry) => /^.+-loop-.+\.json$/i.test(entry))) {
      const filePath = path.join(artifactsDir, fileName);
      let artifact = null;
      try {
        artifact = readJson(filePath);
      } catch {
        continue;
      }
      for (const result of artifact.results || []) {
        if (!/all_sweeps_failed/i.test(result.coverageError || '')) {
          continue;
        }
        addFailureCandidate(byAccount, {
          accountId: result.accountId || `company-resolution-${slugify(result.accountName)}`,
          accountName: result.accountName,
          source: result.source || 'manual',
          beforeCoverageError: result.coverageError,
          evidenceArtifactPath: filePath,
        });
      }
    }
  }

  for (const [accountId, insight] of Object.entries(checkpoint?.accountInsights || {})) {
    if (!/all_sweeps_failed/i.test(insight?.coverageError || '')) {
      continue;
    }
    addFailureCandidate(byAccount, {
      accountId,
      accountName: insight.accountName,
      source: insight.source || 'manual',
      beforeCoverageError: insight.coverageError,
      evidenceArtifactPath: null,
    });
  }

  return [...byAccount.values()];
}

function addFailureCandidate(byAccount, candidate) {
  const accountName = String(candidate.accountName || '').trim();
  if (!accountName) {
    return;
  }
  const key = slugify(accountName);
  const current = byAccount.get(key);
  if (!current) {
    byAccount.set(key, {
      ...candidate,
      accountKey: key,
    });
    return;
  }
  byAccount.set(key, {
    ...current,
    ...candidate,
    evidenceArtifactPath: current.evidenceArtifactPath || candidate.evidenceArtifactPath,
    beforeCoverageError: current.beforeCoverageError || candidate.beforeCoverageError,
  });
}

function prepareCompanyResolutionRetryCandidates({
  failures = [],
  retryCheckpoint = null,
  buildResolution,
  writeResolution,
  maxRetries = 1,
} = {}) {
  const prepared = [];
  for (const failure of failures) {
    const accountKey = failure.accountKey || slugify(failure.accountName);
    const prior = retryCheckpoint?.accounts?.[accountKey] || {};
    const attempts = Number(prior.attempts || 0);
    if (attempts >= Number(maxRetries || 1)) {
      prepared.push({
        ...failure,
        retryable: false,
        skipReason: 'max_retries_reached',
        resolutionStatus: prior.lastResolutionStatus || null,
        resolutionRetryStatus: prior.lastRetryStatus || 'manual_review',
      });
      continue;
    }

    const resolution = buildResolution(failure);
    const written = writeResolution ? writeResolution(resolution) : {};
    const retryable = RETRYABLE_RESOLUTION_STATUSES.has(resolution.status);
    prepared.push({
      ...failure,
      retryable,
      skipReason: retryable ? null : 'resolution_not_retryable',
      resolution,
      resolutionArtifactPath: written.artifactPath || resolution.artifactPath || null,
      resolutionReportPath: written.reportPath || resolution.reportPath || null,
      resolutionStatus: resolution.status,
      resolutionConfidence: resolution.confidence,
      selectedCompanyTargets: resolution.selectedTargets || [],
      nextAction: retryable
        ? resolution.recommendedAction
        : 'review_company_targets_manually',
    });
  }
  return prepared;
}

function buildCompanyResolutionRetryQueue({
  candidates = [],
  ownerName = 'Company Resolution Retry',
  maxRetries = 1,
} = {}) {
  const retryable = candidates.filter((candidate) => candidate.retryable);
  return {
    owner: {
      name: ownerName,
      email: 'dry-safe@local',
    },
    staleAccountPolicy: {
      staleDays: 0,
    },
    connectPolicy: {
      allowBackgroundConnects: false,
      budgetPolicy: {
        mode: 'assist',
        weeklyCap: 140,
        toolShare: 0.5,
      },
    },
    coverageCache: {
      enabled: false,
      maxAgeDays: 0,
      reuseEmptyArtifacts: false,
    },
    retryPolicy: {
      maxCompanyResolutionRetries: Number(maxRetries || 1),
    },
    productiveAccountRules: {
      minListCandidates: 2,
      minCandidateCount: 5,
      productiveRatio: 0.2,
    },
    queue: retryable.map((candidate, index) => ({
      accountId: `company-resolution-retry-${candidate.accountKey || slugify(candidate.accountName)}`,
      accountName: candidate.accountName,
      source: candidate.source || 'manual',
      stalePriorityScore: 1000 - index,
      companyResolutionRetry: true,
      resolutionRetryAttempt: Number(candidate.attempts || 0) + 1,
      beforeCoverageError: candidate.beforeCoverageError || null,
      evidenceArtifactPath: candidate.evidenceArtifactPath || null,
      resolutionArtifactPath: candidate.resolutionArtifactPath || null,
      resolutionStatus: candidate.resolutionStatus || null,
      resolutionConfidence: candidate.resolutionConfidence ?? null,
      selectedCompanyTargets: candidate.selectedCompanyTargets || [],
    })),
    queryContext: {
      purpose: 'dry-safe company-resolution retry for former all_sweeps_failed accounts',
      createdAt: new Date().toISOString(),
    },
  };
}

function summarizeCompanyResolutionRetryResults(artifactsDir = BACKGROUND_RUNNER_ARTIFACTS_DIR) {
  const summary = {
    attempted: 0,
    recovered: 0,
    manualReview: 0,
    failed: 0,
    latestArtifactPath: null,
    latestAccounts: [],
  };
  if (!fs.existsSync(artifactsDir)) {
    return summary;
  }

  const artifacts = fs.readdirSync(artifactsDir)
    .filter((fileName) => /^company-resolution-retry-loop-.+\.json$/i.test(fileName))
    .map((fileName) => {
      const filePath = path.join(artifactsDir, fileName);
      const stat = fs.statSync(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((left, right) => left.mtimeMs - right.mtimeMs);

  for (const entry of artifacts) {
    let artifact = null;
    try {
      artifact = readJson(entry.filePath);
    } catch {
      continue;
    }
    for (const result of artifact.results || []) {
      if (!result.resolutionRetryStatus) {
        continue;
      }
      summary.attempted += 1;
      if (result.resolutionRetryStatus === 'recovered') {
        summary.recovered += 1;
      } else if (result.resolutionRetryStatus === 'manual_review') {
        summary.manualReview += 1;
      } else if (result.resolutionRetryStatus === 'failed') {
        summary.failed += 1;
      }
    }
    summary.latestArtifactPath = entry.filePath;
    summary.latestAccounts = (artifact.results || [])
      .filter((result) => result.resolutionRetryStatus)
      .map((result) => ({
        accountName: result.accountName,
        resolutionRetryStatus: result.resolutionRetryStatus,
        resolutionRetryAttempt: result.resolutionRetryAttempt || null,
        beforeCoverageError: result.beforeCoverageError || null,
        afterCandidateCount: result.afterCandidateCount ?? result.candidateCount ?? 0,
        afterListCandidateCount: result.afterListCandidateCount ?? result.listCandidateCount ?? 0,
      }));
  }

  return summary;
}

function updateCompanyResolutionRetryCheckpoint({
  checkpoint,
  prepared = [],
  results = [],
} = {}) {
  const accounts = { ...(checkpoint?.accounts || {}) };
  const byName = new Map(results.map((result) => [slugify(result.accountName), result]));
  for (const candidate of prepared) {
    const accountKey = candidate.accountKey || slugify(candidate.accountName);
    const prior = accounts[accountKey] || {};
    const result = byName.get(accountKey);
    accounts[accountKey] = {
      accountName: candidate.accountName,
      attempts: prior.attempts || 0,
      lastResolutionStatus: candidate.resolutionStatus || prior.lastResolutionStatus || null,
      lastResolutionConfidence: candidate.resolutionConfidence ?? prior.lastResolutionConfidence ?? null,
      lastRetryStatus: candidate.retryable ? 'queued' : (candidate.resolutionRetryStatus || 'manual_review'),
      lastSkipReason: candidate.skipReason || null,
      lastEvidenceArtifactPath: candidate.evidenceArtifactPath || prior.lastEvidenceArtifactPath || null,
      lastResolutionArtifactPath: candidate.resolutionArtifactPath || prior.lastResolutionArtifactPath || null,
      updatedAt: new Date().toISOString(),
    };
    if (result) {
      accounts[accountKey] = {
        ...accounts[accountKey],
        attempts: Number(prior.attempts || 0) + 1,
        lastRetryStatus: result.resolutionRetryStatus || 'failed',
        lastCoverageError: result.coverageError || null,
        lastCandidateCount: result.candidateCount || 0,
        lastListCandidateCount: result.listCandidateCount || 0,
      };
    }
  }
  return {
    version: checkpoint?.version || '1.0.0',
    updatedAt: new Date().toISOString(),
    accounts,
  };
}

module.exports = {
  RETRYABLE_RESOLUTION_STATUSES,
  buildCompanyResolutionRetryQueue,
  collectAllSweepsFailedAccounts,
  defaultCompanyResolutionRetryCheckpointPath,
  defaultCompanyResolutionRetryQueuePath,
  loadCompanyResolutionRetryCheckpoint,
  prepareCompanyResolutionRetryCandidates,
  slugifyCompanyResolutionRetryAccount: slugify,
  summarizeCompanyResolutionRetryResults,
  updateCompanyResolutionRetryCheckpoint,
  writeCompanyResolutionRetryCheckpoint,
};
