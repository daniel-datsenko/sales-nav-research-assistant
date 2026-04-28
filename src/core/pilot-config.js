const { readJson } = require('../lib/json');
const { resolveProjectPath } = require('../lib/paths');

function loadPilotConfig(configPath = null) {
  const targetPath = configPath || resolveProjectPath('config', 'pilot', 'default.json');
  const payload = readJson(targetPath);
  return {
    path: targetPath,
    mode: String(payload.mode || 'lists-first').trim(),
    description: String(payload.description || '').trim(),
    geoFocus: {
      description: String(payload.geoFocus?.description || '').trim(),
      strictInclude: Boolean(payload.geoFocus?.strictInclude),
      preferredLocationKeywords: Array.isArray(payload.geoFocus?.preferredLocationKeywords)
        ? payload.geoFocus.preferredLocationKeywords.map((value) => String(value || '').trim()).filter(Boolean)
        : [],
      excludedLocationKeywords: Array.isArray(payload.geoFocus?.excludedLocationKeywords)
        ? payload.geoFocus.excludedLocationKeywords.map((value) => String(value || '').trim()).filter(Boolean)
        : [],
    },
    connectPolicy: {
      eligibleAccounts: Array.isArray(payload.connectPolicy?.eligibleAccounts)
        ? payload.connectPolicy.eligibleAccounts.map((value) => String(value || '').trim()).filter(Boolean)
        : [],
      listsFirstOnlyAccounts: payload.connectPolicy?.listsFirstOnlyAccounts
        && typeof payload.connectPolicy.listsFirstOnlyAccounts === 'object'
        ? Object.fromEntries(
          Object.entries(payload.connectPolicy.listsFirstOnlyAccounts)
            .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
            .filter(([key, value]) => key && value),
        )
        : {},
      manualReviewAccounts: payload.connectPolicy?.manualReviewAccounts
        && typeof payload.connectPolicy.manualReviewAccounts === 'object'
        ? Object.fromEntries(
          Object.entries(payload.connectPolicy.manualReviewAccounts)
            .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
            .filter(([key, value]) => key && value),
        )
        : {},
      blockedAccounts: payload.connectPolicy?.blockedAccounts && typeof payload.connectPolicy.blockedAccounts === 'object'
        ? Object.fromEntries(
          Object.entries(payload.connectPolicy.blockedAccounts)
            .map(([key, value]) => [String(key || '').trim(), String(value || '').trim()])
            .filter(([key, value]) => key && value),
        )
        : {},
    },
  };
}

function getPilotConnectPolicyDecision(pilotConfig, accountName) {
  const normalized = String(accountName || '').trim().toLowerCase();

  const manualReviewEntry = Object.entries(pilotConfig?.connectPolicy?.manualReviewAccounts || {})
    .find(([key]) => String(key || '').trim().toLowerCase() === normalized);
  if (manualReviewEntry) {
    return {
      allowed: false,
      reason: manualReviewEntry[1],
      policyClass: 'manual_review_required',
    };
  }

  const listsFirstOnlyEntry = Object.entries({
    ...(pilotConfig?.connectPolicy?.listsFirstOnlyAccounts || {}),
    ...(pilotConfig?.connectPolicy?.blockedAccounts || {}),
  }).find(([key]) => String(key || '').trim().toLowerCase() === normalized);
  if (listsFirstOnlyEntry) {
    return {
      allowed: false,
      reason: listsFirstOnlyEntry[1],
      policyClass: 'lists_first_only',
    };
  }

  const eligible = (pilotConfig?.connectPolicy?.eligibleAccounts || [])
    .some((value) => String(value || '').trim().toLowerCase() === normalized);
  if (eligible) {
    return {
      allowed: true,
      reason: null,
      policyClass: 'connect_eligible',
    };
  }

  return {
    allowed: false,
    reason: 'account not yet approved for automated pilot connects',
    policyClass: 'lists_first_only',
  };
}

module.exports = {
  loadPilotConfig,
  getPilotConnectPolicyDecision,
};
