const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildLeadListSnapshotFromArtifact,
  normalizeLeadListName,
} = require('../src/core/lead-list-snapshot');

test('normalizeLeadListName trims and lowercases operator list names', () => {
  assert.equal(normalizeLeadListName('  DD_v3_Test_2026-04-27  '), 'dd_v3_test_2026-04-27');
});

test('buildLeadListSnapshotFromArtifact converts fast-import artifacts into connectable rows', () => {
  const snapshot = buildLeadListSnapshotFromArtifact({
    listName: 'DD_v3_Test_2026-04-27',
    results: [
      {
        fullName: 'Example Saved Lead',
        title: 'Senior Platform Owner',
        accountName: 'Example Semiconductor Co',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/123',
        status: 'saved_and_verified',
      },
      {
        fullName: 'Duplicate Example Saved Lead',
        salesNavigatorUrl: 'https://www.linkedin.com/in/not-sales-nav',
        status: 'saved_and_verified',
      },
      {
        fullName: 'Example Pending Lead',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/456',
        status: 'already_saved_verified',
        note: 'already saved before run',
      },
    ],
  }, {
    artifactPath: '/tmp/dd-v3.json',
  });

  assert.equal(snapshot.source, 'artifact_fallback');
  assert.equal(snapshot.listName, 'DD_v3_Test_2026-04-27');
  assert.equal(snapshot.rows.length, 2);
  assert.deepEqual(snapshot.rows.map((row) => row.fullName), ['Example Saved Lead', 'Example Pending Lead']);
  assert.equal(snapshot.rows[0].noActivity, true);
  assert.equal(snapshot.rows[1].invitationSent, false);
  assert.equal(snapshot.rows[1].noActivity, true);
});

test('buildLeadListSnapshotFromArtifact rejects source artifacts without explicit list names', () => {
  const snapshot = buildLeadListSnapshotFromArtifact({
    leads: [
      {
        fullName: 'Input Only Lead',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/input-only',
      },
    ],
  }, {
    listName: 'Target List',
    artifactPath: '/tmp/input-source.json',
  });

  assert.equal(snapshot, null);
});

test('buildLeadListSnapshotFromArtifact ignores explicit failed import result rows', () => {
  const snapshot = buildLeadListSnapshotFromArtifact({
    listName: 'Retry List',
    results: [
      {
        fullName: 'Saved Lead',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/saved',
        status: 'saved_and_verified',
      },
      {
        fullName: 'Manual Review Lead',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/manual',
        status: 'manual_review',
      },
      {
        fullName: 'Runtime Failed Lead',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/runtime',
        status: 'failed_runtime',
      },
    ],
  }, {
    artifactPath: '/tmp/retry-list.json',
  });

  assert.equal(snapshot.rows.length, 1);
  assert.equal(snapshot.rows[0].fullName, 'Saved Lead');
});
