const test = require('node:test');
const assert = require('node:assert/strict');

const { createBrowserActivityGuard } = require('../src/core/browser-activity-guard');

test('browser activity guard allows jobs under budget', async () => {
  let current = 1000;
  const guard = createBrowserActivityGuard({
    profile: 'hermes-balanced',
    maxBrowserJobsPerRun: 2,
    minDelayBetweenBrowserJobsMs: 0,
    now: () => current,
  });

  const first = await guard.runJob('job-1', async () => {
    current += 25;
    return 'ok';
  });

  assert.equal(first.status, 'completed');
  assert.equal(first.value, 'ok');
  assert.equal(guard.summarize().browserJobsExecuted, 1);
  assert.equal(guard.summarize().recommendation, 'continue');
});

test('browser activity guard stops after maxBrowserJobsPerRun', async () => {
  const guard = createBrowserActivityGuard({
    profile: 'hermes-balanced',
    maxBrowserJobsPerRun: 1,
    minDelayBetweenBrowserJobsMs: 0,
  });

  await guard.runJob('job-1', async () => true);
  const second = await guard.runJob('job-2', async () => {
    throw new Error('should not run');
  });

  assert.equal(second.status, 'skipped');
  assert.equal(second.reason, 'skipped_browser_budget_exhausted');
  const summary = guard.summarize();
  assert.equal(summary.browserJobsExecuted, 1);
  assert.equal(summary.browserJobsSkipped, 1);
  assert.equal(summary.recommendation, 'wait_and_retry');
});

test('browser activity guard applies deterministic delay and jitter', async () => {
  let current = 1000;
  let waitedMs = 0;
  const guard = createBrowserActivityGuard({
    profile: 'hermes-balanced',
    minDelayBetweenBrowserJobsMs: 100,
    jitterPct: 0.5,
    random: () => 0.4,
    now: () => current,
    wait: async (ms) => {
      waitedMs += ms;
      current += ms;
    },
  });

  await guard.runJob('job-1', async () => {
    current += 10;
    return true;
  });
  current += 30;
  await guard.runJob('job-2', async () => {
    current += 10;
    return true;
  });

  assert.equal(waitedMs, 84);
  assert.equal(guard.summarize().totalDelayMs, 84);
});

test('browser activity guard records rate limit cooldown stops', async () => {
  let current = 1000;
  const guard = createBrowserActivityGuard({
    profile: 'hermes-balanced',
    cooldownAfterRateLimitMs: 500,
    now: () => current,
  });

  guard.recordRateLimit('job-1', 'too many requests');
  const next = await guard.runJob('job-2', async () => true);

  assert.equal(next.status, 'skipped');
  assert.equal(next.reason, 'skipped_rate_limit_cooldown');
  assert.equal(guard.summarize().rateLimitHitCount, 1);
  assert.equal(guard.summarize().recommendation, 'switch_to_incident');
});

test('incident profile plans browser jobs without execution', async () => {
  const guard = createBrowserActivityGuard({ profile: 'incident' });
  const result = await guard.runJob('job-1', async () => {
    throw new Error('should not run');
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'planned_incident_mode');
  assert.equal(guard.summarize().browserJobsExecuted, 0);
  assert.equal(guard.summarize().recommendation, 'operator_review');
});
