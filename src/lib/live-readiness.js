const fs = require('node:fs');
const path = require('node:path');

function isSalesNavigatorLeadUrl(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  let parsed;
  try {
    const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed.replace(/^\/+/, '')}`;
    parsed = new URL(candidate);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') {
    return false;
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) {
    return false;
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  const match = path.match(/^\/sales\/lead\/([^/]+)$/i);
  return Boolean(match && match[1] && match[1].trim());
}

function inspectSalesforceSecretModel({ sourceMode = 'auto', sourcePath = null, env = process.env }) {
  const resolvedSourcePath = sourcePath ? path.resolve(sourcePath) : null;
  let fileSecretKeys = [];

  if (resolvedSourcePath && fs.existsSync(resolvedSourcePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(resolvedSourcePath, 'utf8'));
      fileSecretKeys = ['accessToken', 'authHeader'].filter((key) => Boolean(parsed?.[key]));
    } catch (error) {
      return {
        status: 'blocker',
        label: 'Salesforce live ingest',
        detail: `Source config could not be parsed: ${error.message}`,
        fileSecretKeys: [],
        liveRequested: sourceMode === 'salesforce-live',
      };
    }
  }

  if (fileSecretKeys.length > 0) {
    return {
      status: 'blocker',
      label: 'Salesforce live ingest',
      detail: `Source config contains forbidden secrets (${fileSecretKeys.join(', ')}). Move them to environment variables.`,
      fileSecretKeys,
      liveRequested: true,
    };
  }

  const hasSnapshotUrl = Boolean(env.SALESFORCE_SNAPSHOT_URL);
  const hasInstanceUrl = Boolean(env.SALESFORCE_INSTANCE_URL);
  const hasAccountQuery = Boolean(env.SALESFORCE_ACCOUNT_QUERY);
  const hasTerritoryQuery = Boolean(env.SALESFORCE_TERRITORY_QUERY);
  const hasEnvSecret = Boolean(env.SALESFORCE_ACCESS_TOKEN || env.SALESFORCE_AUTH_HEADER);
  const liveRequested = sourceMode === 'salesforce-live'
    || hasSnapshotUrl
    || hasInstanceUrl
    || hasAccountQuery
    || hasTerritoryQuery;

  if (!liveRequested) {
    return {
      status: 'warn',
      label: 'Salesforce live ingest',
      detail: 'Live ingest is not configured yet; sample or local JSON fallback remains active.',
      fileSecretKeys: [],
      liveRequested: false,
    };
  }

  if (hasSnapshotUrl && !hasInstanceUrl && !hasAccountQuery) {
    return {
      status: hasEnvSecret ? 'pass' : 'warn',
      label: 'Salesforce live ingest',
      detail: hasEnvSecret
        ? 'Snapshot endpoint is configured and auth comes from environment variables.'
        : 'Snapshot endpoint is configured without explicit env auth. Confirm the endpoint is intentionally protected upstream.',
      fileSecretKeys: [],
      liveRequested: true,
    };
  }

  if (hasInstanceUrl && hasAccountQuery && hasEnvSecret) {
    return {
      status: 'pass',
      label: 'Salesforce live ingest',
      detail: 'Live query mode is configured with environment-backed auth.',
      fileSecretKeys: [],
      liveRequested: true,
    };
  }

  if (hasInstanceUrl || hasAccountQuery || sourceMode === 'salesforce-live') {
    return {
      status: 'blocker',
      label: 'Salesforce live ingest',
      detail: 'Live query mode is incomplete. Provide instance URL, account query, and environment-backed auth before production sync.',
      fileSecretKeys: [],
      liveRequested: true,
    };
  }

  return {
    status: 'warn',
    label: 'Salesforce live ingest',
    detail: 'Live ingest intent is present but configuration is incomplete.',
    fileSecretKeys: [],
    liveRequested: true,
  };
}

function analyzeLiveReadiness({
  values,
  driverOptions,
  sessionHealth = null,
  env = process.env,
}) {
  const checks = [];

  checks.push({
    label: 'Driver runtime mode',
    status: driverOptions.sessionMode === 'persistent' ? 'pass' : 'warn',
    detail: driverOptions.sessionMode === 'persistent'
      ? 'Persistent profile is configured for steady-state runs.'
      : `Session mode is ${driverOptions.sessionMode}; persistent mode is recommended for unattended runs.`,
  });

  checks.push({
    label: 'Recovery artifacts',
    status: driverOptions.recoveryMode === 'screenshot-only' ? 'pass' : 'warn',
    detail: driverOptions.recoveryMode === 'screenshot-only'
      ? 'Recovery stays on screenshot-only, which minimizes sensitive local artifacts.'
      : `Recovery mode is ${driverOptions.recoveryMode}; this writes more sensitive local artifacts than the hardened default.`,
  });

  checks.push({
    label: 'List creation guard',
    status: driverOptions.allowListCreate ? 'warn' : 'pass',
    detail: driverOptions.allowListCreate
      ? 'New list creation is enabled; this widens live mutation scope.'
      : 'New list creation is disabled, so live save stays constrained to existing lists.',
  });

  if (sessionHealth) {
    checks.push({
      label: 'LinkedIn session health',
      status: sessionHealth.ok ? 'pass' : 'blocker',
      detail: sessionHealth.ok
        ? `Session is healthy (${sessionHealth.state}).`
        : `Session is not ready (${sessionHealth.state}). Repair or re-auth is required before a live smoke test.`,
    });
  } else {
    checks.push({
      label: 'LinkedIn session health',
      status: 'warn',
      detail: 'Session was not checked in this run. Use the command without --skip-session-check before a live smoke test.',
    });
  }

  checks.push({
    label: 'Lead URL',
    status: isSalesNavigatorLeadUrl(values['candidate-url']) ? 'pass' : 'blocker',
    detail: isSalesNavigatorLeadUrl(values['candidate-url'])
      ? 'Candidate URL looks like a valid Sales Navigator lead URL.'
      : 'Provide one known-good Sales Navigator lead URL with --candidate-url.',
  });

  checks.push({
    label: 'Target list',
    status: values['list-name'] ? 'pass' : 'blocker',
    detail: values['list-name']
      ? `Target list is specified (${values['list-name']}).`
      : 'Provide one already existing safe target list with --list-name.',
  });

  checks.push({
    label: 'Live save arming',
    status: values['live-save'] ? 'pass' : 'warn',
    detail: values['live-save']
      ? 'Live save is explicitly armed for a real smoke test.'
      : 'Live save is not armed yet. This is safer by default, but the smoke test command will refuse to mutate until --live-save is provided.',
  });

  checks.push(inspectSalesforceSecretModel({
    sourceMode: values['source-mode'] || 'auto',
    sourcePath: values.source || null,
    env,
  }));

  const overall = checks.some((check) => check.status === 'blocker')
    ? 'blocker'
    : checks.some((check) => check.status === 'warn')
      ? 'warn'
      : 'pass';

  return { overall, checks };
}

module.exports = {
  analyzeLiveReadiness,
  inspectSalesforceSecretModel,
  isSalesNavigatorLeadUrl,
};
