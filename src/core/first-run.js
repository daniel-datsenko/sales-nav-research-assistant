const fs = require('node:fs');
const path = require('node:path');
const { ROOT_DIR, RUNTIME_DIR, DEFAULT_BROWSER_PROFILE_DIR, DEFAULT_SESSION_STATE_PATH } = require('../lib/paths');

const MIN_NODE_MAJOR = 22;

function parseNodeMajor(version = process.version) {
  const match = String(version).match(/^v?(\d+)/);
  return match ? Number(match[1]) : 0;
}

function exists(relativePath) {
  return fs.existsSync(path.join(ROOT_DIR, relativePath));
}

function buildFirstRunChecklist({ nodeVersion = process.version } = {}) {
  const nodeMajor = parseNodeMajor(nodeVersion);
  const hasPackageJson = exists('package.json');
  const hasNodeModules = exists('node_modules/playwright');
  const hasEnvExample = exists('.env.example');
  const hasEnv = exists('.env');
  const hasRuntime = fs.existsSync(RUNTIME_DIR);
  const hasBrowserProfile = fs.existsSync(DEFAULT_BROWSER_PROFILE_DIR);
  const hasStorageState = fs.existsSync(DEFAULT_SESSION_STATE_PATH);

  const checks = [
    {
      id: 'repo',
      label: 'Repository files',
      ok: hasPackageJson,
      status: hasPackageJson ? 'ok' : 'missing',
      next: hasPackageJson ? 'Repo is loaded.' : 'Clone the repository first.',
    },
    {
      id: 'node',
      label: `Node.js ${MIN_NODE_MAJOR}+`,
      ok: nodeMajor >= MIN_NODE_MAJOR,
      status: nodeMajor >= MIN_NODE_MAJOR ? 'ok' : 'missing',
      next: nodeMajor >= MIN_NODE_MAJOR
        ? `Detected ${nodeVersion}.`
        : `Install Node.js ${MIN_NODE_MAJOR}+ before running the tool.`,
    },
    {
      id: 'dependencies',
      label: 'NPM dependencies',
      ok: hasNodeModules,
      status: hasNodeModules ? 'ok' : 'missing',
      next: hasNodeModules ? 'Dependencies are installed.' : 'Run `npm install`.',
    },
    {
      id: 'env',
      label: 'Local environment file',
      ok: hasEnv || hasEnvExample,
      status: hasEnv ? 'ok' : 'optional',
      next: hasEnv
        ? '.env exists locally.'
        : 'Copy `.env.example` to `.env` only if you need Salesforce/BigQuery/live integrations.',
    },
    {
      id: 'runtime',
      label: 'Local runtime folder',
      ok: hasRuntime,
      status: hasRuntime ? 'ok' : 'missing',
      next: hasRuntime ? 'runtime/ exists and is ignored by Git.' : 'It will be created automatically by the first command.',
    },
    {
      id: 'linkedin-session',
      label: 'LinkedIn/Sales Navigator login',
      ok: hasBrowserProfile || hasStorageState,
      status: hasBrowserProfile || hasStorageState ? 'check' : 'missing',
      next: hasBrowserProfile || hasStorageState
        ? 'Run `npm run check-driver-session -- --driver=playwright --session-mode=persistent` to verify authentication.'
        : 'Run `npm run bootstrap-session -- --driver=playwright --wait-minutes=10` and log in visibly.',
    },
  ];

  const missingRequired = checks.filter((check) => check.status === 'missing' && check.id !== 'runtime');
  const readyForDrySafe = hasPackageJson && nodeMajor >= MIN_NODE_MAJOR && hasNodeModules;
  const readyForLiveSalesNav = readyForDrySafe && (hasBrowserProfile || hasStorageState);

  return {
    title: 'Sales Navigator Research Assistant first-run check',
    nodeVersion,
    readyForDrySafe,
    readyForLiveSalesNav,
    checks,
    missingRequired: missingRequired.map((check) => check.id),
    nextCommand: !hasNodeModules
      ? 'npm install'
      : !(hasBrowserProfile || hasStorageState)
        ? 'npm run bootstrap-session -- --driver=playwright --wait-minutes=10'
        : 'npm run check-driver-session -- --driver=playwright --session-mode=persistent',
  };
}

function renderFirstRunOnboarding(checklist = buildFirstRunChecklist()) {
  const lines = [];
  lines.push('# Sales Navigator Research Assistant');
  lines.push('');
  lines.push('You are setting up a supervised Sales Navigator research assistant. It controls a real browser locally, keeps runtime/session data out of Git, and defaults to dry-safe research unless you explicitly run live-save or live-connect commands.');
  lines.push('');
  lines.push('## Local Readiness');
  lines.push('');
  for (const check of checklist.checks) {
    const marker = check.status === 'ok' ? '[ok]' : check.status === 'check' ? '[check]' : check.status === 'optional' ? '[optional]' : '[missing]';
    lines.push(`- ${marker} ${check.label}: ${check.next}`);
  }
  lines.push('');
  lines.push('## What I Should Do First');
  lines.push('');
  if (!checklist.readyForDrySafe) {
    lines.push('1. Install the local prerequisites and dependencies.');
    lines.push('2. Run the test suite before using any browser-backed workflow.');
  } else if (!checklist.readyForLiveSalesNav) {
    lines.push('1. Dry-safe research can run now.');
    lines.push('2. To write to a real Sales Navigator list, bootstrap a visible LinkedIn/Sales Navigator session first.');
  } else {
    lines.push('1. Verify the browser session.');
    lines.push('2. Start with dry-safe research or list planning.');
  }
  lines.push('');
  lines.push('Recommended next command:');
  lines.push('');
  lines.push('```bash');
  lines.push(checklist.nextCommand);
  lines.push('```');
  lines.push('');
  lines.push('If the repo is not installed or LinkedIn is not logged in yet, offer two safe paths:');
  lines.push('');
  lines.push('- A) Produce a research Markdown/calling-list artifact now; Sales Navigator push happens after setup.');
  lines.push('- B) Finish tool setup first (`npm install`, tests, `bootstrap-session`), then run the browser-backed workflow.');
  lines.push('');
  lines.push('Do not run live-save or live-connect until the operator explicitly asks for it and the dry-safe output has been reviewed.');
  return `${lines.join('\n')}\n`;
}

module.exports = {
  MIN_NODE_MAJOR,
  parseNodeMajor,
  buildFirstRunChecklist,
  renderFirstRunOnboarding,
};
