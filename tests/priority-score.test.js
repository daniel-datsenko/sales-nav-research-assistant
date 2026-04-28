const test = require('node:test');
const assert = require('node:assert/strict');

const { parseBigQueryRows } = require('../src/adapters/gtm-bigquery');
const {
  buildPriorityModelV1,
  scoreCandidateWithPriorityModel,
  classifyPriorityTier,
} = require('../src/core/priority-score');
const config = require('../config/priority-score/default.json');

test('parseBigQueryRows extracts the JSON payload from GTM Data API output', () => {
  const rows = parseBigQueryRows('Returned 1 rows (scanned 0.000 GB)\n[\n  {\"ok\": 1}\n]');
  assert.deepEqual(rows, [{ ok: 1 }]);
});

test('buildPriorityModelV1 ranks strong historical families above weak ones', () => {
  const model = buildPriorityModelV1({
    config,
    winningContactRows: [
      { title_family: 'architecture', won_opportunities: 20, total_won_amount: 5000000 },
      { title_family: 'platform', won_opportunities: 10, total_won_amount: 2500000 },
      { title_family: 'unknown', won_opportunities: 2, total_won_amount: 100000 },
    ],
    hiddenInfluencerRows: [
      { participant_email: 'architect@example.com', contact_title: 'Enterprise Architect' },
      { participant_email: 'platform@example.com', contact_title: 'Platform Engineer' },
    ],
    conversation_intelligenceKeywordRows: [
      {
        top_keywords: [
          { tracker_keyword: 'migration' },
          { tracker_keyword: 'datadog' },
        ],
      },
      {
        top_keywords: [
          { tracker_keyword: 'platform' },
          { tracker_keyword: 'observability' },
        ],
      },
    ],
  });

  assert.equal(model.modelId, 'priority_score_v1');
  assert.equal(model.roleFamilyScores[0].roleFamily, 'architecture');
  assert.ok(model.roleFamilyScores[0].priorityScore >= model.roleFamilyScores[1].priorityScore);
});

test('scoreCandidateWithPriorityModel assigns a tier from the learned role family', () => {
  const model = buildPriorityModelV1({
    config,
    winningContactRows: [
      { title_family: 'architecture', won_opportunities: 12, total_won_amount: 4000000 },
    ],
    hiddenInfluencerRows: [],
    conversation_intelligenceKeywordRows: [],
  });

  const result = scoreCandidateWithPriorityModel({
    title: 'Head of Enterprise Architecture',
    headline: 'Owns platform standards',
  }, model);

  assert.equal(result.matchedRoleFamily, 'architecture');
  assert.equal(result.priorityTier, classifyPriorityTier(result.priorityScore, model.scoreBands));
  assert.ok(result.priorityScore > 0);
});
