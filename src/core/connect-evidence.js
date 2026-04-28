const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('../lib/json');
const { ARTIFACTS_DIR, ensureDir } = require('../lib/paths');

const CONNECT_EVIDENCE_ARTIFACTS_DIR = path.join(ARTIFACTS_DIR, 'connect-evidence');
const DEFAULT_ACCEPTANCE_ARTIFACT = path.join(
  ARTIFACTS_DIR,
  'account-batches',
  'supervised-acceptance.json',
);

const FINAL_CONNECT_STATES = new Set([
  'sent',
  'already_sent',
  'already_connected',
  'email_required',
  'connect_unavailable',
  'manual_review',
  'skipped_by_policy',
]);

const GUARDED_REFERENCE_NAMES = new Set([
  'Example Guarded Lead',
  'Example Email Required Lead',
]);

const GUARDED_POLICY_CLASSES = new Set([
  'manual_review_required',
]);

function buildConnectEvidenceArtifactPath(now = new Date()) {
  ensureDir(CONNECT_EVIDENCE_ARTIFACTS_DIR, 0o700);
  const timestamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(CONNECT_EVIDENCE_ARTIFACTS_DIR, `connect-evidence-${timestamp}.json`);
}

function buildConnectEvidenceReportPath(jsonPath) {
  return String(jsonPath || buildConnectEvidenceArtifactPath()).replace(/\.json$/i, '.md');
}

function findLatestConnectEvidenceArtifact(artifactsDir = CONNECT_EVIDENCE_ARTIFACTS_DIR) {
  if (!fs.existsSync(artifactsDir)) {
    return null;
  }
  const artifacts = fs.readdirSync(artifactsDir)
    .filter((fileName) => /^connect-evidence-.+\.json$/i.test(fileName))
    .map((fileName) => {
      const filePath = path.join(artifactsDir, fileName);
      const stat = fs.statSync(filePath);
      return { filePath, mtimeMs: stat.mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  return artifacts[0]?.filePath || null;
}

function readLatestConnectEvidenceArtifact(artifactsDir = CONNECT_EVIDENCE_ARTIFACTS_DIR) {
  const artifactPath = findLatestConnectEvidenceArtifact(artifactsDir);
  if (!artifactPath) {
    return null;
  }
  return {
    artifactPath,
    artifact: readJson(artifactPath),
  };
}

function buildConnectEvidenceSprint({
  acceptanceArtifactPath = DEFAULT_ACCEPTANCE_ARTIFACT,
  now = new Date(),
} = {}) {
  const acceptanceArtifact = readJson(acceptanceArtifactPath);
  const rows = (acceptanceArtifact.results || []).flatMap((account) => (
    account.connectResults || []
  ).map((result) => buildConnectEvidenceRow({
    accountName: account.accountName,
    result,
    evidenceArtifactPath: acceptanceArtifactPath,
  })));
  const guardedRows = rows.filter((row) => row.guarded);
  const nonFinalRows = rows.filter((row) => !FINAL_CONNECT_STATES.has(row.status));
  const candidateRows = rows.filter((row) => row.recommendation === 'candidate_for_supervised_retest');

  return {
    generatedAt: now.toISOString(),
    goal: 'guarded_connect_evidence_sprint',
    drySafe: true,
    sourceArtifactPath: acceptanceArtifactPath,
    summary: {
      total: rows.length,
      finalStates: rows.length - nonFinalRows.length,
      nonFinal: nonFinalRows.length,
      guarded: guardedRows.length,
      candidatesForSupervisedRetest: candidateRows.length,
      eligibleSupervisedOnly: rows.filter((row) => row.recommendation === 'connect_eligible_supervised_only').length,
      listsFirstOnly: rows.filter((row) => row.recommendation === 'lists_first_only').length,
    },
    rows,
    nextActions: buildConnectEvidenceNextActions(rows),
  };
}

function buildConnectEvidenceRow({ accountName, result, evidenceArtifactPath }) {
  const policyClass = result.policyClass || null;
  const fullName = result.fullName || 'Unknown lead';
  const surfaceClassification = result.surfaceClassification || 'unknown';
  const guarded = GUARDED_POLICY_CLASSES.has(policyClass) || GUARDED_REFERENCE_NAMES.has(fullName);
  const status = result.status || 'unknown';
  const finalState = FINAL_CONNECT_STATES.has(status);
  const recommendation = deriveConnectEvidenceRecommendation({
    guarded,
    policyClass,
    status,
    surfaceClassification,
    finalState,
  });

  return {
    accountName,
    fullName,
    title: result.title || null,
    status,
    finalState,
    policyClass,
    surfaceClassification,
    operatorDisposition: result.operatorDisposition || null,
    nextAction: result.nextAction || null,
    guarded,
    recommendation,
    promotionAllowed: recommendation === 'candidate_for_supervised_retest',
    note: result.note || null,
    evidenceArtifactPath,
  };
}

function deriveConnectEvidenceRecommendation({
  guarded,
  policyClass,
  status,
  surfaceClassification,
  finalState,
}) {
  if (!finalState) {
    return 'fix_non_final_status';
  }
  if (policyClass === 'connect_eligible') {
    return 'connect_eligible_supervised_only';
  }
  if (policyClass === 'lists_first_only') {
    return 'lists_first_only';
  }
  if (status === 'email_required') {
    return 'skip_requires_email';
  }
  if (guarded) {
    return 'keep_guarded_supervised';
  }
  if (['connect_unavailable', 'manual_review'].includes(status)) {
    return 'keep_guarded_supervised';
  }
  if (surfaceClassification === 'overflow_only_connect') {
    return 'candidate_for_supervised_retest';
  }
  return 'candidate_for_supervised_retest';
}

function buildConnectEvidenceNextActions(rows) {
  const actions = [];
  if (rows.some((row) => !row.finalState)) {
    actions.push('fix_non_final_connect_statuses');
  }
  if (rows.some((row) => row.recommendation === 'candidate_for_supervised_retest')) {
    actions.push('run_supervised_retest_for_candidate_shapes');
  }
  if (rows.some((row) => row.guarded)) {
    actions.push('keep_guarded_shapes_supervised_until_retested');
  }
  if (rows.some((row) => row.status === 'email_required')) {
    actions.push('skip_email_required_prospects');
  }
  actions.push('do_not_run_broad_auto_connect');
  return [...new Set(actions)];
}

function renderConnectEvidenceMarkdown(artifact) {
  const lines = [];
  lines.push('# Connect Evidence Sprint');
  lines.push('');
  lines.push(`- Generated at: \`${artifact.generatedAt}\``);
  lines.push(`- Goal: \`${artifact.goal}\``);
  lines.push(`- Dry safe: \`${artifact.drySafe ? 'yes' : 'no'}\``);
  lines.push(`- Source: \`${artifact.sourceArtifactPath}\``);
  lines.push(`- Total rows: \`${artifact.summary.total}\``);
  lines.push(`- Final states: \`${artifact.summary.finalStates}/${artifact.summary.total}\``);
  lines.push(`- Guarded rows: \`${artifact.summary.guarded}\``);
  lines.push(`- Candidates for supervised retest: \`${artifact.summary.candidatesForSupervisedRetest}\``);
  lines.push('');
  lines.push('| Account | Lead | Status | Policy | Surface | Operator | Next | Recommendation |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const row of artifact.rows || []) {
    lines.push(`| ${escapeMarkdownCell(row.accountName)} | ${escapeMarkdownCell(row.fullName)} | ${escapeMarkdownCell(row.status)} | ${escapeMarkdownCell(row.policyClass || 'none')} | ${escapeMarkdownCell(row.surfaceClassification)} | ${escapeMarkdownCell(row.operatorDisposition || 'unknown')} | ${escapeMarkdownCell(row.nextAction || 'unknown')} | ${escapeMarkdownCell(row.recommendation)} |`);
  }
  lines.push('');
  lines.push('## Next Actions');
  for (const action of artifact.nextActions || []) {
    lines.push(`- \`${action}\``);
  }
  lines.push('');
  lines.push('## Guardrail');
  lines.push('- This artifact is evidence only.');
  lines.push('- Do not send connection requests from this sprint.');
  lines.push('- Do not promote `connect_eligible` without repeated supervised evidence.');
  return `${lines.join('\n').trim()}\n`;
}

function writeConnectEvidenceSprint(options = {}) {
  const artifact = buildConnectEvidenceSprint(options);
  const artifactPath = options.artifactPath || buildConnectEvidenceArtifactPath(new Date(artifact.generatedAt));
  const reportPath = options.reportPath || buildConnectEvidenceReportPath(artifactPath);
  writeJson(artifactPath, {
    ...artifact,
    artifactPath,
    reportPath,
  });
  fs.writeFileSync(reportPath, renderConnectEvidenceMarkdown(artifact), {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(reportPath, 0o600);
  } catch {
    // best effort
  }
  return {
    artifact: {
      ...artifact,
      artifactPath,
      reportPath,
    },
    artifactPath,
    reportPath,
  };
}

function escapeMarkdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

module.exports = {
  CONNECT_EVIDENCE_ARTIFACTS_DIR,
  buildConnectEvidenceSprint,
  deriveConnectEvidenceRecommendation,
  findLatestConnectEvidenceArtifact,
  readLatestConnectEvidenceArtifact,
  renderConnectEvidenceMarkdown,
  writeConnectEvidenceSprint,
};
