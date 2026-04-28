function decideCandidateActions(candidate, icpConfig, priority = null, priorityDecisioning = {}, coverageContext = null) {
  if (!candidate.eligible || (candidate.score || 0) <= 0) {
    return {
      recommendation: 'skip',
      shouldSaveToList: false,
      shouldQueueForApproval: false,
      status: 'skipped',
      reason: 'not_eligible',
    };
  }

  if (candidate.score >= (icpConfig.approvalThreshold || 60)) {
    return {
      recommendation: 'queue_for_approval',
      shouldSaveToList: true,
      shouldQueueForApproval: true,
      status: 'recommended',
      reason: 'above_approval_threshold',
    };
  }

  const approvalThreshold = icpConfig.approvalThreshold || 60;
  const saveThreshold = icpConfig.saveToListThreshold || 35;
  const priorityTier = priority?.priorityTier || 'ignore';
  const fillsMissingCoverageRole = Boolean(coverageContext?.fillsMissingRole);

  if (
    priorityTier === 'core'
    && candidate.score >= (priorityDecisioning.coreApprovalFloor ?? (approvalThreshold - 8))
  ) {
    return {
      recommendation: 'queue_for_approval',
      shouldSaveToList: true,
      shouldQueueForApproval: true,
      status: 'recommended',
      reason: 'priority_core_near_approval_threshold',
    };
  }

  if (
    fillsMissingCoverageRole
    && ['core', 'secondary'].includes(priorityTier)
    && candidate.score >= (priorityDecisioning.missingRoleApprovalFloor ?? (approvalThreshold - 10))
  ) {
    return {
      recommendation: 'queue_for_approval',
      shouldSaveToList: true,
      shouldQueueForApproval: true,
      status: 'recommended',
      reason: 'fills_missing_buying_group_role_for_approval',
    };
  }

  if (
    priorityTier === 'core'
    && candidate.score >= (priorityDecisioning.coreSaveFloor ?? (saveThreshold - 7))
  ) {
    return {
      recommendation: 'save_to_list',
      shouldSaveToList: true,
      shouldQueueForApproval: false,
      status: 'watchlist',
      reason: 'priority_core_near_save_threshold',
    };
  }

  if (
    priorityTier === 'secondary'
    && candidate.score >= (priorityDecisioning.secondarySaveFloor ?? (saveThreshold - 5))
  ) {
    return {
      recommendation: 'save_to_list',
      shouldSaveToList: true,
      shouldQueueForApproval: false,
      status: 'watchlist',
      reason: 'priority_secondary_near_save_threshold',
    };
  }

  if (
    fillsMissingCoverageRole
    && priorityTier !== 'ignore'
    && candidate.score >= (priorityDecisioning.missingRoleSaveFloor ?? (saveThreshold - 9))
  ) {
    return {
      recommendation: 'save_to_list',
      shouldSaveToList: true,
      shouldQueueForApproval: false,
      status: 'watchlist',
      reason: 'fills_missing_buying_group_role_for_save',
    };
  }

  if (candidate.score >= saveThreshold) {
    return {
      recommendation: 'save_to_list',
      shouldSaveToList: true,
      shouldQueueForApproval: false,
      status: 'watchlist',
      reason: 'above_save_threshold',
    };
  }

  return {
    recommendation: 'defer',
    shouldSaveToList: false,
    shouldQueueForApproval: false,
    status: 'deferred',
    reason: 'below_threshold',
  };
}

module.exports = {
  decideCandidateActions,
};
