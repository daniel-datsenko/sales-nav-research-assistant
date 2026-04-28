const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCoverageSummary,
  getCandidateCoverageRoles,
  getMissingCoverageRoles,
} = require('../src/core/coverage');

test('buildCoverageSummary reports covered and missing buyer-group roles per account', () => {
  const summary = buildCoverageSummary({
    runAccounts: [
      {
        runId: 'run-1',
        accountKey: 'account-1',
        name: 'Acme',
        listName: 'Acme Test',
      },
    ],
    candidates: [
      {
        candidateId: 'cand-1',
        accountKey: 'account-1',
        fullName: 'Taylor Platform',
        title: 'Head of Platform Engineering',
        score: 78,
        roleFamily: 'platform',
        scoreBreakdown: {
          priorityModel: {
            matchedRoleFamily: 'platform',
            priorityTier: 'core',
          },
        },
      },
      {
        candidateId: 'cand-2',
        accountKey: 'account-1',
        fullName: 'Jamie Architect',
        title: 'Enterprise Architect',
        score: 70,
        roleFamily: 'architecture',
        scoreBreakdown: {
          priorityModel: {
            matchedRoleFamily: 'architecture',
            priorityTier: 'secondary',
          },
        },
      },
    ],
    buyerGroupRoles: {
      technical_champion: ['platform'],
      platform_owner: ['architecture', 'platform'],
      economic_buyer: ['it_technology'],
    },
  });

  assert.equal(summary.length, 1);
  assert.equal(summary[0].coveredRoleCount, 2);
  assert.equal(summary[0].totalRoleCount, 3);
  assert.deepEqual(summary[0].missingRoles, ['economic_buyer']);
  assert.equal(summary[0].coreCount, 1);
});

test('coverage helpers detect candidate role coverage and missing roles', () => {
  const buyerGroupRoles = {
    technical_champion: ['platform'],
    platform_owner: ['architecture', 'platform'],
    economic_buyer: ['it_technology'],
  };

  const candidate = {
    roleFamily: 'platform',
    scoreBreakdown: {
      priorityModel: {
        matchedRoleFamily: 'platform',
        priorityTier: 'core',
      },
    },
  };

  assert.deepEqual(
    getCandidateCoverageRoles(candidate, buyerGroupRoles),
    ['technical_champion', 'platform_owner'],
  );

  const missing = getMissingCoverageRoles([candidate], buyerGroupRoles);
  assert.deepEqual(missing, ['economic_buyer']);
});
