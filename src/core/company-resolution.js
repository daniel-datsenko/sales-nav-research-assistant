const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('../lib/json');
const {
  COMPANY_RESOLUTION_ARTIFACTS_DIR,
  ensureDir,
  resolveProjectPath,
} = require('../lib/paths');

const COMPANY_RESOLUTION_STATUSES = new Set([
  'resolved_exact',
  'resolved_multi_target',
  'resolved_low_confidence',
  'needs_manual_company_review',
  'all_resolution_failed',
]);

const LEARNED_COMPANY_TARGETS_PATH = path.join(COMPANY_RESOLUTION_ARTIFACTS_DIR, 'learned-company-targets.json');

function normalizeCompanyName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(gmbh|mbh|ag|se|sa|s\.a\.|spa|s\.p\.a\.|ltd|limited|inc|corp|corporation|llc|plc|group|holding|holdings)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function companyNameFromLinkedInUrl(url) {
  try {
    const parsed = new URL(String(url));
    const match = parsed.pathname.match(/\/company\/([^/?#]+)/i);
    const slug = match?.[1];
    if (!slug) {
      return null;
    }
    return slug.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  }
}

function findCompanyAliasEntry(aliasConfig, accountName) {
  const accounts = aliasConfig?.accounts || {};
  const exactKey = String(accountName || '').trim().toLowerCase();
  if (accounts[exactKey]) {
    return accounts[exactKey];
  }

  const normalizedTarget = normalizeCompanyName(accountName);
  const matchingKey = Object.keys(accounts).find((key) => normalizeCompanyName(key) === normalizedTarget);
  return matchingKey ? accounts[matchingKey] : {};
}

function loadCompanyAliasConfig(configPath = null) {
  const resolved = configPath || resolveProjectPath('config', 'account-aliases', 'default.json');
  if (!fs.existsSync(resolved)) {
    return { accounts: {} };
  }
  return readJson(resolved);
}

function loadLearnedCompanyTargets(filePath = LEARNED_COMPANY_TARGETS_PATH) {
  if (!fs.existsSync(filePath)) {
    return { version: '1.0.0', accounts: {} };
  }
  return readJson(filePath);
}

function writeLearnedCompanyTargets(registry, filePath = LEARNED_COMPANY_TARGETS_PATH) {
  ensureDir(path.dirname(filePath), 0o700);
  writeJson(filePath, {
    version: registry?.version || '1.0.0',
    accounts: registry?.accounts || {},
    updatedAt: new Date().toISOString(),
  });
  return filePath;
}

function buildCompanyResolutionArtifactPath(accountName, now = new Date()) {
  ensureDir(COMPANY_RESOLUTION_ARTIFACTS_DIR, 0o700);
  const accountSlug = String(accountName || 'unknown-account')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(COMPANY_RESOLUTION_ARTIFACTS_DIR, `${accountSlug}-${timestamp}.json`);
}

function buildCompanyResolutionReportPath(jsonPath) {
  return String(jsonPath || buildCompanyResolutionArtifactPath('unknown-account')).replace(/\.json$/i, '.md');
}

function buildCompanyResolution({
  accountName,
  source = 'manual',
  account = null,
  aliasConfig = null,
  learnedRegistry = null,
  priorCoverage = null,
  now = new Date(),
} = {}) {
  const resolvedAliasConfig = aliasConfig || loadCompanyAliasConfig();
  const resolvedLearnedRegistry = learnedRegistry || loadLearnedCompanyTargets();
  const name = String(accountName || account?.accountName || account?.name || '').trim();
  const aliasEntry = findCompanyAliasEntry(resolvedAliasConfig, name);
  const learnedEntry = findCompanyAliasEntry(resolvedLearnedRegistry, name);
  const evidence = [];
  const candidates = [];

  addTargetCandidates(candidates, aliasEntry.targets, 'curated_target');
  addTargetCandidates(candidates, learnedEntry.targets, 'learned_target');
  addNameCandidates(candidates, aliasEntry.accountSearchAliases, 'alias');
  addNameCandidates(candidates, aliasEntry.companyFilterAliases, 'alias');
  addNameCandidates(candidates, aliasEntry.parentAliases, 'parent_subsidiary');
  addNameCandidates(candidates, aliasEntry.subsidiaryAliases, 'parent_subsidiary');
  addUrlCandidates(candidates, aliasEntry.linkedinCompanyUrls, 'linkedin_url');
  addUrlCandidates(candidates, learnedEntry.linkedinCompanyUrls, 'learned_linkedin_url');
  addNameCandidates(candidates, account?.salesNav?.accountSearchAliases, 'account_salesnav_alias');
  addNameCandidates(candidates, account?.salesNav?.companyFilterAliases, 'account_salesnav_alias');
  addUrlCandidates(candidates, account?.salesNav?.linkedinCompanyUrls, 'account_linkedin_url');
  addNameCandidates(candidates, [account?.parentAccountName], 'parent_subsidiary');
  addNameCandidates(candidates, [name], 'account_name');

  const domains = [
    ...(Array.isArray(aliasEntry.domains) ? aliasEntry.domains : []),
    ...(Array.isArray(account?.domains) ? account.domains : []),
    account?.domain,
    account?.website,
  ].filter(Boolean);
  const territoryCountries = [
    ...(Array.isArray(aliasEntry.territoryCountries) ? aliasEntry.territoryCountries : []),
    account?.country,
    account?.region,
  ].filter(Boolean);

  const targets = dedupeTargets(candidates)
    .map((target) => scoreCompanyTarget({
      target,
      accountName: name,
      domains,
      territoryCountries,
      priorCoverage,
    }))
    .sort((left, right) => right.score - left.score);

  const selectedTargets = targets.filter((target) => target.score >= 50).slice(0, 5);
  const top = selectedTargets[0] || null;
  const strongTargets = selectedTargets.filter((target) => target.score >= 70);
  const inferredStatus = classifyCompanyResolutionStatus({ top, strongTargets });
  const status = COMPANY_RESOLUTION_STATUSES.has(aliasEntry.resolutionStatus)
    && inferredStatus !== 'all_resolution_failed'
    ? aliasEntry.resolutionStatus
    : inferredStatus;
  const confidence = top ? Number((top.score / 100).toFixed(2)) : 0;
  const recommendedAction = getCompanyResolutionRecommendedAction(status);

  if (aliasEntry && Object.keys(aliasEntry).length > 0) {
    evidence.push('alias_registry');
  }
  if (learnedEntry && Object.keys(learnedEntry).length > 0) {
    evidence.push('learned_registry');
  }
  if (selectedTargets.some((target) => target.evidence.includes('linkedin_url') || target.evidence.includes('learned_linkedin_url'))) {
    evidence.push('linkedin_company_url');
  }
  if (priorCoverage?.candidateCount > 0) {
    evidence.push('prior_successful_leads');
  }

  return {
    accountName: name,
    source,
    status,
    confidence,
    generatedAt: now.toISOString(),
    recommendedAction,
    evidence,
    targets: selectedTargets.map(normalizeTargetForArtifact),
    allCandidates: targets.slice(0, 10).map(normalizeTargetForArtifact),
  };
}

function addTargetCandidates(candidates, targets, evidence) {
  for (const target of Array.isArray(targets) ? targets : []) {
    if (!target) {
      continue;
    }
    candidates.push({
      linkedinName: target.linkedinName || target.name || target.companyName || null,
      linkedinCompanyUrl: target.linkedinCompanyUrl || null,
      salesNavCompanyUrl: target.salesNavCompanyUrl || null,
      targetType: target.targetType || 'unknown',
      territoryFit: target.territoryFit || 'unclear',
      evidence: [...new Set([evidence, ...(target.evidence || [])].filter(Boolean))],
    });
  }
}

function addNameCandidates(candidates, names, evidence) {
  for (const name of Array.isArray(names) ? names : []) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      continue;
    }
    candidates.push({
      linkedinName: trimmed,
      linkedinCompanyUrl: null,
      salesNavCompanyUrl: null,
      targetType: evidence === 'parent_subsidiary' ? 'parent' : 'unknown',
      territoryFit: 'unclear',
      evidence: [evidence],
    });
  }
}

function addUrlCandidates(candidates, urls, evidence) {
  for (const url of Array.isArray(urls) ? urls : []) {
    const linkedinName = companyNameFromLinkedInUrl(url);
    if (!linkedinName) {
      continue;
    }
    candidates.push({
      linkedinName,
      linkedinCompanyUrl: url,
      salesNavCompanyUrl: null,
      targetType: 'unknown',
      territoryFit: 'unclear',
      evidence: [evidence],
    });
  }
}

function dedupeTargets(candidates) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const key = normalizeCompanyName(candidate.linkedinName || candidate.linkedinCompanyUrl);
    if (!key) {
      continue;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        ...candidate,
        evidence: [...new Set(candidate.evidence || [])],
      });
      continue;
    }
    existing.linkedinCompanyUrl = existing.linkedinCompanyUrl || candidate.linkedinCompanyUrl;
    existing.salesNavCompanyUrl = existing.salesNavCompanyUrl || candidate.salesNavCompanyUrl;
    existing.targetType = existing.targetType !== 'unknown' ? existing.targetType : candidate.targetType;
    existing.territoryFit = existing.territoryFit !== 'unclear' ? existing.territoryFit : candidate.territoryFit;
    existing.evidence = [...new Set([...(existing.evidence || []), ...(candidate.evidence || [])])];
  }
  return [...byKey.values()];
}

function scoreCompanyTarget({ target, accountName, domains = [], territoryCountries = [], priorCoverage = null }) {
  const normalizedAccount = normalizeCompanyName(accountName);
  const normalizedTarget = normalizeCompanyName(target.linkedinName);
  let score = 0;
  const evidence = [...new Set(target.evidence || [])];

  if (normalizedTarget && normalizedAccount && normalizedTarget === normalizedAccount) {
    score += 35;
    evidence.push('exact_name_match');
  } else if (normalizedTarget && normalizedAccount && (
    normalizedTarget.includes(normalizedAccount)
    || normalizedAccount.includes(normalizedTarget)
  )) {
    score += 20;
    evidence.push('partial_name_match');
  }
  if (evidence.some((item) => /alias/.test(item))) {
    score += 30;
  }
  if (target.linkedinCompanyUrl || evidence.some((item) => /linkedin_url/.test(item))) {
    score += 30;
  }
  if (domains.length > 0 && target.linkedinCompanyUrl && domains.some((domain) => target.linkedinCompanyUrl.includes(String(domain).replace(/^https?:\/\//i, '').replace(/^www\./i, '')))) {
    score += 25;
    evidence.push('domain_match');
  }
  if (evidence.includes('parent_subsidiary') || ['parent', 'subsidiary', 'regional'].includes(target.targetType)) {
    score += 20;
  }
  if (territoryCountries.length > 0 && target.territoryFit !== 'out_of_scope') {
    score += 15;
  }
  if (priorCoverage?.candidateCount > 0) {
    score += 20;
    evidence.push('prior_successful_leads');
  }
  if (target.territoryFit === 'out_of_scope') {
    score -= 40;
  }

  const cappedScore = Math.max(0, Math.min(100, score));
  return {
    ...target,
    score: cappedScore,
    confidence: Number((cappedScore / 100).toFixed(2)),
    evidence: [...new Set(evidence)],
  };
}

function classifyCompanyResolutionStatus({ top, strongTargets }) {
  if (!top) {
    return 'all_resolution_failed';
  }
  if (top.score >= 85 && strongTargets.length <= 1) {
    return 'resolved_exact';
  }
  if (strongTargets.length > 1) {
    return 'resolved_multi_target';
  }
  if (top.score >= 70) {
    return 'needs_manual_company_review';
  }
  if (top.score >= 50) {
    return 'resolved_low_confidence';
  }
  return 'all_resolution_failed';
}

function getCompanyResolutionRecommendedAction(status) {
  switch (status) {
    case 'resolved_exact':
      return 'run_people_sweeps';
    case 'resolved_multi_target':
      return 'run_guarded_multi_target_sweeps';
    case 'resolved_low_confidence':
    case 'needs_manual_company_review':
      return 'review_company_targets_before_retry';
    default:
      return 'resolve_company_targets_then_retry';
  }
}

function normalizeTargetForArtifact(target) {
  return {
    linkedinName: target.linkedinName,
    linkedinCompanyUrl: target.linkedinCompanyUrl || null,
    salesNavCompanyUrl: target.salesNavCompanyUrl || null,
    targetType: target.targetType || 'unknown',
    territoryFit: target.territoryFit || 'unclear',
    confidence: target.confidence,
    score: target.score,
    evidence: target.evidence || [],
  };
}

function writeCompanyResolutionArtifact(resolution, artifactPath = null) {
  const targetPath = artifactPath || buildCompanyResolutionArtifactPath(resolution?.accountName);
  writeJson(targetPath, {
    ...resolution,
    artifactPath: targetPath,
    reportPath: buildCompanyResolutionReportPath(targetPath),
  });
  const reportPath = writeCompanyResolutionReport({
    ...resolution,
    artifactPath: targetPath,
    reportPath: buildCompanyResolutionReportPath(targetPath),
  });
  return { artifactPath: targetPath, reportPath };
}

function writeCompanyResolutionReport(resolution, reportPath = null) {
  const targetPath = reportPath || resolution?.reportPath || buildCompanyResolutionReportPath(resolution?.artifactPath);
  fs.writeFileSync(targetPath, renderCompanyResolutionMarkdown(resolution), {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(targetPath, 0o600);
  } catch {
    // best effort
  }
  return targetPath;
}

function renderCompanyResolutionMarkdown(resolution = {}) {
  const lines = [];
  lines.push('# Company Resolution Report');
  lines.push('');
  lines.push(`- Account: \`${resolution.accountName || 'unknown'}\``);
  lines.push(`- Source: \`${resolution.source || 'unknown'}\``);
  lines.push(`- Status: \`${resolution.status || 'unknown'}\``);
  lines.push(`- Confidence: \`${resolution.confidence ?? 0}\``);
  lines.push(`- Recommended action: \`${resolution.recommendedAction || 'unknown'}\``);
  lines.push(`- Evidence: \`${(resolution.evidence || []).join(', ') || 'none'}\``);
  lines.push('');
  lines.push('## Targets');
  if ((resolution.targets || []).length === 0) {
    lines.push('- none');
  } else {
    lines.push('| Name | Confidence | Territory | Type | Evidence |');
    lines.push('| --- | ---: | --- | --- | --- |');
    for (const target of resolution.targets || []) {
      lines.push(`| ${escapeMarkdownCell(target.linkedinName)} | ${target.confidence} | ${escapeMarkdownCell(target.territoryFit)} | ${escapeMarkdownCell(target.targetType)} | ${escapeMarkdownCell((target.evidence || []).join(', '))} |`);
    }
  }
  lines.push('');
  return `${lines.join('\n').trim()}\n`;
}

function escapeMarkdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function findLatestCompanyResolutionArtifact(accountName = null, artifactsDir = COMPANY_RESOLUTION_ARTIFACTS_DIR) {
  if (!fs.existsSync(artifactsDir)) {
    return null;
  }
  const accountSlug = accountName
    ? String(accountName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    : null;
  const artifacts = fs.readdirSync(artifactsDir)
    .filter((fileName) => /\.json$/i.test(fileName) && fileName !== 'learned-company-targets.json')
    .filter((fileName) => !accountSlug || fileName.startsWith(`${accountSlug}-`))
    .map((fileName) => {
      const filePath = path.join(artifactsDir, fileName);
      return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return artifacts[0]?.filePath || null;
}

function summarizeCompanyResolutionArtifacts(artifactsDir = COMPANY_RESOLUTION_ARTIFACTS_DIR) {
  if (!fs.existsSync(artifactsDir)) {
    return {
      total: 0,
      resolvedExact: 0,
      multiTarget: 0,
      needsManualReview: 0,
      failed: 0,
      nextActions: [],
    };
  }
  const artifacts = fs.readdirSync(artifactsDir)
    .filter((fileName) => /\.json$/i.test(fileName) && fileName !== 'learned-company-targets.json')
    .map((fileName) => path.join(artifactsDir, fileName))
    .map((filePath) => {
      try {
        return readJson(filePath);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const nextActions = [...new Set(artifacts.map((artifact) => artifact.recommendedAction).filter(Boolean))];
  return {
    total: artifacts.length,
    resolvedExact: artifacts.filter((artifact) => artifact.status === 'resolved_exact').length,
    multiTarget: artifacts.filter((artifact) => artifact.status === 'resolved_multi_target').length,
    needsManualReview: artifacts.filter((artifact) => ['needs_manual_company_review', 'resolved_low_confidence'].includes(artifact.status)).length,
    failed: artifacts.filter((artifact) => artifact.status === 'all_resolution_failed').length,
    nextActions,
  };
}

module.exports = {
  COMPANY_RESOLUTION_STATUSES,
  LEARNED_COMPANY_TARGETS_PATH,
  buildCompanyResolution,
  buildCompanyResolutionArtifactPath,
  buildCompanyResolutionReportPath,
  classifyCompanyResolutionStatus,
  companyNameFromLinkedInUrl,
  findCompanyAliasEntry,
  findLatestCompanyResolutionArtifact,
  getCompanyResolutionRecommendedAction,
  loadCompanyAliasConfig,
  loadLearnedCompanyTargets,
  normalizeCompanyName,
  renderCompanyResolutionMarkdown,
  scoreCompanyTarget,
  summarizeCompanyResolutionArtifacts,
  writeCompanyResolutionArtifact,
  writeCompanyResolutionReport,
  writeLearnedCompanyTargets,
};
