const test = require('node:test');
const assert = require('node:assert/strict');

const { decideCandidateActions } = require('../src/core/decision-engine');

test('priority-aware decisioning promotes core candidates near approval threshold', () => {
  const decision = decideCandidateActions(
    { eligible: true, score: 54 },
    { approvalThreshold: 60, saveToListThreshold: 35 },
    { priorityTier: 'core' },
    { coreApprovalFloor: 52 },
  );

  assert.equal(decision.recommendation, 'queue_for_approval');
  assert.equal(decision.reason, 'priority_core_near_approval_threshold');
});

test('priority-aware decisioning saves secondary candidates near save threshold', () => {
  const decision = decideCandidateActions(
    { eligible: true, score: 31 },
    { approvalThreshold: 60, saveToListThreshold: 35 },
    { priorityTier: 'secondary' },
    { secondarySaveFloor: 30 },
  );

  assert.equal(decision.recommendation, 'save_to_list');
  assert.equal(decision.reason, 'priority_secondary_near_save_threshold');
});

test('coverage-aware decisioning promotes missing-role candidates', () => {
  const decision = decideCandidateActions(
    { eligible: true, score: 50 },
    { approvalThreshold: 60, saveToListThreshold: 35 },
    { priorityTier: 'secondary' },
    { missingRoleApprovalFloor: 50 },
    { fillsMissingRole: true },
  );

  assert.equal(decision.recommendation, 'queue_for_approval');
  assert.equal(decision.reason, 'fills_missing_buying_group_role_for_approval');
});
