const path = require('node:path');
const { expandAccountGraph } = require('./subsidiary');
const { writeJson } = require('../lib/json');
const { TERRITORY_ARTIFACTS_DIR } = require('../lib/paths');

async function syncTerritory({
  adapter,
  repository,
  territoryId,
  sourcePath,
  useSample,
  sourceMode = 'auto',
  subsidiaryExpansion = true,
}) {
  const snapshot = await adapter.loadTerritorySnapshot({ territoryId, sourcePath, useSample, sourceMode });
  const expandedAccounts = expandAccountGraph(snapshot.accounts, { enableBasicExpansion: subsidiaryExpansion });
  const storedSnapshot = {
    ...snapshot,
    accounts: expandedAccounts,
  };

  repository.upsertTerritorySnapshot(storedSnapshot);
  repository.upsertAccounts(expandedAccounts);

  const artifactPath = path.join(TERRITORY_ARTIFACTS_DIR, `${snapshot.snapshotId}.json`);
  writeJson(artifactPath, storedSnapshot);

  return {
    snapshot: storedSnapshot,
    artifactPath,
    accountCount: expandedAccounts.length,
  };
}

module.exports = {
  syncTerritory,
};
