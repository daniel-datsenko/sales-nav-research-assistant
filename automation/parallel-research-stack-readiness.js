#!/usr/bin/env node

const { spawnSync } = require('node:child_process');

const DEFAULT_STACK = [
  { pr: 25, title: 'feat: add parallel research pipeline stack', base: 'main', head: 'feat/research-job-planner' },
  { pr: 28, title: 'docs: add multi-agent operating context', base: 'feat/research-job-planner', head: 'docs/agent-operating-context-pr25' },
  { pr: 29, title: 'test: add parallel research stress harness', base: 'docs/agent-operating-context-pr25', head: 'feat/parallel-research-stress-harness' },
  { pr: 31, title: 'test: add repeat mode to parallel research stress harness', base: 'feat/parallel-research-stress-harness', head: 'feat/parallel-research-stress-repeat' },
];

const FORBIDDEN_LIVE_FLAGS = new Set([
  '--live-save',
  '--live-connect',
  '--allow-background-connects',
]);

function assertNoLiveFlags(args = []) {
  const hit = args.find((arg) => FORBIDDEN_LIVE_FLAGS.has(String(arg).split('=')[0]));
  if (hit) {
    throw new Error(`parallel research stack readiness gate refuses live or background mutation flags: ${hit}`);
  }
}

function parsePositiveInteger(value, fallback, optionName) {
  if (value === undefined || value === null) {
    if (fallback !== undefined && fallback !== null) return fallback;
    throw new Error(`${optionName} must be a positive integer`);
  }
  const text = String(value).trim();
  const parsed = Number.parseInt(text, 10);
  if (String(parsed) !== text || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

function parseList(value, fallback, optionName) {
  if (value === undefined || value === null) return [...fallback];
  const parsed = String(value).split(',').map((part) => part.trim()).filter(Boolean);
  if (parsed.length === 0) throw new Error(`${optionName} must include at least one value`);
  return parsed;
}

function parsePositiveIntegerList(value, fallback, optionName) {
  const values = Array.isArray(value) ? value : parseList(value, fallback.map(String), optionName);
  return values.map((entry) => parsePositiveInteger(entry, null, optionName));
}

function buildForbiddenPathScanScript() {
  return `
const { execFileSync } = require('node:child_process');
const forbidden = new RegExp('(^runtime/|(^|/)\\\\.env($|\\\\.)|cookie|cookies|storage-state|profile|screenshots|\\\\.sqlite$|\\\\.db$|package-lock\\\\.json)', 'i');
const paths = execFileSync('git', ['diff', '--name-only', 'origin/main...HEAD'], { encoding: 'utf8' })
  .split(/\\r?\\n/)
  .filter(Boolean);
const hits = paths.filter((path) => forbidden.test(path));
if (hits.length > 0) {
  process.stderr.write('forbidden changed paths: ' + hits.join(', ') + '\\n');
  process.exit(1);
}
process.stdout.write('forbidden_path_scan=ok\\n');
`;
}

function buildSecretValueScanScript() {
  return `
const { execFileSync } = require('node:child_process');
const diff = execFileSync('git', ['diff', 'origin/main...HEAD'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const secretRe = /(authorization:\\s*bearer\\s+|client_secret\\s*[:=]|password\\s*[:=]|cookie\\s*[:=]|token\\s*[:=]\\s*[^\\s` + "`" + `]+)/i;
for (const line of diff.split(/\\r?\\n/)) {
  if (line.startsWith('+') && !line.startsWith('+++') && secretRe.test(line) && !line.includes('[REDACTED]')) {
    process.stderr.write('possible secret in stack diff: ' + line.slice(0, 160) + '\\n');
    process.exit(1);
  }
}
process.stdout.write('stack_secret_scan=ok\\n');
`;
}

function buildPrStackStatusScript(stack) {
  return `
const { execFileSync } = require('node:child_process');
const expected = ${JSON.stringify(stack)};
for (const entry of expected) {
  const raw = execFileSync('gh', ['pr', 'view', String(entry.pr), '--json', 'number,state,mergeable,headRefName,baseRefName,title,url'], { encoding: 'utf8' });
  const pr = JSON.parse(raw);
  const failures = [];
  if (pr.state !== 'OPEN') failures.push('state:' + pr.state);
  if (pr.headRefName !== entry.head) failures.push('head:' + pr.headRefName);
  if (pr.baseRefName !== entry.base) failures.push('base:' + pr.baseRefName);
  if (pr.title !== entry.title) failures.push('title:' + pr.title);
  if (pr.mergeable !== 'MERGEABLE') failures.push('mergeable:' + pr.mergeable);
  if (failures.length > 0) {
    process.stderr.write('PR #' + entry.pr + ' stack metadata mismatch: ' + failures.join(', ') + '\\n');
    process.exit(1);
  }
}
process.stdout.write('pr_stack_status=ok\\n');
`;
}

function buildStackReadinessPlan({
  stressRepeat = 3,
  stressAccounts = ['Example AG', 'Example GmbH'],
  stressLocalConcurrencyValues = [1, 2, 4],
  stack = DEFAULT_STACK,
} = {}) {
  const repeat = parsePositiveInteger(stressRepeat, 3, 'stress-repeat');
  const accounts = Array.isArray(stressAccounts)
    ? stressAccounts.map((account) => String(account).trim()).filter(Boolean)
    : parseList(stressAccounts, ['Example AG', 'Example GmbH'], 'stress-accounts');
  if (accounts.length === 0) throw new Error('stress-accounts must include at least one value');
  const localConcurrencyValues = parsePositiveIntegerList(
    stressLocalConcurrencyValues,
    [1, 2, 4],
    'stress-local-concurrency-values'
  );
  if (localConcurrencyValues.length === 0) throw new Error('stress-local-concurrency-values must include at least one positive integer');

  const steps = [
    {
      id: 'git-diff-check',
      description: 'Reject whitespace and conflict-marker issues in the current diff.',
      command: ['git', 'diff', '--check'],
    },
    {
      id: 'release-readiness',
      description: 'Run release-readiness tests that guard dry-safe defaults and live-mutation flags.',
      command: ['npm', 'run', 'test:release-readiness'],
    },
    {
      id: 'full-test-suite',
      description: 'Run the full deterministic test suite on the stacked branch.',
      command: ['npm', 'test'],
    },
    {
      id: 'parallel-research-repeat-stress',
      description: 'Run dry-safe parallel research stress harness with repeat/flakes coverage.',
      command: [
        'npm',
        'run',
        '--silent',
        'parallel-research:stress',
        '--',
        `--accounts=${accounts.join(', ')}`,
        `--local-concurrency-values=${localConcurrencyValues.join(',')}`,
        `--repeat=${repeat}`,
        '--run-id-prefix=stack-readiness',
      ],
    },
    {
      id: 'forbidden-path-scan',
      description: 'Reject runtime/session/secret-bearing file paths in the stack diff.',
      command: ['node', '-e', buildForbiddenPathScanScript()],
    },
    {
      id: 'secret-value-scan',
      description: 'Reject newly-added credential-like values in the stack diff.',
      command: ['node', '-e', buildSecretValueScanScript()],
    },
    {
      id: 'pr-stack-status',
      description: 'Validate that the expected stacked PRs are open with the expected base/head/title metadata.',
      command: ['node', '-e', buildPrStackStatusScript(stack)],
    },
  ].map((step) => ({ ...step, drySafe: true, mutationPermission: 'none' }));

  return {
    mode: 'dry-safe',
    stack,
    stress: { repeat, accounts, localConcurrencyValues },
    steps,
  };
}

function defaultRunner({ command }) {
  const [bin, ...args] = command;
  return spawnSync(bin, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function runStackReadinessGate(options = {}) {
  assertNoLiveFlags(options.extraArgs || []);
  const plan = buildStackReadinessPlan(options);
  for (const step of plan.steps) assertNoLiveFlags(step.command);

  const steps = [];
  for (const step of plan.steps) {
    const result = (options.runner || defaultRunner)({ command: step.command, step });
    const status = Number.isInteger(result?.status) ? result.status : 1;
    steps.push({
      id: step.id,
      description: step.description,
      drySafe: step.drySafe,
      mutationPermission: step.mutationPermission,
      command: step.command,
      ok: status === 0,
      failures: status === 0 ? [] : [`exit_status:${status}`],
      stdout: result?.stdout || '',
      stderr: result?.stderr || '',
    });
  }

  return {
    ok: steps.every((step) => step.ok),
    mode: plan.mode,
    stack: plan.stack,
    stress: plan.stress,
    steps,
  };
}

function parseArgs(argv) {
  assertNoLiveFlags(argv);
  const options = { extraArgs: argv };
  for (const arg of argv) {
    if (arg === '--help') {
      options.help = true;
      continue;
    }
    if (arg === '--stress-repeat') throw new Error('expected --stress-repeat=<value>');
    if (arg === '--stress-accounts') throw new Error('expected --stress-accounts=<value>');
    if (arg === '--stress-local-concurrency-values') throw new Error('expected --stress-local-concurrency-values=<value>');
    if (arg.startsWith('--stress-repeat=')) {
      options.stressRepeat = parsePositiveInteger(arg.slice('--stress-repeat='.length), 3, 'stress-repeat');
      continue;
    }
    if (arg.startsWith('--stress-accounts=')) {
      options.stressAccounts = parseList(arg.slice('--stress-accounts='.length), ['Example AG', 'Example GmbH'], 'stress-accounts');
      continue;
    }
    if (arg.startsWith('--stress-local-concurrency-values=')) {
      options.stressLocalConcurrencyValues = parsePositiveIntegerList(arg.slice('--stress-local-concurrency-values='.length), [1, 2, 4], 'stress-local-concurrency-values');
      continue;
    }
    if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`);
    throw new Error(`unexpected positional argument: ${arg}`);
  }
  return options;
}

function renderHelp() {
  return `Usage: npm run --silent parallel-research:stack-readiness -- [options]

Dry-safe stack-wide merge-readiness gate for the Parallel Research PR stack.

Options:
  --stress-repeat=<n>                       Repeat count for stress harness (default: 3)
  --stress-accounts=<a,b>                   Accounts for dry-safe stress runs
  --stress-local-concurrency-values=<n,n>   Local concurrency matrix (default: 1,2,4)
  --help                                    Print this help without running the gate

Safety:
  Refuses --live-save, --live-connect, and --allow-background-connects.
`;
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(renderHelp());
    } else {
      const summary = runStackReadinessGate(options);
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      if (!summary.ok) process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  assertNoLiveFlags,
  buildStackReadinessPlan,
  parseArgs,
  renderHelp,
  runStackReadinessGate,
};
