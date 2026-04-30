const GERMAN_COUNTRIES = new Set(['germany', 'austria', 'switzerland', 'deutschland', 'österreich', 'schweiz']);
const EMEA_REGION_ALIASES = new Set(['emea', 'europe', 'middle east', 'africa']);

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickFirst(row, keys) {
  for (const key of keys) {
    if (row?.[key] !== undefined && row?.[key] !== null && String(row[key]).trim()) {
      return String(row[key]).trim();
    }
  }
  return null;
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const trimmed = String(value || '').trim();
    const key = normalizeText(trimmed);
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function inferPrimaryLanguageFromCountries(countries = []) {
  const normalized = countries.map(normalizeText);
  if (normalized.some((country) => GERMAN_COUNTRIES.has(country))) {
    return 'de';
  }
  return 'en';
}

function buildDefaultLanguageSplitPolicy(primaryLanguage = 'de') {
  return {
    enabled: true,
    defaultPrimaryLanguage: primaryLanguage || 'de',
    buckets: {
      de: 'German profile language',
      en: 'English and other profile languages',
    },
  };
}

function inferSdaTerritoryContext({ manualContext = null, bigQueryRows = [] } = {}) {
  if (manualContext?.territoryId || manualContext?.territoryName) {
    const countries = unique(manualContext.countries || []);
    const primaryLanguage = manualContext.primaryLanguage || inferPrimaryLanguageFromCountries(countries);
    return {
      status: 'provided_by_sda',
      territoryId: manualContext.territoryId || null,
      territoryName: manualContext.territoryName || null,
      region: manualContext.region || 'EMEA',
      countries,
      source: 'manual',
      languageSplitPolicy: buildDefaultLanguageSplitPolicy(primaryLanguage),
      requiredFields: [],
    };
  }

  if (Array.isArray(bigQueryRows) && bigQueryRows.length > 0) {
    const territoryId = pickFirst(bigQueryRows[0], ['territory_id', 'territoryId', 'territory2_id', 'Territory2Id']);
    const territoryName = pickFirst(bigQueryRows[0], ['territory_name', 'territoryName', 'Name']);
    const region = pickFirst(bigQueryRows[0], ['region', 'Region', 'sales_region']) || 'EMEA';
    const countries = unique(bigQueryRows.map((row) => pickFirst(row, ['country', 'billing_country', 'BillingCountry', 'account_country'])));
    const normalizedRegion = normalizeText(region);
    const inferredRegion = EMEA_REGION_ALIASES.has(normalizedRegion) || /\bemea\b/.test(normalizedRegion)
      ? 'EMEA'
      : region;
    const primaryLanguage = inferPrimaryLanguageFromCountries(countries);

    return {
      status: 'inferred_from_bigquery',
      territoryId: territoryId || null,
      territoryName: territoryName || null,
      region: inferredRegion,
      countries,
      source: 'bigquery',
      languageSplitPolicy: buildDefaultLanguageSplitPolicy(primaryLanguage),
      requiredFields: [],
    };
  }

  return {
    status: 'requires_sda_input',
    territoryId: null,
    territoryName: null,
    region: 'EMEA',
    countries: [],
    source: 'manual_required',
    languageSplitPolicy: buildDefaultLanguageSplitPolicy('de'),
    requiredFields: ['territoryId', 'territoryName or territory description', 'countries or account scope'],
  };
}

function inferProfileLanguage(candidate = {}) {
  const explicit = normalizeText(candidate.profileLanguage || candidate.language || candidate.locale || candidate.profileLocale);
  if (/^(de|deutsch|german|de-de|de-at|de-ch)\b/.test(explicit)) {
    return 'de';
  }
  if (/^(en|english|en-gb|en-us)\b/.test(explicit)) {
    return 'en';
  }

  const text = normalizeText(`${candidate.title || ''} ${candidate.headline || ''} ${candidate.summary || ''}`);
  if (/\b(deutsch|leiter|leiterin|bereichsleiter|abteilungsleiter|verantwortlich|plattform|kompetenzzentrum)\b/.test(text)) {
    return 'de';
  }
  return 'en';
}

function splitCandidatesByProfileLanguage(candidates = [], options = {}) {
  const primaryLanguage = options.primaryLanguage || 'de';
  const primaryBucket = primaryLanguage === 'de' ? 'de' : primaryLanguage;
  const result = {
    de: [],
    en: [],
    meta: {
      de: { label: 'DE', count: 0 },
      en: { label: 'EN/other', count: 0 },
    },
  };

  for (const candidate of candidates || []) {
    const language = inferProfileLanguage(candidate);
    const bucket = language === primaryBucket && primaryBucket === 'de' ? 'de' : 'en';
    result[bucket].push({
      ...candidate,
      inferredProfileLanguage: language,
      languageSplitBucket: bucket,
    });
  }

  result.meta.de.count = result.de.length;
  result.meta.en.count = result.en.length;
  return result;
}

function buildLanguageSplitListNames({ accountName, segment = 'prospects', prefix = null } = {}) {
  const base = [prefix, accountName, segment]
    .filter(Boolean)
    .join(' - ')
    .replace(/\s+/g, ' ')
    .trim();
  return {
    de: `${base} - DE`,
    en: `${base} - EN`,
  };
}

module.exports = {
  buildLanguageSplitListNames,
  inferProfileLanguage,
  inferSdaTerritoryContext,
  splitCandidatesByProfileLanguage,
};
