const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

test('public release docs exist and explain dry-safe operation', () => {
  const readme = read('README.md');
  const security = read('SECURITY.md');
  const checklist = read('docs/github-release-checklist.md');
  const fastImport = read('docs/fast-list-import.md');
  const runner = read('docs/background-territory-runner.md');

  for (const content of [readme, security, checklist, fastImport, runner]) {
    assert.match(content, /runtime|dry-safe|live-save|Sales Navigator/i);
    assert.doesNotMatch(content, /2026-04-2[234]/);
  }

  assert.match(readme, /Sharing This Repo/);
  assert.match(security, /Do not commit local runtime data/);
  assert.match(checklist, /Lightweight Secret Scan/);
});

test('package scripts keep autoresearch dry-safe and expose release checks', () => {
  const packageJson = readJson('package.json');

  assert.equal(packageJson.scripts.test, 'node --test');
  assert.equal(packageJson.scripts['test:release-readiness'], 'node --test tests/release-readiness.test.js tests/live-readiness.test.js tests/pilot-config.test.js tests/background-list-maintenance.test.js');
  assert.equal(packageJson.scripts['autoresearch:mvp'], 'node src/cli.js autoresearch-mvp');
  assert.doesNotMatch(packageJson.scripts['autoresearch:mvp'], /--live-save|--live-connect|allow-background-connects/);
  assert.equal(packageJson.scripts['autoresearch:speed'], 'node src/cli.js autoresearch-speed-eval');
  assert.doesNotMatch(packageJson.scripts['autoresearch:speed'], /--live-save|--live-connect|allow-background-connects/);
  assert.equal(packageJson.scripts['parallel-account-research'], 'node src/cli.js parallel-account-research');
  assert.doesNotMatch(packageJson.scripts['parallel-account-research'], /--live-save|--live-connect|allow-background-connects/);
  assert.equal(packageJson.scripts['parallel-research:stress'], 'node automation/parallel-research-stress.js');
  assert.doesNotMatch(packageJson.scripts['parallel-research:stress'], /--live-save|--live-connect|allow-background-connects/);
  assert.equal(packageJson.scripts['parallel-research:stack-readiness'], 'node automation/parallel-research-stack-readiness.js');
  assert.doesNotMatch(packageJson.scripts['parallel-research:stack-readiness'], /--live-save|--live-connect|allow-background-connects/);
  assert.equal(packageJson.scripts['print-mvp-operator-dashboard'], 'node src/cli.js print-mvp-operator-dashboard');
});

test('parallel-account-research CLI entry refuses live-save', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, ['src/cli.js', 'parallel-account-research', '--accounts=Example', '--live-save'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.match(`${r.stderr}${r.stdout}`, /refuses live-save/i);
});

test('parallel-account-research CLI is dry-safe plan-only without executing browser jobs', () => {
  const { spawnSync } = require('node:child_process');
  const r = spawnSync(process.execPath, ['src/cli.js', 'parallel-account-research', '--accounts=Example', '--local-concurrency=2'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `${r.stderr}${r.stdout}`);
  const jsonStart = r.stdout.indexOf('{');
  assert.ok(jsonStart >= 0, r.stdout);
  const payload = JSON.parse(r.stdout.slice(jsonStart));
  assert.equal(payload.mode, 'dry-safe');
  assert.equal(payload.browserConcurrency, 1);
  assert.equal(payload.localConcurrency, 2);
  assert.equal(payload.accounts[0].metrics.browserJobsExecuted, 0);
  assert.ok(payload.accounts[0].metrics.cacheMisses > 0);
  assert.equal(payload.accounts[0].browserResults.results.every((row) => row.reason === 'dry_safe_cli_plan_only'), true);
});

test('gitignore keeps local runtime and browser artifacts out of the shared repo', () => {
  const gitignore = read('.gitignore');

  for (const pattern of ['runtime/', '.env', '.env.*', 'playwright-report/', 'test-results/', '*.log']) {
    assert.match(gitignore, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(gitignore, /!\.env\.example/);
});

test('default configs are generic and keep live connects guarded', () => {
  const runner = readJson('config/background-runner/default.json');
  const pilot = readJson('config/pilot/default.json');

  assert.equal(runner.owner.name, 'Example SDR');
  assert.equal(runner.connectPolicy.allowBackgroundConnects, false);
  assert.equal(runner.coverageCache.enabled, true);
  assert.equal(pilot.mode, 'lists-first');
  assert.deepEqual(pilot.connectPolicy.eligibleAccounts, ['Example Connect Eligible Account']);
  assert.ok(Object.hasOwn(pilot.connectPolicy.manualReviewAccounts, 'Example Manual Review Account'));
});

test('automated hybrid mutations do not depend on Browser Harness', () => {
  const hybridDriver = read('src/drivers/hybrid-sales-nav.js');
  const cli = read('src/cli.js');
  const architecture = read('docs/ways-of-working/driver-architecture.md');

  assert.doesNotMatch(hybridDriver, /browser-harness-sales-nav/);
  assert.match(hybridDriver, /this\.mutationDriver = options\.mutationDriver \|\| this\.discoveryDriver/);
  assert.match(cli, /async function handleImportCoverage[\s\S]+const driverName = getString\(values, 'driver'\) \|\| 'playwright'/);
  assert.match(cli, /async function handleFastListImport[\s\S]+const driverName = getString\(values, 'driver'\) \|\| 'playwright'/);
  assert.match(cli, /async function handleConnectLeadList[\s\S]+const driverName = getString\(values, 'driver'\) \|\| 'playwright'/);
  assert.match(architecture, /Browser Harness is a manual diagnostic and repair tool/);
});

test('tracked docs do not include historical handoff or acceptance snapshots', () => {
  const docs = fs.readdirSync(path.join(projectRoot, 'docs'));
  const forbidden = docs.filter((fileName) =>
    /overnight|handoff|mvp-.*2026|pilot-.*2026|sdr-pilot-runbook-2026|weekly-mvp-roadmap-2026/i.test(fileName)
  );

  assert.deepEqual(forbidden, []);
});
