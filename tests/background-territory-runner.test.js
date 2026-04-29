const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBackgroundRunnerDefaults,
  buildBackgroundRunnerSpec,
  estimateDaysSinceActivity,
  mergeBackgroundRunnerSeeds,
  normalizeTerritoryAccountRows,
} = require('../src/core/background-territory-runner');
const config = require('../config/background-runner/default.json');

test('buildBackgroundRunnerDefaults uses supervised SDR stale-account defaults', () => {
  const defaults = buildBackgroundRunnerDefaults(config);

  assert.equal(defaults.owner.name, 'Example SDR');
  assert.equal(defaults.staleAccountPolicy.activityLookbackDays, 60);
  assert.equal(defaults.connectPolicy.budgetPolicy.budgetMode, 'assist');
  assert.equal(defaults.connectPolicy.budgetPolicy.toolSharePercent, 50);
  assert.equal(defaults.seedExpansion.leadLists, true);
  assert.equal(defaults.seedExpansion.accountLists, true);
  assert.equal(defaults.geoFocus.strictInclude, true);
  assert.equal(defaults.coverageCache.maxAgeDays, 7);
  assert.equal(defaults.productiveAccountRules.minListCandidates, 2);
  assert.deepEqual(defaults.listCandidateSelection.includeBuckets, ['direct_observability', 'technical_adjacent']);
  assert.equal(defaults.listCandidateSelection.excludeRoleFamilies.length, 0);
  assert.equal(defaults.retryPolicy.noisyAccountCooldownDays, 7);
  assert.equal(defaults.subsidiaryExpansion.enabled, true);
});

test('normalizeTerritoryAccountRows marks stale accounts and sorts oldest first', () => {
  const defaults = buildBackgroundRunnerDefaults(config);
  const rows = normalizeTerritoryAccountRows([
    {
      sfdc_account_id: 'a-1',
      account_name: 'Fresh Account',
      days_since_activity: 10,
    },
    {
      sfdc_account_id: 'a-2',
      account_name: 'Stale Account',
      days_since_activity: 90,
    },
  ], defaults);

  assert.equal(rows[0].accountName, 'Stale Account');
  assert.equal(rows[0].stale, true);
  assert.equal(rows[1].stale, false);
});

test('mergeBackgroundRunnerSeeds dedupes territory, seed, and subsidiary accounts', () => {
  const merged = mergeBackgroundRunnerSeeds(
    [{ accountId: 'a-1', accountName: 'Acme', stalePriorityScore: 80 }],
    [{ accountId: 'a-1', accountName: 'Acme', seedType: 'lead_list', stalePriorityScore: 20 }],
    [{ accountId: 'a-2', accountName: 'Acme Germany', matchedParentAccountId: 'a-1', stalePriorityScore: 60 }],
  );

  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].seedSources, ['lead_list']);
  assert.equal(merged[1].subsidiarySource, 'a-1');
});

test('buildBackgroundRunnerSpec produces a merged stale-first queue', () => {
  const defaults = buildBackgroundRunnerDefaults(config);
  const territoryAccounts = normalizeTerritoryAccountRows([
    { sfdc_account_id: 'a-1', account_name: 'Acme', days_since_activity: 120 },
  ], defaults);
  const seedAccounts = [
    { accountId: 'a-2', accountName: 'Beta', seedType: 'account_list', stale: true, stalePriorityScore: 70 },
  ];
  const spec = buildBackgroundRunnerSpec({
    runnerDefaults: defaults,
    territoryAccounts,
    seedAccounts,
    subsidiaryAccounts: [],
  });

  assert.equal(spec.counts.mergedAccounts, 2);
  assert.equal(spec.counts.staleAccounts, 2);
  assert.equal(spec.queue[0].accountName, 'Acme');
});

test('estimateDaysSinceActivity falls back to a high stale score when missing', () => {
  assert.equal(estimateDaysSinceActivity(null), 99999);
});
