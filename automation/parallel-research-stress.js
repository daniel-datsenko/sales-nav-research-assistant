#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const DEFAULT_ACCOUNTS = ['Example AG', 'Example GmbH', 'Example SE'];
const DEFAULT_LOCAL_CONCURRENCY_VALUES = [1, 2, 4];
const FORBIDDEN_LIVE_FLAGS = new Set([
  '--live-save',
  '--live-connect',
  '--allow-background-connects',
]);

function parseList(value, fallback, optionName = 'value') {
  if (value === undefined || value === null) return [...fallback];
  const parsed = String(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parsed.length === 0) {
    throw new Error(`${optionName} must include at least one value`);
  }
  return parsed;
}

function parseIntegerList(value, fallback, optionName = 'value') {
  if (value === undefined || value === null) return [...fallback];
  const parts = parseList(value, [], optionName);
  const parsed = parts.map((part) => Number.parseInt(part, 10));
  const invalid = parts.find((part, index) => String(parsed[index]) !== part || !Number.isInteger(parsed[index]) || parsed[index] <= 0);
  if (invalid) {
    throw new Error(`${optionName} must contain positive integers; invalid value: ${invalid}`);
  }
  return parsed;
}

function assertNoLiveFlags(args = []) {
  const hit = args.find((arg) => {
    const name = String(arg).split('=')[0];
    return FORBIDDEN_LIVE_FLAGS.has(name);
  });
  if (hit) {
    throw new Error(`parallel research stress harness refuses live or background mutation flags: ${hit}`);
  }
}

function parseCliJsonPayload(stdout) {
  const text = String(stdout || '');
  const start = text.indexOf('{');
  if (start < 0) {
    throw new Error('parallel-account-research output did not contain a JSON payload');
  }
  return JSON.parse(text.slice(start));
}

function buildParallelResearchStressPlan({
  accounts = DEFAULT_ACCOUNTS,
  localConcurrencyValues = DEFAULT_LOCAL_CONCURRENCY_VALUES,
  runIdPrefix = 'stress',
  extraArgs = [],
} = {}) {
  assertNoLiveFlags(extraArgs);
  const normalizedAccounts = Array.isArray(accounts)
    ? accounts.map((account) => String(account).trim()).filter(Boolean)
    : parseList(accounts, DEFAULT_ACCOUNTS, 'accounts');
  const normalizedConcurrency = Array.isArray(localConcurrencyValues)
    ? localConcurrencyValues.map((value) => Number.parseInt(value, 10)).filter((value) => Number.isInteger(value) && value > 0)
    : parseIntegerList(localConcurrencyValues, DEFAULT_LOCAL_CONCURRENCY_VALUES, 'local-concurrency-values');
  if (normalizedAccounts.length === 0) {
    throw new Error('accounts must include at least one value');
  }
  if (normalizedConcurrency.length === 0) {
    throw new Error('local-concurrency-values must include at least one positive integer');
  }
  const accountsArg = normalizedAccounts.join(', ');
  const prefix = String(runIdPrefix || 'stress');
  const runs = normalizedConcurrency.map((localConcurrency) => {
    const runId = `${prefix}-local-${localConcurrency}`;
    return {
      runId,
      localConcurrency,
      args: [
        'src/cli.js',
        'parallel-account-research',
        `--accounts=${accountsArg}`,
        `--local-concurrency=${localConcurrency}`,
        `--run-id=${runId}`,
        ...extraArgs,
      ],
    };
  });
  return {
    accounts: normalizedAccounts,
    accountsArg,
    localConcurrencyValues: normalizedConcurrency,
    runs,
  };
}

function validateParallelResearchStressPayload({ requestedLocalConcurrency, payload }) {
  const failures = [];
  if (!payload || typeof payload !== 'object') failures.push('payload_missing');
  if (payload?.mode !== 'dry-safe') failures.push('mode_not_dry_safe');
  if (payload?.browserConcurrency !== 1) failures.push('browser_concurrency_not_one');
  if (payload?.localConcurrency !== requestedLocalConcurrency) failures.push('local_concurrency_mismatch');
  const accounts = Array.isArray(payload?.accounts) ? payload.accounts : [];
  if (accounts.length === 0) failures.push('accounts_missing');
  let browserJobsExecuted = 0;
  for (const account of accounts) {
    const executed = Number(account?.metrics?.browserJobsExecuted || 0);
    browserJobsExecuted += executed;
    if (executed !== 0) failures.push(`browser_jobs_executed:${account?.accountName || 'unknown'}`);
    const results = account?.browserResults?.results;
    if (Array.isArray(results)) {
      for (const result of results) {
        if (result?.status !== 'skipped' || result?.reason !== 'dry_safe_cli_plan_only') {
          failures.push(`unexpected_browser_result:${account?.accountName || 'unknown'}`);
          break;
        }
      }
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    requestedLocalConcurrency,
    mode: payload?.mode,
    browserConcurrency: payload?.browserConcurrency,
    localConcurrency: payload?.localConcurrency,
    accountCount: accounts.length,
    browserJobsExecuted,
  };
}

function defaultRunner({ args }) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

function runParallelResearchStressHarness({
  accounts = DEFAULT_ACCOUNTS,
  localConcurrencyValues = DEFAULT_LOCAL_CONCURRENCY_VALUES,
  runIdPrefix = 'stress',
  extraArgs = [],
  runner = defaultRunner,
} = {}) {
  assertNoLiveFlags(extraArgs);
  const plan = buildParallelResearchStressPlan({
    accounts,
    localConcurrencyValues,
    runIdPrefix,
    extraArgs,
  });
  const runs = [];
  for (const run of plan.runs) {
    const result = runner({ args: run.args, run });
    const status = Number.isInteger(result?.status) ? result.status : 1;
    const stdout = result?.stdout || '';
    const stderr = result?.stderr || '';
    if (status !== 0) {
      runs.push({
        runId: run.runId,
        localConcurrency: run.localConcurrency,
        ok: false,
        failures: [`exit_status:${status}`],
        stderr,
      });
      continue;
    }
    try {
      const payload = parseCliJsonPayload(stdout);
      const validation = validateParallelResearchStressPayload({
        requestedLocalConcurrency: run.localConcurrency,
        payload,
      });
      runs.push({
        runId: run.runId,
        localConcurrency: run.localConcurrency,
        ...validation,
      });
    } catch (error) {
      runs.push({
        runId: run.runId,
        localConcurrency: run.localConcurrency,
        ok: false,
        failures: [`parse_or_validation_error:${error.message}`],
      });
    }
  }
  return {
    ok: runs.every((run) => run.ok),
    mode: 'dry-safe',
    browserConcurrencyInvariant: 1,
    accounts: plan.accounts,
    localConcurrencyValues: plan.localConcurrencyValues,
    runs,
  };
}

function parseHarnessArgs(argv) {
  assertNoLiveFlags(argv);
  const options = {};
  for (const arg of argv) {
    if (arg.startsWith('--accounts=')) options.accounts = parseList(arg.slice('--accounts='.length), DEFAULT_ACCOUNTS, 'accounts');
    if (arg.startsWith('--local-concurrency-values=')) {
      options.localConcurrencyValues = parseIntegerList(arg.slice('--local-concurrency-values='.length), DEFAULT_LOCAL_CONCURRENCY_VALUES, 'local-concurrency-values');
    }
    if (arg.startsWith('--run-id-prefix=')) options.runIdPrefix = arg.slice('--run-id-prefix='.length);
  }
  return options;
}

if (require.main === module) {
  try {
    const summary = runParallelResearchStressHarness(parseHarnessArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildParallelResearchStressPlan,
  parseCliJsonPayload,
  runParallelResearchStressHarness,
  validateParallelResearchStressPayload,
};
