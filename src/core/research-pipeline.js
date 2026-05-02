const {
  buildSweepTemplates,
  normalizeCandidateKey,
  resolveSweepTemplateOptions,
  selectCoverageListCandidates,
  classifyCoverageBucket,
  classifySweepErrorCategory,
} = require('./account-coverage');
const { scoreCandidate } = require('./scoring');
const { scoreCandidateWithPriorityModel } = require('./priority-score');
const { buildCoverageSummary } = require('./coverage');

function slugFromDisplayName(value) {
  const slug = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unnamed-account';
}

function normalizeResearchAccount(account = {}) {
  const nameSource =
    account.accountName
    ?? account.name
    ?? account.companyName
    ?? '';

  const accountName = String(nameSource).trim();
  const hasAccountId =
    account.accountId != null && String(account.accountId).trim() !== '';
  const accountKey = hasAccountId
    ? String(account.accountId).trim()
    : slugFromDisplayName(accountName);

  const resolvedName = accountName || accountKey;

  return {
    ...account,
    accountKey,
    accountName: resolvedName,
  };
}

function buildResearchQueue({ accounts = [], runId, generatedAt } = {}) {
  const normalized = accounts.map((a) => normalizeResearchAccount(a));
  normalized.sort((a, b) => a.accountKey.localeCompare(b.accountKey));

  return {
    version: '1.0.0',
    runId: runId ?? null,
    generatedAt: generatedAt ?? null,
    mode: 'dry-safe',
    safety: {
      liveSaveAllowed: false,
      liveConnectAllowed: false,
    },
    accounts: normalized,
  };
}

function planResearchJobs({
  queue,
  coverageConfig,
  maxCandidates = null,
  options = {},
} = {}) {
  const accounts = [...(queue?.accounts || [])];
  accounts.sort((a, b) => a.accountKey.localeCompare(b.accountKey));

  const sweepTemplateOptions = resolveSweepTemplateOptions({
    researchMode: options.researchMode,
    speedProfile: options.speedProfile,
    adaptiveSweepPruning: options.adaptiveSweepPruning,
  });
  const templates = buildSweepTemplates(coverageConfig, maxCandidates, sweepTemplateOptions);

  /** @type {Array<Record<string, unknown>>} */
  const jobs = [];

  for (const account of accounts) {
    const { accountKey, accountName } = account;
    jobs.push({
      id: `company-resolution:${accountKey}`,
      type: 'company_resolution',
      accountKey,
      accountName,
      safety: {
        liveSaveAllowed: false,
        liveConnectAllowed: false,
      },
    });
  }

  for (const account of accounts) {
    const { accountKey, accountName } = account;
    for (const template of templates) {
      jobs.push({
        id: `sweep:${accountKey}:${template.id}`,
        type: 'sweep',
        accountKey,
        accountName,
        templateId: template.id,
        keywords: template.keywords ?? [],
        titleIncludes: template.titleIncludes ?? [],
        ...(template.maxCandidates !== undefined
          ? { maxCandidates: template.maxCandidates }
          : {}),
        requiresBrowser: true,
        safety: {
          liveSaveAllowed: false,
          liveConnectAllowed: false,
          companyScopeRequired: true,
        },
      });
    }
  }

  jobs.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return {
    safety: {
      liveSaveAllowed: false,
      liveConnectAllowed: false,
    },
    jobs,
  };
}

/**
 * @param {Array<{ raw: object, sweeps: string[] }>} rows
 * @param {number} localConcurrency
 */
function partitionForLocalConcurrency(rows, localConcurrency) {
  const n = rows.length;
  if (n === 0) return [];
  const k = Math.min(Math.max(1, Number(localConcurrency) || 4), n);
  const buckets = Array.from({ length: k }, () => []);
  rows.forEach((row, index) => {
    buckets[index % k].push(row);
  });
  return buckets;
}

/**
 * Marks sweep jobs with cache hits/misses using injected readCache(job).
 * Malformed reads never throw to callers.
 *
 * @param {{ jobs?: Array<Record<string, unknown>>, readCache?: (job: object) => unknown }} params
 */
async function attachSweepCacheState({ jobs = [], readCache } = {}) {
  const reader = readCache ?? (() => null);
  /** @type {Array<Record<string, unknown>>} */
  const out = [];

  for (const job of jobs) {
    if (job.type !== 'sweep') {
      out.push({ ...job });
      continue;
    }

    let payload = null;
    try {
      payload = await Promise.resolve(reader(job));
    } catch {
      payload = null;
    }

    const candidates = payload?.candidates;
    const isHit = Array.isArray(candidates);

    if (isHit) {
      out.push({
        ...job,
        requiresBrowser: false,
        cacheHit: true,
        cacheCandidates: [...candidates],
      });
    } else {
      out.push({
        ...job,
        cacheHit: false,
        requiresBrowser: job.requiresBrowser !== false,
      });
    }
  }

  return out;
}

/**
 * Runs sweep jobs that still require a browser, serialized through lock.runExclusive.
 *
 * @param {{
 *   jobs?: Array<Record<string, unknown>>,
 *   driver: {
 *     openPeopleSearch: (account: object, context: object) => Promise<void>,
 *     applySearchTemplate: (template: object, context: object) => Promise<void>,
 *     scrollAndCollectCandidates: (account: object, template: object, context: object) => Promise<Array<object>>,
 *   },
 *   lock: { runExclusive: (jobId: string, fn: () => Promise<unknown>) => Promise<unknown> },
 *   runId?: string | null,
 *   stopOnRateLimit?: boolean,
 * }} params
 */
async function executeBrowserSweepJobs({
  jobs = [],
  driver,
  lock,
  runId,
  stopOnRateLimit = true,
} = {}) {
  if (!driver || !lock) {
    throw new Error('executeBrowserSweepJobs requires driver and lock');
  }

  const browserJobs = jobs
    .filter((j) => j.type === 'sweep' && j.requiresBrowser)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  /** @type {Array<Record<string, unknown>>} */
  const results = [];
  let rateLimitHitCount = 0;
  let stopped = false;

  for (const job of browserJobs) {
    if (stopped) {
      results.push({
        jobId: job.id,
        templateId: job.templateId,
        accountKey: job.accountKey,
        cacheHit: false,
        candidates: [],
        status: 'skipped',
        reason: 'stopped_after_rate_limit',
      });
      continue;
    }

    try {
      const sweepCandidates = await lock.runExclusive(String(job.id), async () => {
        const account = {
          accountKey: job.accountKey,
          accountName: job.accountName,
          name: job.accountName,
        };
        const template = {
          id: job.templateId,
          keywords: job.keywords || [],
          titleIncludes: job.titleIncludes || [],
          ...(job.maxCandidates !== undefined ? { maxCandidates: job.maxCandidates } : {}),
        };
        const context = { runId };

        if (
          typeof driver.openPeopleSearch !== 'function'
          || typeof driver.applySearchTemplate !== 'function'
          || typeof driver.scrollAndCollectCandidates !== 'function'
        ) {
          throw new Error(
            'driver must implement openPeopleSearch, applySearchTemplate, scrollAndCollectCandidates',
          );
        }

        await driver.openPeopleSearch(account, context);
        await driver.applySearchTemplate(template, context);
        const collected = await driver.scrollAndCollectCandidates(account, template, context);
        return Array.isArray(collected) ? collected : [];
      });

      results.push({
        jobId: job.id,
        templateId: job.templateId,
        accountKey: job.accountKey,
        cacheHit: false,
        candidates: sweepCandidates,
        status: 'completed',
      });
    } catch (err) {
      const category = classifySweepErrorCategory(err);
      const isRateLimited = category === 'rate_limited';
      if (isRateLimited) {
        rateLimitHitCount += 1;
      }
      results.push({
        jobId: job.id,
        templateId: job.templateId,
        accountKey: job.accountKey,
        cacheHit: false,
        candidates: [],
        status: 'failed',
        errorCategory: category,
        message: String(err?.message || err),
      });
      if (isRateLimited && stopOnRateLimit) {
        stopped = true;
      }
    }
  }

  return {
    runId,
    results,
    rateLimitHitCount,
    browserJobsExecuted: results.filter((r) => r.status === 'completed').length,
  };
}

/**
 * @param {{
 *   accountName?: string,
 *   rawResults?: Array<{ templateId?: string, candidates?: Array<object> }>,
 *   icpConfig?: object,
 *   coverageConfig?: object,
 *   priorityModel?: object | null,
 *   localConcurrency?: number,
 *   researchMode?: string,
 *   speedProfile?: string,
 * }} params
 */
async function scoreResearchCandidates({
  accountName = '',
  rawResults = [],
  icpConfig = {},
  coverageConfig = {},
  priorityModel = null,
  localConcurrency = 4,
} = {}) {
  const sortedResults = [...rawResults].sort((a, b) =>
    String(a.templateId || '').localeCompare(String(b.templateId || '')));

  const byKey = new Map();
  for (const result of sortedResults) {
    const tid = result.templateId;
    for (const candidate of result.candidates || []) {
      const key = normalizeCandidateKey(candidate);
      if (!byKey.has(key)) {
        byKey.set(key, { raw: candidate, sweeps: [tid] });
      } else {
        const existing = byKey.get(key);
        if (!existing.sweeps.includes(tid)) {
          existing.sweeps.push(tid);
        }
      }
    }
  }

  const entries = [...byKey.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const candidatesRaw = sortedResults.reduce(
    (sum, r) => sum + (Array.isArray(r.candidates) ? r.candidates.length : 0),
    0,
  );

  const rowInputs = entries.map(([key, data]) => ({ key, ...data }));
  const buckets = partitionForLocalConcurrency(rowInputs, localConcurrency);

  const scoredChunks = await Promise.all(
    buckets.map((bucket) => Promise.all(
      bucket.map(({ key, raw, sweeps }) => {
        const scored = scoreCandidate(raw, icpConfig);
        const priority = priorityModel
          ? scoreCandidateWithPriorityModel(raw, priorityModel)
          : null;
        return {
          key,
          raw,
          sweeps: [...sweeps].sort(),
          scored,
          priority,
        };
      }),
    )),
  );

  const scoredFlat = scoredChunks.flat().sort((a, b) => a.key.localeCompare(b.key));

  const merged = scoredFlat.map((row) => ({
    fullName: row.raw.fullName,
    title: row.raw.title,
    company: row.raw.company,
    location: row.raw.location,
    profileUrl: row.raw.profileUrl || null,
    salesNavigatorUrl: row.raw.salesNavigatorUrl || null,
    headline: row.raw.headline || null,
    summary: row.raw.summary || null,
    outOfNetwork: Boolean(row.raw.outOfNetwork),
    networkDistance: row.raw.networkDistance || null,
    sweeps: row.sweeps,
    roleFamily: row.scored.roleFamily,
    seniority: row.scored.seniority,
    score: row.scored.score,
    scoreBreakdown: row.scored.breakdown,
    priorityModel: row.priority,
    scoringEligible: row.scored.eligible,
    coverageBucket: classifyCoverageBucket({
      roleFamily: row.scored.roleFamily,
      score: row.scored.score,
    }, coverageConfig),
  }));

  merged.sort((left, right) => {
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
    candidates: merged.map((candidate, index) => ({
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

  const consolidated = {
    accountName,
    generatedAt: new Date().toISOString(),
    candidateCount: merged.length,
    candidates: merged,
    coverage,
  };

  const selectedForList = selectCoverageListCandidates(consolidated, {});
  const selectedKeys = new Set(selectedForList.map((c) => normalizeCandidateKey(c)));

  const rejected = merged.filter((c) => c.scoringEligible === false);
  const manualReviewCount = merged.filter((c) =>
    c.scoringEligible !== false
    && !selectedKeys.has(normalizeCandidateKey(c)),
  ).length;

  return {
    consolidated,
    selectedForList,
    rejected,
    metrics: {
      candidatesRaw,
      candidatesUnique: merged.length,
      selectedForList: selectedForList.length,
      manualReviewCount,
    },
    localConcurrency,
  };
}

function parseTimeMs(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {{
 *   queue?: object,
 *   plannedJobs?: object,
 *   cacheResults?: Array<object> | null,
 *   browserResults?: object | null,
 *   scoringResults?: object | null,
 *   lockTelemetry?: Array<object> | null,
 *   startedAt?: number | string,
 *   finishedAt?: number | string,
 *   localConcurrency?: number,
 * }} params
 */
function buildResearchPipelineArtifact({
  queue,
  plannedJobs,
  cacheResults = null,
  browserResults = null,
  scoringResults = null,
  lockTelemetry = null,
  startedAt,
  finishedAt,
  localConcurrency = 4,
  researchMode = null,
  speedProfile = null,
} = {}) {
  const jobsWithCache = cacheResults ?? plannedJobs?.jobs ?? [];
  const sweepJobs = jobsWithCache.filter((j) => j.type === 'sweep');
  const cacheHits = sweepJobs.filter((j) => j.cacheHit === true).length;
  const cacheMisses = sweepJobs.filter((j) => j.requiresBrowser === true).length;

  const browser = browserResults || {};
  const br = browser.results || [];
  const rateLimitHitCount = Number(browser.rateLimitHitCount || 0);
  const browserJobsExecuted = Number(
    browser.browserJobsExecuted ?? br.filter((r) => r.status === 'completed').length,
  );

  const scoring = scoringResults || {};
  const sm = scoring.metrics || {};

  const startMs = parseTimeMs(startedAt);
  const endMs = parseTimeMs(finishedAt);
  const totalMs = startMs != null && endMs != null ? Math.max(0, endMs - startMs) : 0;

  const metrics = {
    totalMs,
    preBrowserMs: 0,
    browserMs: 0,
    postBrowserMs: 0,
    cacheHits,
    cacheMisses,
    browserJobsExecuted,
    browserJobsSkippedByCache: cacheHits,
    candidatesRaw: Number(sm.candidatesRaw ?? 0),
    candidatesUnique: Number(sm.candidatesUnique ?? 0),
    selectedForList: Number(sm.selectedForList ?? 0),
    manualReviewCount: Number(sm.manualReviewCount ?? 0),
    rateLimitHitCount,
    duplicateWarningRate: Number(sm.duplicateWarningRate ?? 0),
  };

  const pipelineId = queue?.runId
    ? `parallel-research-${queue.runId}`
    : 'parallel-research-unknown';

  return {
    version: '1.0.0',
    pipelineId,
    mode: 'dry-safe',
    accountCount: queue?.accounts?.length ?? 0,
    browserConcurrency: 1,
    localConcurrency,
    researchMode,
    speedProfile,
    status: 'completed',
    metrics,
    researchPipeline: {
      metrics,
    },
    safety: {
      liveSaveAllowed: false,
      liveConnectAllowed: false,
      browserWorkerLock: 'held_serially',
      companyScopeRequired: true,
    },
    lockTelemetry: lockTelemetry ?? null,
    accounts: [],
    queue,
    plannedJobs,
    browserResults: browser,
    scoringResults: scoring,
  };
}

module.exports = {
  attachSweepCacheState,
  buildResearchPipelineArtifact,
  buildResearchQueue,
  executeBrowserSweepJobs,
  normalizeResearchAccount,
  planResearchJobs,
  scoreResearchCandidates,
};
