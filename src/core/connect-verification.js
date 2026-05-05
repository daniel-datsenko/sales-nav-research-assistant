const {
  buildSalesNavigatorLeadIdentity,
  findSalesNavigatorLeadIdentityMatch,
} = require('./sales-nav-identity');

function hasVerifiedConnectState(row = {}) {
  const rowText = String(row.rowText || row.statusText || row.note || '').toLowerCase();
  return Boolean(
    row.pendingInvitation
      || row.invitationSent
      || row.connectionSent
      || row.degree === 1
      || row.degree === '1'
      || row.networkDistance === '1st'
      || /invitation sent|connection sent|pending|einladung gesendet|verbindung gesendet|ausstehend/.test(rowText),
  );
}

function verifyConnectResultWithSnapshot({ candidate, result, snapshot } = {}) {
  const status = result?.status || 'manual_review';
  if (!['sent'].includes(status)) {
    return {
      ...result,
      verifiedConnect: ['already_sent', 'already_connected'].includes(status),
      verificationStatus: ['already_sent', 'already_connected'].includes(status) ? 'verified_noop' : (result?.verificationStatus || null),
    };
  }

  const match = findSalesNavigatorLeadIdentityMatch(candidate, snapshot?.rows || []);
  if (match.status === 'matched' && hasVerifiedConnectState(match.row)) {
    return {
      ...result,
      status: 'sent',
      verifiedConnect: true,
      verificationStatus: match.row.connectionSent || match.row.degree === 1 || match.row.degree === '1'
        ? 'verified_connected'
        : 'verified_pending_invitation',
      verificationMethod: 'lead_list_readback',
      intendedLeadIdentity: buildSalesNavigatorLeadIdentity(candidate),
      readbackLeadIdentity: match.identity,
    };
  }

  return {
    ...result,
    status: 'manual_review',
    verifiedConnect: false,
    verificationStatus: match.status === 'same_name_wrong_identity'
      ? 'wrong_identity_detected'
      : 'unverified_after_connect',
    verificationMethod: 'lead_list_readback',
    intendedLeadIdentity: buildSalesNavigatorLeadIdentity(candidate),
    readbackLeadIdentity: match.identity,
    note: match.status === 'same_name_wrong_identity'
      ? 'connect outcome unverified: same-name row has a different Sales Navigator lead identity'
      : 'connect outcome unverified: target lead was not pending/connected in readback',
  };
}

async function verifyConnectResult({ candidate, result, readSnapshot }) {
  if (result?.status !== 'sent') {
    return verifyConnectResultWithSnapshot({ candidate, result, snapshot: null });
  }
  if (typeof readSnapshot !== 'function') {
    return {
      ...result,
      status: 'manual_review',
      verifiedConnect: false,
      verificationStatus: 'verification_unavailable',
      verificationMethod: 'none',
      intendedLeadIdentity: buildSalesNavigatorLeadIdentity(candidate),
      note: 'connect outcome unverified: no durable readback verifier was available',
    };
  }
  try {
    return verifyConnectResultWithSnapshot({
      candidate,
      result,
      snapshot: await readSnapshot(),
    });
  } catch (error) {
    return {
      ...result,
      status: 'manual_review',
      verifiedConnect: false,
      verificationStatus: 'readback_failed',
      verificationMethod: 'lead_list_readback',
      intendedLeadIdentity: buildSalesNavigatorLeadIdentity(candidate),
      note: `connect outcome unverified: readback failed: ${String(error.message || error)}`,
    };
  }
}

function summarizeConnectResults(results = [], unprocessed = 0) {
  const count = (status) => results.filter((row) => row.status === status).length;
  return {
    attempted: results.length,
    verifiedSent: results.filter((row) => row.status === 'sent' && row.verifiedConnect).length,
    alreadyConnected: count('already_connected'),
    alreadyPending: count('already_sent'),
    unavailable: count('connect_unavailable'),
    failed: count('failed'),
    manualReviewUnverified: results.filter((row) => row.status === 'manual_review').length,
    rateLimited: count('rate_limited'),
    unprocessed,
  };
}

module.exports = {
  hasVerifiedConnectState,
  summarizeConnectResults,
  verifyConnectResult,
  verifyConnectResultWithSnapshot,
};
