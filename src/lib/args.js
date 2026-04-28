const { parseArgs } = require('node:util');

function parseCliArgs(argv) {
  const command = argv[2];
  const raw = argv.slice(3);

  const { values, positionals } = parseArgs({
    args: raw,
    allowPositionals: true,
    options: {
      territory: { type: 'string' },
      'territory-id': { type: 'string' },
      'account-name': { type: 'string' },
      'account-names': { type: 'string' },
      accounts: { type: 'string' },
      'account-list': { type: 'string' },
      'list-prefix': { type: 'string' },
      'consolidate-list-name': { type: 'string' },
      'list-name-template': { type: 'string' },
      'pilot-config': { type: 'string' },
      'coverage-config': { type: 'string' },
      artifact: { type: 'string' },
      'review-output': { type: 'string' },
      'people-search-url': { type: 'string' },
      'candidate-url': { type: 'string' },
      'list-name': { type: 'string' },
      names: { type: 'string' },
      'owner-name': { type: 'string' },
      'owner-email': { type: 'string' },
      'stale-days': { type: 'string' },
      'seed-dataset': { type: 'string' },
      'seed-file': { type: 'string' },
      'queue-artifact': { type: 'string' },
      checkpoint: { type: 'string' },
      'retry-checkpoint': { type: 'string' },
      'source-checkpoint': { type: 'string' },
      'coverage-dir': { type: 'string' },
      bucket: { type: 'string' },
      'weekly-cap': { type: 'string' },
      'budget-mode': { type: 'string' },
      'tool-share-percent': { type: 'string' },
      'daily-max': { type: 'string' },
      'daily-min': { type: 'string' },
      mode: { type: 'string' },
      'source-mode': { type: 'string' },
      keywords: { type: 'string' },
      'max-candidates': { type: 'string' },
      'min-score': { type: 'string' },
      'max-list-saves-per-account': { type: 'string' },
      'max-connects-per-account': { type: 'string' },
      'max-retries': { type: 'string' },
      'review-limit': { type: 'string' },
      'wait-minutes': { type: 'string' },
      'account-timeout-ms': { type: 'string' },
      'search-timeout-ms': { type: 'string' },
      'speed-profile': { type: 'string' },
      'research-concurrency': { type: 'string' },
      'reuse-sweep-cache': { type: 'boolean' },
      'max-age-hours': { type: 'string' },
      'skip-session-check': { type: 'boolean' },
      checklist: { type: 'boolean' },
      json: { type: 'boolean' },
      source: { type: 'string' },
      driver: { type: 'string' },
      snapshot: { type: 'string' },
      run: { type: 'string' },
      'run-id': { type: 'string' },
      output: { type: 'string' },
      port: { type: 'string' },
      limit: { type: 'string' },
      dryRun: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      'storage-state': { type: 'string' },
      'user-data-dir': { type: 'string' },
      'browser-harness-command': { type: 'string' },
      'browser-harness-name': { type: 'string' },
      'session-mode': { type: 'string' },
      host: { type: 'string' },
      'recovery-mode': { type: 'string' },
      'headless': { type: 'boolean' },
      'visible': { type: 'boolean' },
      'allow-mutations': { type: 'boolean' },
      'allow-list-create': { type: 'boolean' },
      'allow-background-connects': { type: 'boolean' },
      'live-save': { type: 'boolean' },
      'live-connect': { type: 'boolean' },
      'max-scroll-steps': { type: 'string' },
      'settle-ms': { type: 'string' },
      'max-gb': { type: 'string' },
      'gtm-data-api-path': { type: 'string' },
      sample: { type: 'boolean' },
    },
    strict: false,
  });

  return {
    command,
    values,
    positionals,
  };
}

function getString(values, ...keys) {
  for (const key of keys) {
    if (typeof values[key] === 'string' && values[key].trim()) {
      return values[key].trim();
    }
  }
  return null;
}

function getBoolean(values, ...keys) {
  for (const key of keys) {
    if (typeof values[key] === 'boolean') {
      return values[key];
    }
  }
  return false;
}

module.exports = {
  parseCliArgs,
  getString,
  getBoolean,
};
