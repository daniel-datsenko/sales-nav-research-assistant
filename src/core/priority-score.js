const path = require('node:path');
const { readJson, writeJson } = require('../lib/json');
const { PRIORITY_ARTIFACTS_DIR, resolveProjectPath } = require('../lib/paths');
const { toIso } = require('../lib/time');

function buildPriorityModelV1({
  config,
  winningContactRows,
  hiddenInfluencerRows,
  conversation_intelligenceKeywordRows,
  warnings = [],
}) {
  const winningFamilies = normalizeWinningFamilies(winningContactRows);
  const hiddenInfluencerSignals = normalizeHiddenInfluencerSignals(hiddenInfluencerRows);
  const conversation_intelligenceSignals = normalizeConversationIntelligenceSignals(conversation_intelligenceKeywordRows, config.conversation_intelligencePriorityKeywords || []);
  const ignoredRoleFamilies = new Set(config.ignoredRoleFamilies || []);

  const scoredWinningFamilies = winningFamilies.filter((row) => !ignoredRoleFamilies.has(row.titleFamily));
  const scoredHiddenSignals = hiddenInfluencerSignals.filter((row) => !ignoredRoleFamilies.has(row.roleFamily));
  const scoredConversationIntelligenceSignals = conversation_intelligenceSignals.filter((row) => !ignoredRoleFamilies.has(row.roleFamily));

  const maxWonOpps = Math.max(1, ...scoredWinningFamilies.map((row) => row.wonOpportunities || 0));
  const maxWonAmount = Math.max(1, ...scoredWinningFamilies.map((row) => row.totalWonAmount || 0));
  const maxHidden = Math.max(1, ...scoredHiddenSignals.map((row) => row.opportunityCount || 0));

  const roleFamilyScores = scoredWinningFamilies.map((row) => {
    const historicalWinRate = (row.wonOpportunities || 0) / maxWonOpps;
    const historicalAmountWeight = (row.totalWonAmount || 0) / maxWonAmount;
    const hidden = scoredHiddenSignals.find((entry) => entry.roleFamily === row.titleFamily);
    const hiddenInfluencerPresence = hidden ? (hidden.opportunityCount / maxHidden) : 0;
    const conversation_intelligence = scoredConversationIntelligenceSignals.find((entry) => entry.roleFamily === row.titleFamily);
    const conversation_intelligenceKeywordFit = conversation_intelligence ? conversation_intelligence.keywordFit : 0;
    const roleCoverageFit = estimateCoverageFit(row.titleFamily, config.buyerGroupRoles || {});

    const score = (
      (historicalWinRate * (config.weights.historicalWinRate || 0)) +
      (historicalAmountWeight * (config.weights.historicalAmountWeight || 0)) +
      (hiddenInfluencerPresence * (config.weights.hiddenInfluencerPresence || 0)) +
      (conversation_intelligenceKeywordFit * (config.weights.conversation_intelligenceKeywordFit || 0)) +
      (roleCoverageFit * (config.weights.roleCoverageFit || 0))
    ) * 100;

    return {
      roleFamily: row.titleFamily,
      historicalWinRate: round2(historicalWinRate),
      historicalAmountWeight: round2(historicalAmountWeight),
      hiddenInfluencerPresence: round2(hiddenInfluencerPresence),
      conversation_intelligenceKeywordFit: round2(conversation_intelligenceKeywordFit),
      roleCoverageFit: round2(roleCoverageFit),
      priorityScore: round2(score),
      wonOpportunities: row.wonOpportunities,
      totalWonAmount: row.totalWonAmount,
      examples: row.examples,
    };
  }).sort((left, right) => right.priorityScore - left.priorityScore);

  return {
    modelId: config.name || 'priority_score_v1',
    version: config.version || '1.0.0',
    builtAt: toIso(),
    summary: {
      winningFamilyCount: winningFamilies.length,
      hiddenInfluencerFamilies: hiddenInfluencerSignals.length,
      conversation_intelligenceFamilies: conversation_intelligenceSignals.length,
      warnings,
      ignoredRoleFamilies: [...ignoredRoleFamilies],
    },
    roleFamilyScores,
    hiddenInfluencerSignals: scoredHiddenSignals,
    conversation_intelligenceSignals: scoredConversationIntelligenceSignals,
    buyerGroupRoles: config.buyerGroupRoles || {},
    scoreBands: config.scoreBands || {},
    decisioning: config.decisioning || {},
  };
}

function normalizeWinningFamilies(rows) {
  return (rows || []).map((row) => ({
    titleFamily: row.title_family || row.titleFamily,
    uniqueContacts: Number(row.unique_contacts || row.uniqueContacts || 0),
    wonOpportunities: Number(row.won_opportunities || row.wonOpportunities || 0),
    totalWonAmount: Number(row.total_won_amount || row.totalWonAmount || 0),
    avgWonAmount: Number(row.avg_won_amount || row.avgWonAmount || 0),
    examples: [],
  }));
}

function normalizeHiddenInfluencerSignals(rows) {
  const grouped = new Map();

  for (const row of rows || []) {
    const roleFamily = inferRoleFamilyFromText(
      row.contact_title || row.contactTitle || row.participant_email || row.participantEmail || '',
    );
    if (!grouped.has(roleFamily)) {
      grouped.set(roleFamily, {
        roleFamily,
        opportunityCount: 0,
        participantEmails: [],
        contactTitles: [],
      });
    }
    const target = grouped.get(roleFamily);
    target.opportunityCount += 1;
    if (target.participantEmails.length < 5) {
      target.participantEmails.push(row.participant_email || row.participantEmail);
    }
    const title = row.contact_title || row.contactTitle;
    if (title && target.contactTitles.length < 5 && !target.contactTitles.includes(title)) {
      target.contactTitles.push(title);
    }
  }

  return [...grouped.values()].sort((left, right) => right.opportunityCount - left.opportunityCount);
}

function normalizeConversationIntelligenceSignals(rows, priorityKeywords) {
  const keywords = new Set((priorityKeywords || []).map((keyword) => String(keyword).toLowerCase()));
  const grouped = new Map();

  for (const row of rows || []) {
    const roleFamily = inferRoleFamilyFromKeywordRows(row.top_keywords || row.topKeywords || []);
    if (!grouped.has(roleFamily)) {
      grouped.set(roleFamily, {
        roleFamily,
        keywords: [],
        keywordFit: 0,
      });
    }

    const target = grouped.get(roleFamily);
    const topKeywords = row.top_keywords || row.topKeywords || [];
    for (const keywordEntry of topKeywords) {
      const keyword = String(keywordEntry.tracker_keyword || keywordEntry.trackerKeyword || '').toLowerCase();
      if (!keyword) {
        continue;
      }
      if (target.keywords.length < 8 && !target.keywords.includes(keyword)) {
        target.keywords.push(keyword);
      }
      if (keywords.has(keyword)) {
        target.keywordFit += 1;
      }
    }
  }

  return [...grouped.values()].map((row) => ({
    ...row,
    keywordFit: row.keywords.length > 0
      ? round2(Math.min(1, row.keywordFit / Math.max(1, row.keywords.length)))
      : 0,
  })).sort((left, right) => right.keywordFit - left.keywordFit);
}

function inferRoleFamilyFromKeywordRows(keywordRows) {
  const values = (keywordRows || [])
    .map((entry) => String(entry.tracker_keyword || entry.trackerKeyword || '').toLowerCase())
    .filter(Boolean)
    .join(' ');

  if (/platform/.test(values)) return 'platform';
  if (/observability|monitoring|observability-platform|prometheus|opentelemetry|slo|incident/.test(values)) return 'site_reliability';
  if (/migration|datadog|splunk|new relic/.test(values)) return 'architecture';
  if (/pricing|evaluation/.test(values)) return 'it_technology';
  return 'unknown';
}

function inferRoleFamilyFromText(text) {
  const value = String(text || '').toLowerCase();
  if (/site reliability|sre/.test(value)) return 'site_reliability';
  if (/architect|architecture/.test(value)) return 'architecture';
  if (/platform/.test(value)) return 'platform';
  if (/devops/.test(value)) return 'devops';
  if (/infrastructure/.test(value)) return 'infrastructure';
  if (/security/.test(value)) return 'security';
  if (/cloud/.test(value)) return 'cloud';
  if (/engineering|engineer|software/.test(value)) return 'engineering';
  if (/data|analytics/.test(value)) return 'data';
  if (/technology|\bit\b|sap|system/.test(value)) return 'it_technology';
  return 'unknown';
}

function estimateCoverageFit(roleFamily, buyerGroupRoles) {
  const totalBuckets = Object.keys(buyerGroupRoles).length || 1;
  const matches = Object.values(buyerGroupRoles)
    .filter((families) => Array.isArray(families) && families.includes(roleFamily))
    .length;

  return matches / totalBuckets;
}

function classifyPriorityTier(score, scoreBands) {
  if (score >= (scoreBands.core || 70)) {
    return 'core';
  }
  if (score >= (scoreBands.secondary || 45)) {
    return 'secondary';
  }
  if (score >= (scoreBands.exploratory || 20)) {
    return 'exploratory';
  }
  return 'ignore';
}

function scoreCandidateWithPriorityModel(candidate, model) {
  const text = String([
    candidate.title,
    candidate.headline,
    candidate.summary,
    candidate.about,
  ].filter(Boolean).join(' ')).toLowerCase();

  const bestFamily = (model.roleFamilyScores || []).find((entry) =>
    text.includes(entry.roleFamily.replace(/_/g, ' ')) || text.includes(entry.roleFamily)) || null;

  const priorityScore = bestFamily ? bestFamily.priorityScore : 0;
  const tier = classifyPriorityTier(priorityScore, model.scoreBands || {});

  return {
    priorityScore,
    priorityTier: tier,
    matchedRoleFamily: bestFamily?.roleFamily || null,
  };
}

function writePriorityModelArtifact(model, outputPath) {
  const targetPath = outputPath || path.join(PRIORITY_ARTIFACTS_DIR, `${model.modelId}.json`);
  writeJson(targetPath, model);
  return targetPath;
}

function loadPriorityScoreConfig(configPath) {
  return readJson(configPath || resolveProjectPath('config', 'priority-score', 'default.json'));
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

module.exports = {
  buildPriorityModelV1,
  classifyPriorityTier,
  loadPriorityScoreConfig,
  scoreCandidateWithPriorityModel,
  writePriorityModelArtifact,
};
