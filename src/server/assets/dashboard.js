const refreshButton = document.getElementById('refreshButton');
const runsNode = document.getElementById('runs');
const candidatesNode = document.getElementById('candidates');
const approvalsNode = document.getElementById('approvals');
const runAccountsNode = document.getElementById('runAccounts');
const recoveryNode = document.getElementById('recovery');
const budgetNode = document.getElementById('budget');
const prioritySummaryNode = document.getElementById('prioritySummary');
const coverageNode = document.getElementById('coverage');
const modeLabNode = document.getElementById('modeLab');

let loadedModes = [];
let selectedModeId = window.localStorage.getItem('salesNavModeId') || null;

async function load() {
  const [
    summaryResponse,
    candidatesResponse,
    approvalsResponse,
    runAccountsResponse,
    recoveryResponse,
    coverageResponse,
    modesResponse,
  ] = await Promise.all([
    fetch('/api/summary'),
    fetch('/api/candidates'),
    fetch('/api/approvals'),
    fetch('/api/run-accounts'),
    fetch('/api/recovery'),
    fetch('/api/coverage'),
    fetch('/api/modes'),
  ]);

  const summary = await summaryResponse.json();
  const candidates = await candidatesResponse.json();
  const approvals = await approvalsResponse.json();
  const runAccounts = await runAccountsResponse.json();
  const recovery = await recoveryResponse.json();
  const coverage = await coverageResponse.json();
  const modes = await modesResponse.json();
  loadedModes = modes;
  if (!selectedModeId && modes[0]?.id) {
    selectedModeId = modes[0].id;
  }

  renderBudget(summary.budget);
  renderRuns(summary.runs);
  renderModeLab(modes, summary.runs);
  renderCandidates(candidates);
  renderPrioritySummary(candidates);
  renderCoverage(coverage);
  renderApprovals(approvals);
  renderRunAccounts(runAccounts);
  renderRecovery(recovery);
}

function renderBudget(budget) {
  budgetNode.innerHTML = `
    <p class="eyebrow">Connect Budget</p>
    <h2>${budget.remainingToday}</h2>
    <p class="meta">${budget.budgetMode} mode • tool share ${budget.toolSharePercent}%</p>
    <p class="meta">remaining today out of a paced daily target of ${budget.recommendedTodayLimit}</p>
    <p class="meta">${budget.remainingThisWeek} remaining this week from a cap of ${budget.weeklyCap}</p>
  `;
}

function renderRuns(runs) {
  runsNode.innerHTML = runs.map((run) => `
    <article class="run-card">
      <span class="badge ${run.status}">${run.status}</span>
      <h3>${run.territory_name}</h3>
      <p class="meta">${run.driver} driver</p>
      <p class="meta">${run.modeId ? `Mode ${run.modeId}` : 'Mode default'}</p>
      <p class="meta">${run.runtimeMode || 'runtime unknown'}</p>
      <p class="meta">${run.candidate_count} candidates</p>
      <p class="meta">${run.pending_approvals || 0} pending approvals</p>
      <p class="meta">${run.failed_accounts || 0} failed accounts</p>
      <p class="meta">${new Date(run.started_at).toLocaleString()}</p>
    </article>
  `).join('');
}

function renderCandidates(candidates) {
  candidatesNode.innerHTML = candidates.map((candidate) => `
    <article class="candidate-card">
      <div class="panel-header">
        <div>
          <span class="badge ${candidate.approvalState}">${candidate.approvalState}</span>
          ${renderPriorityBadge(candidate)}
          <h3>${candidate.fullName}</h3>
          <p class="meta">${candidate.title}${candidate.company ? ` • ${candidate.company}` : ''}</p>
          <p class="meta">Score ${candidate.score} • ${candidate.listName}</p>
        </div>
        ${candidate.salesNavigatorUrl ? `<a class="ghost-link" href="${candidate.salesNavigatorUrl}" target="_blank" rel="noreferrer">Open</a>` : ''}
      </div>
      <p class="meta">${candidate.location || 'Location unknown'}</p>
      <p class="meta">Role ${candidate.roleFamily || 'unknown'} • Seniority ${candidate.seniority || 'unknown'}</p>
      <p class="meta">${renderPriorityMeta(candidate)}</p>
      <p class="meta">${renderCoverageMeta(candidate)}</p>
      <p class="meta">Recommendation ${candidate.recommendation} • Decision ${candidate.decisionReason || 'n/a'}</p>
      <p class="meta">List save ${candidate.listSaveStatus || 'not_requested'}</p>
      <div class="actions">
        ${candidate.approvalId ? `
          <button class="primary" data-approval="${candidate.approvalId}" data-state="approved">Approve connect</button>
          <button class="secondary" data-approval="${candidate.approvalId}" data-state="deferred">Defer</button>
          <button class="secondary" data-approval="${candidate.approvalId}" data-state="skipped">Skip</button>
        ` : '<span class="meta">No approval item</span>'}
      </div>
      <pre>${JSON.stringify({
        evidence: candidate.evidence,
        listSave: candidate.listSaveDetails,
      }, null, 2)}</pre>
    </article>
  `).join('');

  bindApprovalButtons(candidatesNode);
}

function renderApprovals(approvals) {
  approvalsNode.innerHTML = approvals.map((item) => `
    <article class="candidate-card">
      <span class="badge ${item.state}">${item.state}</span>
      <h3>${item.fullName}</h3>
      <p class="meta">${item.title}${item.company ? ` • ${item.company}` : ''}</p>
      <p class="meta">Score ${item.score} • ${item.listName}</p>
      <p class="meta">${item.location || 'Location unknown'}</p>
      <div class="actions">
        <button class="primary" data-approval="${item.approvalId}" data-state="approved">Approve connect</button>
        <button class="secondary" data-approval="${item.approvalId}" data-state="deferred">Defer</button>
        <button class="secondary" data-approval="${item.approvalId}" data-state="skipped">Skip</button>
      </div>
      ${item.salesNavigatorUrl ? `<a class="ghost-link" href="${item.salesNavigatorUrl}" target="_blank" rel="noreferrer">Open in Sales Nav</a>` : ''}
    </article>
  `).join('');

  bindApprovalButtons(approvalsNode);
}

function renderCoverage(items) {
  coverageNode.innerHTML = items.map((item) => `
    <article class="run-card">
      <div class="panel-header">
        <div>
          <h3>${item.accountName}</h3>
          <p class="meta">${item.coveredRoleCount}/${item.totalRoleCount} buying-group roles covered</p>
          <p class="meta">${item.coreCount} core candidate(s) • ${item.candidateCount} candidate(s)</p>
        </div>
        <span class="badge ${item.coverageRatio >= 0.75 ? 'approved' : item.coverageRatio >= 0.5 ? 'pending' : 'review_required'}">${Math.round(item.coverageRatio * 100)}%</span>
      </div>
      <p class="meta">${item.listName || 'No list assigned'}</p>
      <p class="meta">${item.missingRoles.length > 0 ? `Missing: ${item.missingRoles.join(', ')}` : 'All buyer-group roles covered'}</p>
      <div class="coverage-roles">
        ${item.roles.map((role) => `
          <div class="coverage-chip ${role.covered ? 'covered' : 'missing'}">
            <strong>${role.roleId}</strong>
            <span>${role.covered ? `${role.matchCount} match(es)` : 'missing'}</span>
          </div>
        `).join('')}
      </div>
    </article>
  `).join('');
}

function renderModeLab(modes, runs) {
  const activeRunModeIds = new Set((runs || []).map((run) => run.modeId).filter(Boolean));
  const selectedMode = modes.find((mode) => mode.id === selectedModeId) || modes[0] || null;

  modeLabNode.innerHTML = `
    <div class="mode-controls">
      <label class="meta" for="modeSelect">Mode</label>
      <select id="modeSelect">
        ${modes.map((mode) => `
          <option value="${mode.id}" ${selectedMode?.id === mode.id ? 'selected' : ''}>${mode.name}</option>
        `).join('')}
      </select>
    </div>
    ${selectedMode ? `
      <article class="run-card">
        <div class="panel-header">
          <div>
            <span class="badge ${activeRunModeIds.has(selectedMode.id) ? 'approved' : 'pending'}">${selectedMode.id}</span>
            <h3>${selectedMode.name}</h3>
          </div>
        </div>
        <p class="meta">${selectedMode.description}</p>
        <p class="meta">Goal: ${selectedMode.goal}</p>
        <p class="meta">Deep review: ${selectedMode.deepProfileReview || 'default'}</p>
        <p class="meta">Templates: ${(selectedMode.searchTemplateIds || []).join(', ')}</p>
        <pre>node src/cli.js run-territory --driver=hybrid --mode=${selectedMode.id}</pre>
      </article>
    ` : '<p class="meta">No modes configured.</p>'}
    <div class="runs-grid">
      ${modes.map((mode) => `
        <article class="run-card mode-card ${selectedMode?.id === mode.id ? 'selected' : ''}">
          <span class="badge ${activeRunModeIds.has(mode.id) ? 'approved' : 'pending'}">${activeRunModeIds.has(mode.id) ? 'used in runs' : 'available'}</span>
          <h3>${mode.name}</h3>
          <p class="meta">${mode.goal}</p>
          <p class="meta">${(mode.titleBias || []).slice(0, 5).join(', ')}</p>
        </article>
      `).join('')}
    </div>
  `;

  const select = document.getElementById('modeSelect');
  if (select) {
    select.addEventListener('change', () => {
      selectedModeId = select.value;
      window.localStorage.setItem('salesNavModeId', selectedModeId);
      renderModeLab(loadedModes, runs);
    });
  }
}

function renderPrioritySummary(candidates) {
  const priorityModelCandidates = candidates
    .map((candidate) => candidate.scoreBreakdown?.priorityModel)
    .filter(Boolean);

  if (priorityModelCandidates.length === 0) {
    prioritySummaryNode.innerHTML = '<p class="meta">No priority model scores attached to current candidates yet.</p>';
    return;
  }

  const counts = {
    core: 0,
    secondary: 0,
    exploratory: 0,
    ignore: 0,
  };

  for (const item of priorityModelCandidates) {
    const tier = item.priorityTier || 'ignore';
    counts[tier] = (counts[tier] || 0) + 1;
  }

  prioritySummaryNode.innerHTML = Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([tier, count]) => `
      <article class="run-card">
        <span class="badge priority-${tier}">${tier}</span>
        <h3>${count}</h3>
        <p class="meta">candidates currently scored as ${tier}</p>
      </article>
    `)
    .join('');
}

function renderPriorityBadge(candidate) {
  const priority = candidate.scoreBreakdown?.priorityModel;
  if (!priority?.priorityTier) {
    return '';
  }

  return `<span class="badge priority-${priority.priorityTier}">${priority.priorityTier}</span>`;
}

function renderPriorityMeta(candidate) {
  const priority = candidate.scoreBreakdown?.priorityModel;
  if (!priority) {
    return 'Priority model not attached';
  }

  return [
    `Priority ${priority.priorityTier || 'unknown'}`,
    priority.matchedRoleFamily ? `family ${priority.matchedRoleFamily}` : null,
    Number.isFinite(priority.priorityScore) ? `hist. score ${priority.priorityScore}` : null,
  ].filter(Boolean).join(' • ');
}

function renderCoverageMeta(candidate) {
  const coverage = candidate.scoreBreakdown?.coverageRecommendation;
  if (!coverage) {
    return 'Coverage role fit not evaluated';
  }

  const parts = [
    coverage.coverageRoles?.length ? `roles ${coverage.coverageRoles.join(', ')}` : null,
    coverage.fillsMissingRole ? 'fills a missing buying-group role' : null,
    coverage.missingCoverageRoles?.length ? `still missing ${coverage.missingCoverageRoles.join(', ')}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(' • ') : 'No current buying-group role lift';
}

function renderRunAccounts(runAccounts) {
  runAccountsNode.innerHTML = runAccounts.map((account) => `
    <article class="run-card">
      <span class="badge ${account.status}">${account.status}</span>
      <h3>${account.name}</h3>
      <p class="meta">${account.region || account.country || 'Region unknown'}</p>
      <p class="meta">${account.candidateCount} candidates • ${account.listName || 'No list'}</p>
      <p class="meta">Stage ${account.stage}</p>
      ${account.lastError ? `<pre>${account.lastError}</pre>` : ''}
      <div class="actions">
        ${(account.status === 'failed' || account.status === 'review_required') ? `
          <button class="secondary" data-run="${account.runId}" data-account-key="${account.accountKey}">Retry account</button>
        ` : ''}
      </div>
    </article>
  `).join('');

  runAccountsNode.querySelectorAll('button[data-run]').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetch('/api/run-account/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runId: button.dataset.run,
          accountKey: button.dataset.accountKey,
        }),
      });
      await load();
    });
  });
}

function renderRecovery(recovery) {
  recoveryNode.innerHTML = recovery.map((item) => `
    <article class="recovery-card">
      <span class="badge ${item.severity}">${item.severity}</span>
      <h3>${item.eventType}</h3>
      <p class="meta">Run ${item.runId}</p>
      <pre>${JSON.stringify(item.details, null, 2)}</pre>
    </article>
  `).join('');
}

function bindApprovalButtons(container) {
  container.querySelectorAll('button[data-approval]').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetch(`/api/approval/${button.dataset.approval}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: button.dataset.state }),
      });
      await load();
    });
  });
}

refreshButton.addEventListener('click', load);
load();
