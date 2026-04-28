const fs = require('node:fs');
const {
  DEFAULT_SESSION_STATE_PATH,
  DEFAULT_BROWSER_PROFILE_DIR,
  resolveProjectPath,
} = require('./paths');
const { getString, getBoolean } = require('./args');

function buildDriverOptions(values, run = null, defaults = {}) {
  const localHarnessCommand = resolveProjectPath('automation', 'browser-harness');
  const sessionMode = getString(values, 'session-mode')
    || defaults.sessionMode
    || 'persistent';
  const userDataDir = getString(values, 'user-data-dir')
    || defaults.userDataDir
    || DEFAULT_BROWSER_PROFILE_DIR;

  const explicitHeadless = Object.prototype.hasOwnProperty.call(values, 'headless');
  const explicitVisible = getBoolean(values, 'visible');
  const headless = explicitVisible
    ? false
    : (explicitHeadless ? getBoolean(values, 'headless') : Boolean(defaults.headless));

  const runDry = run?.dryRun ?? false;
  const allowMutations = getBoolean(values, 'allow-mutations') || !runDry;

  return {
    storageState: getString(values, 'storage-state') || defaults.storageState || DEFAULT_SESSION_STATE_PATH,
    userDataDir,
    harnessCommand: getString(values, 'browser-harness-command')
      || defaults.harnessCommand
      || process.env.BROWSER_HARNESS_COMMAND
      || (fs.existsSync(localHarnessCommand) ? localHarnessCommand : null)
      || 'browser-harness',
    browserHarnessName: getString(values, 'browser-harness-name')
      || defaults.browserHarnessName
      || 'sales-nav-research-assistant',
    sessionMode,
    headless,
    allowMutations,
    allowListCreate: getBoolean(values, 'allow-list-create'),
    recoveryMode: getString(values, 'recovery-mode') || defaults.recoveryMode || 'screenshot-only',
    dryRun: runDry,
    maxScrollSteps: Number(getString(values, 'max-scroll-steps') || 10),
    settleMs: Number(getString(values, 'settle-ms') || 350),
    rateLimitBackoffMs: Number(getString(values, 'rate-limit-backoff-ms') || defaults.rateLimitBackoffMs || 60000),
  };
}

module.exports = {
  buildDriverOptions,
};
