const DEFAULT_COOLDOWN_MS = 20 * 60 * 1000;
const DEFAULT_WINDOW_MS = 60 * 60 * 1000;

const PROFILE_DEFAULTS = {
  local: {
    profile: 'local',
    maxBrowserJobsPerRun: 60,
    maxBrowserJobsPerWindow: 60,
    windowMs: DEFAULT_WINDOW_MS,
    minDelayBetweenBrowserJobsMs: 3000,
    jitterPct: 0.2,
    maxRateLimitHitsPerRun: 1,
    cooldownAfterRateLimitMs: 10 * 60 * 1000,
    maxDeepProfilePagesPerRun: 20,
  },
  'hermes-balanced': {
    profile: 'hermes-balanced',
    maxBrowserJobsPerRun: 30,
    maxBrowserJobsPerWindow: 30,
    windowMs: DEFAULT_WINDOW_MS,
    minDelayBetweenBrowserJobsMs: 8000,
    jitterPct: 0.35,
    maxRateLimitHitsPerRun: 1,
    cooldownAfterRateLimitMs: DEFAULT_COOLDOWN_MS,
    maxDeepProfilePagesPerRun: 10,
  },
  incident: {
    profile: 'incident',
    maxBrowserJobsPerRun: 0,
    maxBrowserJobsPerWindow: 0,
    windowMs: DEFAULT_WINDOW_MS,
    minDelayBetweenBrowserJobsMs: 0,
    jitterPct: 0,
    maxRateLimitHitsPerRun: 0,
    cooldownAfterRateLimitMs: DEFAULT_COOLDOWN_MS,
    maxDeepProfilePagesPerRun: 0,
  },
};

function normalizeBrowserActivityProfile(value) {
  const profile = String(value || 'hermes-balanced').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PROFILE_DEFAULTS, profile)
    ? profile
    : 'hermes-balanced';
}

function buildBrowserActivityPolicy(options = {}) {
  const profile = normalizeBrowserActivityProfile(options.profile || options.browserActivityProfile);
  const defaults = PROFILE_DEFAULTS[profile];
  return {
    ...defaults,
    maxBrowserJobsPerRun: normalizeNonNegativeNumber(options.maxBrowserJobsPerRun, defaults.maxBrowserJobsPerRun),
    maxBrowserJobsPerWindow: normalizeNonNegativeNumber(options.maxBrowserJobsPerWindow, defaults.maxBrowserJobsPerWindow),
    windowMs: normalizeNonNegativeNumber(options.windowMs, defaults.windowMs),
    minDelayBetweenBrowserJobsMs: normalizeNonNegativeNumber(options.minDelayBetweenBrowserJobsMs, defaults.minDelayBetweenBrowserJobsMs),
    jitterPct: normalizeNonNegativeNumber(options.jitterPct, defaults.jitterPct),
    maxRateLimitHitsPerRun: normalizeNonNegativeNumber(options.maxRateLimitHitsPerRun, defaults.maxRateLimitHitsPerRun),
    cooldownAfterRateLimitMs: normalizeNonNegativeNumber(options.cooldownAfterRateLimitMs, defaults.cooldownAfterRateLimitMs),
    maxDeepProfilePagesPerRun: normalizeNonNegativeNumber(options.maxDeepProfilePagesPerRun, defaults.maxDeepProfilePagesPerRun),
  };
}

function createBrowserActivityGuard(options = {}) {
  const policy = buildBrowserActivityPolicy(options);
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const wait = typeof options.wait === 'function'
    ? options.wait
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const events = [];
  const completedAt = [];
  let browserJobsExecuted = 0;
  let browserJobsSkipped = 0;
  let rateLimitHitCount = 0;
  let totalDelayMs = 0;
  let cooldownUntil = 0;
  let lastBrowserJobFinishedAt = null;
  let stopReason = null;

  function getWindowExecutionCount(at = now()) {
    const cutoff = at - policy.windowMs;
    return completedAt.filter((timestamp) => timestamp >= cutoff).length;
  }

  function getSkipReason(at = now()) {
    if (policy.profile === 'incident') {
      return 'planned_incident_mode';
    }
    if (cooldownUntil > at) {
      return 'skipped_rate_limit_cooldown';
    }
    if (browserJobsExecuted >= policy.maxBrowserJobsPerRun) {
      return 'skipped_browser_budget_exhausted';
    }
    if (getWindowExecutionCount(at) >= policy.maxBrowserJobsPerWindow) {
      return 'skipped_browser_budget_exhausted';
    }
    if (rateLimitHitCount >= policy.maxRateLimitHitsPerRun && policy.maxRateLimitHitsPerRun >= 0) {
      return 'skipped_rate_limit_cooldown';
    }
    return null;
  }

  function buildDelayMs(at = now()) {
    if (lastBrowserJobFinishedAt == null || policy.minDelayBetweenBrowserJobsMs <= 0) {
      return 0;
    }
    const elapsed = Math.max(0, at - lastBrowserJobFinishedAt);
    const baseDelay = Math.max(0, policy.minDelayBetweenBrowserJobsMs - elapsed);
    if (baseDelay <= 0) {
      return 0;
    }
    const jitter = Math.round(baseDelay * policy.jitterPct * random());
    return baseDelay + jitter;
  }

  async function runJob(jobId, fn, meta = {}) {
    const at = now();
    const skipReason = getSkipReason(at);
    if (skipReason) {
      browserJobsSkipped += 1;
      stopReason = stopReason || skipReason;
      const event = {
        jobId,
        jobType: meta.jobType || null,
        status: 'skipped',
        reason: skipReason,
        startedAt: at,
        finishedAt: at,
        delayMs: 0,
      };
      events.push(event);
      return { status: 'skipped', reason: skipReason, event };
    }

    const delayMs = buildDelayMs(at);
    if (delayMs > 0) {
      totalDelayMs += delayMs;
      await wait(delayMs);
    }

    const startedAt = now();
    let status = 'completed';
    try {
      const value = await fn();
      browserJobsExecuted += 1;
      const finishedAt = now();
      lastBrowserJobFinishedAt = finishedAt;
      completedAt.push(finishedAt);
      const event = {
        jobId,
        jobType: meta.jobType || null,
        status,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        delayMs,
      };
      events.push(event);
      return { status, value, event };
    } catch (error) {
      status = 'failed';
      const finishedAt = now();
      lastBrowserJobFinishedAt = finishedAt;
      const event = {
        jobId,
        jobType: meta.jobType || null,
        status,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        delayMs,
        message: String(error?.message || error),
      };
      events.push(event);
      throw error;
    }
  }

  function recordRateLimit(jobId, message = null) {
    rateLimitHitCount += 1;
    cooldownUntil = Math.max(cooldownUntil, now() + policy.cooldownAfterRateLimitMs);
    stopReason = 'skipped_rate_limit_cooldown';
    events.push({
      jobId,
      jobType: 'rate_limit',
      status: 'rate_limited',
      reason: 'skipped_rate_limit_cooldown',
      detectedAt: now(),
      cooldownUntil,
      message: message ? String(message).slice(0, 500) : null,
    });
  }

  function summarize() {
    const recommendation = deriveRecommendation({
      profile: policy.profile,
      stopReason,
      rateLimitHitCount,
      browserJobsSkipped,
    });
    return {
      profile: policy.profile,
      policy,
      browserJobsExecuted,
      browserJobsSkipped,
      rateLimitHitCount,
      totalDelayMs,
      cooldownUntil: cooldownUntil || null,
      stopReason,
      recommendation,
      events: [...events],
    };
  }

  return {
    policy,
    runJob,
    recordRateLimit,
    summarize,
  };
}

function deriveRecommendation({ profile, stopReason, rateLimitHitCount, browserJobsSkipped }) {
  if (profile === 'incident') {
    return 'operator_review';
  }
  if (rateLimitHitCount > 0 || stopReason === 'skipped_rate_limit_cooldown') {
    return 'switch_to_incident';
  }
  if (stopReason === 'skipped_browser_budget_exhausted' || browserJobsSkipped > 0) {
    return 'wait_and_retry';
  }
  return 'continue';
}

function normalizeNonNegativeNumber(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

module.exports = {
  buildBrowserActivityPolicy,
  createBrowserActivityGuard,
  normalizeBrowserActivityProfile,
};
