const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildStackReadinessPlan,
  runStackReadinessGate,
  assertNoLiveFlags,
  parseArgs,
} = require('../automation/parallel-research-stack-readiness');

test('buildStackReadinessPlan emits deterministic dry-safe merge gates', () => {
  const plan = buildStackReadinessPlan({
    stressRepeat: 3,
    stressAccounts: ['Example AG', 'Example GmbH'],
    stressLocalConcurrencyValues: [1, 2],
  });

  assert.equal(plan.mode, 'dry-safe');
  assert.equal(plan.stack.length, 5);
  assert.deepEqual(plan.stack.map((entry) => entry.pr), [25, 28, 29, 31, 32]);
  assert.deepEqual(plan.steps.map((step) => step.id), [
    'git-diff-check',
    'release-readiness',
    'full-test-suite',
    'parallel-research-repeat-stress',
    'forbidden-path-scan',
    'secret-value-scan',
    'pr-stack-status',
  ]);
  assert.deepEqual(plan.steps.find((step) => step.id === 'parallel-research-repeat-stress').command, [
    'npm',
    'run',
    '--silent',
    'parallel-research:stress',
    '--',
    '--accounts=Example AG, Example GmbH',
    '--local-concurrency-values=1,2',
    '--repeat=3',
    '--run-id-prefix=stack-readiness',
  ]);
  for (const step of plan.steps) {
    assert.equal(step.mutationPermission, 'none');
    assert.equal(step.drySafe, true);
  }
});

test('assertNoLiveFlags rejects live or background mutation flags before running', () => {
  assert.throws(
    () => assertNoLiveFlags(['npm', 'run', 'parallel-research:stack-readiness', '--', '--live-save']),
    /refuses live or background mutation flags/
  );
});

test('runStackReadinessGate executes every planned command and returns machine-readable summary', () => {
  const calls = [];
  const summary = runStackReadinessGate({
    stressRepeat: 2,
    runner: ({ command, step }) => {
      calls.push({ stepId: step.id, command });
      return { status: 0, stdout: `${step.id}=ok\n`, stderr: '' };
    },
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.mode, 'dry-safe');
  assert.equal(summary.stack.length, 5);
  assert.equal(summary.steps.length, 7);
  assert.deepEqual(summary.steps.map((step) => step.ok), [true, true, true, true, true, true, true]);
  assert.deepEqual(calls.map((call) => call.stepId), [
    'git-diff-check',
    'release-readiness',
    'full-test-suite',
    'parallel-research-repeat-stress',
    'forbidden-path-scan',
    'secret-value-scan',
    'pr-stack-status',
  ]);
});

test('runStackReadinessGate fails closed when any verification command fails', () => {
  const summary = runStackReadinessGate({
    runner: ({ step }) => ({
      status: step.id === 'full-test-suite' ? 1 : 0,
      stdout: '',
      stderr: step.id === 'full-test-suite' ? 'tests failed' : '',
    }),
  });

  assert.equal(summary.ok, false);
  const failed = summary.steps.find((step) => step.id === 'full-test-suite');
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.failures, ['exit_status:1']);
});

test('buildStackReadinessPlan rejects invalid programmatic concurrency values', () => {
  assert.throws(
    () => buildStackReadinessPlan({ stressLocalConcurrencyValues: [1, 'bad', 2] }),
    /stress-local-concurrency-values must be a positive integer/
  );
  assert.throws(
    () => buildStackReadinessPlan({ stressLocalConcurrencyValues: [1, null, 2] }),
    /stress-local-concurrency-values must be a positive integer/
  );
  assert.throws(
    () => buildStackReadinessPlan({ stressLocalConcurrencyValues: [1, undefined, 2] }),
    /stress-local-concurrency-values must be a positive integer/
  );
});

test('parseArgs rejects unknown readiness gate flags instead of silently using defaults', () => {
  assert.throws(
    () => parseArgs(['--stress-repeet=5']),
    /unknown option: --stress-repeet=5/
  );
  assert.throws(
    () => parseArgs(['--stress-repeat', '5']),
    /expected --stress-repeat=<value>/
  );
});

test('stack readiness CLI help prints usage without running verification steps', () => {
  const { spawnSync } = require('node:child_process');
  const path = require('node:path');
  const projectRoot = path.resolve(__dirname, '..');
  const result = spawnSync(process.execPath, ['automation/parallel-research-stack-readiness.js', '--help'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, `${result.stderr}${result.stdout}`);
  assert.match(result.stdout, /Usage: npm run --silent parallel-research:stack-readiness/);
  assert.doesNotMatch(result.stdout, /"steps"/);
});
