const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('../lib/json');
const { AUTORESEARCH_ARTIFACTS_DIR, ensureDir, resolveProjectPath } = require('../lib/paths');
const { parseAccountNames } = require('./account-batch');

const DEFAULT_RECALL_IMPROVEMENT_TARGET = 0.05;
const DEFAULT_FALSE_POSITIVE_TOLERANCE = 5;
const DEFAULT_MAX_VOYAGER_FAILURE_RATE = 0.5;

function normalizeMatchText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function leadIdentityKeys(row = {}) {
  const keys = new Set();
  const name = normalizeMatchText(row.fullName || row.name);
  if (name) keys.add(`name:${name}`);

  const url = String(row.salesNavigatorUrl || row.profileUrl || row.linkedinUrl || row.publicProfileUrl || '').trim();
  const leadId = url.match(/\/sales\/lead\/([^,/?#]+)/i)?.[1];
  if (leadId) keys.add(`salesLead:${leadId}`);
  const publicSlug = url.match(/linkedin\.com\/in\/([^/?#]+)/i)?.[1];
  if (publicSlug) keys.add(`publicSlug:${normalizeMatchText(publicSlug)}`);
  const explicitSlug = String(row.publicIdentifier || row.linkedinSlug || '').trim();
  if (explicitSlug) keys.add(`publicSlug:${normalizeMatchText(explicitSlug)}`);

  const urn = String(row.entityUrn || row.profileUrn || '').trim();
  if (urn) keys.add(`urn:${urn.toLowerCase()}`);
  const urnLeadId = urn.match(/fs_salesProfile:\(([^,)]+)/i)?.[1];
  if (urnLeadId) keys.add(`salesLead:${urnLeadId}`);
  return [...keys];
}

function readGoldListFixtures(goldDir, { accounts = [] } = {}) {
  if (!goldDir) return [];
  const resolvedDir = path.isAbsolute(goldDir) ? goldDir : resolveProjectPath(goldDir);
  if (!fs.existsSync(resolvedDir)) return [];
  const accountFilter = new Set((accounts || []).map(normalizeMatchText).filter(Boolean));
  const rows = [];

  for (const fileName of fs.readdirSync(resolvedDir)) {
    const filePath = path.join(resolvedDir, fileName);
    if (!fs.statSync(filePath).isFile()) continue;
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.json') {
      rows.push(...normalizeGoldRows(readJson(filePath), { sourceFile: fileName }));
    } else if (ext === '.csv' || ext === '.tsv') {
      rows.push(...parseDelimitedGoldRows(fs.readFileSync(filePath, 'utf8'), {
        sourceFile: fileName,
        delimiter: ext === '.tsv' ? '\t' : ',',
      }));
    }
  }

  return rows
    .filter((row) => accountFilter.size === 0 || accountFilter.has(normalizeMatchText(row.accountName)))
    .map((row) => ({
      ...row,
      identityKeys: leadIdentityKeys(row),
    }));
}

function normalizeGoldRows(value, { sourceFile = null } = {}) {
  const rawRows = Array.isArray(value)
    ? value
    : (Array.isArray(value?.leads) ? value.leads : []);
  return rawRows.map((row) => ({
    accountName: row.accountName || row.account || row.company || '',
    fullName: row.fullName || row.name || '',
    title: row.title || '',
    salesNavigatorUrl: row.salesNavigatorUrl || row.profileUrl || row.linkedinUrl || '',
    entityUrn: row.entityUrn || '',
    tier: row.tier || row.personaTier || '',
    sourceFile,
  })).filter((row) => row.fullName || row.salesNavigatorUrl || row.entityUrn);
}

function parseDelimitedGoldRows(text, { delimiter = ',', sourceFile = null } = {}) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const headers = splitDelimitedLine(lines[0], delimiter).map((header) => normalizeMatchText(header).replace(/\s+/g, ''));
  return lines.slice(1).map((line) => {
    const values = splitDelimitedLine(line, delimiter);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    return {
      accountName: row.accountname || row.account || row.company || '',
      fullName: row.fullname || row.name || '',
      title: row.title || '',
      salesNavigatorUrl: row.salesnavigatorurl || row.profileurl || row.linkedinurl || '',
      entityUrn: row.entityurn || '',
      tier: row.tier || row.personatier || '',
      sourceFile,
    };
  }).filter((row) => row.fullName || row.salesNavigatorUrl || row.entityUrn);
}

function splitDelimitedLine(line, delimiter) {
  const output = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      output.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  output.push(current.trim());
  return output;
}

function loadCoverageArtifact(filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : resolveProjectPath(filePath);
  return {
    artifactPath: resolved,
    artifact: readJson(resolved),
  };
}

function extractCoverageCandidates(artifact = {}) {
  if (Array.isArray(artifact.candidates)) return artifact.candidates;
  if (Array.isArray(artifact.result?.candidates)) return artifact.result.candidates;
  if (Array.isArray(artifact.accounts)) {
    return artifact.accounts.flatMap((account) => account.candidates || account.coverage?.candidates || []);
  }
  return [];
}

function isSelectedCandidate(candidate = {}) {
  return Boolean(
    candidate.selectedForList
    || candidate.saveRecommended
    || candidate.resolutionBucket === 'resolved_safe_to_save'
    || candidate.coverageBucket === 'direct_observability'
  );
}

function candidateMatchesGold(candidate, goldRow) {
  const candidateKeys = new Set(leadIdentityKeys(candidate));
  if ((goldRow.identityKeys || []).some((key) => candidateKeys.has(key))) return true;

  const candidateName = normalizeMatchText(candidate.fullName || candidate.name);
  const goldName = normalizeMatchText(goldRow.fullName || goldRow.name);
  if (!candidateName || !goldName || candidateName !== goldName) return false;

  const candidateCompany = normalizeMatchText(candidate.company || candidate.accountName);
  const goldCompany = normalizeMatchText(goldRow.accountName);
  return !candidateCompany || !goldCompany || candidateCompany.includes(goldCompany) || goldCompany.includes(candidateCompany);
}

function summarizeCoverageAgainstGold(artifact = {}, goldRows = []) {
  const candidates = extractCoverageCandidates(artifact);
  const selected = candidates.filter(isSelectedCandidate);
  const matchedGold = goldRows.filter((gold) => candidates.some((candidate) => candidateMatchesGold(candidate, gold)));
  const selectedMatchedGold = goldRows.filter((gold) => selected.some((candidate) => candidateMatchesGold(candidate, gold)));
  const selectedFalsePositiveCandidates = goldRows.length > 0
    ? selected.filter((candidate) => !goldRows.some((gold) => candidateMatchesGold(candidate, gold)))
    : [];
  const promotedCandidates = candidates.filter((candidate) =>
    candidate.deepReview?.method === 'voyager'
    && (
      candidate.deepReview?.bucketBefore !== candidate.deepReview?.bucketAfter
      || Number(candidate.deepReview?.scoreAfter || 0) > Number(candidate.deepReview?.scoreBefore || 0)
    ));
  const blockedPromotions = candidates.filter((candidate) =>
    candidate.deepReview?.method === 'voyager'
    && candidate.deepReview?.blockedReason === 'voyager_reviewed_but_pitch_unknown');
  const goldTotal = goldRows.length;
  const recall = goldTotal > 0 ? matchedGold.length / goldTotal : null;
  const selectedRecall = goldTotal > 0 ? selectedMatchedGold.length / goldTotal : null;
  const referencePrecision = selected.length > 0 && goldTotal > 0 ? selectedMatchedGold.length / selected.length : null;
  const falsePositives = goldTotal > 0 ? Math.max(0, selected.length - selectedMatchedGold.length) : null;
  const deepProfile = artifact.deepProfilePass || artifact.result?.deepProfilePass || {};
  const timing = artifact.timings || artifact.result?.timings || {};

  return {
    candidateCount: candidates.length,
    selectedCount: selected.length,
    goldTotal,
    matchedGoldCount: matchedGold.length,
    selectedMatchedGoldCount: selectedMatchedGold.length,
    missedGold: goldRows
      .filter((gold) => !candidates.some((candidate) => candidateMatchesGold(candidate, gold)))
      .map((gold) => ({ fullName: gold.fullName, title: gold.title, accountName: gold.accountName, tier: gold.tier || '' }))
      .slice(0, 25),
    recall,
    selectedRecall,
    referencePrecision,
    falsePositives,
    promotedCount: promotedCandidates.length,
    promotedCandidates: promotedCandidates.map((candidate) => ({
      fullName: candidate.fullName || candidate.name || '',
      title: candidate.title || '',
      scoreBefore: candidate.deepReview?.scoreBefore ?? candidate.deepReview?.previousScore ?? null,
      scoreAfter: candidate.deepReview?.scoreAfter ?? candidate.deepReview?.reviewedScore ?? null,
      bucketBefore: candidate.deepReview?.bucketBefore || candidate.deepReview?.previousBucket || null,
      bucketAfter: candidate.deepReview?.bucketAfter || candidate.deepReview?.reviewedBucket || null,
      pitchStrategy: candidate.deepReview?.pitchStrategy || candidate.deepReview?.signals?.pitchStrategy || 'unknown',
    })).slice(0, 25),
    selectedFalsePositiveCandidates: selectedFalsePositiveCandidates.map((candidate) => ({
      fullName: candidate.fullName || candidate.name || '',
      title: candidate.title || '',
      score: candidate.score ?? null,
      bucket: candidate.coverageBucket || null,
    })).slice(0, 25),
    promotionBlockedCount: blockedPromotions.length,
    promotionBlockedCandidates: blockedPromotions.map((candidate) => ({
      fullName: candidate.fullName || candidate.name || '',
      title: candidate.title || '',
      score: candidate.score ?? null,
      reason: candidate.deepReview?.blockedReason || 'voyager_promotion_blocked',
    })).slice(0, 25),
    identityMissingCandidates: (deepProfile.identityMissingCandidates || []).slice(0, 25),
    voyagerReviewed: Number(deepProfile.reviewedCount || 0),
    voyagerSkipped: Number(deepProfile.skippedCount || 0),
    voyagerFailed: Number(deepProfile.failedCount || 0),
    voyagerIdentityMissing: Number(deepProfile.identityMissingCount || 0),
    totalMs: Number(timing.totalMs || 0),
  };
}

function buildVoyagerAutoresearchEvaluation({
  accounts = [],
  baselineArtifacts = [],
  voyagerArtifacts = [],
  goldRows = [],
  deepProfileLimit = 20,
  generatedAt = new Date().toISOString(),
  recallImprovementTarget = DEFAULT_RECALL_IMPROVEMENT_TARGET,
  falsePositiveTolerance = DEFAULT_FALSE_POSITIVE_TOLERANCE,
  maxVoyagerFailureRate = DEFAULT_MAX_VOYAGER_FAILURE_RATE,
} = {}) {
  const accountNames = accounts.length > 0
    ? accounts
    : [...new Set([
      ...baselineArtifacts.map((entry) => entry.artifact?.accountName || entry.artifact?.result?.accountName),
      ...voyagerArtifacts.map((entry) => entry.artifact?.accountName || entry.artifact?.result?.accountName),
    ].filter(Boolean))];
  const evaluations = accountNames.map((accountName, index) => {
    const baseline = baselineArtifacts[index]?.artifact || baselineArtifacts.find((entry) =>
      normalizeMatchText(entry.artifact?.accountName || entry.artifact?.result?.accountName) === normalizeMatchText(accountName))?.artifact || {};
    const voyager = voyagerArtifacts[index]?.artifact || voyagerArtifacts.find((entry) =>
      normalizeMatchText(entry.artifact?.accountName || entry.artifact?.result?.accountName) === normalizeMatchText(accountName))?.artifact || {};
    const accountGold = goldRows.filter((row) => normalizeMatchText(row.accountName) === normalizeMatchText(accountName));
    const baselineMetrics = summarizeCoverageAgainstGold(baseline, accountGold);
    const voyagerMetrics = summarizeCoverageAgainstGold(voyager, accountGold);
    const newlyMatchedGold = (accountGold || [])
      .filter((gold) => (
        extractCoverageCandidates(voyager).some((candidate) => candidateMatchesGold(candidate, gold))
        && !extractCoverageCandidates(baseline).some((candidate) => candidateMatchesGold(candidate, gold))
      ))
      .map((gold) => ({ fullName: gold.fullName, title: gold.title, accountName: gold.accountName }))
      .slice(0, 25);
    const newlySelectedGold = (accountGold || [])
      .filter((gold) => (
        extractCoverageCandidates(voyager).filter(isSelectedCandidate).some((candidate) => candidateMatchesGold(candidate, gold))
        && !extractCoverageCandidates(baseline).filter(isSelectedCandidate).some((candidate) => candidateMatchesGold(candidate, gold))
      ))
      .map((gold) => ({ fullName: gold.fullName, title: gold.title, accountName: gold.accountName }))
      .slice(0, 25);
    const recallDelta = nullableDelta(voyagerMetrics.recall, baselineMetrics.recall);
    const selectedRecallDelta = nullableDelta(voyagerMetrics.selectedRecall, baselineMetrics.selectedRecall);
    const falsePositiveDelta = nullableDelta(voyagerMetrics.falsePositives, baselineMetrics.falsePositives);
    const runtimeDeltaMs = voyagerMetrics.totalMs - baselineMetrics.totalMs;
    return {
      accountName,
      baseline: baselineMetrics,
      voyager: voyagerMetrics,
      delta: {
        recall: recallDelta,
        selectedRecall: selectedRecallDelta,
        falsePositives: falsePositiveDelta,
        runtimeMs: runtimeDeltaMs,
      },
      newlyMatchedGold,
      newlySelectedGold,
    };
  });

  const totals = sumEvaluations(evaluations);
  const failedGates = [];
  if (totals.goldTotal > 0 && totals.recallDelta < recallImprovementTarget && totals.selectedRecallDelta < recallImprovementTarget) {
    failedGates.push('gold_recall_improvement_below_target');
  }
  if (totals.falsePositiveDelta !== null && totals.falsePositiveDelta > falsePositiveTolerance) {
    failedGates.push('false_positive_delta_above_tolerance');
  }
  if (totals.voyagerFailureRate > maxVoyagerFailureRate) {
    failedGates.push('voyager_failure_rate_above_tolerance');
  }
  const decision = failedGates.length === 0 && (totals.promotedCount > 0 || totals.recallDelta > 0 || totals.selectedRecallDelta > 0)
    ? 'recommend_voyager_policy'
    : (failedGates.includes('false_positive_delta_above_tolerance') ? 'reject_or_tighten_policy' : 'needs_more_evidence');

  return {
    generatedAt,
    mode: 'read_only_voyager_autoresearch',
    decision,
    accounts: accountNames,
    deepProfileLimit: Number(deepProfileLimit || 20),
    gates: {
      recallImprovementTarget,
      falsePositiveTolerance,
      maxVoyagerFailureRate,
      failedGates,
    },
    totals,
    accountEvaluations: evaluations,
    recommendations: buildRecommendations({ decision, failedGates, totals }),
    safety: {
      drySafe: true,
      readOnly: true,
      liveMutationAllowed: false,
      autoSaveAllowed: false,
      autoConnectAllowed: false,
    },
    safeCommandPlan: buildVoyagerAutoresearchCommandPlan(accountNames, { deepProfileLimit }),
  };
}

function nullableDelta(left, right) {
  if (left === null || right === null) return null;
  return Math.round((left - right) * 10000) / 10000;
}

function sumEvaluations(evaluations) {
  const total = {
    goldTotal: 0,
    baselineMatchedGold: 0,
    voyagerMatchedGold: 0,
    baselineSelectedMatchedGold: 0,
    voyagerSelectedMatchedGold: 0,
    baselineSelected: 0,
    voyagerSelected: 0,
    baselineFalsePositives: 0,
    voyagerFalsePositives: 0,
    promotedCount: 0,
    promotionBlockedCount: 0,
    voyagerReviewed: 0,
    voyagerSkipped: 0,
    voyagerFailed: 0,
    voyagerIdentityMissing: 0,
    baselineMs: 0,
    voyagerMs: 0,
  };
  for (const evaluation of evaluations) {
    total.goldTotal += evaluation.baseline.goldTotal || evaluation.voyager.goldTotal || 0;
    total.baselineMatchedGold += evaluation.baseline.matchedGoldCount || 0;
    total.voyagerMatchedGold += evaluation.voyager.matchedGoldCount || 0;
    total.baselineSelectedMatchedGold += evaluation.baseline.selectedMatchedGoldCount || 0;
    total.voyagerSelectedMatchedGold += evaluation.voyager.selectedMatchedGoldCount || 0;
    total.baselineSelected += evaluation.baseline.selectedCount || 0;
    total.voyagerSelected += evaluation.voyager.selectedCount || 0;
    total.baselineFalsePositives += evaluation.baseline.falsePositives || 0;
    total.voyagerFalsePositives += evaluation.voyager.falsePositives || 0;
    total.promotedCount += evaluation.voyager.promotedCount || 0;
    total.promotionBlockedCount += evaluation.voyager.promotionBlockedCount || 0;
    total.voyagerReviewed += evaluation.voyager.voyagerReviewed || 0;
    total.voyagerSkipped += evaluation.voyager.voyagerSkipped || 0;
    total.voyagerFailed += evaluation.voyager.voyagerFailed || 0;
    total.voyagerIdentityMissing += evaluation.voyager.voyagerIdentityMissing || 0;
    total.baselineMs += evaluation.baseline.totalMs || 0;
    total.voyagerMs += evaluation.voyager.totalMs || 0;
  }
  total.baselineRecall = total.goldTotal > 0 ? total.baselineMatchedGold / total.goldTotal : null;
  total.voyagerRecall = total.goldTotal > 0 ? total.voyagerMatchedGold / total.goldTotal : null;
  total.recallDelta = nullableDelta(total.voyagerRecall, total.baselineRecall);
  total.baselineSelectedRecall = total.goldTotal > 0 ? total.baselineSelectedMatchedGold / total.goldTotal : null;
  total.voyagerSelectedRecall = total.goldTotal > 0 ? total.voyagerSelectedMatchedGold / total.goldTotal : null;
  total.selectedRecallDelta = nullableDelta(total.voyagerSelectedRecall, total.baselineSelectedRecall);
  total.falsePositiveDelta = total.goldTotal > 0 ? total.voyagerFalsePositives - total.baselineFalsePositives : null;
  total.runtimeDeltaMs = total.voyagerMs - total.baselineMs;
  const voyagerAttempts = total.voyagerReviewed + total.voyagerSkipped + total.voyagerFailed;
  total.voyagerFailureRate = voyagerAttempts > 0 ? total.voyagerFailed / voyagerAttempts : 0;
  return total;
}

function buildRecommendations({ decision, failedGates, totals }) {
  const recommendations = [];
  if (decision === 'recommend_voyager_policy') {
    recommendations.push('Keep Voyager as an opt-in quality booster for similar accounts.');
  }
  if (totals.promotedCount > 0) {
    recommendations.push(`Review promoted candidates: Voyager promoted ${totals.promotedCount} candidate(s).`);
  }
  if (totals.promotionBlockedCount > 0) {
    recommendations.push(`Keep strict Voyager promotion on: ${totals.promotionBlockedCount} unknown-pitch promotion(s) were held for manual review.`);
  }
  if (totals.voyagerIdentityMissing > 0) {
    recommendations.push(`Improve Sales Nav to Voyager identity mapping: ${totals.voyagerIdentityMissing} candidate(s) could not be deep-profiled.`);
  }
  if (failedGates.includes('gold_recall_improvement_below_target')) {
    recommendations.push('Prioritize discovery templates and selection policy; gold-list recall did not improve enough for Voyager alone.');
  }
  if (failedGates.includes('false_positive_delta_above_tolerance')) {
    recommendations.push('Tighten promotion rules before enabling Voyager for this account type.');
  }
  if (failedGates.includes('voyager_failure_rate_above_tolerance')) {
    recommendations.push('Investigate Voyager identity mapping and rate-limit behavior before broader use.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Collect more benchmark runs before changing the default SDR workflow.');
  }
  return recommendations;
}

function buildVoyagerAutoresearchCommandPlan(accounts = [], { deepProfileLimit = 20 } = {}) {
  return (accounts || []).flatMap((accountName) => [
    {
      id: `baseline-${normalizeMatchText(accountName).replace(/\s+/g, '-')}`,
      command: `npm run account-coverage -- --driver=playwright --account-name="${accountName}" --api-read-prefetch`,
      mode: 'baseline_read_only',
    },
    {
      id: `voyager-${normalizeMatchText(accountName).replace(/\s+/g, '-')}`,
      command: `npm run account-coverage -- --driver=playwright --account-name="${accountName}" --api-read-prefetch --deep-profile-pass --profile-read-method=voyager --deep-profile-limit=${Number(deepProfileLimit || 20)}`,
      mode: 'voyager_read_only',
    },
  ]);
}

async function runVoyagerAutoresearchExperiments({
  accounts = [],
  runCoverage,
  deepProfileLimit = 20,
} = {}) {
  if (typeof runCoverage !== 'function') {
    throw new Error('runVoyagerAutoresearchExperiments requires a runCoverage function');
  }
  const baselineArtifacts = [];
  const voyagerArtifacts = [];

  for (const accountName of accounts || []) {
    const baseline = await runCoverage({
      accountName,
      apiReadPrefetch: true,
      deepProfilePass: false,
      profileReadMethod: 'ui',
      deepProfileLimit,
      experimentArm: 'baseline',
    });
    baselineArtifacts.push({
      artifactPath: baseline?.artifactPath || null,
      artifact: baseline?.result || baseline,
    });

    const voyager = await runCoverage({
      accountName,
      apiReadPrefetch: true,
      deepProfilePass: true,
      profileReadMethod: 'voyager',
      deepProfileLimit,
      experimentArm: 'voyager',
    });
    voyagerArtifacts.push({
      artifactPath: voyager?.artifactPath || null,
      artifact: voyager?.result || voyager,
    });
  }

  return {
    baselineArtifacts,
    voyagerArtifacts,
  };
}

function renderVoyagerAutoresearchMarkdown(evaluation = {}) {
  const lines = [];
  lines.push('# Voyager Autoresearch Evaluation');
  lines.push('');
  lines.push(`- Generated at: \`${evaluation.generatedAt || new Date().toISOString()}\``);
  lines.push(`- Mode: \`${evaluation.mode || 'read_only_voyager_autoresearch'}\``);
  lines.push(`- Decision: \`${evaluation.decision || 'needs_more_evidence'}\``);
  lines.push(`- Accounts: \`${(evaluation.accounts || []).join(', ') || 'none'}\``);
  lines.push(`- Live actions: \`none\``);
  lines.push('');
  lines.push('## Totals');
  const totals = evaluation.totals || {};
  lines.push(`- Gold leads: \`${totals.goldTotal || 0}\``);
  lines.push(`- Baseline recall: \`${formatNullablePercent(totals.baselineRecall)}\``);
  lines.push(`- Voyager recall: \`${formatNullablePercent(totals.voyagerRecall)}\``);
  lines.push(`- Recall delta: \`${formatSignedPercent(totals.recallDelta)}\``);
  lines.push(`- Baseline selected recall: \`${formatNullablePercent(totals.baselineSelectedRecall)}\``);
  lines.push(`- Voyager selected recall: \`${formatNullablePercent(totals.voyagerSelectedRecall)}\``);
  lines.push(`- Voyager promoted: \`${totals.promotedCount || 0}\``);
  lines.push(`- Voyager promotions blocked: \`${totals.promotionBlockedCount || 0}\``);
  lines.push(`- Voyager reviewed/skipped/failed: \`${totals.voyagerReviewed || 0}/${totals.voyagerSkipped || 0}/${totals.voyagerFailed || 0}\``);
  lines.push(`- Voyager identity missing: \`${totals.voyagerIdentityMissing || 0}\``);
  lines.push(`- Runtime delta: \`${totals.runtimeDeltaMs || 0}ms\``);
  lines.push('');
  lines.push('## Account Results');
  for (const item of evaluation.accountEvaluations || []) {
    lines.push(`- \`${item.accountName}\`: recall ${formatNullablePercent(item.baseline.recall)} -> ${formatNullablePercent(item.voyager.recall)}, selected ${item.baseline.selectedCount} -> ${item.voyager.selectedCount}, promoted ${item.voyager.promotedCount}`);
    if ((item.newlyMatchedGold || []).length > 0) {
      lines.push(`  - Newly found reference leads: ${formatPersonList(item.newlyMatchedGold)}`);
    }
    if ((item.newlySelectedGold || []).length > 0) {
      lines.push(`  - Newly selected reference leads: ${formatPersonList(item.newlySelectedGold)}`);
    }
    if ((item.voyager.promotedCandidates || []).length > 0) {
      lines.push(`  - Promoted by Voyager: ${formatPromotedList(item.voyager.promotedCandidates)}`);
    }
    if ((item.voyager.promotionBlockedCandidates || []).length > 0) {
      lines.push(`  - Promotions held for review: ${formatPersonList(item.voyager.promotionBlockedCandidates)}`);
    }
    if ((item.voyager.identityMissingCandidates || []).length > 0) {
      lines.push(`  - Voyager identity gaps: ${formatPersonList(item.voyager.identityMissingCandidates)}`);
    }
    if ((item.voyager.selectedFalsePositiveCandidates || []).length > 0) {
      lines.push(`  - Possible false positives selected: ${formatPersonList(item.voyager.selectedFalsePositiveCandidates)}`);
    }
    if ((item.voyager.missedGold || []).length > 0) {
      lines.push(`  - Still missing reference leads: ${formatPersonList(item.voyager.missedGold.slice(0, 5))}`);
      lines.push(`  - Missed persona families: ${formatFamilyCounts(item.voyager.missedGold)}`);
    }
  }
  if ((evaluation.accountEvaluations || []).length === 0) {
    lines.push('- `no account evaluations`');
  }
  lines.push('');
  lines.push('## Recommendations');
  for (const recommendation of evaluation.recommendations || []) {
    lines.push(`- ${recommendation}`);
  }
  lines.push('');
  lines.push('## Failed Gates');
  const failed = evaluation.gates?.failedGates || [];
  lines.push(failed.length === 0 ? '- `none`' : failed.map((gate) => `- \`${gate}\``).join('\n'));
  lines.push('');
  lines.push('## Safe Command Plan');
  for (const step of evaluation.safeCommandPlan || []) {
    lines.push(`- \`${step.command}\``);
  }
  lines.push('');
  lines.push('## Safety Contract');
  lines.push('- Read-only evaluation only.');
  lines.push('- No Sales Navigator list saves.');
  lines.push('- No connection requests.');
  lines.push('- Recommendations are advisory until reviewed by an operator.');
  return `${lines.join('\n').trim()}\n`;
}

function formatNullablePercent(value) {
  if (value === null || value === undefined) return 'n/a';
  return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}

function formatSignedPercent(value) {
  if (value === null || value === undefined) return 'n/a';
  const percent = Math.round(Number(value || 0) * 1000) / 10;
  return `${percent >= 0 ? '+' : ''}${percent}%`;
}

function formatPersonList(rows = []) {
  return rows
    .slice(0, 8)
    .map((row) => `${row.fullName || 'Unknown'} (${row.title || 'no title'})`)
    .join('; ') || 'none';
}

function formatPromotedList(rows = []) {
  return rows
    .slice(0, 8)
    .map((row) => `${row.fullName || 'Unknown'} (${row.scoreBefore ?? '?'} -> ${row.scoreAfter ?? '?'}, ${row.bucketBefore || '?'} -> ${row.bucketAfter || '?'}, pitch=${row.pitchStrategy || 'unknown'})`)
    .join('; ') || 'none';
}

function classifyMissedPersonaFamily(row = {}) {
  const text = normalizeMatchText(`${row.title || ''} ${row.tier || ''}`);
  if (/\b(cdo|chief data|director data|directeur data|directrice data|data ai|data product|analytics officer)\b/.test(text)) {
    return 'data_ai_buyer';
  }
  if (/\b(cto|cio|chief|vp|director|directeur|directrice|digital transformation|transformation digitale|marketplace|customer experience)\b/.test(text)) {
    return 'executive_buyer';
  }
  if (/\b(responsable|head|leiter|architecture|gouvernance|production|exploitation|cloud transformation|domain|domaine)\b/.test(text)) {
    return 'operator';
  }
  if (/\b(observability|observabilite|observabilite|observabilitat|monitoring|sre|devops|cloud|tech lead|technical lead|engineer|ingenieur)\b/.test(text)) {
    return 'technical_user';
  }
  return 'other';
}

function formatFamilyCounts(rows = []) {
  const counts = {};
  for (const row of rows || []) {
    const family = classifyMissedPersonaFamily(row);
    counts[family] = (counts[family] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .map(([family, count]) => `${family}=${count}`)
    .join(', ') || 'none';
}

function buildVoyagerAutoresearchArtifactPath(now = new Date()) {
  ensureDir(AUTORESEARCH_ARTIFACTS_DIR, 0o700);
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(AUTORESEARCH_ARTIFACTS_DIR, `voyager-autoresearch-${timestamp}.json`);
}

function writeVoyagerAutoresearchEvaluation(evaluation, outputPath = null) {
  const artifactPath = outputPath
    ? (path.isAbsolute(outputPath) ? outputPath : resolveProjectPath(outputPath))
    : buildVoyagerAutoresearchArtifactPath(new Date(evaluation.generatedAt || Date.now()));
  const reportPath = artifactPath.replace(/\.json$/i, '.md');
  writeJson(artifactPath, {
    ...evaluation,
    artifactPath,
    reportPath,
  });
  fs.writeFileSync(reportPath, renderVoyagerAutoresearchMarkdown({
    ...evaluation,
    artifactPath,
    reportPath,
  }), {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(reportPath, 0o600);
  } catch {
    // best effort
  }
  return { artifactPath, reportPath };
}

function parseAccountInput(values = {}) {
  return parseAccountNames(values.accounts || values['account-names'] || values['account-name']);
}

module.exports = {
  buildVoyagerAutoresearchCommandPlan,
  buildVoyagerAutoresearchEvaluation,
  candidateMatchesGold,
  extractCoverageCandidates,
  leadIdentityKeys,
  loadCoverageArtifact,
  normalizeMatchText,
  parseAccountInput,
  readGoldListFixtures,
  renderVoyagerAutoresearchMarkdown,
  runVoyagerAutoresearchExperiments,
  summarizeCoverageAgainstGold,
  writeVoyagerAutoresearchEvaluation,
};
