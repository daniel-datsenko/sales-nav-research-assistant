const { readJson } = require('../lib/json');
const path = require('node:path');
const { writeJson } = require('../lib/json');
const { BACKGROUND_RUNNER_ARTIFACTS_DIR, resolveProjectPath } = require('../lib/paths');
const { resolveConnectBudgetPolicy } = require('./budget');

function loadBackgroundRunnerConfig(configPath) {
  return readJson(configPath || resolveProjectPath('config', 'background-runner', 'default.json'));
}

function buildBackgroundRunnerDefaults(config, overrides = {}) {
  const owner = {
    name: overrides.ownerName || config.owner?.name || null,
    email: overrides.ownerEmail || config.owner?.email || null,
  };
  const stalePolicy = config.staleAccountPolicy || {};
  const connectPolicy = config.connectPolicy || {};
  const budgetPolicy = resolveConnectBudgetPolicy({
    weeklyCap: overrides.weeklyCap ?? 140,
    budgetMode: overrides.budgetMode || connectPolicy.defaultBudgetMode || 'assist',
    toolSharePercent: overrides.toolSharePercent,
    dailyMax: overrides.dailyMax,
    dailyMin: overrides.dailyMin,
  });

  return {
    owner,
    staleAccountPolicy: {
      activityLookbackDays: overrides.staleDays ?? stalePolicy.activityLookbackDays ?? 60,
      activityTypes: stalePolicy.activityTypes || ['meeting', 'call', 'task'],
      prioritizeOldestFirst: stalePolicy.prioritizeOldestFirst !== false,
    },
    connectPolicy: {
      allowBackgroundConnects: overrides.allowBackgroundConnects ?? Boolean(connectPolicy.allowBackgroundConnects),
      budgetPolicy,
    },
    seedExpansion: {
      leadLists: config.seedExpansion?.leadLists !== false,
      accountLists: config.seedExpansion?.accountLists !== false,
    },
    geoFocus: {
      description: String(config.geoFocus?.description || '').trim(),
      strictInclude: Boolean(config.geoFocus?.strictInclude),
      preferredLocationKeywords: Array.isArray(config.geoFocus?.preferredLocationKeywords)
        ? config.geoFocus.preferredLocationKeywords.map((value) => String(value || '').trim()).filter(Boolean)
        : [],
      excludedLocationKeywords: Array.isArray(config.geoFocus?.excludedLocationKeywords)
        ? config.geoFocus.excludedLocationKeywords.map((value) => String(value || '').trim()).filter(Boolean)
        : [],
    },
    coverageCache: {
      enabled: config.coverageCache?.enabled !== false,
      maxAgeDays: Number(config.coverageCache?.maxAgeDays ?? 7),
      reuseEmptyArtifacts: Boolean(config.coverageCache?.reuseEmptyArtifacts),
    },
    productiveAccountRules: {
      minListCandidates: Number(config.productiveAccountRules?.minListCandidates ?? 2),
      minCandidateCount: Number(config.productiveAccountRules?.minCandidateCount ?? 5),
      productiveRatio: Number(config.productiveAccountRules?.productiveRatio ?? 0.2),
    },
    listCandidateSelection: {
      includeBuckets: Array.isArray(config.listCandidateSelection?.includeBuckets)
        ? config.listCandidateSelection.includeBuckets
        : ['direct_observability', 'technical_adjacent'],
      minScore: Number(config.listCandidateSelection?.minScore ?? 25),
      excludeRoleFamilies: Array.isArray(config.listCandidateSelection?.excludeRoleFamilies)
        ? config.listCandidateSelection.excludeRoleFamilies
        : [],
      excludeTitleKeywords: Array.isArray(config.listCandidateSelection?.excludeTitleKeywords)
        ? config.listCandidateSelection.excludeTitleKeywords
        : [],
    },
    retryPolicy: {
      sparseAccountCooldownDays: Number(config.retryPolicy?.sparseAccountCooldownDays ?? 2),
      noisyAccountCooldownDays: Number(config.retryPolicy?.noisyAccountCooldownDays ?? 7),
      saveButtonMissingThreshold: Number(config.retryPolicy?.saveButtonMissingThreshold ?? 2),
      saveButtonMissingCooldownDays: Number(config.retryPolicy?.saveButtonMissingCooldownDays ?? 7),
    },
    subsidiaryExpansion: {
      enabled: config.subsidiaryExpansion?.enabled !== false,
      maxDepth: config.subsidiaryExpansion?.maxDepth ?? 1,
    },
  };
}

function normalizeTerritoryAccountRows(rows, runnerDefaults, now = new Date()) {
  const staleDays = runnerDefaults.staleAccountPolicy.activityLookbackDays;
  const prioritized = (rows || []).map((row) => {
    const lastActivityAt = row.last_activity_at || row.lastActivityAt || null;
    const daysSinceActivity = Number(
      row.days_since_activity
      || row.daysSinceActivity
      || estimateDaysSinceActivity(lastActivityAt, now),
    );

    return {
      accountId: row.sfdc_account_id || row.account_id || row.accountId,
      accountName: row.account_name || row.accountName,
      ownerName: row.owner_name || row.ownerName || null,
      ownerEmail: row.owner_email || row.ownerEmail || null,
      parentAccountId: row.parent_account_id || row.parentAccountId || null,
      parentAccountName: row.parent_account_name || row.parentAccountName || null,
      region: row.region || null,
      industry: row.industry || null,
      accountTier: row.account_tier || row.accountTier || null,
      lastActivityAt,
      recentActivityCount: Number(row.recent_activity_count || row.recentActivityCount || 0),
      daysSinceActivity,
      stale: Number.isFinite(daysSinceActivity) ? daysSinceActivity >= staleDays : true,
      stalePriorityScore: Number.isFinite(daysSinceActivity) ? daysSinceActivity : 99999,
      source: row.source || 'territory',
    };
  });

  return prioritized.sort((left, right) => {
    if (right.stalePriorityScore !== left.stalePriorityScore) {
      return right.stalePriorityScore - left.stalePriorityScore;
    }
    return String(left.accountName || '').localeCompare(String(right.accountName || ''));
  });
}

function mergeBackgroundRunnerSeeds(territoryAccounts, seedAccounts = [], subsidiaryAccounts = []) {
  const merged = new Map();

  for (const account of [...(territoryAccounts || []), ...(seedAccounts || []), ...(subsidiaryAccounts || [])]) {
    const key = account.accountId || `${String(account.accountName || '').toLowerCase()}::${account.parentAccountId || ''}`;
    if (!merged.has(key)) {
      merged.set(key, {
        ...account,
        seedSources: [],
        subsidiarySource: null,
      });
    }

    const current = merged.get(key);
    if (account.seedType && !current.seedSources.includes(account.seedType)) {
      current.seedSources.push(account.seedType);
    }
    if (account.matchedParentAccountId || account.parentAccountId) {
      current.subsidiarySource = account.matchedParentAccountId || account.parentAccountId;
    }
    current.stalePriorityScore = Math.max(
      Number(current.stalePriorityScore || 0),
      Number(account.stalePriorityScore || 0),
    );
  }

  return [...merged.values()].sort((left, right) => {
    if ((right.stalePriorityScore || 0) !== (left.stalePriorityScore || 0)) {
      return (right.stalePriorityScore || 0) - (left.stalePriorityScore || 0);
    }
    return String(left.accountName || '').localeCompare(String(right.accountName || ''));
  });
}

function buildBackgroundRunnerSpec({
  runnerDefaults,
  territoryAccounts = [],
  seedAccounts = [],
  subsidiaryAccounts = [],
}) {
  const mergedAccounts = mergeBackgroundRunnerSeeds(territoryAccounts, seedAccounts, subsidiaryAccounts);
  const staleAccounts = mergedAccounts.filter((account) => account.stale !== false);

  return {
    owner: runnerDefaults.owner,
    staleAccountPolicy: runnerDefaults.staleAccountPolicy,
    connectPolicy: runnerDefaults.connectPolicy,
    seedExpansion: runnerDefaults.seedExpansion,
    geoFocus: runnerDefaults.geoFocus,
    coverageCache: runnerDefaults.coverageCache,
    productiveAccountRules: runnerDefaults.productiveAccountRules,
    listCandidateSelection: runnerDefaults.listCandidateSelection,
    retryPolicy: runnerDefaults.retryPolicy,
    subsidiaryExpansion: runnerDefaults.subsidiaryExpansion,
    counts: {
      territoryAccounts: territoryAccounts.length,
      seedAccounts: seedAccounts.length,
      subsidiaryAccounts: subsidiaryAccounts.length,
      mergedAccounts: mergedAccounts.length,
      staleAccounts: staleAccounts.length,
    },
    queue: mergedAccounts,
  };
}

function estimateDaysSinceActivity(lastActivityAt, now = new Date()) {
  if (!lastActivityAt) {
    return 99999;
  }

  const diffMs = new Date(now).getTime() - new Date(lastActivityAt).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) {
    return 0;
  }

  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function writeBackgroundRunnerArtifact(spec, outputPath = null) {
  const ownerSlug = String(spec.owner?.name || 'owner')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const targetPath = outputPath || path.join(BACKGROUND_RUNNER_ARTIFACTS_DIR, `${ownerSlug}-territory-queue.json`);
  writeJson(targetPath, spec);
  return targetPath;
}

module.exports = {
  buildBackgroundRunnerDefaults,
  buildBackgroundRunnerSpec,
  estimateDaysSinceActivity,
  loadBackgroundRunnerConfig,
  mergeBackgroundRunnerSeeds,
  normalizeTerritoryAccountRows,
  writeBackgroundRunnerArtifact,
};
