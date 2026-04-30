const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildParallelResearchStressPlan,
  parseCliJsonPayload,
  runParallelResearchStressHarness,
  validateParallelResearchStressPayload,
} = require('../automation/parallel-research-stress');

test('parseCliJsonPayload extracts JSON after human cli log lines', () => {
  const payload = parseCliJsonPayload('[cli] parallel-account-research: browserConcurrency=1\n{"mode":"dry-safe","accounts":[]}\n');
  assert.deepEqual(payload, { mode: 'dry-safe', accounts: [] });
});

test('buildParallelResearchStressPlan uses deterministic dry-safe defaults', () => {
  const plan = buildParallelResearchStressPlan({
    accounts: ['Example AG', 'Example GmbH'],
    localConcurrencyValues: [1, 2],
    runIdPrefix: 'stress',
  });

  assert.deepEqual(plan.localConcurrencyValues, [1, 2]);
  assert.equal(plan.accountsArg, 'Example AG, Example GmbH');
  assert.deepEqual(plan.runs.map((r) => r.runId), ['stress-local-1', 'stress-local-2']);
  assert.deepEqual(plan.runs[0].args, [
    'src/cli.js',
    'parallel-account-research',
    '--accounts=Example AG, Example GmbH',
    '--local-concurrency=1',
    '--run-id=stress-local-1',
  ]);
});

test('validateParallelResearchStressPayload enforces dry-safe browser invariants', () => {
  const result = validateParallelResearchStressPayload({
    requestedLocalConcurrency: 2,
    payload: {
      mode: 'dry-safe',
      browserConcurrency: 1,
      localConcurrency: 2,
      accounts: [
        {
          accountName: 'Example AG',
          metrics: { browserJobsExecuted: 0 },
          browserResults: {
            results: [{ status: 'skipped', reason: 'dry_safe_cli_plan_only' }],
          },
        },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.accountCount, 1);
  assert.equal(result.browserJobsExecuted, 0);
});

test('runParallelResearchStressHarness executes matrix and returns machine-readable summary', () => {
  const commands = [];
  const summary = runParallelResearchStressHarness({
    accounts: ['Example AG'],
    localConcurrencyValues: [1, 4],
    runIdPrefix: 'stress',
    runner: ({ args }) => {
      commands.push(args);
      const requested = Number(args.find((arg) => arg.startsWith('--local-concurrency=')).split('=')[1]);
      return {
        status: 0,
        stdout: `[cli] dry-safe log\n${JSON.stringify({
          mode: 'dry-safe',
          browserConcurrency: 1,
          localConcurrency: requested,
          accounts: [{
            accountName: 'Example AG',
            metrics: { browserJobsExecuted: 0 },
            browserResults: { results: [{ status: 'skipped', reason: 'dry_safe_cli_plan_only' }] },
          }],
        })}`,
        stderr: '',
      };
    },
  });

  assert.equal(summary.ok, true);
  assert.deepEqual(summary.localConcurrencyValues, [1, 4]);
  assert.deepEqual(summary.runs.map((run) => run.ok), [true, true]);
  assert.deepEqual(commands.map((args) => args.includes('--local-concurrency=4')), [false, true]);
});

test('runParallelResearchStressHarness rejects live flags before running anything', () => {
  assert.throws(
    () => runParallelResearchStressHarness({
      accounts: ['Example AG'],
      extraArgs: ['--live-save'],
      runner: () => { throw new Error('runner should not be called'); },
    }),
    /refuses live or background mutation flags/
  );
});

test('runParallelResearchStressHarness rejects invalid explicit stress inputs', () => {
  assert.throws(
    () => runParallelResearchStressHarness({ accounts: [] }),
    /accounts must include at least one value/
  );
  assert.throws(
    () => runParallelResearchStressHarness({ localConcurrencyValues: [0] }),
    /local-concurrency-values must include at least one positive integer/
  );
  assert.throws(
    () => runParallelResearchStressHarness({ localConcurrencyValues: 'abc' }),
    /local-concurrency-values must contain positive integers/
  );
});
