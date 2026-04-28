function buildCoverageSummary({ candidates, runAccounts, buyerGroupRoles }) {
  const accountsByKey = new Map((runAccounts || []).map((account) => [account.accountKey, account]));
  const grouped = new Map();

  for (const candidate of candidates || []) {
    if (!candidate.accountKey) {
      continue;
    }

    if (!grouped.has(candidate.accountKey)) {
      grouped.set(candidate.accountKey, []);
    }
    grouped.get(candidate.accountKey).push(candidate);
  }

  return [...accountsByKey.values()].map((account) => {
    const accountCandidates = grouped.get(account.accountKey) || [];
    const roleCoverage = Object.entries(buyerGroupRoles || {}).map(([roleId, families]) => {
      const matches = accountCandidates.filter((candidate) => {
        const priority = candidate.scoreBreakdown?.priorityModel || {};
        const matchedFamily = priority.matchedRoleFamily || candidate.roleFamily || null;
        const tier = priority.priorityTier || 'ignore';
        return Array.isArray(families)
          && families.includes(matchedFamily)
          && tier !== 'ignore';
      });

      return {
        roleId,
        covered: matches.length > 0,
        matchCount: matches.length,
        topMatches: matches
          .sort((left, right) => (right.score || 0) - (left.score || 0))
          .slice(0, 3)
          .map((candidate) => ({
            candidateId: candidate.candidateId,
            fullName: candidate.fullName,
            title: candidate.title,
            priorityTier: candidate.scoreBreakdown?.priorityModel?.priorityTier || 'ignore',
          })),
      };
    });

    const coveredRoleCount = roleCoverage.filter((item) => item.covered).length;
    const totalRoleCount = roleCoverage.length || 1;
    const missingRoles = roleCoverage.filter((item) => !item.covered).map((item) => item.roleId);
    const coreCount = accountCandidates.filter((candidate) =>
      candidate.scoreBreakdown?.priorityModel?.priorityTier === 'core').length;

    return {
      runId: account.runId,
      accountKey: account.accountKey,
      accountName: account.name,
      listName: account.listName,
      coverageRatio: coveredRoleCount / totalRoleCount,
      coveredRoleCount,
      totalRoleCount,
      missingRoles,
      coreCount,
      candidateCount: accountCandidates.length,
      roles: roleCoverage,
    };
  }).sort((left, right) => {
    if (left.coverageRatio !== right.coverageRatio) {
      return left.coverageRatio - right.coverageRatio;
    }
    return (right.coreCount || 0) - (left.coreCount || 0);
  });
}

function getCandidateCoverageRoles(candidate, buyerGroupRoles) {
  const priority = candidate?.scoreBreakdown?.priorityModel || candidate?.priorityModel || {};
  const matchedFamily = priority.matchedRoleFamily || candidate?.roleFamily || null;
  const tier = priority.priorityTier || 'ignore';

  if (!matchedFamily || tier === 'ignore') {
    return [];
  }

  return Object.entries(buyerGroupRoles || {})
    .filter(([, families]) => Array.isArray(families) && families.includes(matchedFamily))
    .map(([roleId]) => roleId);
}

function getMissingCoverageRoles(candidates, buyerGroupRoles) {
  const covered = new Set();
  for (const candidate of candidates || []) {
    for (const roleId of getCandidateCoverageRoles(candidate, buyerGroupRoles)) {
      covered.add(roleId);
    }
  }

  return Object.keys(buyerGroupRoles || {}).filter((roleId) => !covered.has(roleId));
}

module.exports = {
  buildCoverageSummary,
  getCandidateCoverageRoles,
  getMissingCoverageRoles,
};
