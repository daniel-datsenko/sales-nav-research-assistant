const path = require('node:path');
const fs = require('node:fs');
const { readJson, writeJson } = require('../lib/json');
const { resolveProjectPath, PRIORITY_ARTIFACTS_DIR, COVERAGE_ARTIFACTS_DIR } = require('../lib/paths');
const {
  classifyNonIcpTitleReason,
  hasTechnicalAmbiguousQualifier,
  scoreCandidate,
} = require('./scoring');
const { scoreCandidateWithPriorityModel } = require('./priority-score');
const { buildCoverageSummary } = require('./coverage');
const {
  buildCompanyResolution,
  writeCompanyResolutionArtifact,
} = require('./company-resolution');
const { normalizeCandidateLimit } = require('./candidate-limits');
const {
  createRunTimings,
  finishRunTimings,
  summarizeSlowestSweeps,
  timePhase,
} = require('./speed-telemetry');
const {
  buildSweepCacheKey,
  DEFAULT_SWEEP_CACHE_DIR,
  readSweepCache,
  writeSweepCache,
} = require('./sweep-cache');
const {
  buildLanguageSplitListNames,
  splitCandidatesByProfileLanguage,
} = require('./emea-territory');
const { resolveVoyagerIdentity } = require('./voyager-profile');

function loadAccountCoverageConfig(configPath) {
  return readJson(configPath || resolveProjectPath('config', 'account-coverage', 'default.json'));
}

function loadAccountAliasConfig(configPath) {
  const resolved = configPath || resolveProjectPath('config', 'account-aliases', 'default.json');
  if (!fs.existsSync(resolved)) {
    return { accounts: {} };
  }
  return readJson(resolved);
}

function normalizeAccountAliasKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\b(gmbh|mbh|ag|se|sa|s\.a\.|spa|s\.p\.a\.|ltd|limited|inc|corp|corporation|llc|plc|group|holding|holdings)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function findAccountAliasEntry(aliasConfig, accountName) {
  const accounts = aliasConfig?.accounts || {};
  const exactKey = String(accountName || '').trim().toLowerCase();
  if (accounts[exactKey]) {
    return accounts[exactKey];
  }

  const normalizedTarget = normalizeAccountAliasKey(accountName);
  const matchingKey = Object.keys(accounts).find((key) => (
    normalizeAccountAliasKey(key) === normalizedTarget
    || accountAliasEntryMatchesName(accounts[key], normalizedTarget)
  ));
  return matchingKey ? accounts[matchingKey] : {};
}

function accountAliasEntryMatchesName(entry = {}, normalizedTarget = '') {
  if (!normalizedTarget) {
    return false;
  }
  const values = [
    ...(entry.accountSearchAliases || []),
    ...(entry.companyFilterAliases || []),
    ...(entry.parentAliases || []),
    ...(entry.subsidiaryAliases || []),
    ...(entry.targets || []).flatMap((target) => [
      target.linkedinName,
      target.name,
      target.companyName,
    ]),
  ].filter(Boolean);
  return values.some((value) => normalizeAccountAliasKey(value) === normalizedTarget);
}

function loadPriorityModel() {
  const artifactPath = path.join(PRIORITY_ARTIFACTS_DIR, 'priority_score_v1.json');
  if (!fs.existsSync(artifactPath)) {
    return null;
  }
  return readJson(artifactPath);
}

function buildCoverageArtifactPath(accountName) {
  const fileName = `${String(accountName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  return path.join(COVERAGE_ARTIFACTS_DIR, fileName);
}

function loadExistingAccountCoverageArtifact(accountName) {
  const artifactPath = buildCoverageArtifactPath(accountName);
  if (!fs.existsSync(artifactPath)) {
    return null;
  }

  try {
    return readJson(artifactPath);
  } catch {
    return null;
  }
}

function normalizeCandidateKey(candidate) {
  const url = candidate.salesNavigatorUrl || candidate.profileUrl || '';
  if (url) {
    try {
      const parsed = new URL(url);
      const salesLeadMatch = parsed.pathname.match(/^(\/sales\/lead\/[^,/]+)/i);
      if (salesLeadMatch) {
        return `${parsed.origin}${salesLeadMatch[1]}`;
      }
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return String(url).replace(/\?.*$/, '');
    }
  }

  return `${candidate.fullName}:${candidate.title}`;
}

const SPEED_PROFILES = new Set(['exhaustive', 'balanced', 'fast']);
const RESEARCH_MODES = new Set(['persona-led', 'exhaustive', 'keyword']);
const PERSONA_LAYER_ORDER = {
  broad: 0,
  buyer: 1,
  operator: 2,
  user: 3,
  adjacent: 4,
  unknown: 5,
};
const PRIORITY_SWEEP_HINTS = [
  'observability',
  'platform',
  'engineering',
  'infrastructure',
  'cloud',
  'devops',
  'reliability',
  'sre',
  'architecture',
  'monitoring',
];
const API_RESCUE_SWEEP_IDS = new Set([
  'broad-crawl',
  'sweep-api-rescue-personas',
]);
const API_RESCUE_DEFAULT_MAX_CANDIDATES = 30;
const API_RESCUE_DEFAULT_MAX_SCROLL_STEPS = 3;

function normalizeSpeedProfile(value = 'balanced') {
  const profile = String(value || 'balanced').toLowerCase();
  return SPEED_PROFILES.has(profile) ? profile : 'balanced';
}

function normalizeResearchMode(value = 'persona-led') {
  const mode = String(value || 'persona-led').toLowerCase();
  return RESEARCH_MODES.has(mode) ? mode : 'persona-led';
}

/**
 * Normalize research mode, sweep speed profile, and adaptive pruning for buildSweepTemplates.
 * Mirrors runAccountCoverageWorkflow: exhaustive research mode forces an exhaustive sweep template
 * set and disables fast-path adaptive pruning expansion regardless of nominal speedProfile.
 */
function resolveSweepTemplateOptions({
  researchMode,
  speedProfile,
  adaptiveSweepPruning,
} = {}) {
  const normalizedResearchMode = normalizeResearchMode(researchMode);
  const normalizedSpeedProfile = normalizeSpeedProfile(speedProfile);
  const effectiveSpeedProfile = normalizedResearchMode === 'exhaustive'
    ? 'exhaustive'
    : normalizedSpeedProfile;
  const adaptiveRequested = Boolean(adaptiveSweepPruning);
  const adaptiveSweepPruningForTemplates = adaptiveRequested && effectiveSpeedProfile === 'fast';

  return {
    researchMode: normalizedResearchMode,
    speedProfile: effectiveSpeedProfile,
    adaptiveSweepPruning: adaptiveSweepPruningForTemplates,
  };
}

function inferPersonaLayerForSweep(sweep = {}) {
  const text = [
    sweep.id,
    sweep.name,
    ...(sweep.keywords || []),
    ...(sweep.titleIncludes || []),
  ].join(' ').toLowerCase();

  if (sweep.id === 'broad-crawl' || /\bbroad\b/.test(text)) {
    return 'broad';
  }
  if (/\b(buyer|cto|cio|cdo|chief|vp|director|directeur|directrice|direttore|direttrice|data\s*&\s*ai|data and ai|daten\s*&\s*ki|datos e ia|dati e ai|digital transformation|transformation digitale|marketplace director)\b/.test(text)) {
    return 'buyer';
  }
  if (/\b(operator|responsable domaine|direction informatique|gouvernance si|it-governance|governance|architecture des environnements|enterprise architecture|production informatique|produktion it|produzione it|infrastructure|platform|cloud governance|head of tech|leiter|responsabile|jefe de plataforma)\b/.test(text)) {
    return 'operator';
  }
  if (/\b(user|sre|site reliability|devops|devsecops|observability|observabilit|observabilidad|osservabilit|monitoring|technical lead|tech lead|cloud engineer|ingénieur|ingenieur|ingeniero|ingegnere|kubernetes|terraform|prometheus|grafana|dynatrace|datadog)\b/.test(text)) {
    return 'user';
  }
  if (/\b(security|data|software|technology|integration|operations|system|it)\b/.test(text)) {
    return 'adjacent';
  }
  return 'unknown';
}

function orderTemplatesForResearchMode(templates, researchMode = 'persona-led') {
  const mode = normalizeResearchMode(researchMode);
  if (mode === 'keyword') {
    return templates;
  }

  return templates
    .map((template, index) => ({ template, index }))
    .sort((left, right) => {
      const layerDiff = (PERSONA_LAYER_ORDER[left.template.personaLayer] ?? PERSONA_LAYER_ORDER.unknown)
        - (PERSONA_LAYER_ORDER[right.template.personaLayer] ?? PERSONA_LAYER_ORDER.unknown);
      if (layerDiff !== 0) {
        return layerDiff;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.template);
}

function isPrioritySweep(template) {
  if (template.id === 'broad-crawl') {
    return true;
  }
  const haystack = [
    template.id,
    template.name,
    ...(template.keywords || []),
  ].join(' ').toLowerCase();
  return PRIORITY_SWEEP_HINTS.some((hint) => haystack.includes(hint));
}

function applySpeedProfileToTemplates(templates, speedProfile = 'balanced', profileOptions = {}) {
  const profile = normalizeSpeedProfile(speedProfile);
  if (profile === 'exhaustive') {
    return templates;
  }

  const broad = templates.filter((template) => template.id === 'broad-crawl');
  const priority = templates.filter((template) => template.id !== 'broad-crawl' && isPrioritySweep(template));
  const rest = templates.filter((template) => template.id !== 'broad-crawl' && !isPrioritySweep(template));

  const expandFastRestForAdaptivePruning = Boolean(profileOptions.adaptiveSweepPruning);

  if (profile === 'fast') {
    if (expandFastRestForAdaptivePruning) {
      return [...broad, ...priority, ...rest];
    }
    return [...broad, ...priority];
  }
  return [...broad, ...priority, ...rest];
}

function isRestSweepTemplate(template) {
  return template.id !== 'broad-crawl' && !isPrioritySweep(template);
}

function getAdaptivePruningThresholds(speedProfile) {
  const profile = normalizeSpeedProfile(speedProfile);
  if (profile === 'exhaustive') {
    return null;
  }
  if (profile === 'fast') {
    return { windowSize: 2, maxNewUniquesPerSweep: 0 };
  }
  return { windowSize: 3, maxNewUniquesPerSweep: 0 };
}

function broadCrawlFinishedBeforeIndex(templates, templateIndex) {
  const broadIdx = templates.findIndex((template) => template.id === 'broad-crawl');
  if (broadIdx === -1) {
    return true;
  }
  return templateIndex > broadIdx;
}

function shouldAdaptiveSkipRestSweep({
  template,
  thresholds,
  adaptiveEnabled,
  executedUniqueAdds,
  templates,
  templateIndex,
}) {
  if (!adaptiveEnabled || !thresholds || !isRestSweepTemplate(template)) {
    return false;
  }
  if (!broadCrawlFinishedBeforeIndex(templates, templateIndex)) {
    return false;
  }
  if (executedUniqueAdds.length < thresholds.windowSize) {
    return false;
  }
  const tail = executedUniqueAdds.slice(-thresholds.windowSize);
  return tail.every((count) => count <= thresholds.maxNewUniquesPerSweep);
}

function buildSweepTemplates(config, maxCandidatesOverride = null, options = {}) {
  const templates = [];
  const overrideLimit = normalizeCandidateLimit(maxCandidatesOverride);
  const defaultTitleExcludes = config?.titleExcludes || [];

  if (config?.broadCrawl?.enabled) {
    const configuredLimit = normalizeCandidateLimit(config.broadCrawl.maxCandidates);
    const template = {
      id: 'broad-crawl',
      name: 'Broad Employee Crawl',
      keywords: [],
      titleIncludes: config.broadCrawl.titleIncludes || [],
      titleExcludes: config.broadCrawl.titleExcludes || defaultTitleExcludes,
      personaLayer: 'broad',
      maxScrollSteps: config.broadCrawl.maxScrollSteps ?? null,
    };
    const limit = overrideLimit ?? configuredLimit;
    if (limit !== null) {
      template.maxCandidates = limit;
    }
    templates.push(template);
  }

  for (const sweep of config?.sweeps || []) {
    const configuredLimit = normalizeCandidateLimit(sweep.maxCandidates);
    const template = {
      id: `sweep-${sweep.id}`,
      name: `Coverage Sweep ${sweep.id}`,
      keywords: sweep.keywords || [],
      titleIncludes: sweep.titleIncludes || [],
      titleExcludes: sweep.titleExcludes || defaultTitleExcludes,
      personaLayer: sweep.personaLayer || inferPersonaLayerForSweep(sweep),
      maxScrollSteps: sweep.maxScrollSteps ?? null,
    };
    const limit = overrideLimit ?? configuredLimit;
    if (limit !== null) {
      template.maxCandidates = limit;
    }
    templates.push(template);
  }

  const ordered = orderTemplatesForResearchMode(templates, options.researchMode || 'persona-led');

  return applySpeedProfileToTemplates(ordered, options.speedProfile || 'balanced', {
    adaptiveSweepPruning: options.adaptiveSweepPruning,
  });
}

function buildApiRescueSweepTemplates(templates = []) {
  return (templates || [])
    .filter((template) => API_RESCUE_SWEEP_IDS.has(template.id))
    .map((template) => ({
      ...template,
      rescuePass: true,
      maxCandidates: Math.min(
        Number.isFinite(Number(template.maxCandidates))
          ? Number(template.maxCandidates)
          : API_RESCUE_DEFAULT_MAX_CANDIDATES,
        API_RESCUE_DEFAULT_MAX_CANDIDATES,
      ),
      maxScrollSteps: Math.min(
        Number.isFinite(Number(template.maxScrollSteps))
          ? Number(template.maxScrollSteps)
          : API_RESCUE_DEFAULT_MAX_SCROLL_STEPS,
        API_RESCUE_DEFAULT_MAX_SCROLL_STEPS,
      ),
    }));
}

function summarizeApiRescuePass(candidates = []) {
  const rescued = (candidates || []).filter((candidate) => (
    (candidate.sweeps || []).some((sweepId) => API_RESCUE_SWEEP_IDS.has(sweepId))
    && !(candidate.sweeps || []).includes('api-broad-pool')
  ));
  return {
    status: rescued.length > 0 ? 'rescued_candidates_found' : 'completed_no_new_rescue_candidates',
    candidateCount: rescued.length,
    selectedCount: rescued.filter((candidate) => candidate.selectedForList).length,
    examples: rescued.slice(0, 10).map((candidate) => ({
      fullName: candidate.fullName,
      title: candidate.title,
      company: candidate.company,
      score: candidate.score,
      coverageBucket: candidate.coverageBucket,
      personaTier: candidate.personaTier,
      sweeps: candidate.sweeps,
      listSelectionReason: candidate.listSelectionReason || null,
    })),
  };
}

function classifySweepErrorCategory(error) {
  const message = String(error?.message || error || '');
  if (error?.code === 'rate_limited' || /rate[_ -]?limited|too many requests|zu viele anfragen/i.test(message)) {
    return 'rate_limited';
  }
  if (/scope|filter|account.*not found|company/i.test(message)) {
    return 'account_scope_failure';
  }
  if (/hydrate|spinner|shell|render|domcontentloaded|networkidle/i.test(message)) {
    return 'slow_hydration';
  }
  if (/target closed|browser.*closed|memory|crash|transport|econn/i.test(message)) {
    return 'browser_memory_or_transport';
  }
  return 'sweep_runtime_failure';
}

function hasSuccessfulLiveSweepEvidence(rawResults = []) {
  return rawResults.some((entry) => (
    !entry.cacheHit
    && Array.isArray(entry.candidates)
    && entry.candidates.length > 0
  ));
}

function inferLiveScopedTargets(activeAccount, accountName, candidates = []) {
  const explicitLabels = [
    activeAccount?.salesNav?.selectedCompanyLabel,
    activeAccount?.salesNav?.selectedCompanyName,
    activeAccount?.salesNav?.companyName,
    ...(activeAccount?.salesNav?.companyTargets || []).map((target) => target.linkedinName),
  ].filter(Boolean);
  const labels = explicitLabels.length > 0
    ? explicitLabels
    : [
      ...candidates.map((candidate) => candidate.company),
      accountName,
    ].filter(Boolean);

  const seen = new Set();
  return labels
    .map((label) => String(label).replace(/\s+/g, ' ').trim())
    .filter((label) => {
      const key = label.toLowerCase();
      if (!label || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 3);
}

function normalizeCompanyScopeLabel(value) {
  return normalizeAccountAliasKey(value);
}

function companyScopeLabelsMatch(left, right) {
  const normalizedLeft = normalizeCompanyScopeLabel(left);
  const normalizedRight = normalizeCompanyScopeLabel(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  if (normalizedLeft === normalizedRight) {
    return true;
  }
  const leftTokens = new Set(normalizedLeft.split(/\s+/).filter((token) => token.length >= 3));
  const rightTokens = new Set(normalizedRight.split(/\s+/).filter((token) => token.length >= 3));
  const overlap = [...leftTokens].filter((token) => rightTokens.has(token));
  return overlap.length > 0 && (
    normalizedLeft.includes(normalizedRight)
    || normalizedRight.includes(normalizedLeft)
    || overlap.length >= Math.min(2, leftTokens.size, rightTokens.size)
  );
}

function buildAllowedCompanyScopeLabels({
  accountName,
  aliasEntry = {},
  companyResolution = {},
  activeAccount = {},
} = {}) {
  return [
    accountName,
    activeAccount?.salesNav?.selectedCompanyLabel,
    activeAccount?.salesNav?.selectedCompanyName,
    activeAccount?.salesNav?.companyName,
    ...(activeAccount?.salesNav?.companyTargets || []).map((target) => target.linkedinName),
    ...(companyResolution.targets || []).map((target) => target.linkedinName),
    ...(aliasEntry.accountSearchAliases || []),
    ...(aliasEntry.companyFilterAliases || []),
    ...(aliasEntry.parentAliases || []),
    ...(aliasEntry.subsidiaryAliases || []),
    ...(aliasEntry.targets || []).map((target) => target.linkedinName || target.name || target.companyName),
  ]
    .map((label) => String(label || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((label, index, all) => all.findIndex((entry) => normalizeCompanyScopeLabel(entry) === normalizeCompanyScopeLabel(label)) === index);
}

function assessCompanyScopeIntegrity({
  accountName,
  aliasEntry = {},
  companyResolution = {},
  activeAccount = {},
  candidates = [],
} = {}) {
  const allowedLabels = buildAllowedCompanyScopeLabels({
    accountName,
    aliasEntry,
    companyResolution,
    activeAccount,
  });
  const related = [];
  const unrelated = [];
  for (const candidate of candidates || []) {
    const company = String(candidate.company || candidate.accountName || '').replace(/\s+/g, ' ').trim();
    if (!company) {
      related.push(candidate);
      continue;
    }
    const allowed = allowedLabels.some((label) => companyScopeLabelsMatch(company, label));
    (allowed ? related : unrelated).push(candidate);
  }
  const unrelatedCompanies = [...new Set(unrelated.map((candidate) => candidate.company).filter(Boolean))].slice(0, 10);
  const selectedTargets = allowedLabels.slice(0, 5);
  const contaminationDetected = unrelated.length > 0 && related.length > 0;
  const allCandidatesUnrelated = unrelated.length > 0 && related.length === 0;
  return {
    contaminationDetected,
    allCandidatesUnrelated,
    allowedLabels,
    selectedTargets,
    unrelatedCandidateCount: unrelated.length,
    relatedCandidateCount: related.length,
    unrelatedCompanies,
    keptCandidates: allCandidatesUnrelated ? [] : related,
    warning: contaminationDetected || allCandidatesUnrelated ? 'cross_company_contamination_detected' : null,
  };
}

function summarizeCompanyResolutionForCoverage({
  companyResolution,
  companyResolutionArtifact,
  needsCompanyResolution,
  activeAccount,
  accountName,
  finalResult,
  rawResults,
  companyScopeAssessment = null,
}) {
  const selectedTargets = companyResolution.targets.map((target) => target.linkedinName);
  const liveScoped = hasSuccessfulLiveSweepEvidence(rawResults);
  const resolverWasUncertain = (
    companyResolution.status === 'all_resolution_failed'
    || companyResolution.status === 'resolved_low_confidence'
    || companyResolution.status === 'needs_manual_company_review'
    || selectedTargets.length === 0
  );

  if (liveScoped && resolverWasUncertain && Number(finalResult?.candidateCount || 0) > 0) {
    if (companyScopeAssessment?.warning) {
      return {
        status: 'needs_manual_company_review',
        confidence: 0.6,
        recommendedAction: 'review_company_scope_before_sweeps',
        selectedTargets: companyScopeAssessment.selectedTargets || inferLiveScopedTargets(activeAccount, accountName, finalResult.candidates || []),
        artifactPath: companyResolutionArtifact.artifactPath,
        reportPath: companyResolutionArtifact.reportPath,
        evidence: ['live_people_sweep_returned_candidates', companyScopeAssessment.warning],
      };
    }
    const liveTargets = inferLiveScopedTargets(activeAccount, accountName, finalResult.candidates || []);
    return {
      status: 'resolved_by_live_scope',
      confidence: liveTargets.length === 1 ? 0.9 : 0.75,
      recommendedAction: 'run_people_sweeps',
      selectedTargets: liveTargets,
      artifactPath: companyResolutionArtifact.artifactPath,
      reportPath: companyResolutionArtifact.reportPath,
      evidence: ['live_people_sweep_returned_candidates'],
    };
  }

  return {
    status: companyResolution.status,
    confidence: companyResolution.confidence,
    recommendedAction: needsCompanyResolution
      ? 'resolve_company_targets_then_retry'
      : companyResolution.recommendedAction,
    selectedTargets,
    artifactPath: companyResolutionArtifact.artifactPath,
    reportPath: companyResolutionArtifact.reportPath,
  };
}

function classifyCoverageBucket(candidate, config) {
  const roleFamily = candidate.roleFamily || 'unknown';
  const rules = config?.bucketRules || {};
  const directFamilies = new Set(rules.directObservabilityRoleFamilies || []);
  const adjacentFamilies = new Set(rules.adjacentRoleFamilies || []);

  if (directFamilies.has(roleFamily)) {
    return 'direct_observability';
  }

  if (adjacentFamilies.has(roleFamily)) {
    return 'technical_adjacent';
  }

  if ((candidate.score || 0) > 0 && roleFamily !== 'unknown') {
    return 'broad_it_stakeholder';
  }

  return 'likely_noise';
}

function classifyReviewedCoverageBucket(candidate, config) {
  const roleFamily = candidate.roleFamily || 'unknown';
  const signalCount = (
    (candidate.scoreBreakdown?.observabilitySignals?.length || 0)
    + (candidate.scoreBreakdown?.championSignals?.length || 0)
    + (candidate.scoreBreakdown?.profileReviewSignals?.length || 0)
  );

  if (classifyCoverageBucket(candidate, config) === 'direct_observability') {
    return 'direct_observability';
  }

  if (signalCount >= 3 && (candidate.score || 0) >= 35) {
    return 'direct_observability';
  }

  if (
    classifyCoverageBucket(candidate, config) === 'technical_adjacent'
    || signalCount >= 1
    || (candidate.score || 0) >= 30
  ) {
    return 'technical_adjacent';
  }

  return 'likely_noise';
}

function selectDeepReviewCandidates(coverageResult, limit = 8) {
  const titleHints = /(data|technology|integration|engineer|software|system|platform|cloud|infrastructure|architecture|project|operations)/i;
  const bucketRank = {
    technical_adjacent: 0,
    broad_it_stakeholder: 1,
    direct_observability: 2,
    likely_noise: 3,
  };

  return (coverageResult?.candidates || [])
    .filter((candidate) => {
      if (candidate.deepReview?.reviewedAt) {
        return false;
      }
      if (getHardExclusionReason(candidate)) {
        return false;
      }
      if (candidate.coverageBucket === 'technical_adjacent') {
        return true;
      }
      if (candidate.coverageBucket === 'broad_it_stakeholder') {
        return Number(candidate.score || 0) >= 15 || titleHints.test(candidate.title || '');
      }
      if (candidate.coverageBucket === 'direct_observability') {
        return Number(candidate.score || 0) < 70;
      }
      return candidate.coverageBucket === 'likely_noise'
        && Number(candidate.score || 0) > 0
        && titleHints.test(`${candidate.title || ''} ${candidate.headline || ''}`);
    })
    .sort((left, right) => {
      const bucketDiff = (bucketRank[left.coverageBucket] ?? 9) - (bucketRank[right.coverageBucket] ?? 9);
      if (bucketDiff !== 0) {
        return bucketDiff;
      }
      return (right.score || 0) - (left.score || 0);
    })
    .slice(0, Math.max(1, limit));
}

function getVoyagerIdentityMissingReason(candidate = {}) {
  const identity = resolveVoyagerIdentity(candidate);
  return identity.status === 'resolved' ? null : identity.status;
}

function hasStrongVoyagerPromotionSignal(evidence = {}) {
  const signals = evidence.signals || {};
  return [
    ...(signals.observabilitySignals || []),
    ...(signals.competitiveSignals || []),
    ...(signals.legacySignals || []),
    ...(signals.platformSignals || []),
  ].filter(Boolean).length > 0;
}

function applyDeepReviewResult(candidate, rescored, priorityModel, reviewedBucket, evidence) {
  const previousBucket = candidate.coverageBucket;
  const previousScore = candidate.score;
  const method = evidence?.method || evidence?.source || 'ui';
  const signals = evidence?.signals || null;
  const pitchStrategy = evidence?.pitchStrategy || signals?.pitchStrategy || 'unknown';

  return {
    ...candidate,
    score: rescored.score,
    roleFamily: rescored.roleFamily,
    seniority: rescored.seniority,
    scoreBreakdown: rescored.breakdown,
    priorityModel,
    coverageBucket: reviewedBucket,
    deepReview: {
      reviewedAt: new Date().toISOString(),
      method,
      status: evidence?.status || 'reviewed',
      previousBucket,
      reviewedBucket,
      previousScore,
      reviewedScore: rescored.score,
      scoreBefore: previousScore,
      scoreAfter: rescored.score,
      bucketBefore: previousBucket,
      bucketAfter: reviewedBucket,
      changed: previousBucket !== reviewedBucket || previousScore !== rescored.score,
      snippet: String(evidence?.snippet || '').slice(0, 500),
      ...(signals ? { signals } : {}),
      pitchStrategy,
      ...(evidence?.blockedReason ? { blockedReason: evidence.blockedReason } : {}),
    },
  };
}

function classifyPersonaTier(candidate) {
  const title = normalizeSelectionText(candidate.title || '');
  const roleFamily = String(candidate.roleFamily || '').toLowerCase();
  const seniority = String(candidate.seniority || '').toLowerCase();

  if (
    roleFamily === 'executive_engineering'
    || /\b(cio|cto|cdo|chief information officer|chief technology officer|chief data officer|chief data\s*&\s*analytics officer|chief analytics officer|chief ai officer|chief artificial intelligence officer)\b/.test(title)
    || (
      ['director', 'vp', 'head'].includes(seniority)
      && /\b(data\s*&\s*ai|data and ai|data\s*&\s*analytics|data and analytics|artificial intelligence|head of ai|director of ai|vp ai|directeur data|directrice data|director data|director de datos|direttore dati|direttrice dati|daten\s*&\s*ki|datos e ia|dati e ai|digital transformation|transformation digitale|digitale transformation|transformacion digital|transformación digital|trasformazione digitale|marketplace director|head of tech)\b/.test(title)
    )
  ) {
    return 'buyer';
  }

  if (
    ['platform_engineering', 'infrastructure', 'site_reliability', 'devops'].includes(roleFamily)
    && ['manager', 'head', 'director', 'principal', 'lead', 'senior'].includes(seniority)
  ) {
    return ['lead', 'senior', 'individual_contributor'].includes(seniority) ? 'user' : 'operator';
  }

  if (/\b(responsable domaine|direction informatique|gouvernance si|it-governance|gobernanza ti|governo it|architecture des environnements|production informatique|produktion it|produccion ti|producción ti|produzione it)\b/.test(title)) {
    return 'operator';
  }

  if (/\b(tech lead|technical lead|devops|devsecops|sre|engineer|ingenieur|ingénieur|ingeniero|ingegnere|consultant cloud|consultant observability|consultant observabilité)\b/.test(title)) {
    return 'user';
  }

  return 'unknown';
}

function summarizePersonaCoverage(candidates = []) {
  const summary = {
    buyer: { count: 0 },
    operator: { count: 0 },
    user: { count: 0 },
    unknown: { count: 0 },
    warnings: [],
    coverageGaps: [],
    status: 'coverage_sufficient',
    nextAction: 'coverage_sufficient',
  };

  for (const candidate of candidates) {
    const tier = candidate.personaTier || classifyPersonaTier(candidate);
    const bucket = summary[tier] || summary.unknown;
    bucket.count += 1;
  }

  if (summary.buyer.count === 0) {
    summary.coverageGaps.push('buyer_coverage_gap');
  }
  if (summary.operator.count === 0) {
    summary.coverageGaps.push('operator_coverage_gap');
  }
  if (summary.user.count === 0) {
    summary.coverageGaps.push('user_coverage_gap');
  }

  summary.warnings = [...summary.coverageGaps];
  if (summary.coverageGaps.length > 0) {
    summary.status = 'coverage_incomplete';
    if (summary.coverageGaps.includes('buyer_coverage_gap')) {
      summary.nextAction = 'run_buyer_follow_up_sweeps';
    } else if (summary.coverageGaps.includes('operator_coverage_gap')) {
      summary.nextAction = 'run_operator_follow_up_sweeps';
    } else {
      summary.nextAction = 'run_user_follow_up_sweeps';
    }
  }

  return summary;
}

function buildPersonaCoverageFollowUpPlan(personaCoverage = {}, options = {}) {
  const researchMode = normalizeResearchMode(options.researchMode || 'persona-led');
  const gaps = Array.isArray(personaCoverage.coverageGaps)
    ? personaCoverage.coverageGaps
    : Array.isArray(personaCoverage.warnings)
      ? personaCoverage.warnings
      : [];
  const missingLayers = gaps
    .map((gap) => String(gap).replace(/_coverage_gap$/, ''))
    .filter((layer) => ['buyer', 'operator', 'user'].includes(layer));

  if (missingLayers.length === 0) {
    return {
      status: 'coverage_sufficient',
      missingLayers: [],
      nextAction: 'coverage_sufficient',
      followUpSweeps: [],
    };
  }

  const followUpKeywords = {
    buyer: [
      'CTO',
      'CIO',
      'CDO',
      'Chief Data Officer',
      'VP Engineering',
      'VP of Engineering',
      'Director of Engineering',
      'Director Engineering',
      'Engineering Director',
      'Head of Engineering',
      'VP Technology',
      'VP of Technology',
      'Director Data',
      'Directeur Data',
      'Digital Transformation',
      'Cloud Transformation',
      'VP Platform',
      'Head of Cloud',
    ],
    operator: [
      'Head of Technology',
      'Head of Architecture',
      'Enterprise Architecture',
      'Responsable Domaine',
      'Direction Informatique',
      'Gouvernance SI',
      'IT Production',
      'Production Informatique',
      'Cloud Governance',
      'Platform Operations',
    ],
    user: [
      'SRE',
      'DevOps',
      'Observability',
      'Observabilité',
      'Monitoring',
      'Cloud Engineer',
      'Technical Lead',
      'Tech Lead',
      'Kubernetes',
      'Prometheus',
    ],
  };

  return {
    status: 'coverage_incomplete',
    missingLayers,
    nextAction: researchMode === 'exhaustive'
      ? 'manual_review_persona_gap_after_exhaustive_run'
      : `run_${missingLayers[0]}_follow_up_sweeps`,
    followUpSweeps: missingLayers.map((layer) => ({
      id: `persona-follow-up-${layer}`,
      personaLayer: layer,
      keywords: followUpKeywords[layer],
      drySafe: true,
    })),
  };
}

function consolidateCoverageCandidates(rawResults, { icpConfig, priorityModel, coverageConfig, accountName }) {
  const byKey = new Map();

  for (const result of rawResults || []) {
    for (const candidate of result.candidates || []) {
      const key = normalizeCandidateKey(candidate);
      if (!byKey.has(key)) {
        const score = scoreCandidate(candidate, icpConfig);
        const priority = priorityModel ? scoreCandidateWithPriorityModel(candidate, priorityModel) : null;
        byKey.set(key, {
          fullName: candidate.fullName,
          title: candidate.title,
          company: candidate.company,
          location: candidate.location,
          profileUrl: candidate.profileUrl || null,
          salesNavigatorUrl: candidate.salesNavigatorUrl || null,
          headline: candidate.headline || null,
          summary: candidate.summary || null,
          outOfNetwork: Boolean(candidate.outOfNetwork),
          networkDistance: candidate.networkDistance || null,
          sweeps: [result.templateId],
          roleFamily: score.roleFamily,
          seniority: score.seniority,
          score: score.score,
          scoreBreakdown: score.breakdown,
          priorityModel: priority,
          personaTier: classifyPersonaTier({
            ...candidate,
            roleFamily: score.roleFamily,
            seniority: score.seniority,
          }),
          coverageBucket: classifyCoverageBucket({
            roleFamily: score.roleFamily,
            score: score.score,
          }, coverageConfig),
        });
      } else {
        const existing = byKey.get(key);
        if (!existing.sweeps.includes(result.templateId)) {
          existing.sweeps.push(result.templateId);
        }
      }
    }
  }

  const candidates = [...byKey.values()].sort((left, right) => {
    const rightPriority = right.priorityModel?.priorityScore || 0;
    const leftPriority = left.priorityModel?.priorityScore || 0;
    if (rightPriority !== leftPriority) {
      return rightPriority - leftPriority;
    }
    return (right.score || 0) - (left.score || 0);
  });

  const coverage = buildCoverageSummary({
    runAccounts: [{
      runId: 'account-coverage',
      accountKey: `coverage:${accountName}`,
      name: accountName,
      listName: null,
    }],
    candidates: candidates.map((candidate, index) => ({
      candidateId: candidate.salesNavigatorUrl || candidate.profileUrl || `coverage-${index}`,
      accountKey: `coverage:${accountName}`,
      fullName: candidate.fullName,
      title: candidate.title,
      score: candidate.score,
      roleFamily: candidate.roleFamily,
      scoreBreakdown: {
        priorityModel: candidate.priorityModel || null,
      },
    })),
    buyerGroupRoles: priorityModel?.buyerGroupRoles || {},
  })[0] || null;

  const personaCoverage = summarizePersonaCoverage(candidates);
  const personaFollowUpPlan = buildPersonaCoverageFollowUpPlan(personaCoverage);

  return {
    accountName,
    generatedAt: new Date().toISOString(),
    candidateCount: candidates.length,
    candidates,
    coverage,
    personaCoverage,
    personaFollowUpPlan,
  };
}

function buildDeepReviewEvidenceForScoring(candidate, evidence = {}) {
  const signals = evidence.signals || {};
  return [
    evidence.snippet,
    signals.headline,
    ...(signals.about || []),
    ...(signals.currentTitles || []),
    ...(signals.recentExperienceTitles || []),
    ...(signals.skills || []),
    ...(signals.observabilitySignals || []),
    ...(signals.stackSignals || []),
    ...(signals.languageSignals || []),
  ].filter(Boolean).join(' ');
}

async function runCoverageDeepProfilePass({
  driver,
  coverageResult,
  coverageConfig,
  icpConfig,
  priorityModel,
  reviewLimit = 20,
  profileReadMethod = 'ui',
  force = false,
  strictVoyagerPromotion = true,
  reportVoyagerIdentityGaps = true,
  logger = null,
  now = Date.now,
} = {}) {
  const normalizedMethod = String(profileReadMethod || 'ui').toLowerCase() === 'voyager' ? 'voyager' : 'ui';
  const limit = Math.max(1, Number(reviewLimit) || 20);
  const reviewPool = force
    ? (coverageResult?.candidates || []).filter((candidate) => !getHardExclusionReason(candidate))
    : selectDeepReviewCandidates(coverageResult, (coverageResult?.candidates || []).length || limit);
  const identityMissingCandidates = normalizedMethod === 'voyager' && reportVoyagerIdentityGaps
    ? reviewPool
      .map((candidate) => ({
        candidate,
        reason: getVoyagerIdentityMissingReason(candidate),
      }))
      .filter((entry) => entry.reason)
    : [];
  const selected = (normalizedMethod === 'voyager'
    ? reviewPool.filter((candidate) => !getVoyagerIdentityMissingReason(candidate))
    : reviewPool)
    .slice(0, limit);
  const startedAt = new Date(now()).toISOString();
  const updates = new Map();
  const summary = {
    enabled: true,
    requested: true,
    method: normalizedMethod,
    reviewLimit: limit,
    selectedCount: selected.length,
    reviewedCount: 0,
    promotedCount: 0,
    promotionBlockedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    identityMissingCount: identityMissingCandidates.length,
    identityMissingCandidates: identityMissingCandidates
      .slice(0, 20)
      .map(({ candidate, reason }) => ({
        fullName: candidate.fullName || candidate.name || '',
        title: candidate.title || '',
        reason,
      })),
    selectionPolicy: 'account_coverage_deep_profile_v1',
    strictPromotion: normalizedMethod === 'voyager' ? Boolean(strictVoyagerPromotion) : false,
    startedAt,
    finishedAt: null,
  };

  for (const { candidate, reason } of identityMissingCandidates) {
    updates.set(normalizeCandidateKey(candidate), {
      ...candidate,
      deepReview: {
        reviewedAt: new Date(now()).toISOString(),
        method: 'voyager',
        status: 'skipped',
        skippedReason: reason,
        budgetConsumed: false,
      },
    });
  }

  for (const candidate of selected) {
    const key = normalizeCandidateKey(candidate);
    try {
      let evidence;
      if (normalizedMethod === 'voyager') {
        if (typeof driver.readVoyagerProfile !== 'function') {
          throw new Error('Driver does not support Voyager profile reads');
        }
        const voyagerArtifact = await driver.readVoyagerProfile(candidate);
        if (!voyagerArtifact.voyagerReadable) {
          updates.set(key, {
            ...candidate,
            deepReview: {
              reviewedAt: new Date(now()).toISOString(),
              method: 'voyager',
              status: 'skipped',
              skippedReason: voyagerArtifact.error?.code || 'voyager_unreadable',
              message: voyagerArtifact.error?.message || 'Voyager profile was not readable.',
            },
          });
          summary.skippedCount += 1;
          continue;
        }
        evidence = {
          method: 'voyager',
          source: 'voyager',
          status: 'reviewed',
          snippet: voyagerArtifact.signals?.snippet || '',
          signals: voyagerArtifact.signals,
          pitchStrategy: voyagerArtifact.signals?.pitchStrategy || 'unknown',
          profileIdentity: voyagerArtifact.profileIdentity,
        };
      } else {
        await driver.openCandidate(candidate, { runId: 'account-coverage-deep-profile', accountKey: 'coverage' });
        evidence = await driver.captureEvidence({
          ...candidate,
          fromListPage: false,
        }, {
          runId: 'account-coverage-deep-profile',
          accountKey: 'coverage',
          deepProfileReview: true,
        });
        evidence.method = 'ui';
        evidence.status = 'reviewed';
      }

      const detailText = buildDeepReviewEvidenceForScoring(candidate, evidence);
      const rescored = scoreCandidate({
        ...candidate,
        headline: evidence.signals?.headline || candidate.headline,
        about: detailText,
        summary: detailText,
        evidence,
      }, icpConfig);
      const reviewedPriority = priorityModel
        ? scoreCandidateWithPriorityModel({
          ...candidate,
          about: detailText,
          summary: detailText,
        }, priorityModel)
        : candidate.priorityModel || null;
      const reviewedBucket = classifyReviewedCoverageBucket({
        roleFamily: rescored.roleFamily,
        score: rescored.score,
        scoreBreakdown: rescored.breakdown,
      }, coverageConfig);
      const shouldBlockUnknownVoyagerPromotion = normalizedMethod === 'voyager'
        && strictVoyagerPromotion
        && candidate.coverageBucket !== 'direct_observability'
        && reviewedBucket === 'direct_observability'
        && evidence.pitchStrategy === 'unknown'
        && !hasStrongVoyagerPromotionSignal(evidence);
      const finalReviewedBucket = shouldBlockUnknownVoyagerPromotion
        ? 'technical_adjacent'
        : reviewedBucket;
      if (shouldBlockUnknownVoyagerPromotion) {
        evidence.status = 'manual_review';
        evidence.blockedReason = 'voyager_reviewed_but_pitch_unknown';
      }
      const reviewed = {
        ...applyDeepReviewResult(candidate, rescored, reviewedPriority, finalReviewedBucket, evidence),
        ...(shouldBlockUnknownVoyagerPromotion
          ? {
            manualReviewSuggested: true,
            manualReviewReason: 'voyager_reviewed_but_pitch_unknown',
          }
          : {}),
      };
      updates.set(key, reviewed);
      summary.reviewedCount += 1;
      if (shouldBlockUnknownVoyagerPromotion) {
        summary.promotionBlockedCount += 1;
      }
      if (candidate.coverageBucket !== 'direct_observability' && reviewed.coverageBucket === 'direct_observability') {
        summary.promotedCount += 1;
      }
      if (logger && typeof logger.info === 'function') {
        logger.info(`Deep profile reviewed: ${candidate.fullName || 'Unknown'} | method=${normalizedMethod} | ${candidate.score || 0}->${reviewed.score || 0}`);
      }
    } catch (error) {
      updates.set(key, {
        ...candidate,
        deepReview: {
          reviewedAt: new Date(now()).toISOString(),
          method: normalizedMethod,
          status: 'failed',
          failed: true,
          message: String(error.message || error).slice(0, 240),
        },
      });
      summary.failedCount += 1;
    }
  }

  const nextCandidates = (coverageResult?.candidates || []).map((candidate) =>
    updates.get(normalizeCandidateKey(candidate)) || candidate);
  summary.finishedAt = new Date(now()).toISOString();

  return {
    ...coverageResult,
    candidates: nextCandidates.sort((left, right) => Number(right.score || 0) - Number(left.score || 0)),
    candidateCount: nextCandidates.length,
    personaCoverage: summarizePersonaCoverage(nextCandidates),
    personaFollowUpPlan: buildPersonaCoverageFollowUpPlan(summarizePersonaCoverage(nextCandidates), {
      researchMode: coverageResult?.researchMode || 'persona-led',
    }),
    deepProfilePass: summary,
  };
}

function summarizeCoverageBuckets(candidates) {
  const counts = {
    direct_observability: 0,
    technical_adjacent: 0,
    broad_it_stakeholder: 0,
    likely_noise: 0,
  };

  for (const candidate of candidates || []) {
    const bucket = candidate.coverageBucket || 'likely_noise';
    counts[bucket] = (counts[bucket] || 0) + 1;
  }

  return counts;
}

function summarizeCoverageSweepErrors(coverageRun) {
  const sweepErrors = coverageRun?.sweepErrors || coverageRun?.result?.sweepErrors || [];
  if (!Array.isArray(sweepErrors) || sweepErrors.length === 0) {
    return null;
  }

  const templateCount = Number(coverageRun?.templates?.length || 0);
  const prefix = templateCount > 0 && sweepErrors.length >= templateCount
    ? 'all_sweeps_failed'
    : 'sweeps_failed';
  const firstMessage = String(sweepErrors[0]?.message || 'unknown sweep failure').replace(/\s+/g, ' ');
  const suffix = sweepErrors.length > 1
    ? `; ${sweepErrors.length} sweep failures total`
    : '';
  return `${prefix}: ${firstMessage}${suffix}`.slice(0, 240);
}

async function runAccountCoverageWorkflow({
  driver,
  accountName,
  peopleSearchUrl = 'https://www.linkedin.com/sales/search/people?viewAllFilters=true',
  accountListName = null,
  coverageConfig,
  icpConfig,
  priorityModel,
  maxCandidates = null,
  researchMode = 'persona-led',
  speedProfile = 'balanced',
  adaptiveSweepPruning = false,
  reuseSweepCache = false,
  sweepCacheDir = DEFAULT_SWEEP_CACHE_DIR,
  runId = 'account-coverage',
  accountSource = 'manual',
  interSweepDelayMs = 0,
  apiReadPrefetch = false,
  apiReadPrefetchLeadCount = 100,
  deepProfilePass = false,
  profileReadMethod = 'ui',
  deepProfileLimit = 20,
  forceDeepProfilePass = false,
  strictVoyagerPromotion = true,
  reportVoyagerIdentityGaps = true,
  logger = null,
  now = Date.now,
}) {
  const normalizedSpeedProfile = normalizeSpeedProfile(speedProfile);
  const scrollStepsByProfile = { exhaustive: 40, balanced: 20, fast: 10 };
  const profileScrollSteps = scrollStepsByProfile[normalizedSpeedProfile] ?? 10;
  const timings = createRunTimings(now);
  const adaptivePruningRequested = Boolean(adaptiveSweepPruning);
  const sweepTemplateOptions = resolveSweepTemplateOptions({
    researchMode,
    speedProfile,
    adaptiveSweepPruning,
  });
  const { researchMode: normalizedResearchMode, speedProfile: effectiveSpeedProfile } = sweepTemplateOptions;
  const adaptivePruningActive = adaptivePruningRequested && effectiveSpeedProfile !== 'exhaustive';
  const pruningThresholds = adaptivePruningActive ? getAdaptivePruningThresholds(effectiveSpeedProfile) : null;
  const templates = buildSweepTemplates(coverageConfig, maxCandidates, sweepTemplateOptions);
  const aliasConfig = loadAccountAliasConfig();
  const aliasEntry = findAccountAliasEntry(aliasConfig, accountName);
  const priorCoverage = loadExistingAccountCoverageArtifact(accountName);
  const companyResolution = await timePhase(timings, 'company_resolution', async () => buildCompanyResolution({
    accountName,
    source: accountSource,
    aliasConfig,
    priorCoverage,
  }), { now });
  if (logger && typeof logger.info === 'function') {
    logger.info(`Company scope checked for ${accountName}: ${companyResolution.status}`);
  }
  const companyResolutionArtifact = await timePhase(timings, 'company_resolution_artifact', async () =>
    writeCompanyResolutionArtifact(companyResolution), { now });
  const account = {
    accountId: `coverage-${String(accountName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: accountName,
    salesNav: {
      peopleSearchUrl,
      ...(aliasEntry.accountSearchAliases ? { accountSearchAliases: aliasEntry.accountSearchAliases } : {}),
      ...(aliasEntry.companyFilterAliases ? { companyFilterAliases: aliasEntry.companyFilterAliases } : {}),
      ...(aliasEntry.linkedinCompanyUrls ? { linkedinCompanyUrls: aliasEntry.linkedinCompanyUrls } : {}),
      ...(companyResolution.targets?.length ? { companyTargets: companyResolution.targets } : {}),
      companyResolution,
      ...(accountListName ? { accountListName } : {}),
    },
  };
  let activeAccount = account;

  const rawResults = [];
  const sweepErrors = [];
  const seenCandidateKeys = new Set();
  const rateLimitEvents = [];
  let cacheHits = 0;
  let cacheMisses = 0;
  await timePhase(timings, 'account_scoping', async () => {
    await driver.openAccountSearch();
    const resolvedAccounts = await driver.enumerateAccounts([account], { runId, accountKey: account.accountId }).catch(() => [account]);
    activeAccount = resolvedAccounts?.[0] || account;
  }, { now });

  let apiReadPrefetchResult = null;
  let uiSweepMode = 'full';
  let skipUiSweeps = false;
  if (apiReadPrefetch && typeof driver.runSalesNavApiReadPrefetch === 'function') {
    try {
      apiReadPrefetchResult = await timePhase(timings, 'api_read_prefetch', async () =>
        driver.runSalesNavApiReadPrefetch({
          accountName,
          leadCount: apiReadPrefetchLeadCount,
          companyTargets: companyResolution.targets || activeAccount?.salesNav?.companyTargets || [],
        }), { now });
    } catch (error) {
      apiReadPrefetchResult = {
        status: 'failed',
        source: 'api_read_prefetch',
        companyResolution: {
          status: 'api_prefetch_failed',
          warning: 'api_prefetch_failed',
        },
        companyCandidates: [],
        leadCandidates: [],
        targetResponses: [],
        errors: [{
          code: error.code || 'unexpected_shape',
          message: String(error.message || error).slice(0, 500),
          status: error.status || null,
          path: error.path || null,
        }],
      };
    }

    if (logger && typeof logger.info === 'function') {
      logger.info(`API read prefetch: ${apiReadPrefetchResult.companyResolution?.status || apiReadPrefetchResult.status} | leads=${apiReadPrefetchResult.leadCandidates?.length || 0}`);
    }

    if (apiReadPrefetchResult.companyResolution?.status === 'needs_company_scope_review') {
      skipUiSweeps = true;
    }

    if ((apiReadPrefetchResult.leadCandidates || []).length > 0) {
      const apiCandidates = apiReadPrefetchResult.leadCandidates;
      rawResults.push({
        templateId: 'api-broad-pool',
        keywords: [],
        candidates: apiCandidates,
        cacheHit: false,
        source: 'api_read_prefetch',
      });
      let uniqueNew = 0;
      for (const candidate of apiCandidates) {
        const key = normalizeCandidateKey(candidate);
        if (!seenCandidateKeys.has(key)) {
          uniqueNew += 1;
        }
        seenCandidateKeys.add(key);
      }
      const preliminary = await timePhase(timings, 'api_prefetch_scoring', async () => consolidateCoverageCandidates(rawResults, {
        icpConfig,
        priorityModel,
        coverageConfig,
        accountName,
      }), { now });
      const preliminaryPersona = summarizePersonaCoverage(preliminary.candidates || []);
      if (preliminaryPersona.status === 'coverage_sufficient') {
        if (effectiveSpeedProfile === 'fast') {
          uiSweepMode = 'skipped';
          skipUiSweeps = true;
          if (logger && typeof logger.info === 'function') {
            logger.info(`API read prefetch covered buyer/operator/user personas; skipping UI sweeps in fast mode`);
          }
        } else {
          uiSweepMode = 'rescue_only';
          if (logger && typeof logger.info === 'function') {
            logger.info(`API read prefetch covered buyer/operator/user personas; running bounded UI rescue pass`);
          }
        }
      }
      timings.events.push({
        phase: 'api_read_prefetch:api-broad-pool',
        templateId: 'api-broad-pool',
        durationMs: 0,
        cacheHit: false,
        candidateCount: apiCandidates.length,
        uniqueNew,
      });
    }
  }

  let stopSweeps = false;
  const adaptivePruningTelemetry = {
    enabled: adaptivePruningActive,
    triggered: false,
    reason: null,
    skippedTemplates: [],
    executedTemplates: [],
    uniqueCandidatesAddedByTemplate: {},
    thresholds: pruningThresholds
      ? { ...pruningThresholds, profile: effectiveSpeedProfile }
      : null,
    profile: effectiveSpeedProfile,
  };
  const executedUniqueAdds = [];
  const templatesToRun = uiSweepMode === 'rescue_only'
    ? buildApiRescueSweepTemplates(templates)
    : templates;
  if (uiSweepMode === 'rescue_only') {
    const rescueIds = new Set(templatesToRun.map((template) => template.id));
    adaptivePruningTelemetry.skippedTemplates.push(
      ...templates
        .filter((template) => !rescueIds.has(template.id))
        .map((template) => template.id),
    );
    adaptivePruningTelemetry.triggered = adaptivePruningTelemetry.skippedTemplates.length > 0;
    adaptivePruningTelemetry.reason = adaptivePruningTelemetry.triggered
      ? 'api_prefetch_hybrid_recall_rescue_only'
      : null;
  }

  function registerSweepAdds(uniqueNew, templateId) {
    adaptivePruningTelemetry.executedTemplates.push(templateId);
    adaptivePruningTelemetry.uniqueCandidatesAddedByTemplate[templateId] = uniqueNew;
    executedUniqueAdds.push(uniqueNew);
  }

  for (let templateIndex = 0; templateIndex < templatesToRun.length; templateIndex += 1) {
    if (skipUiSweeps) {
      adaptivePruningTelemetry.skippedTemplates.push(...templatesToRun.slice(templateIndex).map((template) => template.id));
      adaptivePruningTelemetry.triggered = true;
      adaptivePruningTelemetry.reason = apiReadPrefetchResult?.companyResolution?.status === 'needs_company_scope_review'
        ? 'api_company_scope_review_required'
        : 'api_prefetch_coverage_sufficient';
      break;
    }
    if (stopSweeps) {
      break;
    }
    const template = templatesToRun[templateIndex];
    if (logger && typeof logger.info === 'function') {
      logger.info(`Sweep ${templateIndex + 1}/${templatesToRun.length} started: ${template.id}${template.rescuePass ? ' (rescue)' : ''}`);
    }

    if (
      shouldAdaptiveSkipRestSweep({
        template,
        thresholds: pruningThresholds,
        adaptiveEnabled: adaptivePruningActive,
        executedUniqueAdds,
        templates: templatesToRun,
        templateIndex,
      })
    ) {
      adaptivePruningTelemetry.skippedTemplates.push(template.id);
      adaptivePruningTelemetry.triggered = true;
      adaptivePruningTelemetry.reason = adaptivePruningTelemetry.reason || 'low_yield_recent_window';
      continue;
    }

    const cacheKey = buildSweepCacheKey({
      account: activeAccount,
      accountName,
      template,
      coverageConfigVersion: coverageConfig?.version || coverageConfig?.name || 'default',
    });
    const cacheHit = reuseSweepCache ? readSweepCache(sweepCacheDir, cacheKey) : null;
    if (cacheHit && Array.isArray(cacheHit.candidates)) {
      cacheHits += 1;
      await timePhase(timings, `sweep:${template.id}`, async () => {
        let uniqueNew = 0;
        rawResults.push({
          templateId: template.id,
          keywords: template.keywords || [],
          candidates: cacheHit.candidates,
          cacheHit: true,
        });
        for (const candidate of cacheHit.candidates) {
          const key = normalizeCandidateKey(candidate);
          if (!seenCandidateKeys.has(key)) {
            uniqueNew += 1;
          }
          seenCandidateKeys.add(key);
        }
        registerSweepAdds(uniqueNew, template.id);
        if (logger && typeof logger.info === 'function') {
          logger.info(`Sweep ${templateIndex + 1}/${templatesToRun.length} finished: ${template.id} | candidates=${cacheHit.candidates.length} | new=${uniqueNew} | cache=hit`);
        }
      }, {
        now,
        meta: {
          templateId: template.id,
          cacheHit: true,
          candidateCount: cacheHit.candidates.length,
        },
      });
      continue;
    }
    if (reuseSweepCache) {
      cacheMisses += 1;
    }

    try {
      await timePhase(timings, `sweep:${template.id}`, async () => {
        await driver.openPeopleSearch(activeAccount, { runId, accountKey: activeAccount.accountId || account.accountId });
        await driver.applySearchTemplate(template, { runId, accountKey: account.accountId });
        const candidates = await driver.scrollAndCollectCandidates(activeAccount, template, {
          runId,
          accountKey: activeAccount.accountId || account.accountId,
          seenCandidateKeys,
          seenUrls: seenCandidateKeys,
          logger,
          rateLimitEvents,
          duplicateShortCircuitThreshold: coverageConfig.duplicateShortCircuitThreshold ?? 0.8,
          maxScrollSteps: template.maxScrollSteps ?? profileScrollSteps,
        });
        let uniqueNew = 0;
        rawResults.push({
          templateId: template.id,
          keywords: template.keywords || [],
          candidates,
          cacheHit: false,
        });
        for (const candidate of candidates) {
          const key = normalizeCandidateKey(candidate);
          if (!seenCandidateKeys.has(key)) {
            uniqueNew += 1;
          }
          seenCandidateKeys.add(key);
        }
        registerSweepAdds(uniqueNew, template.id);
      if (logger && typeof logger.info === 'function') {
        logger.info(`Sweep ${templateIndex + 1}/${templatesToRun.length} finished: ${template.id} | candidates=${candidates.length} | new=${uniqueNew}`);
      }
        if (reuseSweepCache) {
          writeSweepCache(sweepCacheDir, cacheKey, {
            accountName,
            templateId: template.id,
            keywords: template.keywords || [],
            candidates,
          });
        }
      }, {
        now,
        meta: {
          templateId: template.id,
          cacheHit: false,
        },
      });
    } catch (error) {
      const errorCategory = classifySweepErrorCategory(error);
      sweepErrors.push({
        templateId: template.id,
        message: error.message,
        errorCategory,
      });
      if (errorCategory === 'rate_limited') {
        stopSweeps = true;
      }
      timings.events.push({
        phase: `sweep:${template.id}`,
        templateId: template.id,
        durationMs: 0,
        cacheHit: false,
        candidateCount: 0,
        errorCategory,
      });
      if (logger && typeof logger.warn === 'function') {
        logger.warn(errorCategory === 'rate_limited'
          ? `Sweep ${template.id} rate limited: ${error.message}`
          : `Sweep ${template.id} failed: ${error.message}`);
      }
    }

    if (!stopSweeps && Number(interSweepDelayMs) > 0 && templateIndex < templatesToRun.length - 1) {
      await waitForInterSweepDelay(driver, Number(interSweepDelayMs));
    }
  }

  const result = await timePhase(timings, 'scoring', async () => consolidateCoverageCandidates(rawResults, {
    icpConfig,
    priorityModel,
    coverageConfig,
    accountName,
  }), { now });
  const apiCompanyScopeReviewRequired = apiReadPrefetchResult?.companyResolution?.status === 'needs_company_scope_review';
  const fallbackResult = result.candidateCount === 0 && !apiCompanyScopeReviewRequired
    ? priorCoverage
    : null;
  const sweepFailureSummary = summarizeCoverageSweepErrors({ templates, sweepErrors });
  const needsCompanyResolution = /^all_sweeps_failed/i.test(sweepFailureSummary || '');
  const rateLimited = sweepErrors.some((error) => error.errorCategory === 'rate_limited');
  const finalResult = !rateLimited && fallbackResult && fallbackResult.candidateCount > 0
    ? {
      ...fallbackResult,
      fallback: {
        reason: 'live_coverage_empty',
        reusedAt: new Date().toISOString(),
      },
      ...(sweepErrors.length > 0 ? { sweepErrors } : {}),
    }
    : {
      ...result,
      ...(sweepErrors.length > 0 ? { sweepErrors } : {}),
    };
  if (apiReadPrefetchResult) {
    finalResult.apiReadPrefetch = {
      status: apiReadPrefetchResult.status,
      source: 'api_read_prefetch',
      companyResolution: apiReadPrefetchResult.companyResolution,
      companyCandidateCount: apiReadPrefetchResult.companyCandidates?.length || 0,
      leadCandidateCount: apiReadPrefetchResult.leadCandidates?.length || 0,
      targetResponses: apiReadPrefetchResult.targetResponses || [],
      errors: apiReadPrefetchResult.errors || [],
      uiSweepsSkipped: skipUiSweeps,
      uiSweepMode,
      uiRescuePass: uiSweepMode === 'rescue_only',
    };
    if (apiReadPrefetchResult.companyResolution?.status === 'needs_company_scope_review') {
      finalResult.companyScope = {
        status: 'needs_company_scope_review',
        warning: apiReadPrefetchResult.companyResolution.warning || 'api_company_scope_review_required',
        unrelatedCandidateCount: 0,
        relatedCandidateCount: 0,
        unrelatedCompanies: (apiReadPrefetchResult.companyResolution.selectedTargets || []).map((target) => target.name),
        allowedLabels: [],
      };
      finalResult.resolutionStatus = 'needs_company_scope_review';
      finalResult.coverageError = apiReadPrefetchResult.companyResolution.warning || 'api_company_scope_review_required';
    }
  }
  const companyScopeAssessment = assessCompanyScopeIntegrity({
    accountName,
    aliasEntry,
    companyResolution,
    activeAccount,
    candidates: finalResult.candidates || [],
  });
  if (companyScopeAssessment.warning) {
    finalResult.companyScope = {
      status: 'needs_company_scope_review',
      warning: companyScopeAssessment.warning,
      unrelatedCandidateCount: companyScopeAssessment.unrelatedCandidateCount,
      relatedCandidateCount: companyScopeAssessment.relatedCandidateCount,
      unrelatedCompanies: companyScopeAssessment.unrelatedCompanies,
      allowedLabels: companyScopeAssessment.allowedLabels,
    };
    finalResult.candidates = companyScopeAssessment.keptCandidates;
    finalResult.candidateCount = finalResult.candidates.length;
    finalResult.personaCoverage = summarizePersonaCoverage(finalResult.candidates);
    finalResult.resolutionStatus = 'needs_company_scope_review';
    finalResult.coverageError = `${companyScopeAssessment.warning}: ${companyScopeAssessment.unrelatedCompanies.join(', ')}`;
  }
  if (apiReadPrefetchResult && uiSweepMode === 'rescue_only') {
    finalResult.apiRescuePass = summarizeApiRescuePass(finalResult.candidates || []);
  }
  finalResult.companyResolution = summarizeCompanyResolutionForCoverage({
    companyResolution,
    companyResolutionArtifact,
    needsCompanyResolution,
    activeAccount,
    accountName,
    finalResult,
    rawResults,
    companyScopeAssessment,
  });
  if (needsCompanyResolution) {
    finalResult.resolutionStatus = 'needs_company_resolution';
  }
  if (rateLimited) {
    finalResult.resolutionStatus = 'rate_limited';
    finalResult.coverageError = 'rate_limited: LinkedIn requested a pause during account sweep';
  }
  if (rateLimitEvents.length > 0 || rateLimited) {
    finalResult.rateLimit = {
      hitCount: rateLimitEvents.length || 1,
      totalBackoffMs: rateLimitEvents.reduce((sum, event) => sum + Number(event.backoffMs || 0), 0),
      recovered: !rateLimited,
    };
  }
  let reviewedResult = finalResult;
  if (deepProfilePass && !rateLimited && finalResult.candidateCount > 0) {
    reviewedResult = await timePhase(timings, 'deep_profile_pass', async () =>
      runCoverageDeepProfilePass({
        driver,
        coverageResult: finalResult,
        coverageConfig,
        icpConfig,
        priorityModel,
        reviewLimit: deepProfileLimit,
        profileReadMethod,
        force: forceDeepProfilePass,
        strictVoyagerPromotion,
        reportVoyagerIdentityGaps,
        logger,
        now,
      }), { now });
  } else if (deepProfilePass) {
    finalResult.deepProfilePass = {
      enabled: false,
      requested: true,
      method: String(profileReadMethod || 'ui').toLowerCase(),
      reviewLimit: Math.max(1, Number(deepProfileLimit) || 20),
      selectedCount: 0,
      reviewedCount: 0,
      promotedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      selectionPolicy: 'account_coverage_deep_profile_v1',
      strictPromotion: String(profileReadMethod || 'ui').toLowerCase() === 'voyager' ? Boolean(strictVoyagerPromotion) : false,
      identityMissingCount: 0,
      skippedReason: rateLimited ? 'rate_limited' : 'no_candidates',
    };
  }
  const finalTimings = finishRunTimings(timings, now);
  Object.assign(finalResult, reviewedResult);
  finalResult.timings = finalTimings;
  finalResult.slowestSweeps = summarizeSlowestSweeps(timings.events);
  finalResult.cacheHits = cacheHits;
  finalResult.cacheMisses = cacheMisses;
  finalResult.speedProfile = effectiveSpeedProfile;
  finalResult.researchMode = normalizedResearchMode;
  finalResult.personaFollowUpPlan = buildPersonaCoverageFollowUpPlan(finalResult.personaCoverage, {
    researchMode: normalizedResearchMode,
  });
  finalResult.adaptivePruning = adaptivePruningTelemetry;
  const bucketSummary = summarizeCoverageBuckets(finalResult.candidates);

  return {
    account: activeAccount,
    templates,
    sweepErrors,
    result: finalResult,
    bucketSummary,
    timings: finalTimings,
    slowestSweeps: finalResult.slowestSweeps,
    cacheHits,
    cacheMisses,
    speedProfile: effectiveSpeedProfile,
    researchMode: normalizedResearchMode,
  };
}

async function waitForInterSweepDelay(driver, delayMs) {
  const normalized = Math.max(0, Number(delayMs) || 0);
  if (normalized <= 0) {
    return;
  }
  if (driver?.page && typeof driver.page.waitForTimeout === 'function') {
    await driver.page.waitForTimeout(normalized);
    return;
  }
  if (typeof driver?.waitForInterSweepDelay === 'function') {
    await driver.waitForInterSweepDelay(normalized);
    return;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, normalized);
  });
}

function normalizeSelectionText(value) {
  return String(value || '').toLowerCase();
}

function hasExecutiveTechnologyTitle(candidate) {
  const text = normalizeSelectionText(`${candidate.title || ''} ${candidate.headline || ''}`);
  return /\b(chief information officer|chief technology officer|chief data officer|chief data\s*&\s*analytics officer|chief analytics officer|chief ai officer|chief artificial intelligence officer|cio|cto|cdo|vp engineering|vp of engineering|director of engineering|director engineering|engineering director|head of engineering|vp technology|vp of technology)\b/.test(text);
}

function hasMicroservicesObservabilityTitle(candidate) {
  const text = normalizeSelectionText(candidate.title || '');
  return /microservices?.*(engineer|architect|developer)|(engineer|architect|developer).*microservices?/.test(text);
}

function isManagerOrAbove(seniority) {
  return new Set(['manager', 'head', 'director', 'vp', 'principal']).has(String(seniority || '').toLowerCase());
}

function hasCoreTechnicalAdjacentScope(title) {
  if (/\b(cloud|ai|microservice|microservices)\b/.test(title)) {
    return true;
  }
  if (/\b(platform|architecture|architect)\b/.test(title)) {
    return hasTechnicalAmbiguousQualifier(title);
  }
  return false;
}

function hasEngineeringLeadershipScope(title) {
  return /\b(engineering|technology|technical|platform|cloud|architecture)\b.*\bleadership\b|\bleadership\b.*\b(engineering|technology|technical|platform|cloud|architecture)\b/.test(title);
}

function isSeniorPlatformLeader(candidate) {
  const seniority = String(candidate.seniority || '').toLowerCase();
  const roleFamily = String(candidate.roleFamily || '').toLowerCase();
  return new Set(['vp', 'director', 'head', 'principal']).has(seniority)
    && new Set([
      'platform_engineering',
      'executive_engineering',
      'devops',
      'site_reliability',
      'infrastructure',
      'software_engineering',
    ]).has(roleFamily);
}

function hasScaleupTechnicalAdjacentScope(candidate) {
  const title = normalizeSelectionText(candidate.title || '');
  const roleFamily = String(candidate.roleFamily || '').toLowerCase();
  if (/\b(engineering director|director of engineering|engineering manager|senior engineering manager)\b/.test(title)) {
    return true;
  }
  if (/\b(vp product\s*&\s*data|vp product and data|head of product\s*&\s*data|head of product and data)\b/.test(title)) {
    return true;
  }
  if (/\b(cloud engineer|senior cloud engineer|data platform engineer|staff engineer ai|staff ai engineer|senior ai software engineer)\b/.test(title)) {
    return true;
  }
  if (
    /\b(senior|staff|principal)\b/.test(title)
    && /\b(software engineer|software developer|developer|engineer)\b/.test(title)
    && /\b(cloud|platform|ai|data|ml|machine learning)\b/.test(title)
  ) {
    return true;
  }
  return ['software_engineering', 'executive_engineering', 'data'].includes(roleFamily)
    && /\b(cloud|platform|ai|data platform|engineering manager|engineering director)\b/.test(title);
}

function getHardExclusionReason(candidate, options = {}) {
  const title = normalizeSelectionText(candidate.title || '');
  const roleFamily = String(candidate.roleFamily || '').toLowerCase();
  const excludeRoleFamilies = new Set((options.excludeRoleFamilies || []).map((value) => String(value || '').toLowerCase()));
  const excludeTitleKeywords = (options.excludeTitleKeywords || []).map((value) => String(value || '').toLowerCase().trim()).filter(Boolean);

  if (excludeRoleFamilies.has(roleFamily)) {
    return 'operator_excluded_role_family';
  }
  if (excludeTitleKeywords.some((keyword) => title.includes(keyword))) {
    return 'operator_excluded_title_keyword';
  }
  const nonIcpTitleReason = classifyNonIcpTitleReason(title);
  if (nonIcpTitleReason) {
    return nonIcpTitleReason;
  }
  if (/\b(hr|human resources|privacy|controlling|einkauf|procurement|finance|financial)\b/.test(title)) {
    return 'non_icp_business_function';
  }
  if (/\b(supply chain|procurement|buying|merchandising|logistics|transport)\b/.test(title)) {
    return 'non_icp_operations_function';
  }
  if (/\b(salesforce commerce cloud|commerce cloud|ecommerce|e-commerce|digital commerce)\b/.test(title)) {
    return 'commerce_platform_not_observability';
  }
  if (/\b(corporate security|event resilience|physical security|security risk|operational resilience)\b/.test(title)) {
    return 'corporate_security_not_observability';
  }
  if (
    roleFamily === 'data'
    && (/\b(bi|business intelligence|analyst)\b/.test(title) || (/\banalytics\b/.test(title) && !/\b(ai|cloud|platform)\b/.test(title)))
  ) {
    return 'data_analytics_not_observability';
  }
  if (roleFamily === 'security' && !/\b(vp|vice president|head of security)\b/.test(title)) {
    return 'security_path_not_primary_icp';
  }
  return null;
}

function summarizeTopScoreComponents(scoreBreakdown, limit = 3) {
  const components = scoreBreakdown?.components || {};
  return Object.entries(components)
    .filter(([, value]) => Number(value) !== 0)
    .map(([component, value]) => ({ component, value: Number(value) }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, limit);
}

function classifyCoverageListSelection(candidate, options = {}) {
  const hardExclusionReason = getHardExclusionReason(candidate, options);
  if (hardExclusionReason) {
    return {
      selected: false,
      reason: hardExclusionReason,
      rank: 0,
    };
  }

  const includeBuckets = new Set(options.includeBuckets || ['direct_observability', 'technical_adjacent']);
  const minScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : 25;
  const title = normalizeSelectionText(candidate.title || '');
  const technicalContext = normalizeSelectionText(`${candidate.title || ''} ${candidate.headline || ''} ${candidate.summary || ''}`);
  const seniority = String(candidate.seniority || '').toLowerCase();
  const roleFamily = String(candidate.roleFamily || '').toLowerCase();
  const reportOnlyOutOfNetwork = Boolean(options.reportOnlyOutOfNetwork || options.excludeOutOfNetwork);

  if (candidate.deepReview?.blockedReason === 'voyager_reviewed_but_pitch_unknown') {
    return {
      selected: false,
      reason: 'voyager_reviewed_but_pitch_unknown',
      rank: 0,
    };
  }

  if (
    reportOnlyOutOfNetwork
    && candidate.outOfNetwork
    && includeBuckets.has(candidate.coverageBucket)
  ) {
    return {
      selected: false,
      reason: 'strong_but_not_auto_saved',
      rank: 0,
    };
  }

  if (candidate.coverageBucket === 'direct_observability') {
    if (/\b(platform|architecture|architect)\b/.test(title) && !hasTechnicalAmbiguousQualifier(technicalContext)) {
      return {
        selected: false,
        reason: 'direct_observability_needs_technical_qualifier',
        rank: 0,
      };
    }
    return {
      selected: true,
      reason: 'direct_observability_always_include',
      rank: 90,
    };
  }
  if (hasExecutiveTechnologyTitle(candidate)) {
    return {
      selected: true,
      reason: 'executive_cto_cio_always_include',
      rank: 85,
    };
  }
  if (hasMicroservicesObservabilityTitle(candidate)) {
    return {
      selected: true,
      reason: 'microservices_observability_path',
      rank: 86,
    };
  }

  if (candidate.coverageBucket === 'technical_adjacent') {
    if (options.scaleupSelectionExpanded && hasScaleupTechnicalAdjacentScope(candidate)) {
      return {
        selected: true,
        reason: 'scaleup_selection_expanded',
        rank: 79,
      };
    }
    if (roleFamily === 'software_engineering') {
      return {
        selected: true,
        reason: 'technical_adjacent_software_engineering',
        rank: 78,
      };
    }
    if (roleFamily === 'executive_engineering') {
      return {
        selected: true,
        reason: 'technical_adjacent_executive_engineering',
        rank: 82,
      };
    }
    if (hasCoreTechnicalAdjacentScope(title)) {
      return {
        selected: true,
        reason: 'technical_adjacent_core_technical_scope',
        rank: 76,
      };
    }
    if (hasEngineeringLeadershipScope(title)) {
      return {
        selected: true,
        reason: 'technical_adjacent_engineering_leadership',
        rank: 74,
      };
    }
    if (isSeniorPlatformLeader(candidate)) {
      return {
        selected: true,
        reason: 'technical_adjacent_senior_platform_leader',
        rank: 80,
      };
    }
    if (/\b(data\s*&\s*ai|ai\s*&\s*cloud|cloud\s*&\s*ai|analytics\s*&\s*cloud|ai\/ml)\b/.test(title)) {
      return {
        selected: true,
        reason: 'technical_adjacent_ai_cloud_compound',
        rank: 70,
      };
    }
    if (/\b(cloud|ai|platform)\b/.test(title) && isManagerOrAbove(seniority)) {
      return {
        selected: true,
        reason: 'technical_adjacent_cloud_ai_platform_leader',
        rank: 75,
      };
    }
  }

  if (
    includeBuckets.has(candidate.coverageBucket)
    && Number(candidate.score || 0) >= minScore
    && roleFamily !== 'unknown'
  ) {
    return {
      selected: true,
      reason: 'score_threshold',
      rank: 40,
    };
  }

  return {
    selected: false,
    reason: includeBuckets.has(candidate.coverageBucket) ? 'below_icp_selection_threshold' : 'bucket_not_included',
    rank: 0,
  };
}

function annotateCoverageCandidatesForListSelection(result, options = {}) {
  const annotated = (result?.candidates || [])
    .map((candidate) => {
      const selection = classifyCoverageListSelection(candidate, options);
      return {
        ...candidate,
        listSelectionReason: selection.reason,
        listSelectionRank: selection.rank,
        topScoreComponents: summarizeTopScoreComponents(candidate.scoreBreakdown),
        selectedForList: selection.selected,
      };
    });
  const minScore = Number.isFinite(Number(options.minScore))
    ? Number(options.minScore)
    : 25;
  const selectedCount = annotated.filter((candidate) => candidate.selectedForList).length;
  const maxScore = Math.max(...annotated.map((candidate) => Number(candidate.score || 0)), 0);
  if (options.relativeRankFallback !== false && annotated.length > 0 && selectedCount === 0 && maxScore < minScore) {
    const fallbackLimit = Number.isFinite(Number(options.relativeRankFallbackLimit))
      ? Number(options.relativeRankFallbackLimit)
      : 10;
    const fallbackKeys = new Set(
      annotated
        .filter((candidate) => Number(candidate.score || 0) > 0)
        .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
        .slice(0, fallbackLimit)
        .map(normalizeCandidateKey),
    );
    return annotated.map((candidate) => fallbackKeys.has(normalizeCandidateKey(candidate))
      ? {
        ...candidate,
        listSelectionReason: 'relative_rank_manual_review',
        manualReviewSuggested: true,
        relativeRankFallbackApplied: true,
        selectedForList: false,
      }
      : candidate);
  }
  return annotated;
}

function selectCoverageListCandidates(result, options = {}) {
  return annotateCoverageCandidatesForListSelection(result, options)
    .filter((candidate) => candidate.selectedForList)
    .sort((left, right) => {
      const rankDiff = (right.listSelectionRank || 0) - (left.listSelectionRank || 0);
      if (rankDiff !== 0) {
        return rankDiff;
      }
      const rightPriority = right.priorityModel?.priorityScore || 0;
      const leftPriority = left.priorityModel?.priorityScore || 0;
      if (rightPriority !== leftPriority) {
        return rightPriority - leftPriority;
      }
      return Number(right.score || 0) - Number(left.score || 0);
    });
}

function buildCoverageLanguageSplits(result, options = {}) {
  const selectedCandidates = options.selectedOnly === false
    ? (result?.candidates || [])
    : selectCoverageListCandidates(result, options.selection || {});
  const segment = options.segment || 'prospects';
  const listNames = buildLanguageSplitListNames({
    accountName: result?.accountName || options.accountName || 'Account',
    segment,
    prefix: options.prefix || null,
  });
  const split = splitCandidatesByProfileLanguage(selectedCandidates, {
    primaryLanguage: options.primaryLanguage || 'de',
  });

  return {
    policy: {
      primaryLanguage: options.primaryLanguage || 'de',
      de: 'German profile language',
      en: 'English and other profile languages',
    },
    listNames,
    buckets: {
      de: split.de,
      en: split.en,
    },
    meta: split.meta,
  };
}

function writeAccountCoverageArtifact(accountName, coverageResult) {
  const artifactPath = buildCoverageArtifactPath(accountName);
  writeJson(artifactPath, coverageResult);
  return artifactPath;
}

module.exports = {
  annotateCoverageCandidatesForListSelection,
  applyDeepReviewResult,
  buildApiRescueSweepTemplates,
  buildSweepTemplates,
  classifyCoverageBucket,
  classifyReviewedCoverageBucket,
  classifySweepErrorCategory,
  consolidateCoverageCandidates,
  buildCoverageArtifactPath,
  buildCoverageLanguageSplits,
  findAccountAliasEntry,
  loadAccountCoverageConfig,
  loadAccountAliasConfig,
  loadExistingAccountCoverageArtifact,
  loadPriorityModel,
  normalizeAccountAliasKey,
  normalizeCandidateKey,
  normalizeResearchMode,
  normalizeSpeedProfile,
  resolveSweepTemplateOptions,
  runCoverageDeepProfilePass,
  runAccountCoverageWorkflow,
  selectCoverageListCandidates,
  selectDeepReviewCandidates,
  buildPersonaCoverageFollowUpPlan,
  summarizeCoverageBuckets,
  summarizeCoverageSweepErrors,
  writeAccountCoverageArtifact,
};
