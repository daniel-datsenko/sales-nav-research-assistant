const {
  classifyCompanyEntityPriority,
  compareCompanyTargetPriority,
} = require('./company-resolution');

const SAFE_TEXT_LIMIT = 500;

function stripQuotedCookieValue(value) {
  return String(value || '').trim().replace(/^"+|"+$/g, '');
}

function extractCsrfFromCookies(cookies = []) {
  const cookie = (cookies || []).find((item) => item && item.name === 'JSESSIONID');
  return stripQuotedCookieValue(cookie?.value || '');
}

function extractCsrfFromCookieHeader(cookieHeader = '') {
  const match = String(cookieHeader || '').match(/(?:^|;\s*)JSESSIONID="?([^";]+)"?/i);
  return stripQuotedCookieValue(match?.[1] || '');
}

function classifySalesNavApiFailure({ status = 0, bodyText = '', sessionState = '' } = {}) {
  const normalized = String(bodyText || '').toLowerCase();
  if (sessionState && sessionState !== 'authenticated') {
    return 'not_authenticated';
  }
  if (status === 401 || status === 403 || /login|csrf|unauthorized|forbidden/.test(normalized)) {
    return 'api_blocked';
  }
  if (status === 429 || /too many requests|rate.?limit|throttl|try again later/.test(normalized)) {
    return 'rate_limited';
  }
  if (!status) {
    return 'api_blocked';
  }
  return 'unexpected_shape';
}

function safePreview(value) {
  return String(value || '').slice(0, SAFE_TEXT_LIMIT);
}

function restliKeyword(value) {
  return encodeURIComponent(String(value || '').trim()).replace(/[()]/g, '');
}

function buildCompanySearchPath(accountName, { count = 10, start = 0 } = {}) {
  const keywords = restliKeyword(accountName);
  return `/sales-api/salesApiAccountSearch?q=searchQuery&query=(filters:List(),keywords:${keywords})&start=${start}&count=${count}&decorationId=com.linkedin.sales.deco.desktop.searchv2.AccountSearchResult-4`;
}

function buildLeadSearchPath({ companyId, keywords = '', start = 0, count = 25 } = {}) {
  const filters = companyId
    ? `(type:CURRENT_COMPANY,values:List((id:${String(companyId).trim()})))`
    : '';
  const keywordPart = keywords ? `,keywords:${restliKeyword(keywords)}` : '';
  const query = `(filters:List(${filters})${keywordPart})`;
  return `/sales-api/salesApiLeadSearch?q=searchQuery&query=${query}&start=${start}&count=${count}&decorationId=com.linkedin.sales.deco.desktop.searchv2.LeadSearchResult-16`;
}

function buildLeadListReadbackPath({ listId, start = 0, count = 100 } = {}) {
  const id = String(listId || '').trim();
  const query = `(spotlightParam:(selectedType:ALL),doFetchSpotlights:false,doFetchHits:true,doFetchFilters:false,pivotParam:(com.linkedin.sales.search.LeadListPivotRequest:(list:urn%3Ali%3Afs_salesList%3A${id},sortCriteria:LAST_ACTIVITY,sortOrder:DESCENDING)),list:(scope:LEAD,includeAll:false,excludeAll:false,includedValues:List((id:${id}))))`;
  return `/sales-api/salesApiPeopleSearch?q=peopleSearchQuery&query=${query}&start=${start}&count=${count}`;
}

function walkStrings(value, output = []) {
  if (value === null || value === undefined) return output;
  if (typeof value === 'string') {
    output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkStrings(item, output);
    return output;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) walkStrings(item, output);
  }
  return output;
}

function findFirstStringByKey(value, keyMatchers = []) {
  if (!value || typeof value !== 'object') return '';
  const stack = [value];
  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== 'object') continue;
    for (const [key, inner] of Object.entries(current)) {
      if (typeof inner === 'string' && keyMatchers.some((matcher) => matcher.test(key))) {
        return inner;
      }
      if (inner && typeof inner === 'object') stack.push(inner);
    }
  }
  return '';
}

function extractCompanyId(value = {}) {
  const strings = walkStrings(value);
  for (const item of strings) {
    const urlMatch = item.match(/\/sales\/company\/([^/?#]+)/i);
    if (urlMatch) return decodeURIComponent(urlMatch[1]).trim();
    const urnMatch = item.match(/fs_salesCompany[:(](\d+)/i);
    if (urnMatch) return urnMatch[1];
  }
  return '';
}

function extractLeadIdFromUrn(entityUrn = '') {
  const match = String(entityUrn || '').match(/fs_salesProfile:\(?([^,\)]+)/i);
  return match ? match[1].trim() : '';
}

function extractLeadId(value = {}) {
  const entityUrn = findEntityUrn(value);
  const urnLeadId = extractLeadIdFromUrn(entityUrn);
  if (urnLeadId) return urnLeadId;
  const strings = walkStrings(value);
  for (const item of strings) {
    const match = item.match(/\/sales\/lead\/([^/?#]+)/i);
    if (match) return decodeURIComponent(match[1]).split(',')[0].trim();
  }
  return '';
}

function findEntityUrn(value = {}) {
  const direct = findFirstStringByKey(value, [/entityUrn/i, /^urn$/i]);
  if (direct) return direct;
  return walkStrings(value).find((item) => /urn:li:fs_sales(Profile|Company)/i.test(item)) || '';
}

function findSalesNavUrl(value = {}, type = 'lead') {
  const pattern = type === 'company' ? /\/sales\/company\//i : /\/sales\/lead\//i;
  return walkStrings(value).find((item) => pattern.test(item)) || '';
}

function normalizeCompanySearchResponse(payload = {}) {
  return (payload.elements || []).map((element) => {
    const name = findFirstStringByKey(element, [/^name$/i, /companyName/i, /accountName/i])
      || findFirstStringByKey(element, [/title/i]);
    const companyId = extractCompanyId(element);
    const entityUrn = findEntityUrn(element);
    const salesNavigatorUrl = findSalesNavUrl(element, 'company')
      || (companyId ? `https://www.linkedin.com/sales/company/${companyId}` : '');
    return {
      name,
      companyId,
      entityUrn,
      salesNavigatorUrl,
    };
  }).filter((item) => item.name || item.companyId || item.entityUrn);
}

function normalizeLeadSearchResponse(payload = {}) {
  return (payload.elements || []).map(normalizeLeadElement).filter((item) => (
    item.fullName || item.entityUrn || item.salesNavigatorLeadId
  ));
}

function normalizeLeadElement(element = {}) {
  const firstName = findFirstStringByKey(element, [/firstName/i]);
  const lastName = findFirstStringByKey(element, [/lastName/i]);
  const fullName = findFirstStringByKey(element, [/fullName/i, /^name$/i])
    || [firstName, lastName].filter(Boolean).join(' ').trim();
  const currentPosition = Array.isArray(element.currentPositions)
    ? element.currentPositions.find((position) => position?.current !== false) || element.currentPositions[0]
    : null;
  const title = currentPosition?.title
    || findFirstStringByKey(element, [/^title$/i, /headline/i]);
  const companyName = currentPosition?.companyName
    || findFirstStringByKey(element, [/companyName/i, /accountName/i]);
  const entityUrn = findEntityUrn(element);
  const salesNavigatorLeadId = extractLeadId(element);
  const salesNavigatorUrl = findSalesNavUrl(element, 'lead')
    || (salesNavigatorLeadId ? `https://www.linkedin.com/sales/lead/${salesNavigatorLeadId}` : '');
  return {
    entityUrn,
    salesNavigatorLeadId,
    salesNavigatorUrl,
    fullName,
    title,
    companyName,
    degree: element.degree || element.networkDistance || null,
    pendingInvitation: Boolean(element.pendingInvitation),
    saved: Boolean(element.saved),
  };
}

function normalizeCompanyNameForApi(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(gmbh|mbh|ag|se|sa|s\.a\.|spa|s\.p\.a\.|ltd|limited|inc|corp|corporation|llc|plc|group|holding|holdings)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function assessApiCompanyResolution(accountName, companyCandidates = []) {
  const normalizedAccount = normalizeCompanyNameForApi(accountName);
  const enriched = (companyCandidates || [])
    .map((candidate, index) => ({
      ...candidate,
      index,
      normalizedName: normalizeCompanyNameForApi(candidate.name),
    }))
    .map((candidate) => ({
      ...candidate,
      entityPriority: classifyCompanyEntityPriority({
        linkedinName: candidate.name,
        targetType: candidate.normalizedName === normalizedAccount ? 'parent' : 'unknown',
        evidence: candidate.evidence || [],
      }),
    }))
    .filter((candidate) => candidate.normalizedName && candidate.companyId);
  const exact = enriched.filter((candidate) => candidate.normalizedName === normalizedAccount);
  const prefixed = enriched.filter((candidate) => (
    candidate.normalizedName !== normalizedAccount
    && candidate.normalizedName.startsWith(`${normalizedAccount} `)
  ));

  if (!normalizedAccount || enriched.length === 0) {
    return {
      status: 'all_resolution_failed',
      confidence: 0,
      selectedTargets: [],
      warning: 'no_api_company_candidates',
    };
  }

  if (exact.length > 1) {
    return {
      status: 'needs_company_scope_review',
      confidence: 0.55,
      selectedTargets: [...exact].sort(compareCompanyTargetPriority),
      warning: 'api_company_search_ambiguous_exact_matches',
    };
  }

  if (exact.length === 1 && prefixed.length >= 2) {
    const selectedTargets = [exact[0], ...prefixed.slice(0, 4)].sort(compareCompanyTargetPriority);
    return {
      status: 'resolved_multi_target_api',
      confidence: 0.82,
      selectedTargets,
      warning: null,
    };
  }

  if (exact.length === 1) {
    return {
      status: 'resolved_exact_api',
      confidence: 0.95,
      selectedTargets: [exact[0]],
      warning: null,
    };
  }

  if (prefixed.length > 0) {
    return {
      status: 'needs_company_scope_review',
      confidence: 0.62,
      selectedTargets: prefixed.slice(0, 4).sort(compareCompanyTargetPriority),
      warning: 'api_company_search_missing_exact_match',
    };
  }

  return {
    status: 'all_resolution_failed',
    confidence: 0,
    selectedTargets: [],
    warning: 'no_plausible_api_company_target',
  };
}

function normalizeApiLeadForCoverage(lead = {}, {
  accountName = '',
  sourceTarget = null,
} = {}) {
  return {
    fullName: lead.fullName,
    title: lead.title,
    headline: lead.title,
    company: lead.companyName || sourceTarget?.name || accountName,
    accountName: lead.companyName || sourceTarget?.name || accountName,
    salesNavigatorUrl: lead.salesNavigatorUrl,
    profileUrl: lead.salesNavigatorUrl,
    entityUrn: lead.entityUrn,
    salesNavigatorLeadId: lead.salesNavigatorLeadId,
    degree: lead.degree,
    pendingInvitation: lead.pendingInvitation,
    saved: lead.saved,
    source: 'api_read_prefetch',
    sourceTarget,
  };
}

function buildSalesNavApiProbeArtifact({
  accountName,
  listName = null,
  companyResponse = null,
  leadResponse = null,
  listResponse = null,
  listId = null,
  errors = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const companyCandidates = companyResponse?.payload
    ? normalizeCompanySearchResponse(companyResponse.payload)
    : [];
  const leadCandidates = leadResponse?.payload
    ? normalizeLeadSearchResponse(leadResponse.payload)
    : [];
  const listRows = listResponse?.payload
    ? normalizeLeadSearchResponse(listResponse.payload)
    : [];
  const entityUrnRows = [...leadCandidates, ...listRows].filter((row) => row.entityUrn).length;
  const totalRows = leadCandidates.length + listRows.length;
  return {
    generatedAt,
    status: errors.length > 0 ? 'completed_with_warnings' : 'completed',
    mode: 'read_only',
    accountName,
    listName,
    listId,
    apiReadable: Boolean(companyResponse?.ok || leadResponse?.ok || listResponse?.ok),
    counts: {
      companyCandidates: companyCandidates.length,
      leadCandidates: leadCandidates.length,
      listRows: listRows.length,
      entityUrnCoverage: totalRows > 0 ? entityUrnRows / totalRows : null,
    },
    companyCandidates,
    leadCandidates,
    listRows,
    errors: errors.map((error) => ({
      code: error.code || 'unexpected_shape',
      message: safePreview(error.message || error),
      status: error.status || null,
      path: error.path || null,
    })),
  };
}

module.exports = {
  buildCompanySearchPath,
  buildLeadListReadbackPath,
  buildLeadSearchPath,
  buildSalesNavApiProbeArtifact,
  assessApiCompanyResolution,
  classifySalesNavApiFailure,
  extractCsrfFromCookieHeader,
  extractCsrfFromCookies,
  extractLeadIdFromUrn,
  normalizeApiLeadForCoverage,
  normalizeCompanySearchResponse,
  normalizeLeadElement,
  normalizeLeadSearchResponse,
  safePreview,
};
