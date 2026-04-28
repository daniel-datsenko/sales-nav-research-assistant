function expandAccountGraph(accounts, options = {}) {
  const { enableBasicExpansion = true } = options;
  const expanded = [];

  for (const account of accounts) {
    expanded.push(stripSubsidiaries(account));

    if (enableBasicExpansion && Array.isArray(account.subsidiaries)) {
      for (const subsidiary of account.subsidiaries) {
        expanded.push(stripSubsidiaries({
          ...subsidiary,
          parentAccountId: subsidiary.parentAccountId || account.accountId,
          isSubsidiary: true,
        }));
      }
    }
  }

  return dedupeAccounts(expanded);
}

function stripSubsidiaries(account) {
  const { subsidiaries, ...rest } = account;
  return rest;
}

function dedupeAccounts(accounts) {
  const seen = new Set();
  const output = [];

  for (const account of accounts) {
    const key = `${account.accountId}::${account.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(account);
  }

  return output.sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

module.exports = {
  expandAccountGraph,
};
