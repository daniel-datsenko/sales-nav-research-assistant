const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildVoyagerAutoresearchCommandPlan,
  buildVoyagerAutoresearchEvaluation,
  candidateMatchesGold,
  readGoldListFixtures,
  renderVoyagerAutoresearchMarkdown,
  runVoyagerAutoresearchExperiments,
  summarizeCoverageAgainstGold,
  writeVoyagerAutoresearchEvaluation,
} = require('../src/core/autoresearch-voyager');

test('readGoldListFixtures loads CSV fixtures for fixed benchmark accounts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voyager-gold-'));
  fs.writeFileSync(path.join(tempDir, 'gold.csv'), [
    'accountName,fullName,title,salesNavigatorUrl,tier',
    'Fnac Darty,Laurent Anadon,Data & AI Factory Director,https://www.linkedin.com/sales/lead/gold-1,Buyer',
    'Other Account,Noise Person,Unrelated,https://www.linkedin.com/sales/lead/noise,Noise',
  ].join('\n'));

  const rows = readGoldListFixtures(tempDir, { accounts: ['Fnac Darty'] });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].fullName, 'Laurent Anadon');
  assert.equal(rows[0].identityKeys.includes('salesLead:gold-1'), true);
});

test('candidateMatchesGold matches by stable Sales Navigator lead id before name fallback', () => {
  assert.equal(candidateMatchesGold({
    fullName: 'Different Rendered Name',
    salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ACwAA123,NAME_SEARCH,x',
  }, {
    fullName: 'Expected Name',
    salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ACwAA123,NAME_SEARCH,y',
    identityKeys: ['salesLead:ACwAA123'],
  }), true);
});

test('summarizeCoverageAgainstGold computes recall, selected recall, and Voyager telemetry', () => {
  const gold = [
    { accountName: 'Fnac Darty', fullName: 'Gold Buyer', identityKeys: ['name:gold buyer'] },
    { accountName: 'Fnac Darty', fullName: 'Gold Operator', identityKeys: ['name:gold operator'] },
  ];
  const summary = summarizeCoverageAgainstGold({
    accountName: 'Fnac Darty',
    timings: { totalMs: 1000 },
    deepProfilePass: { reviewedCount: 2, skippedCount: 1, failedCount: 0 },
    candidates: [
      { fullName: 'Gold Buyer', coverageBucket: 'direct_observability', selectedForList: true },
        {
          fullName: 'Gold Operator',
          coverageBucket: 'technical_adjacent',
          selectedForList: true,
        deepReview: {
          method: 'voyager',
          scoreBefore: 30,
          scoreAfter: 58,
          bucketBefore: 'technical_adjacent',
          bucketAfter: 'direct_observability',
        },
      },
      { fullName: 'Extra Person', coverageBucket: 'direct_observability', selectedForList: true },
      {
        fullName: 'Unknown Pitch',
        title: 'DevOps Engineer',
        coverageBucket: 'technical_adjacent',
        deepReview: {
          method: 'voyager',
          blockedReason: 'voyager_reviewed_but_pitch_unknown',
        },
      },
    ],
  }, gold);

  assert.equal(summary.recall, 1);
  assert.equal(summary.selectedRecall, 1);
  assert.equal(summary.referencePrecision, 2 / 3);
  assert.equal(summary.falsePositives, 1);
  assert.equal(summary.promotedCount, 1);
  assert.equal(summary.promotedCandidates[0].fullName, 'Gold Operator');
  assert.equal(summary.selectedFalsePositiveCandidates[0].fullName, 'Extra Person');
  assert.equal(summary.voyagerReviewed, 2);
  assert.equal(summary.promotionBlockedCount, 1);
  assert.equal(summary.promotionBlockedCandidates[0].fullName, 'Unknown Pitch');
});

test('buildVoyagerAutoresearchEvaluation recommends Voyager when gold recall improves safely', () => {
  const goldRows = [
    { accountName: 'Fnac Darty', fullName: 'Gold Buyer', identityKeys: ['name:gold buyer'] },
    { accountName: 'Fnac Darty', fullName: 'Gold Operator', identityKeys: ['name:gold operator'] },
  ];
  const baselineArtifacts = [{
    artifact: {
      accountName: 'Fnac Darty',
      timings: { totalMs: 1000 },
      candidates: [
        { fullName: 'Gold Buyer', coverageBucket: 'direct_observability', selectedForList: true },
      ],
    },
  }];
  const voyagerArtifacts = [{
    artifact: {
      accountName: 'Fnac Darty',
      timings: { totalMs: 1300 },
      deepProfilePass: { reviewedCount: 1, skippedCount: 0, failedCount: 0 },
      candidates: [
        { fullName: 'Gold Buyer', coverageBucket: 'direct_observability', selectedForList: true },
        {
          fullName: 'Gold Operator',
          coverageBucket: 'direct_observability',
          selectedForList: true,
          deepReview: {
            method: 'voyager',
            scoreBefore: 31,
            scoreAfter: 60,
            bucketBefore: 'technical_adjacent',
            bucketAfter: 'direct_observability',
          },
        },
      ],
    },
  }];

  const evaluation = buildVoyagerAutoresearchEvaluation({
    accounts: ['Fnac Darty'],
    baselineArtifacts,
    voyagerArtifacts,
    goldRows,
  });

  assert.equal(evaluation.decision, 'recommend_voyager_policy');
  assert.equal(evaluation.totals.baselineRecall, 0.5);
  assert.equal(evaluation.totals.voyagerRecall, 1);
  assert.equal(evaluation.totals.promotedCount, 1);
  assert.deepEqual(evaluation.accountEvaluations[0].newlyMatchedGold.map((row) => row.fullName), ['Gold Operator']);
  assert.deepEqual(evaluation.accountEvaluations[0].newlySelectedGold.map((row) => row.fullName), ['Gold Operator']);
  assert.equal(evaluation.safety.liveMutationAllowed, false);
});

test('Voyager autoresearch command plan is dry-safe and contains both baseline and candidate runs', () => {
  const plan = buildVoyagerAutoresearchCommandPlan(['Fnac Darty'], { deepProfileLimit: 12 });

  assert.equal(plan.length, 2);
  assert.match(plan[0].command, /account-coverage/);
  assert.doesNotMatch(plan.map((step) => step.command).join('\n'), /--live-save|--live-connect|allow-background-connects/);
  assert.match(plan[1].command, /--deep-profile-pass/);
  assert.match(plan[1].command, /--profile-read-method=voyager/);
  assert.match(plan[1].command, /--deep-profile-limit=12/);
});

test('runVoyagerAutoresearchExperiments executes baseline and Voyager arms per account', async () => {
  const calls = [];
  const result = await runVoyagerAutoresearchExperiments({
    accounts: ['Fnac Darty'],
    deepProfileLimit: 9,
    runCoverage: async (input) => {
      calls.push(input);
      return {
        result: {
          accountName: input.accountName,
          candidates: [],
          deepProfilePass: input.deepProfilePass ? { reviewedCount: 1 } : null,
        },
      };
    },
  });

  assert.deepEqual(calls.map((call) => call.experimentArm), ['baseline', 'voyager']);
  assert.equal(calls[0].apiReadPrefetch, true);
  assert.equal(calls[0].deepProfilePass, false);
  assert.equal(calls[1].deepProfilePass, true);
  assert.equal(calls[1].profileReadMethod, 'voyager');
  assert.equal(calls[1].deepProfileLimit, 9);
  assert.equal(result.baselineArtifacts.length, 1);
  assert.equal(result.voyagerArtifacts.length, 1);
});

test('render and write Voyager autoresearch evaluation produce operator-readable artifacts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voyager-autoresearch-'));
  const evaluation = buildVoyagerAutoresearchEvaluation({
    accounts: ['Fnac Darty'],
    baselineArtifacts: [{ artifact: { accountName: 'Fnac Darty', candidates: [] } }],
    voyagerArtifacts: [{ artifact: { accountName: 'Fnac Darty', candidates: [] } }],
    goldRows: [],
  });
  const markdown = renderVoyagerAutoresearchMarkdown(evaluation);
  const written = writeVoyagerAutoresearchEvaluation(evaluation, path.join(tempDir, 'eval.json'));

  assert.match(markdown, /Voyager Autoresearch Evaluation/);
  assert.match(markdown, /Safety Contract/);
  assert.equal(fs.existsSync(written.artifactPath), true);
  assert.equal(fs.existsSync(written.reportPath), true);
});

test('renderVoyagerAutoresearchMarkdown surfaces identity gaps and blocked promotions', () => {
  const evaluation = buildVoyagerAutoresearchEvaluation({
    accounts: ['Fnac Darty'],
    baselineArtifacts: [{ artifact: { accountName: 'Fnac Darty', candidates: [] } }],
    voyagerArtifacts: [{
      artifact: {
        accountName: 'Fnac Darty',
        deepProfilePass: {
          reviewedCount: 1,
          identityMissingCount: 1,
          identityMissingCandidates: [{ fullName: 'Missing Identity', title: 'Directeur Data' }],
        },
        candidates: [{
          fullName: 'Unknown Pitch',
          title: 'DevOps Engineer',
          coverageBucket: 'technical_adjacent',
          deepReview: {
            method: 'voyager',
            blockedReason: 'voyager_reviewed_but_pitch_unknown',
          },
        }],
      },
    }],
    goldRows: [{
      accountName: 'Fnac Darty',
      fullName: 'Laurent Anadon',
      title: 'Data & AI Factory Director',
      tier: 'Buyer',
      identityKeys: ['name:laurent anadon'],
    }],
  });
  const markdown = renderVoyagerAutoresearchMarkdown(evaluation);

  assert.match(markdown, /Voyager identity missing: `1`/);
  assert.match(markdown, /Promotions held for review: Unknown Pitch/);
  assert.match(markdown, /Voyager identity gaps: Missing Identity/);
  assert.match(markdown, /Missed persona families: data_ai_buyer=1/);
  assert.match(markdown, /Improve Sales Nav to Voyager identity mapping/);
});

test('autoresearch-voyager CLI refuses live mutation flags', () => {
  const result = spawnSync(process.execPath, [
    'src/cli.js',
    'autoresearch-voyager',
    '--accounts=Fnac Darty',
    '--live-save',
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /read-only.*refuses live-save/i);
});
