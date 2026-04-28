const { computeBudgetState, resolveConnectBudgetPolicy } = require('./budget');

async function sendApprovedConnects({ repository, driver, runContext, limit = 25 }) {
  const policy = resolveConnectBudgetPolicy({
    weeklyCap: runContext.weeklyCap || 140,
    budgetMode: runContext.connectBudgetPolicy?.budgetMode || 'balanced',
    toolSharePercent: runContext.connectBudgetPolicy?.toolSharePercent,
    dailyMax: runContext.connectBudgetPolicy?.dailyMax,
    dailyMin: runContext.connectBudgetPolicy?.dailyMin,
  });
  const rawBudget = repository.getBudgetState(policy.effectiveWeeklyCap || 140);
  const budget = computeBudgetState({
    weeklyCap: rawBudget.weeklyCap,
    sentThisWeek: rawBudget.weekCount,
    sentToday: rawBudget.dayCount,
    budgetMode: policy.budgetMode,
    toolSharePercent: policy.toolSharePercent,
    dailyMax: policy.dailyMax,
    dailyMin: policy.dailyMin,
  });

  if (budget.remainingToday <= 0 || budget.remainingThisWeek <= 0) {
    return {
      budget,
      processed: 0,
      sent: 0,
      skipped: 0,
      reason: 'budget_exhausted',
    };
  }

  const approvals = repository.getPendingApprovals(Math.min(limit, budget.remainingToday));
  let sent = 0;
  let skipped = 0;

  for (const approval of approvals) {
    if (repository.hasSentConnect(approval.candidateId)) {
      skipped += 1;
      repository.insertConnectEvent(approval.candidateId, approval.approvalId, 'connect', 'duplicate_skipped', {
        reason: 'already_sent',
      });
      repository.updateApprovalState(approval.approvalId, 'sent', 'already_sent');
      continue;
    }

    try {
      const result = await driver.sendConnect(approval, runContext);
      repository.insertConnectEvent(approval.candidateId, approval.approvalId, 'connect', result.status, result);
      repository.updateApprovalState(
        approval.approvalId,
        result.status === 'sent' ? 'sent' : 'approved',
        result.note || null,
      );

      if (result.status === 'sent') {
        sent += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      skipped += 1;
      repository.insertConnectEvent(approval.candidateId, approval.approvalId, 'connect', 'failed', {
        message: error.message,
      });
      repository.insertRecoveryEvent({
        runId: approval.runId,
        candidateId: approval.candidateId,
        severity: 'error',
        eventType: 'connect_execution_failed',
        details: { message: error.message },
      });
    }
  }

  return {
    budget,
    processed: approvals.length,
    sent,
    skipped,
    reason: approvals.length === 0 ? 'no_approved_people' : 'completed',
  };
}

module.exports = {
  sendApprovedConnects,
};
