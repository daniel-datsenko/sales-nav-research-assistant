const PROHIBITED_BACKGROUND_FLAGS = /--live-connect|allow-background-connects/i;
const IMPLICIT_LIVE_MUTATION_COMMANDS = /\b(?:pilot-live-save-batch|test-list-save|remove-lead-list-members)\b/i;

function buildResearchExecutionGate({
  researchLoopPlan = null,
  evaluationMetrics = null,
  mutationReview = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const reasons = [];
  const planSteps = Array.isArray(researchLoopPlan?.steps) ? researchLoopPlan.steps : [];
  const riskLevel = evaluationMetrics?.overall?.riskLevel || 'unknown';
  const reviewSummary = mutationReview?.summary || null;

  if (researchLoopPlan?.drySafe !== true) {
    reasons.push('research_loop_plan_missing_or_not_dry_safe');
  }
  if (evaluationMetrics?.drySafe !== true) {
    reasons.push('evaluation_metrics_missing_or_not_dry_safe');
  }
  if (!mutationReview) {
    reasons.push('mutation_review_artifact_missing');
  } else if (mutationReview.drySafe !== true) {
    reasons.push('mutation_review_artifact_not_dry_safe');
  }

  const hasCompanyResolutionBlocker = planSteps.some((step) => step.id === 'company-resolution-retry');
  if (hasCompanyResolutionBlocker) {
    reasons.push('company_resolution_retry_pending');
  }

  const hasEnvironmentBlocker = planSteps.some((step) => step.id === 'environment-check');
  if (hasEnvironmentBlocker) {
    reasons.push('environment_check_pending');
  }

  if (riskLevel === 'high') {
    reasons.push('high_research_risk');
  } else if (riskLevel === 'medium') {
    reasons.push('medium_research_risk_requires_operator_review');
  } else if (riskLevel === 'unknown') {
    reasons.push('research_risk_unknown');
  }

  if (reviewSummary) {
    if ((reviewSummary.intendedAdds || 0) <= 0) {
      reasons.push('no_intended_adds_to_save');
    }
    if ((reviewSummary.exclusions || 0) > 0) {
      reasons.push('mutation_review_has_exclusions');
    }
    if ((reviewSummary.duplicateWarnings || 0) > 0) {
      reasons.push('mutation_review_has_duplicate_warnings');
    }
  }

  const decision = chooseGateDecision({
    reasons,
    hasCompanyResolutionBlocker,
    hasEnvironmentBlocker,
    riskLevel,
    reviewSummary,
    mutationReview,
  });

  const allowedCommandTemplate = decision === 'eligible_for_live_save'
    ? 'node src/cli.js fast-list-import --source=<reviewed-source> --list-name=<reviewed-list> --live-save'
    : getDrySafeCommandTemplate(planSteps);

  assertGatePlanCommandsSafe(decision, planSteps);
  assertGateCommandSafe(decision, allowedCommandTemplate);

  return {
    version: 1,
    generatedAt,
    drySafe: true,
    decision,
    liveSaveEligible: decision === 'eligible_for_live_save',
    requiresOperatorApproval: ['requires_operator_review', 'eligible_for_live_save'].includes(decision),
    riskLevel,
    reasons,
    allowedCommandTemplate,
    checkpoints: buildGateCheckpoints({ decision, reviewSummary, riskLevel }),
  };
}

function chooseGateDecision({
  reasons,
  hasCompanyResolutionBlocker,
  hasEnvironmentBlocker,
  riskLevel,
  reviewSummary,
  mutationReview,
}) {
  if (hasCompanyResolutionBlocker) {
    return 'blocked_until_company_resolution';
  }
  if (hasEnvironmentBlocker || riskLevel === 'high' || !mutationReview) {
    return 'allow_dry_run_only';
  }
  if (
    riskLevel !== 'low'
    || mutationReview.drySafe !== true
    || !reviewSummary
    || (reviewSummary.intendedAdds || 0) <= 0
    || (reviewSummary.exclusions || 0) > 0
    || (reviewSummary.duplicateWarnings || 0) > 0
    || reasons.includes('research_loop_plan_missing_or_not_dry_safe')
    || reasons.includes('evaluation_metrics_missing_or_not_dry_safe')
  ) {
    return 'requires_operator_review';
  }
  return 'eligible_for_live_save';
}

function getDrySafeCommandTemplate(planSteps = []) {
  const firstDryStep = planSteps.find((step) => step.command && step.type !== 'manual_gate');
  return firstDryStep?.command || 'npm run autoresearch:mvp';
}

function buildGateCheckpoints({ decision, reviewSummary, riskLevel }) {
  const checkpoints = [
    'confirm_no_live_connect_or_background_connect_flags',
    'confirm_sales_navigator_urls_are_valid_lead_urls',
    'confirm_company_scope_and_identity_evidence_are_current',
  ];
  if (decision !== 'eligible_for_live_save') {
    checkpoints.push('do_not_run_live_save_until_gate_is_eligible');
  } else {
    checkpoints.push('operator_confirms_mutation_review_before_live_save');
  }
  if (riskLevel !== 'low') {
    checkpoints.push('resolve_or_accept_metric_risk_before_live_save');
  }
  if ((reviewSummary?.exclusions || 0) > 0 || (reviewSummary?.duplicateWarnings || 0) > 0) {
    checkpoints.push('review_exclusions_and_duplicate_warnings');
  }
  return checkpoints;
}

function assertGatePlanCommandsSafe(decision, planSteps = []) {
  for (const step of planSteps) {
    const command = step.command || '';
    if (IMPLICIT_LIVE_MUTATION_COMMANDS.test(command)) {
      throw new Error(`Execution gate plan contains implicit live mutation command: ${command}`);
    }
    assertGateCommandSafe(decision, command);
  }
}

function assertGateCommandSafe(decision, command = '') {
  if (PROHIBITED_BACKGROUND_FLAGS.test(command)) {
    throw new Error(`Execution gate command contains prohibited background/connect flags: ${command}`);
  }
  if (decision !== 'eligible_for_live_save' && /--live-save/i.test(command)) {
    throw new Error(`Execution gate non-live decision contains live-save command: ${command}`);
  }
}

module.exports = {
  buildResearchExecutionGate,
};
