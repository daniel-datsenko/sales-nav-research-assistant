const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadPilotConfig,
  getPilotConnectPolicyDecision,
} = require('../src/core/pilot-config');

test('loadPilotConfig loads the default pilot mode and connect policy', () => {
  const config = loadPilotConfig();
  assert.equal(config.mode, 'lists-first');
  assert.equal(config.geoFocus.strictInclude, true);
  assert.ok(config.geoFocus.preferredLocationKeywords.includes('germany'));
  assert.deepEqual(config.connectPolicy.eligibleAccounts, ['Example Connect Eligible Account']);
  assert.equal(config.connectPolicy.listsFirstOnlyAccounts['Example Lists First Account'], 'connect variation not yet verified; keep as lists-first account');
  assert.match(config.connectPolicy.manualReviewAccounts['Example Manual Review Account'], /keep first send supervised/i);
});

test('getPilotConnectPolicyDecision returns connect-eligible, lists-first, and manual-review pilot classes', () => {
  const config = loadPilotConfig();
  assert.deepEqual(getPilotConnectPolicyDecision(config, 'Example Connect Eligible Account'), {
    allowed: true,
    reason: null,
    policyClass: 'connect_eligible',
  });
  assert.deepEqual(getPilotConnectPolicyDecision(config, 'Example Lists First Account'), {
    allowed: false,
    reason: 'connect variation not yet verified; keep as lists-first account',
    policyClass: 'lists_first_only',
  });
  assert.deepEqual(getPilotConnectPolicyDecision(config, 'Example Manual Review Account'), {
    allowed: false,
    reason: 'visible-action connect path is not yet fully live-confirmed; keep first send supervised.',
    policyClass: 'manual_review_required',
  });
});
