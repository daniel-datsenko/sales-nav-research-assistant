const path = require('node:path');
const fs = require('node:fs');
const { readJson, writeJson } = require('../lib/json');
const { resolveProjectPath, PRIORITY_ARTIFACTS_DIR, COVERAGE_ARTIFACTS_DIR } = require('../lib/paths');
const { scoreCandidate } = require('./scoring');
const { scoreCandidateWithPriorityModel } = require('./priority-score');
const { buildCoverageSummary } = require('./coverage');
const {
  buildCompanyResolution,
  writeCompanyResolutionArtifact,
} = require('./company-resolution');
const { normalizeCandidateLimit } = require('./candidate-limits');
const {
  createRunTimings,
  finishRunTimings,
  summarizeSlowestSweeps,
  timePhase,
} = require('./speed-telemetry');
const {
  buildSweepCacheKey,
  DEFAULT_SWEEP_CACHE_DIR,
  readSweepCache,
  writeSweepCache,
} = require('./sweep-cache');
const {
  buildLanguageSplitListNames,
  splitCandidatesByProfileLanguage,
} = require('./emea-territory');

function loadAccountCoverageConfig(configPath) {
  return readJson(configPath || resolveProjectPath('config', 'account-coverage', 'default.json'));
}

function loadAccountAliasConfig(configPath) {
  const resolved = configPath || resolveProjectPath('config', 'account-aliases', 'default.json');
  if (!fs.existsSync(resolved)) {
    return { accounts: {} };
  }
  return readJson(resolved);
}

function normalizeAccountAliasKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(gmbh|mbh|ag|se|sa|s\.a\.|spa|s\.p\.a\.|ltd|limited|inc|corp|corporation|llc|plc|group|holding|holdings)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findAccountAliasEntry(aliasConfig, accountName) {
  const accounts = aliasConfig?.accounts || {};
  const exactKey = String(accountName || '').trim().toLowerCase();
  if (accounts[exactKey]) {
    return accounts[exactKey];
  }

  const normalizedTarget = normalizeAccountAliasKey(accountName);
  const matchingKey = Object.keys(accounts).find((key) => (
    normalizeAccountAliasKey(key) === normalizedTarget
  ));
  return matchingKey ? accounts[matchingKey] : {};
}

function loadPriorityModel() {
  const artifactPath = path.join(PRIORITY_ARTIFACTS_DIR, 'priority_score_v1.json');
  if (!fs.existsSync(artifactPath)) {
    return null;
  }
  return readJson(artifactPath);
}

function buildCoverageArtifactPath(accountName) {
  const fileName = `${String(accountName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  return path.join(COVERAGE_ARTIFACTS_DIR, fileName);
}

function loadExistingAccountCoverageArtifact(accountName) {
  const artifactPath = buildCoverageArtifactPath(accountName);
  if (!fs.existsSync(artifactPath)) {
    return null;
  }

  try {
    return readJson(artifactPath);
  } catch {
    return null;
  }
}

function normalizeCandidateKey(candidate) {
  const url = candidate.salesNavigatorUrl || candidate.profileUrl || '';
  if (url) {
    try {
      const parsed = new URL(url);
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return String(url).replace(/\?.*$/, '');
    }
  }

  return `${candidate.fullName}:${candidate.title}`;
}

const SPEED_PROFILES = new Set(['exhaustive', 'balanced', 'fast']);
const PRIORITY_SWEEP_HINTS = [
  'observability',
  'platform',
  'engineering',
  'infrastructure',
  'cloud',
  'devops',
  'reliability',
  'sre',
  'architecture',
  'monitoring',
];

function normalizeSpeedProfile(value = 'balanced') {
  const profile = String(value || 'balanced').toLowerCase();
  return SPEED_PROFILES.has(profile) ? profile : 'balanced';
}

function isPrioritySweep(template) {
  if (template.id === 'broad-crawl') {
    return true;
  }
  const haystack = [
    template.id,
    template.name,
    ...(template.keywords || []),
  ].join(' ').toLowerCase();
  return PRIORITY_SWEEP_HINTS.some((hint) => haystack.includes(hint));
}

function applySpeedProfileToTemplates(templates, speedProfile = 'balanced', profileOptions = {}) {
  const profile = normalizeSpeedProfile(speedProfile);
  if (profile === 'exhaustive') {
    return templates;
  }

  const broad = templates.filter((template) => template.id === 'broad-crawl');
  const priority = templates.filter((template) => template.id !== 'broad-crawl' && isPrioritySweep(template));
  const rest = templates.filter((template) => template.id !== 'broad-crawl' && !isPrioritySweep(template));

  const expandFastRestForAdaptivePruning = Boolean(profileOptions.adaptiveSweepPruning);

  if (profile === 'fast') {
    if (expandFastRestForAdaptivePruning) {
      return [...broad, ...priority, ...rest];
    }
    return [...broad, ...priority];
  }
  return [...broad, ...priority, ...rest];
}

function isRestSweepTemplate(template) {
  return template.id !== 'broad-crawl' && !isPrioritySweep(template);
}

function getAdaptivePruningThresholds(speedProfile) {
  const profile = normalizeSpeedProfile(speedProfile);
  if (profile === 'exhaustive') {
    return null;
  }
  if (profile === 'fast') {
    return { windowSize: 2, maxNewUniquesPerSweep: 0 };
  }
  return { windowSize: 3, maxNewUniquesPerSweep: 0 };
}

function broadCrawlFinishedBeforeIndex(templates, templateIndex) {
  const broadIdx = templates.findIndex((template) => template.id === 'broad-crawl');
  if (broadIdx === -1) {
    return true;
  }
  return templateIndex > broadIdx;
}

function shouldAdaptiveSkipRestSweep({
  template,
  thresholds,
  adaptiveEnabled,
  executedUniqueAdds,
  templates,
  templateIndex,
}) {
  if (!adaptiveEnabled || !thresholds || !isRestSweepTemplate(template)) {
    return false;
  }
  if (!broadCrawlFinishedBeforeIndex(templates, templateIndex)) {
    return false;
  }
  if (executedUniqueAdds.length < thresholds.windowSize) {
    return false;
  }
  const tail = executedUniqueAdds.slice(-thresholds.windowSize);
  return tail.every((count) => count <= thresholds.maxNewUniquesPerSweep);
}

function buildSweepTemplates(config, maxCandidatesOverride = null, options = {}) {
  const templates = [];
  const overrideLimit = normalizeCandidateLimit(maxCandidatesOverride);

  if (config?.broadCrawl?.enabled) {
    const configuredLimit = normalizeCandidateLimit(config.broadCrawl.maxCandidates);
    const template = {
      id: 'broad-crawl',
      name: 'Broad Employee Crawl',
      keywords: [],
    };
    const limit = overrideLimit ?? configuredLimit;
    if (limit !== null) {
      template.maxCandidates = limit;
    }
    templates.push(template);
  }

  for (const sweep of config?.sweeps || []) {
    const configuredLimit = normalizeCandidateLimit(sweep.maxCandidates);
    const template = {
      id: `sweep-${sweep.id}`,
      name: `Coverage Sweep ${sweep.id}`,
      keywords: sweep.keywords || [],
    };
    const limit = overrideLimit ?? configuredLimit;
    if (limit !== null) {
      template.maxCandidates = limit;
    }
    templates.push(template);
  }

  return applySpeedProfileToTemplates(templates, options.speedProfile || 'balanced', {
    adaptiveSweepPruning: options.adaptiveSweepPruning,
  });
}

function classifySweepErrorCategory(error) {
  const message = String(error?.message || error || '');
  if (error?.code === 'rate_limited' || /rate[_ -]?limited|too many requests|zu viele anfragen/i.test(message)) {
    return 'rate_limited';
  }
  if (/scope|filter|account.*not found|company/i.test(message)) {
    return 'account_scope_failure';
  }
  if (/hydrate|spinner|shell|render|domcontentloaded|networkidle/i.test(message)) {
    return 'slow_hydration';
  }
  if (/target closed|browser.*closed|memory|crash|transport|econn/i.test(message)) {
    return 'browser_memory_or_transport';
  }
  return 'sweep_runtime_failure';
}

function hasSuccessfulLiveSweepEvidence(rawResults = []) {
  return rawResults.some((entry) => (
    !entry.cacheHit
    && Array.isArray(entry.candidates)
    && entry.candidates.length > 0
  ));
}

function inferLiveScopedTargets(activeAccount, accountName, candidates = []) {
  const explicitLabels = [
    activeAccount?.salesNav?.selectedCompanyLabel,
    activeAccount?.salesNav?.selectedCompanyName,
    activeAccount?.salesNav?.companyName,
    ...(activeAccount?.salesNav?.companyTargets || []).map((target) => target.linkedinName),
  ].filter(Boolean);
  const labels = explicitLabels.length > 0
    ? explicitLabels
    : [
      ...candidates.map((candidate) => candidate.company),
      accountName,
    ].filter(Boolean);

  const seen = new Set();
  return labels
    .map((label) => String(label).replace(/\s+/g, ' ').trim())
    .filter((label) => {
      const key = label.toLowerCase();
      if (!label || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function summarizeCompanyResolutionForCoverage({
  companyResolution,
  companyResolutionArtifact,
  needsCompanyResolution,
  activeAccount,
  accountName,
  finalResult,
  rawResults,
}) {
  const selectedTargets = companyResolution.targets.map((target) => target.linkedinName);
  const liveScoped = hasSuccessfulLiveSweepEvidence(rawResults);
  const resolverWasUncertain = (
    companyResolution.status === 'all_resolution_failed'
    || companyResolution.status === 'resolved_low_confidence'
    || companyResolution.status === 'needs_manual_company_review'
    || selectedTargets.length === 0
  );

  if (liveScoped && resolverWasUncertain && Number(finalResult?.candidateCount || 0) > 0) {
    return {
      status: 'resolved_by_live_scope',
      confidence: 1,
      recommendedAction: 'run_people_sweeps',
      selectedTargets: inferLiveScopedTargets(activeAccount, accountName, finalResult.candidates || []),
      artifactPath: companyResolutionArtifact.artifactPath,
      reportPath: companyResolutionArtifact.reportPath,
      evidence: ['live_people_sweep_returned_candidates'],
    };
  }

  return {
    status: companyResolution.status,
    confidence: companyResolution.confidence,
    recommendedAction: needsCompanyResolution
      ? 'resolve_company_targets_then_retry'
      : companyResolution.recommendedAction,
    selectedTargets,
    artifactPath: companyResolutionArtifact.artifactPath,
    reportPath: companyResolutionArtifact.reportPath,
  };
}

function classifyCoverageBucket(candidate, config) {
  const roleFamily = candidate.roleFamily || 'unknown';
  const rules = config?.bucketRules || {};
  const directFamilies = new Set(rules.directObservabilityRoleFamilies || []);
  const adjacentFamilies = new Set(rules.adjacentRoleFamilies || []);

  if (directFamilies.has(roleFamily)) {
    return 'direct_observability';
  }

  if (adjacentFamilies.has(roleFamily)) {
    return 'technical_adjacent';
  }

  if ((candidate.score || 0) > 0 && roleFamily !== 'unknown') {
    return 'broad_it_stakeholder';
  }

  return 'likely_noise';
}

function classifyReviewedCoverageBucket(candidate, config) {
  const roleFamily = candidate.roleFamily || 'unknown';
  const signalCount = (
    (candidate.scoreBreakdown?.observabilitySignals?.length || 0)
    + (candidate.scoreBreakdown?.championSignals?.length || 0)
    + (candidate.scoreBreakdown?.profileReviewSignals?.length || 0)
  );

  if (classifyCoverageBucket(candidate, config) === 'direct_observability') {
    return 'direct_observability';
  }

  if (signalCount >= 3 && (candidate.score || 0) >= 35) {
    return 'direct_observability';
  }

  if (
    classifyCoverageBucket(candidate, config) === 'technical_adjacent'
    || signalCount >= 1
    || (candidate.score || 0) >= 30
  ) {
    return 'technical_adjacent';
  }

  return 'likely_noise';
}

function selectDeepReviewCandidates(coverageResult, limit = 8) {
  const titleHints = /(data|technology|integration|engineer|software|system|platform|cloud|infrastructure|architecture|project|operations)/i;
  const bucketRank = {
    technical_adjacent: 0,
    likely_noise: 1,
    direct_observability: 2,
    broad_it_stakeholder: 3,
  };

  return (coverageResult?.candidates || [])
    .filter((candidate) =>
      ['technical_adjacent', 'likely_noise'].includes(candidate.coverageBucket)
      && titleHints.test(candidate.title || ''))
    .sort((left, right) => {
      const bucketDiff = (bucketRank[left.coverageBucket] ?? 9) - (bucketRank[right.coverageBucket] ?? 9);
      if (bucketDiff !== 0) {
        return bucketDiff;
      }
      return (right.score || 0) - (left.score || 0);
    })
    .slice(0, Math.max(1, limit));
}

function applyDeepReviewResult(candidate, rescored, priorityModel, reviewedBucket, evidence) {
  const previousBucket = candidate.coverageBucket;
  const previousScore = candidate.score;

  return {
    ...candidate,
    score: rescored.score,
    roleFamily: rescored.roleFamily,
    seniority: rescored.seniority,
    scoreBreakdown: rescored.breakdown,
    priorityModel,
    coverageBucket: reviewedBucket,
    deepReview: {
      reviewedAt: new Date().toISOString(),
      previousBucket,
      reviewedBucket,
      previousScore,
      reviewedScore: rescored.score,
      changed: previousBucket !== reviewedBucket || previousScore !== rescored.score,
      snippet: String(evidence?.snippet || '').slice(0, 500),
    },
  };
}

function consolidateCoverageCandidates(rawResults, { icpConfig, priorityModel, coverageConfig, accountName }) {
  const byKey = new Map();

  for (const result of rawResults || []) {
    for (const candidate of result.candidates || []) {
      const key = normalizeCandidateKey(candidate);
      if (!byKey.has(key)) {
        const score = scoreCandidate(candidate, icpConfig);
        const priority = priorityModel ? scoreCandidateWithPriorityModel(candidate, priorityModel) : null;
        byKey.set(key, {
          fullName: candidate.fullName,
          title: candidate.title,
          company: candidate.company,
          location: candidate.location,
          profileUrl: candidate.profileUrl || null,
          salesNavigatorUrl: candidate.salesNavigatorUrl || null,
          headline: candidate.headline || null,
          summary: candidate.summary || null,
          outOfNetwork: Boolean(candidate.outOfNetwork),
          networkDistance: candidate.networkDistance || null,
          sweeps: [result.templateId],
          roleFamily: score.roleFamily,
          seniority: score.seniority,
          score: score.score,
          scoreBreakdown: score.breakdown,
          priorityModel: priority,
          coverageBucket: classifyCoverageBucket({
            roleFamily: score.roleFamily,
            score: score.score,
          }, coverageConfig),
        });
      } else {
        const existing = byKey.get(key);
        if (!existing.sweeps.includes(result.templateId)) {
          existing.sweeps.push(result.templateId);
        }
      }
    }
  }

  const candidates = [...byKey.values()].sort((left, right) => {
    const rightPriority = right.priorityModel?.priorityScore || 0;
    const leftPriority = left.priorityModel?.priorityScore || 0;
    if (rightPriority !== leftPriority) {
      return rightPriority - leftPriority;
    }
    return (right.score || 0) - (left.score || 0);
  });

  const coverage = buildCoverageSummary({
    runAccounts: [{
      runId: 'account-coverage',
      accountKey: `coverage:${accountName}`,
      name: accountName,
      listName: null,
    }],
    candidates: candidates.map((candidate, index) => ({
      candidateId: candidate.salesNavigatorUrl || candidate.profileUrl || `coverage-${index}`,
      accountKey: `coverage:${accountName}`,
      fullName: candidate.fullName,
      title: candidate.title,
      score: candidate.score,
      roleFamily: candidate.roleFamily,
      scoreBreakdown: {
        priorityModel: candidate.priorityModel || null,
      },
    })),
    buyerGroupRoles: priorityModel?.buyerGroupRoles || {},
  })[0] || null;

  return {
    accountName,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidates,
    coverage,
  };
}

function summarizeCoverageBuckets(candidates) {
  const counts = {
    direct_observability: 0,
    technical_adjacent: 0,
    broad_it_stakeholder: 0,
    likely_noise: 0,
  };

  for (const candidate of candidates || []) {
    const bucket = candidate.coverageBucket || 'likely_noise';
    counts[bucket] = (counts[bucket] || 0) + 1;
  }

  return counts;
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

async function runAccountCoverageWorkflow({
  driver,
  accountName,
  peopleSearchUrl = 'https://www.linkedin.com/sales/search/people?viewAllFilters=true',
  accountListName = null,
  coverageConfig,
  icpConfig,
  priorityModel,
  maxCandidates = null,
  speedProfile = 'balanced',
  adaptiveSweepPruning = false,
  reuseSweepCache = false,
  sweepCacheDir = DEFAULT_SWEEP_CACHE_DIR,
  runId = 'account-coverage',
  accountSource = 'manual',
  interSweepDelayMs = 0,
  logger = null,
  now = Date.now,
}) {
  const normalizedSpeedProfile = normalizeSpeedProfile(speedProfile);
  const timings = createRunTimings(now);
  const adaptivePruningRequested = Boolean(adaptiveSweepPruning);
  const adaptivePruningActive = adaptivePruningRequested && normalizedSpeedProfile !== 'exhaustive';
  const pruningThresholds = adaptivePruningActive ? getAdaptivePruningThresholds(normalizedSpeedProfile) : null;
  const templates = buildSweepTemplates(coverageConfig, maxCandidates, {
    speedProfile: normalizedSpeedProfile,
    adaptiveSweepPruning: adaptivePruningRequested && normalizedSpeedProfile === 'fast',
  });
  const aliasConfig = loadAccountAliasConfig();
  const aliasEntry = findAccountAliasEntry(aliasConfig, accountName);
  const priorCoverage = loadExistingAccountCoverageArtifact(accountName);
  const companyResolution = await timePhase(timings, 'company_resolution', async () => buildCompanyResolution({
    accountName,
    source: accountSource,
    aliasConfig,
    priorCoverage,
  }), { now });
  const companyResolutionArtifact = await timePhase(timings, 'company_resolution_artifact', async () =>
    writeCompanyResolutionArtifact(companyResolution), { now });
  const account = {
    accountId: `coverage-${String(accountName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: accountName,
    salesNav: {
      peopleSearchUrl,
      ...(aliasEntry.accountSearchAliases ? { accountSearchAliases: aliasEntry.accountSearchAliases } : {}),
      ...(aliasEntry.companyFilterAliases ? { companyFilterAliases: aliasEntry.companyFilterAliases } : {}),
      ...(aliasEntry.linkedinCompanyUrls ? { linkedinCompanyUrls: aliasEntry.linkedinCompanyUrls } : {}),
      ...(companyResolution.targets?.length ? { companyTargets: companyResolution.targets } : {}),
      companyResolution,
      ...(accountListName ? { accountListName } : {}),
    },
  };
  let activeAccount = account;

  const rawResults = [];
  const sweepErrors = [];
  const seenCandidateKeys = new Set();
  const rateLimitEvents = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  await timePhase(timings, 'account_scoping', async () => {
    await driver.openAccountSearch();
    const resolvedAccounts = await driver.enumerateAccounts([account], { runId, accountKey: account.accountId }).catch(() => [account]);
    activeAccount = resolvedAccounts?.[0] || account;
  }, { now });

  let stopSweeps = false;
  const adaptivePruningTelemetry = {
    enabled: adaptivePruningActive,
    triggered: false,
    reason: null,
    skippedTemplates: [],
    executedTemplates: [],
    uniqueCandidatesAddedByTemplate: {},
    thresholds: pruningThresholds
      ? { ...pruningThresholds, profile: normalizedSpeedProfile }
      : null,
    profile: normalizedSpeedProfile,
  };
  const executedUniqueAdds = [];

  function registerSweepAdds(uniqueNew, templateId) {
    adaptivePruningTelemetry.executedTemplates.push(templateId);
    adaptivePruningTelemetry.uniqueCandidatesAddedByTemplate[templateId] = uniqueNew;
    executedUniqueAdds.push(uniqueNew);
  }

  for (let templateIndex = 0; templateIndex < templates.length; templateIndex += 1) {
    if (stopSweeps) {
      break;
    }
    const template = templates[templateIndex];

    if (
      shouldAdaptiveSkipRestSweep({
        template,
        thresholds: pruningThresholds,
        adaptiveEnabled: adaptivePruningActive,
        executedUniqueAdds,
        templates,
        templateIndex,
      })
    ) {
      adaptivePruningTelemetry.skippedTemplates.push(template.id);
      adaptivePruningTelemetry.triggered = true;
      adaptivePruningTelemetry.reason = adaptivePruningTelemetry.reason || 'low_yield_recent_window';
      continue;
    }

    const cacheKey = buildSweepCacheKey({
      account: activeAccount,
      accountName,
      template,
      coverageConfigVersion: coverageConfig?.version || coverageConfig?.name || 'default',
    });
    const cacheHit = reuseSweepCache ? readSweepCache(sweepCacheDir, cacheKey) : null;
    if (cacheHit && Array.isArray(cacheHit.candidates)) {
      cacheHits += 1;
      await timePhase(timings, `sweep:${template.id}`, async () => {
        let uniqueNew = 0;
        rawResults.push({
          templateId: template.id,
          keywords: template.keywords || [],
          candidates: cacheHit.candidates,
          cacheHit: true,
        });
        for (const candidate of cacheHit.candidates) {
          const key = normalizeCandidateKey(candidate);
          if (!seenCandidateKeys.has(key)) {
            uniqueNew += 1;
          }
          seenCandidateKeys.add(key);
        }
        registerSweepAdds(uniqueNew, template.id);
      }, {
        now,
        meta: {
          templateId: template.id,
          cacheHit: true,
          candidateCount: cacheHit.candidates.length,
        },
      });
      continue;
    }
    if (reuseSweepCache) {
      cacheMisses += 1;
    }

    try {
      await timePhase(timings, `sweep:${template.id}`, async () => {
        await driver.openPeopleSearch(activeAccount, { runId, accountKey: activeAccount.accountId || account.accountId });
        await driver.applySearchTemplate(template, { runId, accountKey: account.accountId });
        const candidates = await driver.scrollAndCollectCandidates(activeAccount, template, {
          runId,
          accountKey: activeAccount.accountId || account.accountId,
          seenCandidateKeys,
          seenUrls: seenCandidateKeys,
          logger,
          rateLimitEvents,
          duplicateShortCircuitThreshold: coverageConfig.duplicateShortCircuitThreshold ?? 0.8,
        });
        let uniqueNew = 0;
        rawResults.push({
          templateId: template.id,
          keywords: template.keywords || [],
          candidates,
          cacheHit: false,
        });
        for (const candidate of candidates) {
          const key = normalizeCandidateKey(candidate);
          if (!seenCandidateKeys.has(key)) {
            uniqueNew += 1;
          }
          seenCandidateKeys.add(key);
        }
        registerSweepAdds(uniqueNew, template.id);
        if (reuseSweepCache) {
          writeSweepCache(sweepCacheDir, cacheKey, {
            accountName,
            templateId: template.id,
            keywords: template.keywords || [],
            candidates,
          });
        }
      }, {
        now,
        meta: {
          templateId: template.id,
          cacheHit: false,
        },
      });
    } catch (error) {
      const errorCategory = classifySweepErrorCategory(error);
      sweepErrors.push({
        templateId: template.id,
        message: error.message,
        errorCategory,
      });
      if (errorCategory === 'rate_limited') {
        stopSweeps = true;
      }
      timings.events.push({
        phase: `sweep:${template.id}`,
        templateId: template.id,
        durationMs: 0,
        cacheHit: false,
        candidateCount: 0,
        errorCategory,
      });
      if (logger && typeof logger.warn === 'function') {
        logger.warn(errorCategory === 'rate_limited'
          ? `Sweep ${template.id} rate limited: ${error.message}`
          : `Sweep ${template.id} failed: ${error.message}`);
      }
    }

    if (!stopSweeps && Number(interSweepDelayMs) > 0 && templateIndex < templates.length - 1) {
      await waitForInterSweepDelay(driver, Number(interSweepDelayMs));
    }
  }

  const result = await timePhase(timings, 'scoring', async () => consolidateCoverageCandidates(rawResults, {
    icpConfig,
    priorityModel,
    coverageConfig,
    accountName,
  }), { now });
  const fallbackResult = result.candidateCount === 0
    ? priorCoverage
    : null;
  const sweepFailureSummary = summarizeCoverageSweepErrors({ templates, sweepErrors });
  const needsCompanyResolution = /^all_sweeps_failed/i.test(sweepFailureSummary || '');
  const rateLimited = sweepErrors.some((error) => error.errorCategory === 'rate_limited');
  const finalResult = !rateLimited && fallbackResult && fallbackResult.candidateCount > 0
    ? {
      ...fallbackResult,
      fallback: {
        reason: 'live_coverage_empty',
        reusedAt: new Date().toISOString(),
      },
      ...(sweepErrors.length > 0 ? { sweepErrors } : {}),
    }
    : {
      ...result,
      ...(sweepErrors.length > 0 ? { sweepErrors } : {}),
    };
  finalResult.companyResolution = summarizeCompanyResolutionForCoverage({
    companyResolution,
    companyResolutionArtifact,
    needsCompanyResolution,
    activeAccount,
    accountName,
    finalResult,
    rawResults,
  });
  if (needsCompanyResolution) {
    finalResult.resolutionStatus = 'needs_company_resolution';
  }
  if (rateLimited) {
    finalResult.resolutionStatus = 'rate_limited';
    finalResult.coverageError = 'rate_limited: LinkedIn requested a pause during account sweep';
  }
  if (rateLimitEvents.length > 0 || rateLimited) {
    finalResult.rateLimit = {
      hitCount: rateLimitEvents.length || 1,
      totalBackoffMs: rateLimitEvents.reduce((sum, event) => sum + Number(event.backoffMs || 0), 0),
      recovered: !rateLimited,
    };
  }
  const finalTimings = finishRunTimings(timings, now);
  finalResult.timings = finalTimings;
  finalResult.slowestSweeps = summarizeSlowestSweeps(timings.events);
  finalResult.cacheHits = cacheHits;
  finalResult.cacheMisses = cacheMisses;
  finalResult.speedProfile = normalizedSpeedProfile;
  finalResult.adaptivePruning = adaptivePruningTelemetry;
  const bucketSummary = summarizeCoverageBuckets(finalResult.candidates);

  return {
    account: activeAccount,
    templates,
    sweepErrors,
    result: finalResult,
    bucketSummary,
    timings: finalTimings,
    slowestSweeps: finalResult.slowestSweeps,
    cacheHits,
    cacheMisses,
    speedProfile: normalizedSpeedProfile,
  };
}

async function waitForInterSweepDelay(driver, delayMs) {
  const normalized = Math.max(0, Number(delayMs) || 0);
  if (normalized <= 0) {
    return;
  }
  if (driver?.page && typeof driver.page.waitForTimeout === 'function') {
    await driver.page.waitForTimeout(normalized);
    return;
  }
  if (typeof driver?.waitForInterSweepDelay === 'function') {
    await driver.waitForInterSweepDelay(normalized);
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, normalized);
  });
}

function normalizeSelectionText(value) {
  return String(value || '').toLowerCase();
}

function hasExecutiveTechnologyTitle(candidate) {
  const text = normalizeSelectionText(`${candidate.title || ''} ${candidate.headline || ''}`);
  return /\b(chief information officer|chief technology officer|cio|cto)\b/.test(text);
}

function hasMicroservicesObservabilityTitle(candidate) {
  const text = normalizeSelectionText(candidate.title || '');
  return /microservices?.*(engineer|architect|developer)|(engineer|architect|developer).*microservices?/.test(text);
}

function isManagerOrAbove(seniority) {
  return new Set(['manager', 'head', 'director', 'vp', 'principal']).has(String(seniority || '').toLowerCase());
}

function hasCoreTechnicalAdjacentScope(title) {
  return /\b(cloud|ai|platform|architecture|architect|microservice|microservices)\b/.test(title);
}

function hasEngineeringLeadershipScope(title) {
  return /\b(engineering|technology|technical|platform|cloud|architecture)\b.*\bleadership\b|\bleadership\b.*\b(engineering|technology|technical|platform|cloud|architecture)\b/.test(title);
}

function isSeniorPlatformLeader(candidate) {
  const seniority = String(candidate.seniority || '').toLowerCase();
  const roleFamily = String(candidate.roleFamily || '').toLowerCase();
  return new Set(['vp', 'director', 'head', 'principal']).has(seniority)
    && new Set([
      'platform_engineering',
      'executive_engineering',
      'devops',
      'site_reliability',
      'infrastructure',
      'software_engineering',
    ]).has(roleFamily);
}

function getHardExclusionReason(candidate, options = {}) {
  const title = normalizeSelectionText(candidate.title || '');
  const roleFamily = String(candidate.roleFamily || '').toLowerCase();
  const excludeRoleFamilies = new Set((options.excludeRoleFamilies || []).map((value) => String(value || '').toLowerCase()));
  const excludeTitleKeywords = (options.excludeTitleKeywords || []).map((value) => String(value || '').toLowerCase().trim()).filter(Boolean);

  if (candidate.outOfNetwork) {
    return 'out_of_network';
  }
  if (excludeRoleFamilies.has(roleFamily)) {
    return 'operator_excluded_role_family';
  }
  if (excludeTitleKeywords.some((keyword) => title.includes(keyword))) {
    return 'operator_excluded_title_keyword';
  }
  if (/\b(hr|human resources|privacy|controlling|einkauf|procurement|finance|financial)\b/.test(title)) {
    return 'non_icp_business_function';
  }
  if (
    roleFamily === 'data'
    && (/\b(bi|business intelligence|analyst)\b/.test(title) || (/\banalytics\b/.test(title) && !/\b(ai|cloud|platform)\b/.test(title)))
  ) {
    return 'data_analytics_not_observability';
  }
  if (roleFamily === 'security' && !/\b(vp|vice president|head of security)\b/.test(title)) {
    return 'security_path_not_primary_icp';
  }
  return null;
}

function summarizeTopScoreComponents(scoreBreakdown, limit = 3) {
  const components = scoreBreakdown?.components || {};
  return Object.entries(components)
    .filter(([, value]) => Number(value) !== 0)
    .map(([component, value]) => ({ component, value: Number(value) }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, limit);
}

function classifyCoverageListSelection(candidate, options = {}) {
  const hardExclusionReason = getHardExclusionReason(candidate, options);
  if (hardExclusionReason) {
    return {
      selected: false,
      reason: hardExclusionReason,
      rank: 0,
    };
  }

  const includeBuckets = new Set(options.includeBuckets || ['direct_observability', 'technical_adjacent']);
  const minScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : 25;
  const title = normalizeSelectionText(candidate.title || '');
  const seniority = String(candidate.seniority || '').toLowerCase();
  const roleFamily = String(candidate.roleFamily || '').toLowerCase();

  if (candidate.coverageBucket === 'direct_observability') {
    return {
      selected: true,
      reason: 'direct_observability_always_include',
      rank: 90,
    };
  }
  if (hasExecutiveTechnologyTitle(candidate)) {
    return {
      selected: true,
      reason: 'executive_cto_cio_always_include',
      rank: 85,
    };
  }
  if (hasMicroservicesObservabilityTitle(candidate)) {
    return {
      selected: true,
      reason: 'microservices_observability_path',
      rank: 86,
    };
  }

  if (candidate.coverageBucket === 'technical_adjacent') {
    if (roleFamily === 'software_engineering') {
      return {
        selected: true,
        reason: 'technical_adjacent_software_engineering',
        rank: 78,
      };
    }
    if (roleFamily === 'executive_engineering') {
      return {
        selected: true,
        reason: 'technical_adjacent_executive_engineering',
        rank: 82,
      };
    }
    if (hasCoreTechnicalAdjacentScope(title)) {
      return {
        selected: true,
        reason: 'technical_adjacent_core_technical_scope',
        rank: 76,
      };
    }
    if (hasEngineeringLeadershipScope(title)) {
      return {
        selected: true,
        reason: 'technical_adjacent_engineering_leadership',
        rank: 74,
      };
    }
    if (isSeniorPlatformLeader(candidate)) {
      return {
        selected: true,
        reason: 'technical_adjacent_senior_platform_leader',
        rank: 80,
      };
    }
    if (/\b(data\s*&\s*ai|ai\s*&\s*cloud|cloud\s*&\s*ai|analytics\s*&\s*cloud|ai\/ml)\b/.test(title)) {
      return {
        selected: true,
        reason: 'technical_adjacent_ai_cloud_compound',
        rank: 70,
      };
    }
    if (/\b(cloud|ai|platform)\b/.test(title) && isManagerOrAbove(seniority)) {
      return {
        selected: true,
        reason: 'technical_adjacent_cloud_ai_platform_leader',
        rank: 75,
      };
    }
  }

  if (
    includeBuckets.has(candidate.coverageBucket)
    && Number(candidate.score || 0) >= minScore
    && roleFamily !== 'unknown'
  ) {
    return {
      selected: true,
      reason: 'score_threshold',
      rank: 40,
    };
  }

  return {
    selected: false,
    reason: includeBuckets.has(candidate.coverageBucket) ? 'below_icp_selection_threshold' : 'bucket_not_included',
    rank: 0,
  };
}

function selectCoverageListCandidates(result, options = {}) {
  return (result?.candidates || [])
    .map((candidate) => {
      const selection = classifyCoverageListSelection(candidate, options);
      return {
        ...candidate,
        listSelectionReason: selection.reason,
        listSelectionRank: selection.rank,
        topScoreComponents: summarizeTopScoreComponents(candidate.scoreBreakdown),
        selectedForList: selection.selected,
      };
    })
    .filter((candidate) => candidate.selectedForList)
    .sort((left, right) => {
      const rankDiff = (right.listSelectionRank || 0) - (left.listSelectionRank || 0);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      const rightPriority = right.priorityModel?.priorityScore || 0;
      const leftPriority = left.priorityModel?.priorityScore || 0;
      if (rightPriority !== leftPriority) {
        return rightPriority - leftPriority;
      }
      return Number(right.score || 0) - Number(left.score || 0);
    });
}

function buildCoverageLanguageSplits(result, options = {}) {
  const selectedCandidates = options.selectedOnly === false
    ? (result?.candidates || [])
    : selectCoverageListCandidates(result, options.selection || {});
  const segment = options.segment || 'prospects';
  const listNames = buildLanguageSplitListNames({
    accountName: result?.accountName || options.accountName || 'Account',
    segment,
    prefix: options.prefix || null,
  });
  const split = splitCandidatesByProfileLanguage(selectedCandidates, {
    primaryLanguage: options.primaryLanguage || 'de',
  });

  return {
    policy: {
      primaryLanguage: options.primaryLanguage || 'de',
      de: 'German profile language',
      en: 'English and other profile languages',
    },
    listNames,
    buckets: {
      de: split.de,
      en: split.en,
    },
    meta: split.meta,
  };
}

function writeAccountCoverageArtifact(accountName, coverageResult) {
  const artifactPath = buildCoverageArtifactPath(accountName);
  writeJson(artifactPath, coverageResult);
  return artifactPath;
}

module.exports = {
  applyDeepReviewResult,
  buildSweepTemplates,
  classifyCoverageBucket,
  classifyReviewedCoverageBucket,
  classifySweepErrorCategory,
  consolidateCoverageCandidates,
  buildCoverageArtifactPath,
  buildCoverageLanguageSplits,
  findAccountAliasEntry,
  loadAccountCoverageConfig,
  loadAccountAliasConfig,
  loadExistingAccountCoverageArtifact,
  loadPriorityModel,
  normalizeAccountAliasKey,
  normalizeCandidateKey,
  normalizeSpeedProfile,
  runAccountCoverageWorkflow,
  selectCoverageListCandidates,
  selectDeepReviewCandidates,
  summarizeCoverageBuckets,
  summarizeCoverageSweepErrors,
  writeAccountCoverageArtifact,
};
