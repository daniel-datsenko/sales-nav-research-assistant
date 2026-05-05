const fs = require('node:fs');
const path = require('node:path');
const { readJson } = require('../lib/json');
const { resolveProjectPath } = require('../lib/paths');
const {
  buildSalesNavigatorLeadIdentity,
  normalizeSalesNavigatorLeadUrl,
} = require('./sales-nav-identity');

const ACCOUNT_BATCH_ARTIFACTS_DIR = resolveProjectPath('runtime/artifacts/account-batches');
const CONFIRMED_SAVED_STATUSES = new Set([
  'saved_and_verified',
  'already_saved_verified',
]);

function normalizeLeadListName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function readLatestLeadListArtifactSnapshot(listName, artifactsDir = ACCOUNT_BATCH_ARTIFACTS_DIR) {
  const normalizedListName = normalizeLeadListName(listName);
  if (!normalizedListName || !fs.existsSync(artifactsDir)) {
    return null;
  }

  const artifacts = fs.readdirSync(artifactsDir)
    .filter((fileName) => fileName.endsWith('.json'))
    .map((fileName) => {
      const artifactPath = path.join(artifactsDir, fileName);
      return {
        artifactPath,
        mtimeMs: fs.statSync(artifactPath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const { artifactPath } of artifacts) {
    const artifact = readJson(artifactPath, null);
    const snapshot = buildLeadListSnapshotFromArtifact(artifact, { artifactPath });
    if (snapshot && normalizeLeadListName(snapshot.listName) === normalizedListName) {
      return snapshot;
    }
  }

  return null;
}

function buildLeadListSnapshotFromArtifact(artifact, { listName = null, artifactPath = null } = {}) {
  if (!artifact || typeof artifact !== 'object') {
    return null;
  }

  const effectiveListName = artifact.listName || artifact.leadListName || artifact.list?.name;
  if (!effectiveListName) {
    return null;
  }

  const rawRows = Array.isArray(artifact.results) && artifact.results.length > 0
    ? artifact.results
    : Array.isArray(artifact.leads)
      ? artifact.leads
      : [];
  const sourceRows = rawRows.filter((row) => (
    !row.status || CONFIRMED_SAVED_STATUSES.has(row.status)
  ));
  const seen = new Set();
  const rows = [];
  for (const row of sourceRows) {
    const salesNavigatorUrl = normalizeSalesNavigatorLeadUrl(row.salesNavigatorUrl || row.profileUrl || row.candidate?.salesNavigatorUrl || null);
    const fullName = row.fullName || row.name || row.candidate?.fullName || null;
    if (!fullName || !salesNavigatorUrl || !/linkedin\.com\/sales\/lead\//i.test(salesNavigatorUrl)) {
      continue;
    }
    const key = `${fullName} ${salesNavigatorUrl}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    const statusText = `${row.status || ''} ${row.note || ''}`;
    rows.push({
      fullName,
      salesNavigatorUrl,
      ...buildSalesNavigatorLeadIdentity({
        ...row,
        salesNavigatorUrl,
        fullName,
      }),
      rowText: [fullName, row.title, row.accountName, row.status, row.note].filter(Boolean).join(' | '),
      invitationSent: /already_sent|invitation sent|connection sent|sent/i.test(statusText),
      connectionSent: /already_connected|connected|vernetzt/i.test(statusText),
      noActivity: !/already_sent|already_connected|sent|connected/i.test(statusText),
      artifactSource: artifactPath,
    });
    seen.add(key);
  }

  if (rows.length === 0) {
    return null;
  }

  return {
    status: 'ok',
    source: 'artifact_fallback',
    listName: effectiveListName,
    listUrl: null,
    artifactPath,
    rows,
  };
}

module.exports = {
  buildLeadListSnapshotFromArtifact,
  normalizeLeadListName,
  readLatestLeadListArtifactSnapshot,
};
