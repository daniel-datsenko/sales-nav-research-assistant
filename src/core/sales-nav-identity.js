function normalizeSalesNavigatorLeadUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/$/, '');
  }
}

function extractSalesNavigatorLeadId(url) {
  const normalized = normalizeSalesNavigatorLeadUrl(url);
  const match = normalized.match(/\/sales\/lead\/([^/?#]+)/i);
  if (!match) {
    return '';
  }
  return decodeURIComponent(match[1]).split(',')[0].trim();
}

function normalizeIdentityName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function buildSalesNavigatorLeadIdentity(value = {}) {
  const salesNavigatorUrl = normalizeSalesNavigatorLeadUrl(
    value.salesNavigatorUrl
      || value.profileUrl
      || value.url
      || value.candidate?.salesNavigatorUrl
      || '',
  );
  return {
    salesNavigatorUrl,
    salesNavigatorLeadId: value.salesNavigatorLeadId
      || value.leadId
      || value.entityUrn
      || extractSalesNavigatorLeadId(salesNavigatorUrl),
    fullName: value.fullName || value.name || value.candidate?.fullName || '',
    title: value.title || value.headline || value.candidate?.title || '',
    accountName: value.accountName || value.company || value.candidate?.accountName || '',
  };
}

function salesNavigatorLeadIdentitiesMatch(left = {}, right = {}) {
  const leftIdentity = buildSalesNavigatorLeadIdentity(left);
  const rightIdentity = buildSalesNavigatorLeadIdentity(right);
  if (leftIdentity.salesNavigatorLeadId && rightIdentity.salesNavigatorLeadId) {
    return leftIdentity.salesNavigatorLeadId === rightIdentity.salesNavigatorLeadId;
  }
  return Boolean(
    leftIdentity.salesNavigatorUrl
      && rightIdentity.salesNavigatorUrl
      && leftIdentity.salesNavigatorUrl === rightIdentity.salesNavigatorUrl,
  );
}

function findSalesNavigatorLeadIdentityMatch(target = {}, rows = []) {
  const sameIdentity = (rows || []).find((row) => salesNavigatorLeadIdentitiesMatch(target, row));
  if (sameIdentity) {
    return {
      status: 'matched',
      row: sameIdentity,
      identity: buildSalesNavigatorLeadIdentity(sameIdentity),
    };
  }

  const targetName = normalizeIdentityName(target.fullName || target.name);
  const sameName = targetName
    ? (rows || []).find((row) => normalizeIdentityName(row.fullName || row.name) === targetName)
    : null;
  if (sameName) {
    return {
      status: 'same_name_wrong_identity',
      row: sameName,
      identity: buildSalesNavigatorLeadIdentity(sameName),
    };
  }

  return {
    status: 'missing',
    row: null,
    identity: null,
  };
}

module.exports = {
  buildSalesNavigatorLeadIdentity,
  extractSalesNavigatorLeadId,
  findSalesNavigatorLeadIdentityMatch,
  normalizeSalesNavigatorLeadUrl,
  salesNavigatorLeadIdentitiesMatch,
};
