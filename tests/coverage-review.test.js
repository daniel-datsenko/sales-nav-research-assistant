const test = require('node:test');
const assert = require('node:assert/strict');

const { renderCoverageReviewMarkdown } = require('../src/core/coverage-review');

test('renderCoverageReviewMarkdown produces grouped markdown output', () => {
  const markdown = renderCoverageReviewMarkdown({
    accountName: "Example Retail Brand SE",
    generatedAt: '2026-04-21T15:00:00.000Z',
    candidates: [
      {
        fullName: 'Example Operator Zimmer',
        title: 'Head of IT Security & Infrastructure',
        company: "Example Retail Brand SE",
        score: 74,
        sweeps: ['broad-crawl', 'sweep-security'],
        coverageBucket: 'direct_observability',
      },
      {
        fullName: 'Matthias Zielezny',
        title: 'Head Of Software Development',
        company: "Marc O'Polo AG",
        score: 47,
        sweeps: ['sweep-cloud'],
        coverageBucket: 'technical_adjacent',
      },
      {
        fullName: 'Christina Weindl',
        title: 'Group Manager SAP Technology',
        company: "Example Retail Brand SE",
        score: 28,
        sweeps: ['sweep-security'],
        coverageBucket: 'likely_noise',
      },
    ],
    coverage: {
      coveredRoleCount: 3,
      totalRoleCount: 4,
      missingRoles: ['economic_buyer'],
    },
  });

  assert.match(markdown, /# Final Coverage Review: Example Retail Brand SE/);
  assert.match(markdown, /## Direct Observability/);
  assert.match(markdown, /\*\*Example Operator Zimmer\*\*/);
  assert.match(markdown, /## Technical Adjacent/);
  assert.match(markdown, /\*\*Matthias Zielezny\*\*/);
  assert.match(markdown, /## Likely Noise/);
  assert.match(markdown, /\*\*Christina Weindl\*\*/);
});
