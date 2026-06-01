const SAFE_TEXT_LIMIT = 500;

const PROFILE_QUERY_IDS = [
  'voyagerIdentityDashProfiles.e9b0809465a07db1f02e70a82d455e10',
  'voyagerIdentityDashProfiles.b5c27c04968c409fc0ed3546575b9b7a',
];

const OBSERVABILITY_NATIVE_TERMS = [
  'grafana',
  'prometheus',
  'loki',
  'tempo',
  'opentelemetry',
  'open telemetry',
  'observability',
  'monitoring',
  'telemetry',
  'tracing',
  'logging',
  'metrics',
  'sre',
  'site reliability',
];

const COMPETITIVE_TERMS = [
  'datadog',
  'dynatrace',
  'new relic',
  'splunk',
  'elastic',
  'appdynamics',
  'instana',
];

const LEGACY_TERMS = [
  'nagios',
  'zabbix',
  'icinga',
  'checkmk',
  'sensu',
];

const PLATFORM_TERMS = [
  'kubernetes',
  'k8s',
  'terraform',
  'ansible',
  'helm',
  'docker',
  'openshift',
  'devops',
  'devsecops',
  'platform engineering',
  'cloud platform',
  'infrastructure',
];

const LANGUAGE_TERMS = [
  'responsable',
  'directeur',
  'directrice',
  'observabilité',
  'observabilite',
  'observabilität',
  'observabilidad',
  'osservabilità',
  'leiter',
  'bereichsleiter',
  'ingénieur',
  'ingenieur',
  'ingeniero',
  'ingegnere',
];

function stripQuotedCookieValue(value) {
  return String(value || '').trim().replace(/^"+|"+$/g, '');
}

function extractVoyagerCsrfFromCookies(cookies = []) {
  const cookie = (cookies || []).find((item) => item && item.name === 'JSESSIONID');
  return stripQuotedCookieValue(cookie?.value || '');
}

function classifyVoyagerFailure({ status = 0, bodyText = '', sessionState = '' } = {}) {
  const normalized = String(bodyText || '').toLowerCase();
  if (sessionState && sessionState !== 'authenticated') {
    return 'not_authenticated';
  }
  if (status === 401 || status === 403 || /login|csrf|unauthorized|forbidden/.test(normalized)) {
    return 'voyager_blocked';
  }
  if (status === 404 || /not.?found|profile_not_found/.test(normalized)) {
    return 'profile_not_found';
  }
  if (status === 429 || /too many requests|rate.?limit|throttl|try again later/.test(normalized)) {
    return 'rate_limited';
  }
  if (!status) {
    return 'voyager_blocked';
  }
  return 'unexpected_shape';
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeForMatch(value) {
  return normalizeText(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function collectByKey(value, matcher, output = []) {
  if (value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    for (const item of value) collectByKey(item, matcher, output);
    return output;
  }
  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (typeof inner === 'string' && matcher(key, inner)) {
        const text = normalizeText(inner);
        if (text) output.push(text);
      }
      if (inner && typeof inner === 'object') {
        collectByKey(inner, matcher, output);
      }
    }
  }
  return output;
}

function uniqueLimit(values = [], limit = 12) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = normalizeText(value);
    const key = normalizeForMatch(text);
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text.slice(0, SAFE_TEXT_LIMIT));
    if (output.length >= limit) break;
  }
  return output;
}

function extractPublicIdentifierFromUrl(url) {
  const match = String(url || '').match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]).trim() : '';
}

function extractProfileUrn(value = {}) {
  const candidates = [
    value.voyagerProfileUrn,
    value.profileUrn,
    value.dashEntityUrn,
    value.entityUrn,
  ].filter(Boolean);
  return candidates.find((item) => /urn:li:fsd?_profile:/i.test(String(item))) || '';
}

function resolveVoyagerIdentity(candidate = {}) {
  const publicIdentifier = candidate.publicIdentifier
    || candidate.linkedinSlug
    || extractPublicIdentifierFromUrl(candidate.publicProfileUrl)
    || extractPublicIdentifierFromUrl(candidate.linkedinProfileUrl)
    || extractPublicIdentifierFromUrl(candidate.profileUrl);
  const profileUrn = extractProfileUrn(candidate);
  if (!publicIdentifier && !profileUrn) {
    return {
      status: 'missing_voyager_identity',
      publicIdentifier: '',
      profileUrn: '',
    };
  }
  return {
    status: 'resolved',
    publicIdentifier,
    profileUrn,
  };
}

function buildVoyagerProfilePaths(identity = {}) {
  if (identity.publicIdentifier) {
    return PROFILE_QUERY_IDS.map((queryId) =>
      `/voyager/api/graphql?includeWebMetadata=true&variables=(memberIdentity:${encodeURIComponent(identity.publicIdentifier)})&queryId=${queryId}`);
  }
  if (identity.profileUrn) {
    return PROFILE_QUERY_IDS.map((queryId) =>
      `/voyager/api/graphql?includeWebMetadata=true&variables=(profileUrn:${encodeURIComponent(identity.profileUrn)})&queryId=${queryId}`);
  }
  return [];
}

function collectSignalMatches(text, terms) {
  const normalized = normalizeForMatch(text);
  return uniqueLimit(terms.filter((term) => normalized.includes(normalizeForMatch(term))), 20);
}

function classifyPitchStrategy({ observabilitySignals = [], competitiveSignals = [], legacySignals = [] } = {}) {
  const hasNative = observabilitySignals.length > 0;
  const hasCompetitive = competitiveSignals.length > 0;
  const hasLegacy = legacySignals.length > 0;
  if (hasNative && (hasCompetitive || hasLegacy)) return 'coexist';
  if (hasNative) return 'advocate';
  if (hasCompetitive) return 'displace';
  if (hasLegacy) return 'migrate';
  return 'unknown';
}

function normalizeVoyagerProfileResponse(payload = {}, { candidate = {} } = {}) {
  const headline = uniqueLimit(collectByKey(payload, (key) => /^headline$/i.test(key)), 2)[0]
    || candidate.headline
    || '';
  const aboutValues = collectByKey(payload, (key) => /summary|about|description/i.test(key));
  const titleValues = collectByKey(payload, (key, value) => (
    /^title$/i.test(key)
    && !/^https?:\/\//i.test(value)
    && value.length <= 180
  ));
  const skillValues = collectByKey(payload, (key) => /skill/i.test(key));
  const nameValues = collectByKey(payload, (key) => /^name$/i.test(key));
  const companyValues = collectByKey(payload, (key) => /companyName|company/i.test(key));
  const allText = [
    headline,
    ...aboutValues,
    ...titleValues,
    ...skillValues,
    ...nameValues,
    ...companyValues,
  ].join(' ');
  const observabilitySignals = collectSignalMatches(allText, OBSERVABILITY_NATIVE_TERMS);
  const competitiveSignals = collectSignalMatches(allText, COMPETITIVE_TERMS);
  const legacySignals = collectSignalMatches(allText, LEGACY_TERMS);
  const platformSignals = collectSignalMatches(allText, PLATFORM_TERMS);
  const languageSignals = collectSignalMatches(allText, LANGUAGE_TERMS);
  const stackSignals = uniqueLimit([
    ...observabilitySignals,
    ...competitiveSignals,
    ...legacySignals,
    ...platformSignals,
  ], 30);
  const snippet = normalizeText([
    headline,
    ...uniqueLimit(aboutValues, 3),
    ...uniqueLimit(titleValues, 6),
    ...stackSignals,
  ].join(' ')).slice(0, SAFE_TEXT_LIMIT);

  return {
    headline,
    about: uniqueLimit(aboutValues, 3),
    currentTitles: uniqueLimit(titleValues, 6),
    recentExperienceTitles: uniqueLimit(titleValues.slice(0, 10), 10),
    skills: uniqueLimit([...skillValues, ...nameValues].filter((value) =>
      collectSignalMatches(value, [...OBSERVABILITY_NATIVE_TERMS, ...COMPETITIVE_TERMS, ...LEGACY_TERMS, ...PLATFORM_TERMS]).length > 0), 20),
    currentCompany: uniqueLimit(companyValues, 3)[0] || candidate.company || '',
    observabilitySignals,
    competitiveSignals,
    legacySignals,
    platformSignals,
    stackSignals,
    languageSignals,
    pitchStrategy: classifyPitchStrategy({ observabilitySignals, competitiveSignals, legacySignals }),
    snippet,
    signalCount: observabilitySignals.length + competitiveSignals.length + legacySignals.length + platformSignals.length + languageSignals.length,
  };
}

function buildVoyagerProfileArtifact({
  candidate = {},
  identity = {},
  response = null,
  error = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const signals = response?.payload
    ? normalizeVoyagerProfileResponse(response.payload, { candidate })
    : null;
  return {
    generatedAt,
    mode: 'read_only',
    source: 'voyager',
    voyagerReadable: Boolean(response?.ok && signals),
    profileIdentity: {
      publicIdentifier: identity.publicIdentifier || null,
      profileUrn: identity.profileUrn || null,
    },
    candidate: {
      fullName: candidate.fullName || null,
      salesNavigatorUrl: candidate.salesNavigatorUrl || null,
      profileUrl: candidate.profileUrl || null,
      publicProfileUrl: candidate.publicProfileUrl || null,
    },
    fieldsFound: signals ? {
      headline: Boolean(signals.headline),
      about: signals.about.length > 0,
      experience: signals.currentTitles.length > 0,
      skills: signals.skills.length > 0,
      currentCompany: Boolean(signals.currentCompany),
    } : {},
    signals,
    error: error ? {
      code: error.code || 'unexpected_shape',
      message: String(error.message || error).slice(0, SAFE_TEXT_LIMIT),
      status: error.status || null,
    } : null,
  };
}

module.exports = {
  buildVoyagerProfileArtifact,
  buildVoyagerProfilePaths,
  classifyPitchStrategy,
  classifyVoyagerFailure,
  extractVoyagerCsrfFromCookies,
  normalizeVoyagerProfileResponse,
  resolveVoyagerIdentity,
};
