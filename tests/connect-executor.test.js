const test = require('node:test');
const assert = require('node:assert/strict');

const { sendApprovedConnects } = require('../src/core/connect-executor');

function createRepository(approvals) {
  const events = [];
  const approvalUpdates = [];
  return {
    events,
    approvalUpdates,
    getBudgetState() {
      return { weeklyCap: 70, weekCount: 0, dayCount: 0 };
    },
    getPendingApprovals(limit) {
      return approvals.slice(0, limit);
    },
    hasSentConnect() {
      return false;
    },
    insertConnectEvent(candidateId, approvalId, action, status, details) {
      events.push({ candidateId, approvalId, action, status, details });
    },
    updateApprovalState(approvalId, state, note) {
      approvalUpdates.push({ approvalId, state, note });
    },
    insertRecoveryEvent() {},
  };
}

test('sendApprovedConnects counts sent only after durable verifier confirms pending invitation', async () => {
  const approval = {
    approvalId: 'a1',
    candidateId: 'c1',
    fullName: 'Verified Lead',
    salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/verified-id',
  };
  const repository = createRepository([approval]);
  const driver = {
    async sendConnect() {
      return { status: 'sent', note: 'ui clicked send' };
    },
    async verifyConnectOutcome() {
      return {
        rows: [{
          fullName: 'Verified Lead',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/verified-id',
          pendingInvitation: true,
        }],
      };
    },
  };

  const result = await sendApprovedConnects({
    repository,
    driver,
    runContext: { weeklyCap: 140 },
  });

  assert.equal(result.sent, 1);
  assert.equal(result.summary.verifiedSent, 1);
  assert.equal(result.results[0].status, 'sent');
  assert.equal(result.results[0].verifiedConnect, true);
  assert.equal(repository.approvalUpdates[0].state, 'sent');
});

test('sendApprovedConnects fails closed when sent UI cannot be verified', async () => {
  const approvals = [
    {
      approvalId: 'a1',
      candidateId: 'c1',
      fullName: 'Unverified Lead',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/unverified-id',
    },
    {
      approvalId: 'a2',
      candidateId: 'c2',
      fullName: 'Unprocessed Lead',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/unprocessed-id',
    },
  ];
  const repository = createRepository(approvals);
  let sends = 0;
  const driver = {
    async sendConnect() {
      sends += 1;
      return { status: 'sent', note: 'ui clicked send' };
    },
    async verifyConnectOutcome() {
      return {
        rows: [{
          fullName: 'Unverified Lead',
          salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/unverified-id',
          pendingInvitation: false,
        }],
      };
    },
  };

  const result = await sendApprovedConnects({
    repository,
    driver,
    runContext: { weeklyCap: 140 },
  });

  assert.equal(sends, 1);
  assert.equal(result.sent, 0);
  assert.equal(result.processed, 1);
  assert.equal(result.unprocessed, 1);
  assert.equal(result.reason, 'stopped_unverified_connect');
  assert.equal(result.results[0].status, 'manual_review');
  assert.equal(result.summary.manualReviewUnverified, 1);
  assert.equal(repository.approvalUpdates[0].state, 'approved');
});

test('sendApprovedConnects override continues after unverified manual review without counting it as sent', async () => {
  const approvals = [
    {
      approvalId: 'a1',
      candidateId: 'c1',
      fullName: 'Unverified Lead',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/unverified-id',
    },
    {
      approvalId: 'a2',
      candidateId: 'c2',
      fullName: 'Verified Lead',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/verified-id',
    },
  ];
  const repository = createRepository(approvals);
  const driver = {
    async sendConnect(approval) {
      return { status: 'sent', note: `ui clicked send for ${approval.fullName}` };
    },
    async verifyConnectOutcome(approval) {
      return {
        rows: [{
          fullName: approval.fullName,
          salesNavigatorUrl: approval.salesNavigatorUrl,
          pendingInvitation: approval.fullName === 'Verified Lead',
        }],
      };
    },
  };

  const result = await sendApprovedConnects({
    repository,
    driver,
    runContext: {
      weeklyCap: 140,
      allowUnverifiedConnectContinue: true,
    },
  });

  assert.equal(result.reason, 'completed');
  assert.equal(result.processed, 2);
  assert.equal(result.sent, 1);
  assert.deepEqual(result.results.map((row) => row.status), ['manual_review', 'sent']);
});

test('sendApprovedConnects separates rate-limit stops from manual review', async () => {
  const approvals = [
    {
      approvalId: 'a1',
      candidateId: 'c1',
      fullName: 'Rate Limited Lead',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/rate-limited-id',
    },
    {
      approvalId: 'a2',
      candidateId: 'c2',
      fullName: 'Unprocessed Lead',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/unprocessed-id',
    },
  ];
  const repository = createRepository(approvals);
  const driver = {
    async sendConnect() {
      return {
        status: 'rate_limited',
        note: 'LinkedIn showed too many requests',
        rateLimit: { matchedSignal: 'too many requests' },
      };
    },
  };

  const result = await sendApprovedConnects({
    repository,
    driver,
    runContext: { weeklyCap: 140 },
  });

  assert.equal(result.reason, 'stopped_rate_limit_signal');
  assert.equal(result.unprocessed, 1);
  assert.equal(result.summary.rateLimited, 1);
  assert.equal(result.results[0].rateLimit.matchedSignal, 'too many requests');
});
