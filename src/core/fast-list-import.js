const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('../lib/json');
const {
  ACCOUNT_BATCH_ARTIFACTS_DIR,
  ARTIFACTS_DIR,
  COVERAGE_ARTIFACTS_DIR,
  ensureDir,
  resolveProjectPath,
} = require('../lib/paths');
const {
  buildCompanyResolution,
  companyNameFromLinkedInUrl,
  findCompanyAliasEntry,
  loadCompanyAliasConfig,
  loadLearnedCompanyTargets,
} = require('./company-resolution');
const {
  applyIdentityResolution,
  extractPublicLinkedInSlug,
  inferFullNameFromLinkedInSlug,
  normalizeLookupValue,
  resolveLeadIdentity,
} = require('./lead-identity-resolution');
const {
  createRunTimings,
  finishRunTimings,
  timePhase,
} = require('./speed-telemetry');

const FAST_IMPORT_ARTIFACTS_DIR = path.join(ARTIFACTS_DIR, 'fast-import');
const LEARNED_LEAD_RESOLUTION_SUGGESTIONS_PATH = path.join(FAST_IMPORT_ARTIFACTS_DIR, 'learned-lead-resolution-suggestions.json');
const DEFAULT_ACCOUNT_ALIASES_PATH = resolveProjectPath('config', 'account-aliases', 'default.json');

function deriveListNameFromSource(sourcePath) {
  return path.basename(String(sourcePath || 'fast-list-import'), path.extname(String(sourcePath || '')));
}

function buildSlugNameSignals(slug) {
  const normalized = normalizeLookupValue(String(slug || '').replace(/[-_]+/g, ' '));
  if (!normalized) {
    return [];
  }
  return normalized
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !/^\d+$/.test(token));
}

function slugMatchesCandidateName(slug, fullName) {
  const normalizedName = normalizeLookupValue(fullName);
  const signals = buildSlugNameSignals(slug);
  if (!signals.length || !normalizedName) {
    return false;
  }
  const joinedSlug = signals.join('');
  const compactName = normalizedName.replace(/\s+/g, '');
  return signals.some((signal) => normalizedName.includes(signal))
    || (joinedSlug.length >= 6 && compactName.includes(joinedSlug.slice(0, Math.min(joinedSlug.length, 12))));
}

function buildCompanyAliasTerms(accountName, aliasConfig = loadCompanyAliasConfig()) {
  const entry = findCompanyAliasEntry(aliasConfig, accountName);
  const rawTerms = [
    accountName,
    ...(Array.isArray(entry.accountSearchAliases) ? entry.accountSearchAliases : []),
    ...(Array.isArray(entry.companyFilterAliases) ? entry.companyFilterAliases : []),
    ...(Array.isArray(entry.parentAliases) ? entry.parentAliases : []),
    ...(Array.isArray(entry.subsidiaryAliases) ? entry.subsidiaryAliases : []),
    ...(Array.isArray(entry.linkedinCompanyUrls) ? entry.linkedinCompanyUrls.map(companyNameFromLinkedInUrl) : []),
    ...(Array.isArray(entry.targets) ? entry.targets.map((target) => target.linkedinName || target.name || target.companyName) : []),
  ].filter(Boolean);
  const unique = [];
  for (const term of rawTerms) {
    const trimmed = String(term || '').trim();
    if (!trimmed) {
      continue;
    }
    if (!unique.some((existing) => normalizeLookupValue(existing) === normalizeLookupValue(trimmed))) {
      unique.push(trimmed);
    }
  }
  return unique;
}

function buildFastResolveQueryTerms(accountName, aliasConfig = loadCompanyAliasConfig()) {
  const terms = buildCompanyAliasTerms(accountName, aliasConfig).slice(0, 4);
  if (!terms.includes('')) {
    terms.push('');
  }
  return terms;
}

function getCompanyResolutionTerms(companyResolution, accountName, aliasConfig = loadCompanyAliasConfig()) {
  const aliasTerms = buildCompanyAliasTerms(accountName, aliasConfig);
  const targetTerms = (companyResolution?.targets || [])
    .map((target) => target.linkedinName || target.name || target.companyName)
    .filter(Boolean);
  const terms = [];
  for (const term of [...targetTerms, ...aliasTerms]) {
    const trimmed = String(term || '').trim();
    if (!trimmed) {
      continue;
    }
    if (!terms.some((existing) => normalizeLookupValue(existing) === normalizeLookupValue(trimmed))) {
      terms.push(trimmed);
    }
  }
  return terms;
}

function buildFastResolveQueryPlan({ lead, identityResolution, companyResolution, aliasConfig = loadCompanyAliasConfig() } = {}) {
  const companyTerms = getCompanyResolutionTerms(companyResolution, lead?.accountName, aliasConfig).slice(0, 4);
  const sourceName = identityResolution?.sourceName || lead?.fullName || lead?.name || '';
  const primaryName = identityResolution?.primaryName || sourceName;
  const searchNames = identityResolution?.searchNames?.length ? identityResolution.searchNames : [primaryName].filter(Boolean);
  const plan = [];

  for (const name of searchNames) {
    for (const companyTerm of companyTerms) {
      plan.push({
        query: [name, companyTerm].filter(Boolean).join(' ').trim(),
        name,
        companyTerm,
        queryType: name === primaryName ? 'primary_name_company' : 'alternate_name_company',
        guardedNameOnly: false,
      });
    }
  }

  if (primaryName) {
    plan.push({
      query: primaryName,
      name: primaryName,
      companyTerm: null,
      queryType: 'guarded_name_only',
      guardedNameOnly: true,
    });
  }

  const seen = new Set();
  return plan.filter((entry) => {
    const key = normalizeLookupValue(entry.query);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function dedupeStrings(values = []) {
  const result = [];
  for (const value of values) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      continue;
    }
    if (!result.some((existing) => normalizeLookupValue(existing) === normalizeLookupValue(trimmed))) {
      result.push(trimmed);
    }
  }
  return result;
}

function normalizeCompanyUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw.startsWith('http') ? raw : `https://${raw.replace(/^\/+/, '')}`);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return raw.replace(/[?#].*$/, '').replace(/\/$/, '');
  }
}

function mergeCompanyTargets(existingTargets = [], incomingTargets = []) {
  const byKey = new Map();
  for (const target of [...existingTargets, ...incomingTargets]) {
    if (!target || typeof target !== 'object') {
      continue;
    }
    const linkedinName = String(target.linkedinName || target.name || target.companyName || '').trim();
    const linkedinCompanyUrl = normalizeCompanyUrl(target.linkedinCompanyUrl || target.url || '');
    const key = [
      normalizeLookupValue(linkedinName),
      normalizeLookupValue(linkedinCompanyUrl),
    ].join('::');
    if (!key.replace(/:/g, '')) {
      continue;
    }
    const previous = byKey.get(key) || {};
    byKey.set(key, {
      ...target,
      ...previous,
      linkedinName: previous.linkedinName || linkedinName || target.linkedinName,
      linkedinCompanyUrl: previous.linkedinCompanyUrl || linkedinCompanyUrl || target.linkedinCompanyUrl,
      evidence: dedupeStrings([
        ...(Array.isArray(previous.evidence) ? previous.evidence : []),
        ...(Array.isArray(target.evidence) ? target.evidence : []),
      ]),
    });
  }
  return Array.from(byKey.values());
}

function buildCompanyAliasConfigEntry(accountName, resolvedAlias = {}, now = new Date()) {
  const linkedinName = String(resolvedAlias.linkedinName || resolvedAlias.companyName || '').trim();
  const linkedinCompanyUrl = normalizeCompanyUrl(resolvedAlias.linkedinCompanyUrl || resolvedAlias.url || '');
  const evidence = dedupeStrings([
    ...(Array.isArray(resolvedAlias.evidence) ? resolvedAlias.evidence : []),
    'linkedin_company_search',
  ]);
  const targets = linkedinName ? [{
    linkedinName,
    linkedinCompanyUrl: linkedinCompanyUrl || null,
    targetType: 'unknown',
    territoryFit: 'likely',
    confidence: Number(resolvedAlias.confidence || 0.82),
    evidence,
  }] : [];
  return {
    accountSearchAliases: dedupeStrings([accountName, linkedinName]),
    companyFilterAliases: dedupeStrings([linkedinName, accountName]),
    linkedinCompanyUrls: dedupeStrings([linkedinCompanyUrl]),
    targets,
    resolutionStatus: 'resolved_exact',
    resolutionNotes: `Resolved automatically from LinkedIn company search for "${accountName}".`,
    lastVerifiedAt: now.toISOString(),
  };
}

function mergeAliasConfigEntry(existing = {}, incoming = {}) {
  return {
    ...existing,
    accountSearchAliases: dedupeStrings([
      ...(Array.isArray(existing.accountSearchAliases) ? existing.accountSearchAliases : []),
      ...(Array.isArray(incoming.accountSearchAliases) ? incoming.accountSearchAliases : []),
    ]),
    companyFilterAliases: dedupeStrings([
      ...(Array.isArray(existing.companyFilterAliases) ? existing.companyFilterAliases : []),
      ...(Array.isArray(incoming.companyFilterAliases) ? incoming.companyFilterAliases : []),
    ]),
    linkedinCompanyUrls: dedupeStrings([
      ...(Array.isArray(existing.linkedinCompanyUrls) ? existing.linkedinCompanyUrls : []),
      ...(Array.isArray(incoming.linkedinCompanyUrls) ? incoming.linkedinCompanyUrls : []),
    ]),
    targets: mergeCompanyTargets(existing.targets, incoming.targets),
    resolutionStatus: existing.resolutionStatus || incoming.resolutionStatus,
    resolutionNotes: existing.resolutionNotes || incoming.resolutionNotes,
    lastVerifiedAt: existing.lastVerifiedAt || incoming.lastVerifiedAt,
  };
}

function appendCompanyAliasConfigEntry({
  accountName,
  resolvedAlias,
  configPath = DEFAULT_ACCOUNT_ALIASES_PATH,
  now = new Date(),
} = {}) {
  const accountKey = normalizeLookupValue(accountName);
  const linkedinName = String(resolvedAlias?.linkedinName || '').trim();
  if (!accountKey || !linkedinName) {
    return fs.existsSync(configPath)
      ? readJson(configPath)
      : { version: '1.0.0', accounts: {} };
  }

  const config = fs.existsSync(configPath)
    ? readJson(configPath)
    : { version: '1.0.0', accounts: {} };
  config.version = config.version || '1.0.0';
  config.accounts = config.accounts || {};
  const incoming = buildCompanyAliasConfigEntry(accountName, resolvedAlias, now);
  config.accounts[accountKey] = mergeAliasConfigEntry(config.accounts[accountKey] || {}, incoming);
  ensureDir(path.dirname(configPath), 0o700);
  writeJson(configPath, config);
  return config;
}

function mergeAliasConfigInMemory(aliasConfig, accountName, resolvedAlias, now = new Date()) {
  if (!aliasConfig || typeof aliasConfig !== 'object') {
    return aliasConfig;
  }
  const accountKey = normalizeLookupValue(accountName);
  if (!accountKey) {
    return aliasConfig;
  }
  aliasConfig.accounts = aliasConfig.accounts || {};
  const incoming = buildCompanyAliasConfigEntry(accountName, resolvedAlias, now);
  aliasConfig.accounts[accountKey] = mergeAliasConfigEntry(aliasConfig.accounts[accountKey] || {}, incoming);
  return aliasConfig;
}

function companyMatchesAlias(company, aliasTerms) {
  const normalizedCompany = normalizeLookupValue(company);
  if (!normalizedCompany) {
    return false;
  }
  return (aliasTerms || []).some((term) => {
    const normalizedTerm = normalizeLookupValue(term);
    const tokens = normalizedTerm
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !['group', 'holding', 'company'].includes(token));
    return normalizedTerm && (
      normalizedCompany.includes(normalizedTerm)
      || tokens.some((token) => normalizedCompany.includes(token))
    );
  });
}

function scoreFastResolveCandidate(lead, candidate, aliasTerms = []) {
  const expectedName = normalizeLookupValue(lead?.fullName);
  const actualName = normalizeLookupValue(candidate?.fullName || candidate?.name);
  const exactName = expectedName && actualName && expectedName === actualName;
  const slug = extractPublicLinkedInSlug(lead?.publicLinkedInUrl || lead?.profileUrl);
  const slugMatch = slugMatchesCandidateName(slug, candidate?.fullName || candidate?.name);
  const companyMatch = companyMatchesAlias(candidate?.company || candidate?.accountName, aliasTerms);
  const title = normalizeLookupValue(candidate?.title);
  const candidateLocation = normalizeLookupValue(candidate?.location);
  const expectedLocationTokens = normalizeLookupValue(lead?.location)
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .slice(0, 3);
  const expectedTitleTokens = normalizeLookupValue(lead?.title)
    .split(/\s+/)
    .filter((token) => token.length >= 5)
    .slice(0, 5);
  const titleMatch = expectedTitleTokens.some((token) => title.includes(token));
  const locationMatch = expectedLocationTokens.some((token) => candidateLocation.includes(token));
  const hasSalesNavigatorUrl = /linkedin\.com\/sales\/lead\//i.test(candidate?.salesNavigatorUrl || candidate?.profileUrl || '');
  const additionalSignals = [
    slugMatch,
    titleMatch,
    companyMatch,
    locationMatch,
    hasSalesNavigatorUrl,
  ].filter(Boolean).length;

  let score = 0;
  if (exactName) score += 55;
  if (slugMatch) score += 15;
  if (companyMatch) score += 30;
  if (titleMatch) score += 10;
  if (locationMatch) score += 5;
  if (hasSalesNavigatorUrl) score += 5;

  return {
    score,
    exactName,
    slug,
    slugMatch,
    companyMatch,
    titleMatch,
    locationMatch,
    hasSalesNavigatorUrl,
    additionalSignals,
  };
}

function bucketFastResolveLead(lead, scoredCandidates = [], aliasTerms = []) {
  const sorted = [...scoredCandidates].sort((left, right) => right.score - left.score);
  const best = sorted[0] || null;
  const bestIsGuardedNameOnly = best?.queryPlanEntry?.guardedNameOnly || best?.guardedNameOnly;
  const safe = best
    && best.exactName
    && (best.candidate.salesNavigatorUrl || best.candidate.profileUrl)
    && (
      (!bestIsGuardedNameOnly && best.score >= 90 && best.companyMatch)
      || (bestIsGuardedNameOnly && best.score >= 80 && best.additionalSignals >= 2)
    );
  if (safe) {
    return {
      ...lead,
      salesNavigatorUrl: best.candidate.salesNavigatorUrl || best.candidate.profileUrl,
      profileUrl: best.candidate.salesNavigatorUrl || best.candidate.profileUrl,
      resolutionStatus: 'resolved',
      resolutionBucket: 'resolved_safe_to_save',
      resolutionConfidence: best.score,
      resolutionEvidence: 'fast_sales_nav_resolve',
      matchedCompany: best.candidate.company || null,
      matchedTitle: best.candidate.title || null,
      candidateDecision: buildCandidateDecision(best, sorted),
      learningSuggestions: buildLearningSuggestions({
        lead,
        best,
        bucket: 'resolved_safe_to_save',
      }),
      resolutionCandidates: sorted.slice(0, 3).map(summarizeScoredCandidate),
    };
  }

  const exactWrongCompany = sorted.some((candidate) => candidate.exactName && !candidate.companyMatch);
  const noCandidates = sorted.length === 0;
  const hasOnlyOriginalAlias = aliasTerms.length <= 1;
  const companyUnresolved = ['all_resolution_failed', 'resolved_low_confidence', 'needs_manual_company_review'].includes(lead.companyResolution?.status);
  const bucket = companyUnresolved || noCandidates || exactWrongCompany || hasOnlyOriginalAlias
    ? 'needs_company_alias_retry'
    : 'manual_review';
  const evidence = companyUnresolved
    ? 'company_unresolved'
    : noCandidates && lead.identityResolution?.needsManualReview
      ? 'identity_incomplete'
      : bucket;
  return {
    ...lead,
    salesNavigatorUrl: null,
    profileUrl: lead.profileUrl || lead.publicLinkedInUrl || null,
    resolutionStatus: 'unresolved',
    resolutionBucket: bucket,
    resolutionConfidence: best?.score || 0,
    resolutionEvidence: evidence,
    candidateDecision: buildCandidateDecision(best, sorted),
    learningSuggestions: buildLearningSuggestions({
      lead,
      best,
      bucket,
    }),
    resolutionCandidates: sorted.slice(0, 3).map(summarizeScoredCandidate),
  };
}

function buildCandidateDecision(best, sorted) {
  if (!best) {
    return {
      status: 'no_candidate',
      reason: 'no_candidates_returned',
      additionalSignals: 0,
    };
  }
  return {
    status: best.exactName ? 'candidate_scored' : 'ambiguous_candidate',
    score: best.score,
    reason: best.exactName ? 'best_candidate_evaluated' : 'best_candidate_name_mismatch',
    queryType: best.queryPlanEntry?.queryType || best.queryType || null,
    guardedNameOnly: Boolean(best.queryPlanEntry?.guardedNameOnly || best.guardedNameOnly),
    additionalSignals: best.additionalSignals || 0,
    bestCandidate: summarizeScoredCandidate(best),
    candidateCount: sorted.length,
  };
}

function buildLearningSuggestions({ lead, best, bucket }) {
  const suggestions = [];
  if (lead?.identityResolution?.evidence?.includes('linkedin_slug_name_fallback')) {
    suggestions.push({
      type: 'identity_name_fallback',
      sourceName: lead.identityResolution.sourceName,
      suggestedName: lead.identityResolution.primaryName,
      evidence: ['linkedin_slug'],
      disposition: 'suggest_only',
    });
  }
  if (bucket !== 'resolved_safe_to_save' && lead?.companyResolution?.status === 'all_resolution_failed') {
    suggestions.push({
      type: 'company_resolution_needed',
      accountName: lead.accountName,
      suggestedAction: 'resolve_company_targets',
      evidence: lead.companyResolution.evidence || [],
      disposition: 'suggest_only',
    });
  }
  if (best?.exactName && best?.candidate?.company && !best.companyMatch) {
    suggestions.push({
      type: 'company_alias_candidate',
      accountName: lead.accountName,
      suggestedAlias: best.candidate.company,
      evidence: ['exact_name_wrong_company'],
      disposition: 'suggest_only',
    });
  }
  return suggestions;
}

function summarizeScoredCandidate(scored) {
  return {
    fullName: scored.candidate.fullName || scored.candidate.name || null,
    title: scored.candidate.title || null,
    company: scored.candidate.company || scored.candidate.accountName || null,
    salesNavigatorUrl: scored.candidate.salesNavigatorUrl || scored.candidate.profileUrl || null,
    score: scored.score,
    exactName: scored.exactName,
    slugMatch: scored.slugMatch,
    companyMatch: scored.companyMatch,
    titleMatch: scored.titleMatch,
    locationMatch: scored.locationMatch,
    additionalSignals: scored.additionalSignals,
    queryType: scored.queryPlanEntry?.queryType || scored.queryType || null,
  };
}

function splitMarkdownTableRow(line) {
  return String(line || '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function extractMarkdownLinkUrl(value) {
  const match = String(value || '').match(/\[[^\]]+]\(([^)]+)\)/);
  return match ? match[1].trim() : String(value || '').trim();
}

function parseMarkdownLeadRows(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const tableLines = lines.filter((line) => /^\s*\|/.test(line));
  if (tableLines.length < 3) {
    return [];
  }

  const header = splitMarkdownTableRow(tableLines[0])
    .map((cell) => normalizeLookupValue(cell));
  const rows = [];
  for (const line of tableLines.slice(2)) {
    const cells = splitMarkdownTableRow(line);
    if (cells.length < header.length || /^-+$/.test(cells[0])) {
      continue;
    }
    const row = {};
    header.forEach((key, index) => {
      row[key] = cells[index] || '';
    });

    const fullName = row.name || row.fullname || row.full_name;
    if (!fullName) {
      continue;
    }
    const publicLinkedInUrl = extractMarkdownLinkUrl(row.linkedin || row.profile || row.url || '');
    rows.push({
      row: Number(row['#']) || rows.length + 1,
      accountName: row.account || row.company || '',
      fullName,
      title: row.titel || row.title || '',
      score: Number(row.score) || null,
      tier: Number(row.tier) || null,
      publicLinkedInUrl,
      salesNavigatorUrl: /linkedin\.com\/sales\/lead\//i.test(publicLinkedInUrl) ? publicLinkedInUrl : null,
      location: row.standort || row.location || '',
      source: row.quelle || row.source || '',
    });
  }
  return dedupeLeads(rows);
}

function dedupeLeads(leads) {
  const seen = new Set();
  const output = [];
  for (const lead of Array.isArray(leads) ? leads : []) {
    const key = [
      normalizeLookupValue(lead.accountName || lead.company),
      normalizeLookupValue(lead.fullName || lead.name),
      normalizeLookupValue(lead.salesNavigatorUrl || lead.publicLinkedInUrl || lead.profileUrl),
    ].join('::');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push({
      ...lead,
      accountName: lead.accountName || lead.company || '',
      fullName: lead.fullName || lead.name || '',
      salesNavigatorUrl: lead.salesNavigatorUrl || (/linkedin\.com\/sales\/lead\//i.test(lead.profileUrl || '') ? lead.profileUrl : null),
      publicLinkedInUrl: lead.publicLinkedInUrl || lead.profileUrl || null,
    });
  }
  return output;
}

function loadCoverageLeadIndex(coverageDir = COVERAGE_ARTIFACTS_DIR) {
  const byNameAndAccount = new Map();
  const byName = new Map();

  for (const sourceDir of [coverageDir, ACCOUNT_BATCH_ARTIFACTS_DIR]) {
    if (!fs.existsSync(sourceDir)) {
      continue;
    }

    const entries = fs.readdirSync(sourceDir)
      .filter((entry) => entry.endsWith('.json'))
      .sort();
    for (const entry of entries) {
      let parsed = null;
      try {
        parsed = JSON.parse(fs.readFileSync(path.join(sourceDir, entry), 'utf8'));
      } catch {
        continue;
      }
      const candidates = [
        ...(Array.isArray(parsed.candidates) ? parsed.candidates : []),
        ...(Array.isArray(parsed.leads) ? parsed.leads : []),
        ...(Array.isArray(parsed.results) ? parsed.results : []),
      ];
      for (const candidate of candidates) {
        const url = candidate.salesNavigatorUrl || candidate.profileUrl;
        if (!url || !/linkedin\.com\/sales\/lead\//i.test(url)) {
          continue;
        }
        const nameKey = normalizeLookupValue(candidate.fullName || candidate.name);
        const accountKey = normalizeLookupValue(candidate.accountName || candidate.company || parsed.accountName);
        if (!nameKey) {
          continue;
        }
        const sourceType = sourceDir === coverageDir ? 'coverage' : 'account-batch';
        const value = {
          fullName: candidate.fullName || candidate.name,
          title: candidate.title || null,
          accountName: candidate.accountName || candidate.company || parsed.accountName || null,
          salesNavigatorUrl: url,
          evidence: `${sourceType}:${entry}`,
        };
        byNameAndAccount.set(`${accountKey}::${nameKey}`, value);
        if (!byName.has(nameKey)) {
          byName.set(nameKey, []);
        }
        byName.get(nameKey).push(value);
      }
    }
  }

  return { byNameAndAccount, byName };
}

function resolveLeadsWithCoverage(leads, coverageIndex = loadCoverageLeadIndex()) {
  return dedupeLeads(leads).map((lead) => {
    if (lead.salesNavigatorUrl && /linkedin\.com\/sales\/lead\//i.test(lead.salesNavigatorUrl)) {
      return {
        ...lead,
        resolutionStatus: 'resolved',
        resolutionEvidence: lead.resolutionEvidence || 'source_sales_nav_url',
      };
    }

    const nameKey = normalizeLookupValue(lead.fullName);
    const accountKey = normalizeLookupValue(lead.accountName);
    const direct = coverageIndex.byNameAndAccount.get(`${accountKey}::${nameKey}`);
    const nameMatches = coverageIndex.byName.get(nameKey) || [];
    const uniqueNameMatch = nameMatches.length === 1 ? nameMatches[0] : null;
    const match = direct || uniqueNameMatch;
    if (match) {
      return {
        ...lead,
        title: lead.title || match.title || '',
        accountName: lead.accountName || match.accountName || '',
        salesNavigatorUrl: match.salesNavigatorUrl,
        resolutionStatus: 'resolved',
        resolutionEvidence: match.evidence,
      };
    }

    return {
      ...lead,
      resolutionStatus: 'unresolved',
      resolutionEvidence: 'missing_sales_nav_url',
    };
  });
}

function normalizeImportScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeImportRowsFromParsedArtifact(parsed = {}, options = {}) {
  const rows = Array.isArray(parsed.candidates)
    ? parsed.candidates
    : Array.isArray(parsed.leads)
      ? parsed.leads
      : Array.isArray(parsed.results)
        ? parsed.results
        : [];
  const bucket = String(options.bucket || '').trim();
  const minScore = normalizeImportScore(options.minScore);
  const fallbackAccountName = parsed.accountName || parsed.account?.name || parsed.account || '';

  return rows
    .filter((row) => {
      if (bucket && row.coverageBucket !== bucket) {
        return false;
      }
      if (minScore !== null && normalizeImportScore(row.score) < minScore) {
        return false;
      }
      return true;
    })
    .map((row, index) => ({
      ...row,
      row: row.row || index + 1,
      accountName: row.accountName || row.account || fallbackAccountName || row.company || '',
      fullName: row.fullName || row.name || '',
      title: row.title || row.titel || '',
      score: normalizeImportScore(row.score),
      coverageBucket: row.coverageBucket || null,
      salesNavigatorUrl: row.salesNavigatorUrl || (/linkedin\.com\/sales\/lead\//i.test(row.profileUrl || '') ? row.profileUrl : null),
      publicLinkedInUrl: row.publicLinkedInUrl || row.profileUrl || null,
      location: row.location || row.standort || '',
    }))
    .filter((row) => row.fullName);
}

function splitFastImportSourcePaths(sourcePaths) {
  const values = Array.isArray(sourcePaths) ? sourcePaths : [sourcePaths];
  return values
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function dedupeMergedImportLeads(leads = []) {
  const seen = new Set();
  const output = [];
  for (const lead of leads) {
    const normalizedUrl = normalizeLeadUrl(lead.salesNavigatorUrl || lead.profileUrl || lead.publicLinkedInUrl || '');
    const key = normalizedUrl || [
      normalizeLookupValue(lead.accountName || lead.company),
      normalizeLookupValue(lead.fullName || lead.name),
    ].join('::');
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(lead);
  }
  return output;
}

function loadFastListImportSource(sourcePath, options = {}) {
  const absolutePath = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(sourcePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const listName = options.listName || deriveListNameFromSource(absolutePath);
  const parsed = absolutePath.endsWith('.json') ? JSON.parse(raw) : null;
  const rawLeads = parsed
    ? dedupeLeads(normalizeImportRowsFromParsedArtifact(parsed, options))
    : parseMarkdownLeadRows(raw);
  const leads = resolveLeadsWithCoverage(rawLeads, options.coverageIndex || loadCoverageLeadIndex(options.coverageDir));

  return {
    listName,
    sourcePath: absolutePath,
    generatedAt: new Date().toISOString(),
    detectedRows: rawLeads.length,
    uniqueLeads: leads.length,
    resolvedLeads: leads.filter((lead) => lead.resolutionStatus === 'resolved').length,
    unresolvedLeads: leads.filter((lead) => lead.resolutionStatus !== 'resolved').length,
    liveConnect: false,
    leads,
  };
}

function buildMergedFastListImportPlan({ listName, sourcePaths, leads, generatedAt = new Date().toISOString(), sourceType = 'merged_sources' }) {
  const mergedLeads = dedupeMergedImportLeads(leads);
  return {
    listName: listName || 'Merged Fast Import',
    sourcePath: sourcePaths?.[0] || null,
    sourcePaths,
    sourceType,
    generatedAt,
    detectedRows: mergedLeads.length,
    uniqueLeads: mergedLeads.length,
    resolvedLeads: mergedLeads.filter((lead) => lead.resolutionStatus === 'resolved').length,
    unresolvedLeads: mergedLeads.filter((lead) => lead.resolutionStatus !== 'resolved').length,
    liveConnect: false,
    leads: mergedLeads,
  };
}

function loadFastListImportSources(sourcePaths, options = {}) {
  const paths = splitFastImportSourcePaths(sourcePaths);
  if (!paths.length) {
    throw new Error('fast-list-import requires at least one source path');
  }
  if (paths.length === 1) {
    return loadFastListImportSource(paths[0], options);
  }
  const plans = paths.map((sourcePath) => loadFastListImportSource(sourcePath, {
    ...options,
    listName: options.listName || null,
  }));
  return buildMergedFastListImportPlan({
    listName: options.listName || deriveListNameFromSource(paths[0]),
    sourcePaths: plans.map((plan) => plan.sourcePath),
    leads: plans.flatMap((plan) => plan.leads || []),
  });
}

function coverageArtifactPathForAccount(account, coverageDir = COVERAGE_ARTIFACTS_DIR) {
  const raw = String(account || '').trim();
  if (!raw) {
    return null;
  }
  if (raw.endsWith('.json') || raw.includes('/') || raw.includes('\\')) {
    return path.isAbsolute(raw) ? raw : path.resolve(raw);
  }
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return path.join(coverageDir, `${slug}.json`);
}

function loadCoverageImportPlan({
  accounts,
  coverageDir = COVERAGE_ARTIFACTS_DIR,
  bucket = null,
  minScore = null,
  listName = null,
} = {}) {
  const sourcePaths = splitFastImportSourcePaths(accounts)
    .map((account) => coverageArtifactPathForAccount(account, coverageDir))
    .filter(Boolean);
  if (!sourcePaths.length) {
    throw new Error('import-coverage requires --accounts or --source');
  }
  const plan = loadFastListImportSources(sourcePaths, {
    listName: listName || 'Coverage Import',
    bucket,
    minScore,
    coverageDir,
  });
  return {
    ...plan,
    sourceType: 'coverage_artifacts',
  };
}

async function fastResolveLeads({
  driver,
  sourcePath,
  listName = null,
  aliasConfig = loadCompanyAliasConfig(),
  learnedCompanyRegistry = loadLearnedCompanyTargets(),
  aliasConfigPath = DEFAULT_ACCOUNT_ALIASES_PATH,
  searchTimeoutMs = 8000,
  maxCandidates = 4,
  runId = 'fast-resolve-leads',
  groupedCompanyPool = true,
  onProgress = null,
  now = Date.now,
} = {}) {
  const importPlan = loadFastListImportSource(sourcePath, { listName });
  const leads = [];
  const timings = createRunTimings(now);
  const safeSearchTimeout = Math.max(2000, Number(searchTimeoutMs || 8000));
  const selectorTimeout = Math.max(1000, Math.floor(safeSearchTimeout / 2));
  const aliasResearchCache = new Map();

  async function collectScoredCandidates(leadForResolution, queryPlan, aliasTerms) {
    const scored = [];
    const attemptedQueries = [];
    for (const queryPlanEntry of queryPlan) {
      const query = queryPlanEntry.query;
      if (!query) {
        continue;
      }
      attemptedQueries.push(query);
      const account = {
        accountId: 'fast-resolve-unscoped',
        name: '',
        salesNav: {
          peopleSearchUrl: 'https://www.linkedin.com/sales/search/people?viewAllFilters=true',
        },
      };
      const template = {
        id: 'fast-resolve-leads',
        name: 'Fast Resolve Leads',
        keywords: [query],
        maxCandidates,
        titleIncludes: [],
      };

      let candidates = [];
      try {
        await driver.openPeopleSearch(account, { runId, accountKey: 'fast-resolve-unscoped' });
        await driver.applySearchTemplate(template, { runId, accountKey: 'fast-resolve-unscoped' });
        candidates = await driver.scrollAndCollectCandidates(account, template, {
          runId,
          accountKey: 'fast-resolve-unscoped',
          resultTimeoutMs: selectorTimeout,
          hydrateTimeoutMs: selectorTimeout,
        });
      } catch (error) {
        scored.push({
          candidate: {
            fullName: null,
            title: null,
            company: null,
            salesNavigatorUrl: null,
          },
          score: 0,
          exactName: false,
          slugMatch: false,
          companyMatch: false,
          titleMatch: false,
          error: error.message,
        });
      }

      for (const candidate of candidates) {
        scored.push({
          candidate,
          ...scoreFastResolveCandidate(leadForResolution, candidate, aliasTerms),
          query,
          queryPlanEntry,
        });
      }

      const current = bucketFastResolveLead(leadForResolution, scored, aliasTerms);
      if (current.resolutionBucket === 'resolved_safe_to_save') {
        break;
      }
    }
    return { scored, attemptedQueries };
  }

  async function researchCompanyAlias(accountName) {
    const cacheKey = normalizeLookupValue(accountName);
    if (!cacheKey || typeof driver?.resolveCompanyAlias !== 'function') {
      return null;
    }
    if (!aliasResearchCache.has(cacheKey)) {
      let resolvedAlias = null;
      try {
        resolvedAlias = await driver.resolveCompanyAlias(accountName, {
          runId,
          accountKey: accountName || 'fast-resolve-company-alias',
        });
      } catch {
        resolvedAlias = null;
      }
      aliasResearchCache.set(cacheKey, resolvedAlias?.linkedinName ? resolvedAlias : null);
    }
    return aliasResearchCache.get(cacheKey);
  }

  async function retryWithResearchedAlias(row, leadForResolution, identityResolution, companyResolution, queryPlan, attemptedQueries) {
    if (row.resolutionBucket !== 'needs_company_alias_retry') {
      return row;
    }
    const resolvedAlias = await researchCompanyAlias(leadForResolution.accountName);
    if (!resolvedAlias?.linkedinName) {
      return row;
    }

    if (aliasConfigPath) {
      appendCompanyAliasConfigEntry({
        accountName: leadForResolution.accountName,
        resolvedAlias,
        configPath: aliasConfigPath,
      });
    }
    mergeAliasConfigInMemory(aliasConfig, leadForResolution.accountName, resolvedAlias);

    const retryCompanyResolution = buildCompanyResolution({
      accountName: leadForResolution.accountName,
      source: 'fast_import_alias_research',
      aliasConfig,
      learnedRegistry: learnedCompanyRegistry,
    });
    const retryLead = {
      ...leadForResolution,
      companyResolution: retryCompanyResolution,
    };
    const retryAliasTerms = getCompanyResolutionTerms(retryCompanyResolution, retryLead.accountName, aliasConfig);
    const retryQueryPlan = buildFastResolveQueryPlan({
      lead: retryLead,
      identityResolution,
      companyResolution: retryCompanyResolution,
      aliasConfig,
    }).map((entry) => ({
      ...entry,
      queryType: entry.guardedNameOnly ? entry.queryType : 'alias_research_company',
      aliasResearch: true,
    }));
    const retry = await collectScoredCandidates(retryLead, retryQueryPlan, retryAliasTerms);
    const retriedRow = bucketFastResolveLead(retryLead, retry.scored, retryAliasTerms);
    if (retriedRow.resolutionBucket !== 'resolved_safe_to_save') {
      return {
        ...row,
        resolutionPath: row.resolutionPath || 'single_query',
        aliasResearch: {
          status: 'attempted_unresolved',
          linkedinName: resolvedAlias.linkedinName,
          linkedinCompanyUrl: resolvedAlias.linkedinCompanyUrl || null,
          evidence: resolvedAlias.evidence || ['linkedin_company_search'],
        },
        queryPlan: [...queryPlan, ...retryQueryPlan],
        attemptedQueries: [...attemptedQueries, ...retry.attemptedQueries],
      };
    }

    return {
      ...retriedRow,
      resolutionBucket: 'resolved_via_alias_research',
      resolutionEvidence: 'linkedin_company_search_alias_research',
      resolutionPath: 'alias_research',
      companyResolution: retryCompanyResolution,
      companyAliasTerms: retryAliasTerms,
      queryPlan: [...queryPlan, ...retryQueryPlan],
      attemptedQueries: [...attemptedQueries, ...retry.attemptedQueries],
      aliasResearch: {
        status: 'resolved',
        linkedinName: resolvedAlias.linkedinName,
        linkedinCompanyUrl: resolvedAlias.linkedinCompanyUrl || null,
        evidence: resolvedAlias.evidence || ['linkedin_company_search'],
      },
    };
  }

  function prepareLead(lead) {
    const identityResolution = resolveLeadIdentity(lead);
    const companyResolution = buildCompanyResolution({
      accountName: lead.accountName,
      source: 'fast_import',
      aliasConfig,
      learnedRegistry: learnedCompanyRegistry,
    });
    const leadForResolution = {
      ...applyIdentityResolution(lead, identityResolution),
      companyResolution,
    };
    const aliasTerms = getCompanyResolutionTerms(companyResolution, leadForResolution.accountName, aliasConfig);
    const queryPlan = buildFastResolveQueryPlan({
      lead: leadForResolution,
      identityResolution,
      companyResolution,
      aliasConfig,
    });
    return {
      lead,
      identityResolution,
      companyResolution,
      leadForResolution,
      aliasTerms,
      queryPlan,
    };
  }

  async function collectGroupedCompanyPoolRows(preparedLeads) {
    if (!groupedCompanyPool || !driver) {
      return new Map();
    }
    const groups = new Map();
    for (const prepared of preparedLeads) {
      if (prepared.lead.resolutionStatus === 'resolved' && prepared.lead.salesNavigatorUrl) {
        continue;
      }
      const groupKey = normalizeLookupValue(prepared.leadForResolution.accountName);
      if (!groupKey) {
        continue;
      }
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(prepared);
    }

    const resolvedRows = new Map();
    for (const [groupKey, group] of groups.entries()) {
      if (group.length < 2) {
        continue;
      }
      const companyTerm = group
        .flatMap((prepared) => prepared.aliasTerms || [])
        .find((term) => normalizeLookupValue(term)) || group[0].leadForResolution.accountName;
      if (!companyTerm) {
        continue;
      }
      const account = {
        accountId: `fast-resolve-company-pool-${groupKey}`,
        name: companyTerm,
        salesNav: {
          peopleSearchUrl: 'https://www.linkedin.com/sales/search/people?viewAllFilters=true',
        },
      };
      const template = {
        id: 'fast-resolve-company-pool',
        name: 'Fast Resolve Company Pool',
        keywords: [companyTerm],
        maxCandidates: Math.max(maxCandidates, group.length * 4),
        titleIncludes: [],
      };
      let candidates = [];
      try {
        candidates = await timePhase(timings, 'grouped_company_pool', async () => {
          await driver.openPeopleSearch(account, { runId, accountKey: account.accountId });
          await driver.applySearchTemplate(template, { runId, accountKey: account.accountId });
          return driver.scrollAndCollectCandidates(account, template, {
            runId,
            accountKey: account.accountId,
            resultTimeoutMs: selectorTimeout,
            hydrateTimeoutMs: selectorTimeout,
          });
        }, { now });
      } catch {
        candidates = [];
      }
      if (!candidates.length) {
        continue;
      }
      for (const prepared of group) {
        const scored = candidates.map((candidate) => ({
          candidate,
          ...scoreFastResolveCandidate(prepared.leadForResolution, candidate, prepared.aliasTerms),
          query: companyTerm,
          queryPlanEntry: {
            query: companyTerm,
            companyTerm,
            queryType: 'grouped_company_pool',
            guardedNameOnly: false,
          },
        }));
        const bucketed = bucketFastResolveLead(prepared.leadForResolution, scored, prepared.aliasTerms);
        if (bucketed.resolutionBucket === 'resolved_safe_to_save') {
          resolvedRows.set(prepared.lead.row || `${groupKey}:${prepared.lead.fullName}`, {
            ...bucketed,
            resolutionPath: 'grouped_company_pool',
            resolutionEvidence: 'grouped_company_pool',
            companyAliasTerms: prepared.aliasTerms,
            queryPlan: [{
              query: companyTerm,
              companyTerm,
              queryType: 'grouped_company_pool',
              guardedNameOnly: false,
            }],
            attemptedQueries: [companyTerm],
          });
        }
      }
    }
    return resolvedRows;
  }

  const preparedLeads = await timePhase(timings, 'planning', async () => importPlan.leads.map(prepareLead), { now });
  const groupedRows = await collectGroupedCompanyPoolRows(preparedLeads);

  for (const prepared of preparedLeads) {
    const { lead, identityResolution, companyResolution, leadForResolution, aliasTerms, queryPlan } = prepared;
    if (lead.resolutionStatus === 'resolved' && lead.salesNavigatorUrl) {
      const identityResolution = resolveLeadIdentity(lead);
      const companyResolution = buildCompanyResolution({
        accountName: lead.accountName,
        source: 'fast_import',
        aliasConfig,
        learnedRegistry: learnedCompanyRegistry,
      });
      const row = {
        ...lead,
        identityResolution,
        companyResolution,
        queryPlan: [],
        candidateDecision: {
          status: 'already_resolved',
          reason: lead.resolutionEvidence || 'source_or_coverage_sales_nav_url',
        },
        learningSuggestions: [],
        resolutionBucket: 'resolved_safe_to_save',
        resolutionConfidence: lead.resolutionConfidence || 100,
        resolutionPath: 'source_or_coverage',
      };
      leads.push(row);
      if (typeof onProgress === 'function') {
        onProgress(row);
      }
      continue;
    }

    const groupedRow = groupedRows.get(lead.row || `${normalizeLookupValue(lead.accountName)}:${lead.fullName}`);
    if (groupedRow) {
      leads.push(groupedRow);
      if (typeof onProgress === 'function') {
        onProgress(groupedRow);
      }
      continue;
    }

    const search = await timePhase(timings, 'single_query', async () =>
      collectScoredCandidates(leadForResolution, queryPlan, aliasTerms), { now });
    let initialRow = {
      ...bucketFastResolveLead(leadForResolution, search.scored, aliasTerms),
      companyAliasTerms: aliasTerms,
      queryPlan,
      attemptedQueries: search.attemptedQueries,
      resolutionPath: 'single_query',
    };
    const cachedAlias = aliasResearchCache.get(normalizeLookupValue(leadForResolution.accountName));
    if (initialRow.resolutionBucket === 'resolved_safe_to_save' && cachedAlias?.linkedinName) {
      initialRow = {
        ...initialRow,
        resolutionBucket: 'resolved_via_alias_research',
        resolutionEvidence: 'linkedin_company_search_alias_research',
        resolutionPath: 'alias_research',
        aliasResearch: {
          status: 'resolved_from_run_cache',
          linkedinName: cachedAlias.linkedinName,
          linkedinCompanyUrl: cachedAlias.linkedinCompanyUrl || null,
          evidence: cachedAlias.evidence || ['linkedin_company_search'],
        },
      };
    }
    const row = await retryWithResearchedAlias(
      initialRow,
      leadForResolution,
      identityResolution,
      companyResolution,
      queryPlan,
      search.attemptedQueries,
    );
    leads.push(row);
    if (typeof onProgress === 'function') {
      onProgress(row);
    }
  }

  return buildFastResolveArtifact({
    ...importPlan,
    generatedAt: new Date().toISOString(),
    liveSave: false,
    liveConnect: false,
    searchTimeoutMs: safeSearchTimeout,
    maxCandidates,
    groupedCompanyPool,
    timings: finishRunTimings(timings, now),
    leads,
  });
}

function buildFastResolveArtifact(payload) {
  const leads = payload.leads || [];
  const learningSuggestions = leads.flatMap((lead) => lead.learningSuggestions || []);
  const bucketCounts = {
    resolved_safe_to_save: leads.filter((lead) => lead.resolutionBucket === 'resolved_safe_to_save').length,
    resolved_via_alias_research: leads.filter((lead) => lead.resolutionBucket === 'resolved_via_alias_research').length,
    needs_company_alias_retry: leads.filter((lead) => lead.resolutionBucket === 'needs_company_alias_retry').length,
    manual_review: leads.filter((lead) => lead.resolutionBucket === 'manual_review').length,
  };
  const resolutionPathCounts = leads.reduce((counts, lead) => {
    const key = lead.resolutionPath || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const resolvedLeads = bucketCounts.resolved_safe_to_save + bucketCounts.resolved_via_alias_research;
  return {
    ...payload,
    status: bucketCounts.needs_company_alias_retry || bucketCounts.manual_review ? 'completed_with_followup' : 'completed',
    resolvedLeads,
    unresolvedLeads: leads.length - resolvedLeads,
    bucketCounts,
    resolutionPathCounts,
    learningSuggestions,
  };
}

function isRetryableSaveError(note) {
  return /lead detail did not render|spinner shell|lead page stuck|timeout|current company filter/i.test(String(note || ''));
}

function isMissingListCreationDisabledError(note) {
  return /list .*not found|not find.*list|creation is disabled|allow-list-create/i.test(String(note || ''));
}

function normalizeLeadUrl(url) {
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

function buildExistingLeadUrlSet(existingLeadUrls = []) {
  return new Set((existingLeadUrls || []).map(normalizeLeadUrl).filter(Boolean));
}

async function saveFastListImport({ driver, importPlan, liveSave = false, allowListCreate = false, maxRetries = 1, runId = 'fast-list-import', onProgress = null, existingLeadUrls = [] }) {
  const results = [];
  const listInfo = { listName: importPlan.listName, externalRef: null };
  const existingLeadUrlSet = buildExistingLeadUrlSet(existingLeadUrls);

  if (!liveSave) {
    return {
      ...importPlan,
      liveSave: false,
      status: 'planned',
      results: importPlan.leads.map((lead) => ({
        ...lead,
        status: lead.resolutionStatus === 'resolved' ? 'planned' : 'unresolved',
        note: lead.resolutionStatus === 'resolved' ? 'ready_for_live_save' : 'missing_sales_nav_url',
      })),
    };
  }

  for (const lead of importPlan.leads) {
    if (lead.resolutionStatus !== 'resolved') {
      results.push({
        ...lead,
        status: 'unresolved',
        note: 'missing_sales_nav_url',
      });
      continue;
    }

    if (existingLeadUrlSet.has(normalizeLeadUrl(lead.salesNavigatorUrl))) {
      const row = {
        ...lead,
        status: 'already_saved',
        saveRecoveryPath: 'snapshot_preflight',
        failureCategory: null,
        selectionMode: 'snapshot_preflight',
        attempt: 0,
        note: 'snapshot_preflight_already_saved',
      };
      results.push(row);
      if (typeof onProgress === 'function') {
        onProgress(row);
      }
      continue;
    }

    let attempt = 0;
    let saved = false;
    let lastNote = null;
    while (attempt <= maxRetries && !saved) {
      attempt += 1;
      try {
        const saveResult = await driver.saveCandidateToList(
          {
            fullName: lead.fullName,
            title: lead.title,
            accountName: lead.accountName,
            company: lead.accountName,
            location: lead.location,
            salesNavigatorUrl: lead.salesNavigatorUrl,
            profileUrl: lead.salesNavigatorUrl,
          },
          listInfo,
          { runId, accountKey: lead.accountName || 'fast-list-import', dryRun: false },
        );
        const normalizedSave = normalizeSaveResult(saveResult);
        const row = {
          ...lead,
          status: normalizedSave.status,
          saveRecoveryPath: normalizedSave.recoveryPath,
          failureCategory: null,
          selectionMode: saveResult.selectionMode || null,
          attempt,
          note: saveResult.note || null,
        };
        results.push(row);
        if (typeof onProgress === 'function') {
          onProgress(row);
        }
        saved = true;
      } catch (error) {
        lastNote = String(error.message || error);
        if (!allowListCreate && isMissingListCreationDisabledError(lastNote)) {
          const message = [
            `Lead list "${importPlan.listName}" was not found and list creation is disabled.`,
            'Create the list in Sales Navigator first or rerun with --allow-list-create.',
          ].join(' ');
          const listError = new Error(message);
          listError.code = 'list_not_found_creation_disabled';
          listError.cause = error;
          throw listError;
        }
        if (attempt > maxRetries || !isRetryableSaveError(lastNote)) {
          const failure = classifySaveFailure(lastNote);
          const row = {
            ...lead,
            status: failure.status,
            failureCategory: failure.failureCategory,
            saveRecoveryPath: failure.recoveryPath,
            selectionMode: null,
            attempt,
            note: lastNote,
          };
          results.push(row);
          if (typeof onProgress === 'function') {
            onProgress(row);
          }
          break;
        }
      }
    }
  }

  return buildFastListImportResult({
    ...importPlan,
    liveSave: true,
    allowListCreate,
    results,
  });
}

function normalizeSaveResult(saveResult = {}) {
  if (saveResult.status === 'already_saved') {
    return { status: 'already_saved', recoveryPath: saveResult.selectionMode || 'already_saved' };
  }
  if (/results_row/i.test(saveResult.selectionMode || '')) {
    return { status: 'results_row_fallback_saved', recoveryPath: saveResult.selectionMode };
  }
  return { status: saveResult.status || 'saved', recoveryPath: saveResult.selectionMode || 'lead_page_save' };
}

function classifySaveFailure(note) {
  const message = String(note || '');
  if (/target closed|browser.*closed|econn|transport|session state|not authenticated/i.test(message)) {
    return {
      status: 'failed_runtime',
      failureCategory: 'runtime_failure',
      recoveryPath: 'runtime_or_session_failure',
    };
  }
  return {
    status: 'manual_review',
    failureCategory: isRetryableSaveError(message) ? 'save_ui_manual_review' : 'manual_review',
    recoveryPath: 'save_recovery_exhausted',
  };
}

function buildFastListImportResult(payload) {
  const results = payload.results || [];
  const failed = results.filter((row) => row.status === 'failed_runtime').length;
  const unresolved = results.filter((row) => row.status === 'unresolved').length;
  const manualReview = results.filter((row) => row.status === 'manual_review').length;
  const confirmedSaved = results.filter((row) => ['saved', 'results_row_fallback_saved'].includes(row.status)).length;
  const alreadySaved = results.filter((row) => row.status === 'already_saved').length;
  const snapshotSkipped = results.filter((row) => row.status === 'already_saved' && row.saveRecoveryPath === 'snapshot_preflight').length;
  return {
    ...payload,
    status: failed || unresolved || manualReview ? 'completed_with_followup' : 'completed',
    saved: confirmedSaved,
    confirmedSaved,
    alreadySaved,
    snapshotSkipped,
    failed,
    unresolved,
    manualReview,
  };
}

function buildFastListImportArtifactPath(label = 'fast-list-import') {
  const slug = String(label || 'fast-list-import')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'fast-list-import';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(ACCOUNT_BATCH_ARTIFACTS_DIR, `${slug}-fast-import-${timestamp}.json`);
}

function buildFastResolveArtifactPath(label = 'fast-resolve-leads') {
  const slug = String(label || 'fast-resolve-leads')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'fast-resolve-leads';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(ACCOUNT_BATCH_ARTIFACTS_DIR, `${slug}-fast-resolve-${timestamp}.json`);
}

function renderFastListImportMarkdown(artifact) {
  const lines = [];
  lines.push(`# Fast List Import Report`);
  lines.push('');
  lines.push(`- Generated at: \`${artifact.generatedAt}\``);
  lines.push(`- List: \`${artifact.listName}\``);
  lines.push(`- Status: \`${artifact.status}\``);
  lines.push(`- Live save: \`${artifact.liveSave ? 'yes' : 'no'}\``);
  lines.push(`- Live connect: \`no\``);
  lines.push(`- Resolved leads: \`${artifact.resolvedLeads ?? 0}\``);
  lines.push(`- Unresolved leads: \`${artifact.unresolvedLeads ?? artifact.unresolved ?? 0}\``);
  if (artifact.liveSave) {
    lines.push(`- Confirmed saved this run: \`${artifact.confirmedSaved ?? artifact.saved ?? 0}\``);
    lines.push(`- Already in list: \`${artifact.alreadySaved ?? 0}\``);
    lines.push(`- Snapshot preflight skips: \`${artifact.snapshotSkipped ?? 0}\``);
    lines.push(`- Failed: \`${artifact.failed ?? 0}\``);
  }
  lines.push('');
  lines.push(`| # | Account | Name | Status | Attempt | Evidence | Note |`);
  lines.push(`|---:|---|---|---|---:|---|---|`);
  for (const [index, row] of (artifact.results || artifact.leads || []).entries()) {
    lines.push(`| ${index + 1} | ${escapeMarkdown(row.accountName)} | ${escapeMarkdown(row.fullName)} | ${escapeMarkdown(row.status || row.resolutionStatus)} | ${row.attempt || ''} | ${escapeMarkdown(row.resolutionEvidence)} | ${escapeMarkdown(row.note)} |`);
  }
  return `${lines.join('\n').trim()}\n`;
}

function writeFastListImportArtifact(artifact, outputPath = null) {
  const targetPath = outputPath || buildFastListImportArtifactPath(artifact.listName);
  writeJson(targetPath, artifact);
  const reportPath = targetPath.replace(/\.json$/i, '.md');
  fs.writeFileSync(reportPath, renderFastListImportMarkdown(artifact), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return { artifactPath: targetPath, reportPath };
}

function renderFastResolveMarkdown(artifact) {
  const lines = [];
  lines.push(`# Fast Resolve Leads Report`);
  lines.push('');
  lines.push(`- Generated at: \`${artifact.generatedAt}\``);
  lines.push(`- List: \`${artifact.listName}\``);
  lines.push(`- Status: \`${artifact.status}\``);
  lines.push(`- Search timeout: \`${artifact.searchTimeoutMs}ms\``);
  lines.push(`- Live save: \`no\``);
  lines.push(`- Live connect: \`no\``);
  lines.push(`- resolved_safe_to_save: \`${artifact.bucketCounts?.resolved_safe_to_save || 0}\``);
  lines.push(`- resolved_via_alias_research: \`${artifact.bucketCounts?.resolved_via_alias_research || 0}\``);
  lines.push(`- needs_company_alias_retry: \`${artifact.bucketCounts?.needs_company_alias_retry || 0}\``);
  lines.push(`- manual_review: \`${artifact.bucketCounts?.manual_review || 0}\``);
  lines.push(`- learning suggestions: \`${artifact.learningSuggestions?.length || 0}\``);
  lines.push('');
  lines.push(`| # | Account | Name | Bucket | Identity | Company | Confidence | Match | Next |`);
  lines.push(`|---:|---|---|---|---|---|---:|---|---|`);
  for (const [index, lead] of (artifact.leads || []).entries()) {
    const next = ['resolved_safe_to_save', 'resolved_via_alias_research'].includes(lead.resolutionBucket)
      ? 'safe_for_fast_list_import'
      : lead.resolutionBucket === 'needs_company_alias_retry'
        ? 'add_or_retry_company_alias'
        : 'manual_review_before_save';
    lines.push(`| ${index + 1} | ${escapeMarkdown(lead.accountName)} | ${escapeMarkdown(lead.fullName)} | ${escapeMarkdown(lead.resolutionBucket)} | ${escapeMarkdown(lead.identityResolution?.evidence?.join('+') || '')} | ${escapeMarkdown(lead.companyResolution?.status || '')} | ${lead.resolutionConfidence || 0} | ${escapeMarkdown(lead.matchedCompany || '')} | ${next} |`);
  }
  return `${lines.join('\n').trim()}\n`;
}

function writeFastResolveArtifact(artifact, outputPath = null) {
  const targetPath = outputPath || buildFastResolveArtifactPath(artifact.listName);
  writeJson(targetPath, artifact);
  const reportPath = targetPath.replace(/\.json$/i, '.md');
  fs.writeFileSync(reportPath, renderFastResolveMarkdown(artifact), {
    encoding: 'utf8',
    mode: 0o600,
  });
  writeLearnedLeadResolutionSuggestions(artifact);
  return { artifactPath: targetPath, reportPath };
}

function writeLearnedLeadResolutionSuggestions(artifact, outputPath = LEARNED_LEAD_RESOLUTION_SUGGESTIONS_PATH) {
  const suggestions = (artifact.learningSuggestions || [])
    .filter((suggestion) => suggestion && suggestion.type);
  if (suggestions.length === 0) {
    return null;
  }
  ensureDir(path.dirname(outputPath), 0o700);
  const existing = fs.existsSync(outputPath)
    ? JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    : { version: '1.0.0', suggestions: [] };
  const byKey = new Map();
  for (const suggestion of [...(existing.suggestions || []), ...suggestions]) {
    const key = [
      suggestion.type,
      normalizeLookupValue(suggestion.accountName || ''),
      normalizeLookupValue(suggestion.sourceName || ''),
      normalizeLookupValue(suggestion.suggestedName || suggestion.suggestedAlias || ''),
    ].join('::');
    byKey.set(key, {
      ...suggestion,
      disposition: suggestion.disposition || 'suggest_only',
    });
  }
  writeJson(outputPath, {
    version: existing.version || '1.0.0',
    updatedAt: new Date().toISOString(),
    suggestions: Array.from(byKey.values()),
  });
  return outputPath;
}

function escapeMarkdown(value) {
  return String(value || '').replace(/\|/g, '/');
}

module.exports = {
  appendCompanyAliasConfigEntry,
  buildFastListImportArtifactPath,
  buildFastResolveArtifact,
  buildFastResolveArtifactPath,
  bucketFastResolveLead,
  buildCompanyAliasTerms,
  buildFastResolveQueryPlan,
  buildFastResolveQueryTerms,
  classifySaveFailure,
  deriveListNameFromSource,
  extractPublicLinkedInSlug,
  fastResolveLeads,
  inferFullNameFromLinkedInSlug,
  isRetryableSaveError,
  normalizeSaveResult,
  loadCoverageImportPlan,
  loadCoverageLeadIndex,
  loadFastListImportSource,
  loadFastListImportSources,
  parseMarkdownLeadRows,
  renderFastResolveMarkdown,
  renderFastListImportMarkdown,
  resolveLeadsWithCoverage,
  resolveLeadIdentity,
  saveFastListImport,
  scoreFastResolveCandidate,
  writeLearnedLeadResolutionSuggestions,
  writeFastListImportArtifact,
  writeFastResolveArtifact,
};
