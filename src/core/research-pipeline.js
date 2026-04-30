const { buildSweepTemplates } = require('./account-coverage');

function slugFromDisplayName(value) {
  const slug = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'unnamed-account';
}

function normalizeResearchAccount(account = {}) {
  const nameSource =
    account.accountName
    ?? account.name
    ?? account.companyName
    ?? '';

  const accountName = String(nameSource).trim();
  const hasAccountId =
    account.accountId != null && String(account.accountId).trim() !== '';
  const accountKey = hasAccountId
    ? String(account.accountId).trim()
    : slugFromDisplayName(accountName);

  const resolvedName = accountName || accountKey;

  return {
    ...account,
    accountKey,
    accountName: resolvedName,
  };
}

function buildResearchQueue({ accounts = [], runId, generatedAt } = {}) {
  const normalized = accounts.map((a) => normalizeResearchAccount(a));
  normalized.sort((a, b) => a.accountKey.localeCompare(b.accountKey));

  return {
    version: '1.0.0',
    runId: runId ?? null,
    generatedAt: generatedAt ?? null,
    mode: 'dry-safe',
    safety: {
      liveSaveAllowed: false,
      liveConnectAllowed: false,
    },
    accounts: normalized,
  };
}

function planResearchJobs({
  queue,
  coverageConfig,
  maxCandidates = null,
  options = {},
} = {}) {
  const accounts = [...(queue?.accounts || [])];
  accounts.sort((a, b) => a.accountKey.localeCompare(b.accountKey));

  const templates = buildSweepTemplates(coverageConfig, maxCandidates, options);

  /** @type {Array<Record<string, unknown>>} */
  const jobs = [];

  for (const account of accounts) {
    const { accountKey, accountName } = account;
    jobs.push({
      id: `company-resolution:${accountKey}`,
      type: 'company_resolution',
      accountKey,
      accountName,
      safety: {
        liveSaveAllowed: false,
        liveConnectAllowed: false,
      },
    });
  }

  for (const account of accounts) {
    const { accountKey, accountName } = account;
    for (const template of templates) {
      jobs.push({
        id: `sweep:${accountKey}:${template.id}`,
        type: 'sweep',
        accountKey,
        accountName,
        templateId: template.id,
        keywords: template.keywords ?? [],
        titleIncludes: template.titleIncludes ?? [],
        ...(template.maxCandidates !== undefined
          ? { maxCandidates: template.maxCandidates }
          : {}),
        requiresBrowser: true,
        safety: {
          liveSaveAllowed: false,
          liveConnectAllowed: false,
          companyScopeRequired: true,
        },
      });
    }
  }

  jobs.sort((a, b) => String(a.id).localeCompare(String(b.id)));

  return {
    safety: {
      liveSaveAllowed: false,
      liveConnectAllowed: false,
    },
    jobs,
  };
}

module.exports = {
  buildResearchQueue,
  normalizeResearchAccount,
  planResearchJobs,
};
