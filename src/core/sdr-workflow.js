const { parseAccountNames, renderAccountBatchListNameTemplate } = require('./account-batch');

// Sales Navigator UI truncates list names beyond ~32 chars in the save-to-list
// dropdown. When the DOM `innerText` returns the truncated string, exact-match
// list-row detection in playwright-sales-nav.js fails, which causes
// `tryCreateList` to be called for every single save -> one new duplicate list
// per saved lead. See runtime/BUG-REPORT-list-duplication-2026-05-12.md.
const SALES_NAV_LIST_NAME_MAX = 32;

function validateSalesNavListName(listName) {
  const trimmed = String(listName || '').trim();
  if (trimmed.length > SALES_NAV_LIST_NAME_MAX) {
    throw new Error(
      `List name is ${trimmed.length} chars but Sales Navigator UI truncates beyond ${SALES_NAV_LIST_NAME_MAX} chars, `
      + `which triggers a list-duplication bug (one new list per saved lead). `
      + `Shorten "--list-name" to <=${SALES_NAV_LIST_NAME_MAX} chars. Suggestion: "${trimmed.slice(0, SALES_NAV_LIST_NAME_MAX).trim()}"`
    );
  }
  return trimmed;
}

function buildSdrResearchListName(accountNames = [], {
  listName = null,
  startedAt = new Date().toISOString(),
} = {}) {
  const explicit = String(listName || '').trim();
  if (explicit) {
    return validateSalesNavListName(explicit);
  }

  const auto = renderAccountBatchListNameTemplate('SDR {date} ({accounts})', {
    accountNames,
    startedAt,
    endedAt: startedAt,
  });
  if (auto.length <= SALES_NAV_LIST_NAME_MAX) {
    return auto;
  }
  // Fall back: shrink to fit, keep date prefix
  const datePrefix = renderAccountBatchListNameTemplate('SDR {date}', {
    accountNames,
    startedAt,
    endedAt: startedAt,
  });
  const room = SALES_NAV_LIST_NAME_MAX - datePrefix.length - 3; // " (...)"
  const truncatedAccounts = accountNames.join(', ').slice(0, Math.max(0, room - 3));
  return `${datePrefix} (${truncatedAccounts}...)`.slice(0, SALES_NAV_LIST_NAME_MAX);
}

function buildSdrResearchBatchValues(values = {}, {
  startedAt = new Date().toISOString(),
} = {}) {
  const accountNames = parseAccountNames(values.accounts || values['account-names'] || values['account-name']);
  if (accountNames.length === 0) {
    throw new Error('sdr-research requires --accounts="Account A, Account B, Account C"');
  }
  if (values['live-connect'] || values.liveConnect || values['allow-background-connects']) {
    throw new Error('sdr-research never sends connects; use a reviewed connect command separately');
  }

  const listName = buildSdrResearchListName(accountNames, {
    listName: values['list-name'],
    startedAt,
  });
  const exhaustive = Boolean(values.exhaustive || values['research-mode'] === 'exhaustive');

  return {
    ...values,
    'account-names': accountNames.join(', '),
    'consolidate-list-name': listName,
    'allow-list-create': values['allow-list-create'] ?? Boolean(values['live-save'] || values.liveSave),
    driver: values.driver || 'playwright',
    'session-mode': values['session-mode'] || 'persistent',
    'coverage-config': values['coverage-config'] || 'config/account-coverage/default.json',
    'research-mode': exhaustive ? 'exhaustive' : (values['research-mode'] || 'persona-led'),
    'speed-profile': exhaustive ? 'exhaustive' : (values['speed-profile'] || 'balanced'),
    'research-concurrency': values['research-concurrency'] || '1',
    'reuse-sweep-cache': values['reuse-sweep-cache'] ?? true,
    'report-only-out-of-network': values['report-only-out-of-network'] ?? true,
  };
}

function renderSdrResearchIntro({
  accountNames = [],
  listName,
  liveSave = false,
  researchMode = 'persona-led',
  speedProfile = 'balanced',
  deepProfilePass = false,
  profileReadMethod = 'ui',
  scaleupSelectionExpanded = false,
} = {}) {
  const lines = [];
  lines.push('# SDR Research Run');
  lines.push('');
  lines.push(`- Accounts: \`${accountNames.join(', ')}\``);
  lines.push(`- Target list: \`${listName}\``);
  lines.push(`- Research mode: \`${researchMode}\``);
  lines.push(`- Speed profile: \`${speedProfile}\``);
  lines.push(`- Deep profile review: \`${deepProfilePass ? profileReadMethod : 'off'}\``);
  lines.push(`- Scaleup selection expansion: \`${scaleupSelectionExpanded ? 'on' : 'off'}\``);
  lines.push(`- Live save: \`${liveSave ? 'yes' : 'no'}\``);
  lines.push('- Connects: `never in this command`');
  lines.push('');
  if (liveSave) {
    lines.push('This will create or update the Sales Navigator list after the browser research selects safe candidates.');
  } else {
    lines.push('This is dry-safe. It will research and write review artifacts, but it will not save leads to Sales Navigator.');
  }
  return `${lines.join('\n')}\n`;
}

module.exports = {
  buildSdrResearchBatchValues,
  buildSdrResearchListName,
  renderSdrResearchIntro,
  validateSalesNavListName,
  SALES_NAV_LIST_NAME_MAX,
};
