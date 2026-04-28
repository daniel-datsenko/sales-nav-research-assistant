const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildConnectEvidenceSprint,
  deriveConnectEvidenceRecommendation,
  renderConnectEvidenceMarkdown,
  writeConnectEvidenceSprint,
} = require('../src/core/connect-evidence');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeAcceptanceArtifact(filePath) {
  writeJson(filePath, {
    results: [
      {
        accountName: 'Example Manual Review Account',
        connectResults: [
          {
            fullName: 'Asko Tamm',
            status: 'sent',
            policyClass: 'manual_review_required',
            surfaceClassification: 'already_covered_pending',
            operatorDisposition: 'completed',
            nextAction: 'monitor',
          },
        ],
      },
      {
        accountName: 'Example Connect Eligible Account',
        connectResults: [
          {
            fullName: 'Philipp Weidinger',
            status: 'already_sent',
            policyClass: 'connect_eligible',
            surfaceClassification: 'already_covered_pending',
            operatorDisposition: 'already_covered',
            nextAction: 'no_action',
          },
        ],
      },
      {
        accountName: 'Armada',
        connectResults: [
          {
            fullName: 'Example Guarded Lead',
            status: 'connect_unavailable',
            policyClass: null,
            surfaceClassification: 'overflow_only_connect',
            operatorDisposition: 'manual_review',
            nextAction: 'review_ui_variant',
          },
        ],
      },
    ],
  });
}

test('deriveConnectEvidenceRecommendation keeps guarded shapes guarded', () => {
  assert.equal(deriveConnectEvidenceRecommendation({
    guarded: true,
    policyClass: 'manual_review_required',
    status: 'sent',
    surfaceClassification: 'already_covered_pending',
    finalState: true,
  }), 'keep_guarded_supervised');

  assert.equal(deriveConnectEvidenceRecommendation({
    guarded: false,
    policyClass: 'connect_eligible',
    status: 'already_sent',
    surfaceClassification: 'already_covered_pending',
    finalState: true,
  }), 'connect_eligible_supervised_only');
});

test('buildConnectEvidenceSprint summarizes acceptance connect evidence', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-evidence-'));
  const acceptancePath = path.join(tempDir, 'acceptance.json');
  makeAcceptanceArtifact(acceptancePath);

  const artifact = buildConnectEvidenceSprint({
    acceptanceArtifactPath: acceptancePath,
    now: new Date('2026-04-24T10:45:00.000Z'),
  });

  assert.equal(artifact.drySafe, true);
  assert.equal(artifact.summary.total, 3);
  assert.equal(artifact.summary.finalStates, 3);
  assert.equal(artifact.summary.guarded, 2);
  assert.equal(artifact.rows.find((row) => row.fullName === 'Example Guarded Lead').recommendation, 'keep_guarded_supervised');
  assert.equal(artifact.rows.find((row) => row.fullName === 'Philipp Weidinger').recommendation, 'connect_eligible_supervised_only');
  assert.equal(artifact.nextActions.includes('keep_guarded_shapes_supervised_until_retested'), true);
});

test('writeConnectEvidenceSprint writes JSON and Markdown reports', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'connect-evidence-write-'));
  const acceptancePath = path.join(tempDir, 'acceptance.json');
  const artifactPath = path.join(tempDir, 'connect-evidence.json');
  makeAcceptanceArtifact(acceptancePath);

  const result = writeConnectEvidenceSprint({
    acceptanceArtifactPath: acceptancePath,
    artifactPath,
  });
  const json = JSON.parse(fs.readFileSync(result.artifactPath, 'utf8'));
  const markdown = fs.readFileSync(result.reportPath, 'utf8');

  assert.equal(json.goal, 'guarded_connect_evidence_sprint');
  assert.match(markdown, /# Connect Evidence Sprint/);
  assert.match(markdown, /Example Guarded Lead/);
  assert.match(markdown, /Do not send connection requests/);
  assert.match(renderConnectEvidenceMarkdown(json), /Next Actions/);
});
