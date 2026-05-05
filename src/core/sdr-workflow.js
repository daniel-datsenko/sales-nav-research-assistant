const { parseAccountNames, renderAccountBatchListNameTemplate } = require('./account-batch');

function buildSdrResearchListName(accountNames = [], {
  listName = null,
  startedAt = new Date().toISOString(),
} = {}) {
  const explicit = String(listName || '').trim();
  if (explicit) {
    return explicit;
  }

  return renderAccountBatchListNameTemplate('SDR Research {date} {start_time} ({accounts})', {
    accountNames,
    startedAt,
    endedAt: startedAt,
  });
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
} = {}) {
  const lines = [];
  lines.push('# SDR Research Run');
  lines.push('');
  lines.push(`- Accounts: \`${accountNames.join(', ')}\``);
  lines.push(`- Target list: \`${listName}\``);
  lines.push(`- Research mode: \`${researchMode}\``);
  lines.push(`- Speed profile: \`${speedProfile}\``);
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
};
