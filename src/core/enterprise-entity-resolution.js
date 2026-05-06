const fs = require('node:fs');
const path = require('node:path');
const { writeJson } = require('../lib/json');
const {
  COMPANY_RESOLUTION_ARTIFACTS_DIR,
  ensureDir,
} = require('../lib/paths');
const {
  classifyCompanyEntityPriority,
  compareCompanyTargetPriority,
  findCompanyAliasEntry,
  loadCompanyAliasConfig,
  normalizeCompanyName,
} = require('./company-resolution');

const ENTERPRISE_ENTITY_ARTIFACTS_DIR = path.join(COMPANY_RESOLUTION_ARTIFACTS_DIR, 'enterprise-entities');

const IT_DIGITAL_PATTERN = /\b(it|digital|systems?|technology|tech|platform|cloud|data|software|engineering|analytics|ai|devops|sre|infrastructure|informatik|rechenzentrum)\b/i;
const PARENT_PATTERN = /\b(parent|main|hq|headquarters|group|holding|zentrale|makro|macro|retail|global)\b/i;
const UNRELATED_PATTERN = /\b(bank|broadband|include exclude|advertis|academy|university|real estate|properties|media sales|investment|capital|insurance|clinic|hospitality)\b/i;
const TECH_TITLE_PATTERN = /\b(observability|monitoring|sre|site reliability|devops|platform|cloud|infrastructure|systems?|software|engineering|architect|technology|data|ai|security operations)\b/i;
const LEGAL_OR_GENERIC_TOKENS = new Set([
  'ag',
  'co',
  'company',
  'corp',
  'corporation',
  'gmbh',
  'group',
  'holding',
  'inc',
  'ltd',
  'limited',
  'llc',
  'plc',
  'sa',
  'se',
]);

function slugifyAccountName(accountName) {
  return String(accountName || 'account')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'account';
}

function buildEnterpriseEntitySearchTerms(accountName, {
  aliasEntry = null,
  maxTerms = 12,
} = {}) {
  const raw = String(accountName || '').trim();
  const aliases = aliasEntry || findCompanyAliasEntry(loadCompanyAliasConfig(), raw);
  const configuredTerms = [
    ...(aliases.accountSearchAliases || []),
    ...(aliases.companyFilterAliases || []),
    ...(aliases.parentAliases || []),
    ...(aliases.subsidiaryAliases || []),
    ...(aliases.targets || []).map((target) => target.linkedinName || target.name || target.companyName),
  ].filter(Boolean);
  const variants = [
    raw,
    `${raw} digital`,
    `${raw} IT`,
    `${raw} systems`,
    `${raw} technology`,
    `${raw} platform`,
    `${raw} data`,
    ...configuredTerms,
  ]
    .map((value) => String(value || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return [...new Set(variants)].slice(0, maxTerms);
}

function candidateCompanyId(candidate = {}) {
  if (candidate.companyId) return String(candidate.companyId);
  const match = String(candidate.salesNavigatorUrl || candidate.salesNavCompanyUrl || '').match(/\/sales\/company\/([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]).trim() : '';
}

function normalizeCandidate(candidate = {}, index = 0) {
  const name = candidate.name || candidate.linkedinName || candidate.companyName || '';
  const companyId = candidateCompanyId(candidate);
  return {
    ...candidate,
    name,
    linkedinName: name,
    companyId,
    entityUrn: candidate.entityUrn || (companyId ? `urn:li:fs_salesCompany:${companyId}` : ''),
    salesNavigatorUrl: candidate.salesNavigatorUrl || candidate.salesNavCompanyUrl || (companyId ? `https://www.linkedin.com/sales/company/${companyId}` : ''),
    evidence: [...new Set(candidate.evidence || [])],
    searchTerm: candidate.searchTerm || null,
    source: candidate.source || 'api_company_search',
    leadSamples: Array.isArray(candidate.leadSamples) ? candidate.leadSamples : [],
    index,
  };
}

function dedupeEntityCandidates(candidates = []) {
  const byKey = new Map();
  for (const [index, rawCandidate] of candidates.entries()) {
    const candidate = normalizeCandidate(rawCandidate, index);
    const key = candidate.companyId || normalizeCompanyName(candidate.name);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, candidate);
      continue;
    }
    existing.evidence = [...new Set([...(existing.evidence || []), ...(candidate.evidence || [])])];
    existing.searchTerm = existing.searchTerm || candidate.searchTerm;
    existing.leadSamples = mergeLeadSamples(existing.leadSamples, candidate.leadSamples);
  }
  return [...byKey.values()];
}

function buildBrandTokens(accountName) {
  const tokens = normalizeCompanyName(accountName)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !LEGAL_OR_GENERIC_TOKENS.has(token));
  if (tokens.length > 1) {
    return tokens.filter((token, index) => index > 0 || token.length >= 5);
  }
  return tokens;
}

function mergeLeadSamples(left = [], right = []) {
  const seen = new Set();
  const merged = [];
  for (const item of [...left, ...right]) {
    const key = item.entityUrn || item.salesNavigatorLeadId || `${item.fullName}|${item.title}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

function leadSampleTechSignals(leadSamples = []) {
  return (leadSamples || []).filter((lead) => TECH_TITLE_PATTERN.test(`${lead.title || ''} ${lead.headline || ''}`)).length;
}

function classifyEnterpriseEntityCandidate(accountName, candidate = {}, context = {}) {
  const normalizedAccount = normalizeCompanyName(accountName);
  const normalizedName = normalizeCompanyName(candidate.name || candidate.linkedinName);
  const text = `${candidate.name || candidate.linkedinName || ''} ${(candidate.evidence || []).join(' ')}`;
  const brandTokens = context.brandTokens || buildBrandTokens(accountName);
  const exactName = normalizedName && normalizedName === normalizedAccount;
  const relatedByName = normalizedName && normalizedAccount && (
    normalizedName.startsWith(`${normalizedAccount} `)
    || normalizedName.includes(` ${normalizedAccount} `)
    || normalizedName.includes(`${normalizedAccount} `)
    || normalizedName.includes(normalizedAccount)
    || brandTokens.some((token) => normalizedName.split(' ').includes(token))
  );
  const itDigital = IT_DIGITAL_PATTERN.test(text);
  const parentSignal = PARENT_PATTERN.test(text) || exactName;
  const unrelatedSignal = UNRELATED_PATTERN.test(text);
  const curatedSignal = (candidate.evidence || []).some((item) => /curated/.test(item));
  const techLeadSignals = leadSampleTechSignals(candidate.leadSamples);
  const hasStrongerRelatedTargets = Boolean(context.hasStrongerRelatedTargets);
  let score = 0;
  const reasons = [];

  if (exactName) {
    score += 30;
    reasons.push('exact account-name match');
  } else if (relatedByName) {
    score += 24;
    reasons.push('name is related to the account');
  }
  if (itDigital && (relatedByName || techLeadSignals > 0 || curatedSignal)) {
    score += 50;
    reasons.push('IT/digital/technology entity');
  } else if (itDigital) {
    score += 10;
    reasons.push('IT/digital keyword without account relation');
  }
  if (parentSignal) {
    score += 46;
    reasons.push('parent/main buyer-scope entity');
  }
  if (techLeadSignals > 0) {
    score += Math.min(30, techLeadSignals * 7);
    reasons.push(`${techLeadSignals} technical lead sample${techLeadSignals === 1 ? '' : 's'}`);
  }
  if (relatedByName && techLeadSignals >= 3) {
    score += 25;
    reasons.push('technical sample confirms related entity');
  }
  if (curatedSignal) {
    score += 70;
    reasons.push('curated target');
  }
  if (unrelatedSignal) {
    score -= 55;
    reasons.push('unrelated homonym signal');
  }
  if (exactName && hasStrongerRelatedTargets && !itDigital && !PARENT_PATTERN.test(text)) {
    score -= 20;
    reasons.push('generic exact page kept behind stronger related entities');
  }
  if (!relatedByName && !exactName && !techLeadSignals && !curatedSignal) {
    score -= 35;
    reasons.push('no clear relation to account');
  }

  const confidence = Math.max(0, Math.min(1, Number((score / 100).toFixed(2))));
  let entityPriority = classifyCompanyEntityPriority({
    linkedinName: candidate.name || candidate.linkedinName,
    targetType: parentSignal ? 'parent' : 'unknown',
    evidence: candidate.evidence || [],
  });
  if (itDigital && (relatedByName || techLeadSignals > 0 || curatedSignal)) {
    entityPriority = 'it_digital_first';
  } else if (parentSignal && !unrelatedSignal) {
    entityPriority = 'parent_buyer_scope';
  } else if (unrelatedSignal || confidence < 0.35) {
    entityPriority = 'unrelated_homonym';
  } else {
    entityPriority = 'related_entity';
  }

  let decision = 'exclude';
  if (!unrelatedSignal && confidence >= 0.7) {
    decision = 'include';
  } else if (!unrelatedSignal && confidence >= 0.5) {
    decision = 'suggest';
  }

  if (!relatedByName && !exactName && !techLeadSignals && !curatedSignal) {
    decision = 'exclude';
    entityPriority = 'unrelated_homonym';
  }

  if (entityPriority === 'unrelated_homonym') {
    decision = 'exclude';
  }

  return {
    ...candidate,
    normalizedName,
    entityPriority,
    confidence,
    decision,
    reason: reasons.join('; ') || 'no strong relation signal',
    leadSampleCount: candidate.leadSamples?.length || 0,
    technicalLeadSampleCount: techLeadSignals,
  };
}

function normalizeCuratedTargets(accountName, aliasEntry = {}) {
  return (aliasEntry.targets || [])
    .map((target) => normalizeCandidate({
      name: target.linkedinName || target.name || target.companyName,
      companyId: candidateCompanyId(target),
      salesNavigatorUrl: target.salesNavCompanyUrl,
      entityUrn: target.entityUrn,
      evidence: [...new Set(['curated_target', ...(target.evidence || [])])],
      source: 'curated_company_targets',
    }))
    .filter((candidate) => candidate.name && candidate.companyId)
    .map((candidate) => classifyEnterpriseEntityCandidate(accountName, candidate, { hasStrongerRelatedTargets: true }))
    .map((candidate) => ({
      ...candidate,
      decision: 'include',
      confidence: Math.max(candidate.confidence, 0.9),
      reason: `${candidate.reason}; curated config target`,
    }));
}

function addCuratedEvidenceToCandidates(candidates = [], aliasEntry = {}) {
  const curatedNames = new Map();
  for (const target of aliasEntry.targets || []) {
    const name = target.linkedinName || target.name || target.companyName;
    const key = normalizeCompanyName(name);
    if (!key) continue;
    curatedNames.set(key, [...new Set(['curated_target', ...(target.evidence || [])])]);
  }
  return candidates.map((candidate) => {
    const key = normalizeCompanyName(candidate.name || candidate.linkedinName);
    const evidence = curatedNames.get(key);
    if (!evidence) return candidate;
    return {
      ...candidate,
      evidence: [...new Set([...(candidate.evidence || []), ...evidence])],
    };
  });
}

function resolveEnterpriseEntities({
  accountName,
  companyCandidates = [],
  aliasConfig = null,
  now = new Date(),
} = {}) {
  const config = aliasConfig || loadCompanyAliasConfig();
  const aliasEntry = findCompanyAliasEntry(config, accountName);
  const brandTokens = buildBrandTokens(accountName);
  const curatedTargets = normalizeCuratedTargets(accountName, aliasEntry);
  const candidates = dedupeEntityCandidates(addCuratedEvidenceToCandidates(companyCandidates, aliasEntry));
  const hasStrongerRelatedTargets = candidates.some((candidate) => {
    const text = `${candidate.name || ''} ${(candidate.evidence || []).join(' ')}`;
    const normalizedName = normalizeCompanyName(candidate.name);
    return (normalizedName.includes(normalizeCompanyName(accountName))
      || brandTokens.some((token) => normalizedName.split(' ').includes(token)))
      && (IT_DIGITAL_PATTERN.test(text) || PARENT_PATTERN.test(text));
  });
  const classifiedSearchCandidates = candidates.map((candidate) =>
    classifyEnterpriseEntityCandidate(accountName, candidate, { hasStrongerRelatedTargets, brandTokens }));
  const merged = dedupeEntityCandidates([...curatedTargets, ...classifiedSearchCandidates])
    .map((candidate) => (
      candidate.decision
        ? candidate
        : classifyEnterpriseEntityCandidate(accountName, candidate, { hasStrongerRelatedTargets, brandTokens })
    ));
  const included = merged
    .filter((candidate) => candidate.decision === 'include')
    .sort(compareEnterpriseEntityPriority);
  const suggested = merged
    .filter((candidate) => candidate.decision === 'suggest')
    .sort(compareEnterpriseEntityPriority);
  const excluded = merged
    .filter((candidate) => candidate.decision === 'exclude')
    .sort(compareEnterpriseEntityPriority);
  const hasCuratedEvidence = merged.some((candidate) => (candidate.evidence || []).some((item) => /curated/.test(item)));
  const source = curatedTargets.length > 0 || hasCuratedEvidence ? 'curated_company_targets' : 'api_company_search';
  let status = 'needs_company_scope_review';
  if (included.length > 0) {
    status = curatedTargets.length > 0 || hasCuratedEvidence
      ? (included.length > 1 ? 'resolved_multi_target_curated' : 'resolved_exact_curated')
      : (included.length > 1 ? 'resolved_multi_target_suggested' : 'resolved_exact_suggested');
  } else if (merged.length === 0) {
    status = 'all_resolution_failed';
  }

  const selectedTargets = included.map(toApiTarget);
  const searchedFirst = selectedTargets[0]?.name || null;
  const searchedRest = selectedTargets.slice(1).map((target) => target.name);
  const skippedCount = excluded.length;

  return {
    generatedAt: now.toISOString(),
    accountName,
    source,
    status,
    mode: 'read_only',
    learningMode: 'suggest_first',
    recommendedAction: included.length > 0 ? 'run_related_entity_sweeps' : 'review_enterprise_entities',
    summary: {
      included: included.length,
      suggested: suggested.length,
      excluded: excluded.length,
      searchedFirst,
      searchedRest,
      skippedCount,
    },
    selectedTargets,
    included: included.map(toArtifactEntity),
    suggested: suggested.map(toArtifactEntity),
    excluded: excluded.map(toArtifactEntity),
    learnedSuggestions: curatedTargets.length > 0 || hasCuratedEvidence ? [] : suggested.concat(included).map(toLearnedSuggestion),
  };
}

function compareEnterpriseEntityPriority(left = {}, right = {}) {
  const leftRank = entityPriorityRank(left.entityPriority);
  const rightRank = entityPriorityRank(right.entityPriority);
  if (leftRank !== rightRank) return leftRank - rightRank;
  if ((right.confidence || 0) !== (left.confidence || 0)) return (right.confidence || 0) - (left.confidence || 0);
  return (left.index || 0) - (right.index || 0);
}

function entityPriorityRank(priority) {
  switch (priority) {
    case 'it_digital_first':
      return 0;
    case 'parent_buyer_scope':
      return 1;
    case 'related_entity':
      return 2;
    case 'unrelated_homonym':
      return 9;
    default:
      return 5;
  }
}

function toApiTarget(entity = {}) {
  return {
    name: entity.name || entity.linkedinName,
    companyId: entity.companyId,
    entityUrn: entity.entityUrn || (entity.companyId ? `urn:li:fs_salesCompany:${entity.companyId}` : ''),
    salesNavigatorUrl: entity.salesNavigatorUrl || (entity.companyId ? `https://www.linkedin.com/sales/company/${entity.companyId}` : ''),
    entityPriority: entity.entityPriority,
    confidence: entity.confidence,
    decision: entity.decision,
    reason: entity.reason,
    evidence: entity.evidence || [],
  };
}

function toArtifactEntity(entity = {}) {
  return {
    name: entity.name || entity.linkedinName,
    companyId: entity.companyId,
    entityUrn: entity.entityUrn || null,
    salesNavigatorUrl: entity.salesNavigatorUrl || null,
    entityPriority: entity.entityPriority,
    confidence: entity.confidence,
    decision: entity.decision,
    reason: entity.reason,
    evidence: entity.evidence || [],
    leadSampleCount: entity.leadSampleCount || 0,
    technicalLeadSampleCount: entity.technicalLeadSampleCount || 0,
  };
}

function toLearnedSuggestion(entity = {}) {
  return {
    linkedinName: entity.name || entity.linkedinName,
    salesNavCompanyUrl: entity.salesNavigatorUrl || null,
    targetType: entity.entityPriority === 'parent_buyer_scope' ? 'parent' : 'subsidiary',
    territoryFit: 'likely',
    confidence: entity.confidence,
    entityPriority: entity.entityPriority,
    evidence: [...new Set(['enterprise_entity_resolver', ...(entity.evidence || [])])],
    reason: entity.reason,
  };
}

function buildEnterpriseEntityArtifactPath(accountName, now = new Date()) {
  ensureDir(ENTERPRISE_ENTITY_ARTIFACTS_DIR, 0o700);
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(ENTERPRISE_ENTITY_ARTIFACTS_DIR, `${timestamp}-${slugifyAccountName(accountName)}.json`);
}

function writeEnterpriseEntityResolutionArtifact(resolution, artifactPath = null) {
  const targetPath = artifactPath || buildEnterpriseEntityArtifactPath(resolution?.accountName);
  const reportPath = targetPath.replace(/\.json$/i, '.md');
  writeJson(targetPath, {
    ...resolution,
    artifactPath: targetPath,
    reportPath,
  });
  fs.writeFileSync(reportPath, renderEnterpriseEntityResolutionMarkdown({
    ...resolution,
    artifactPath: targetPath,
    reportPath,
  }), {
    encoding: 'utf8',
    mode: 0o600,
  });
  return { artifactPath: targetPath, reportPath };
}

function renderEnterpriseEntityResolutionMarkdown(resolution = {}) {
  const lines = [];
  lines.push('# Enterprise Entity Resolution');
  lines.push('');
  lines.push(`- Account: \`${resolution.accountName || 'unknown'}\``);
  lines.push(`- Status: \`${resolution.status || 'unknown'}\``);
  lines.push(`- Mode: \`${resolution.mode || 'read_only'}\``);
  lines.push(`- Learning: \`${resolution.learningMode || 'suggest_first'}\``);
  lines.push(`- Recommended action: \`${resolution.recommendedAction || 'review_enterprise_entities'}\``);
  if (resolution.summary?.searchedFirst) {
    const rest = (resolution.summary.searchedRest || []).join(', ');
    lines.push(`- Plain English: Searched ${resolution.summary.searchedFirst} first${rest ? `, then ${rest}` : ''}; skipped ${resolution.summary.skippedCount || 0} unrelated page${resolution.summary.skippedCount === 1 ? '' : 's'}.`);
  }
  lines.push('');
  lines.push('## Included Targets');
  appendEntityTable(lines, resolution.included || []);
  lines.push('');
  lines.push('## Suggested Targets');
  appendEntityTable(lines, resolution.suggested || []);
  lines.push('');
  lines.push('## Excluded Targets');
  appendEntityTable(lines, resolution.excluded || []);
  lines.push('');
  return `${lines.join('\n').trim()}\n`;
}

function appendEntityTable(lines, entities) {
  if (!entities.length) {
    lines.push('- none');
    return;
  }
  lines.push('| Name | Decision | Priority | Confidence | Reason |');
  lines.push('| --- | --- | --- | ---: | --- |');
  for (const entity of entities) {
    lines.push(`| ${escapeMarkdownCell(entity.name)} | ${escapeMarkdownCell(entity.decision)} | ${escapeMarkdownCell(entity.entityPriority)} | ${entity.confidence ?? 0} | ${escapeMarkdownCell(entity.reason)} |`);
  }
}

function escapeMarkdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

module.exports = {
  ENTERPRISE_ENTITY_ARTIFACTS_DIR,
  buildEnterpriseEntityArtifactPath,
  buildEnterpriseEntitySearchTerms,
  classifyEnterpriseEntityCandidate,
  renderEnterpriseEntityResolutionMarkdown,
  resolveEnterpriseEntities,
  writeEnterpriseEntityResolutionArtifact,
};
