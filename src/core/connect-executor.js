const { computeBudgetState, resolveConnectBudgetPolicy } = require('./budget');
const {
  summarizeConnectResults,
  verifyConnectResult,
} = require('./connect-verification');

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
  const results = [];
  let skipped = 0;
  let stopReason = null;
  let unprocessed = 0;

  for (let index = 0; index < approvals.length; index += 1) {
    const approval = approvals[index];
    if (repository.hasSentConnect(approval.candidateId)) {
      skipped += 1;
      results.push({
        candidateId: approval.candidateId,
        status: 'duplicate_skipped',
        note: 'already recorded as sent locally',
      });
      repository.insertConnectEvent(approval.candidateId, approval.approvalId, 'connect', 'duplicate_skipped', {
        reason: 'already_sent',
      });
      repository.updateApprovalState(approval.approvalId, 'sent', 'already_sent');
      continue;
    }

    try {
      const rawResult = await driver.sendConnect(approval, runContext);
      const result = await verifyConnectResult({
        candidate: approval,
        result: rawResult,
        readSnapshot: typeof driver.verifyConnectOutcome === 'function'
          ? () => driver.verifyConnectOutcome(approval, rawResult, runContext)
          : null,
      });
      repository.insertConnectEvent(approval.candidateId, approval.approvalId, 'connect', result.status, result);
      repository.updateApprovalState(
        approval.approvalId,
        result.status === 'sent' && result.verifiedConnect ? 'sent' : 'approved',
        result.note || null,
      );
      results.push({
        candidateId: approval.candidateId,
        status: result.status,
        note: result.note || null,
        verifiedConnect: result.verifiedConnect || false,
        verificationStatus: result.verificationStatus || null,
        rateLimit: result.rateLimit || null,
      });

      if (!(result.status === 'sent' && result.verifiedConnect)) {
        skipped += 1;
      }
      if (result.status === 'manual_review' && !runContext.allowUnverifiedConnectContinue) {
        stopReason = 'stopped_unverified_connect';
        unprocessed = approvals.length - index - 1;
        break;
      }
      if (result.status === 'rate_limited') {
        stopReason = 'stopped_rate_limit_signal';
        unprocessed = approvals.length - index - 1;
        break;
      }
    } catch (error) {
      skipped += 1;
      results.push({
        candidateId: approval.candidateId,
        status: 'failed',
        note: error.message,
      });
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

  const summary = summarizeConnectResults(results, unprocessed);
  return {
    budget,
    processed: results.length,
    sent: summary.verifiedSent,
    skipped,
    unprocessed,
    results,
    summary,
    reason: approvals.length === 0 ? 'no_approved_people' : (stopReason || 'completed'),
  };
}

module.exports = {
  sendApprovedConnects,
};
