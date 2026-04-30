function renderCoverageReviewMarkdown(coverageArtifact) {
  const accountName = coverageArtifact.accountName || 'Unknown Account';
  const generatedAt = coverageArtifact.generatedAt || new Date().toISOString();
  const coverage = coverageArtifact.coverage || null;
  const candidates = Array.isArray(coverageArtifact.candidates) ? coverageArtifact.candidates : [];

  const direct = candidates
    .filter((candidate) => candidate.coverageBucket === 'direct_observability')
    .sort((left, right) => (right.score || 0) - (left.score || 0));
  const adjacent = candidates
    .filter((candidate) => candidate.coverageBucket === 'technical_adjacent')
    .sort((left, right) => (right.score || 0) - (left.score || 0));
  const noise = candidates
    .filter((candidate) => candidate.coverageBucket === 'likely_noise')
    .sort((left, right) => (right.score || 0) - (left.score || 0));

  const lines = [
    `# Final Coverage Review: ${accountName}`,
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Summary',
    '',
    `- Unique candidates: ${candidates.length}`,
    `- Direct observability: ${direct.length}`,
    `- Technical adjacent: ${adjacent.length}`,
    `- Likely noise: ${noise.length}`,
  ];

  if (coverage) {
    lines.push(`- Coverage: ${coverage.coveredRoleCount}/${coverage.totalRoleCount} buying-group roles covered`);
    lines.push(`- Missing roles: ${coverage.missingRoles?.join(', ') || '(none)'}`);
  }
  if (coverageArtifact.personaCoverage) {
    const persona = coverageArtifact.personaCoverage;
    lines.push(`- Buyer/Operator/User: buyer=${persona.buyer?.count || 0}, operator=${persona.operator?.count || 0}, user=${persona.user?.count || 0}`);
    if (persona.warnings?.length) {
      lines.push(`- Persona warnings: ${persona.warnings.join(', ')}`);
    }
  }

  lines.push('', '## Direct Observability', '');
  if (direct.length === 0) {
    lines.push('No direct observability candidates identified.');
  } else {
    for (const candidate of direct) {
      lines.push(renderCandidateBullet(candidate));
    }
  }

  lines.push('', '## Technical Adjacent', '');
  if (adjacent.length === 0) {
    lines.push('No technical-adjacent candidates identified.');
  } else {
    for (const candidate of adjacent) {
      lines.push(renderCandidateBullet(candidate));
    }
  }

  lines.push('', '## Likely Noise', '');
  if (noise.length === 0) {
    lines.push('No likely-noise candidates identified.');
  } else {
    for (const candidate of noise) {
      lines.push(renderCandidateBullet(candidate));
    }
  }

  lines.push('', '## Notes', '');
  lines.push('- This review is coverage-first, not a narrow buyer-only list.');
  lines.push('- `Direct observability` means platform, infra, architecture, or devops-adjacent enough to matter now.');
  lines.push('- `Technical adjacent` means technically relevant and meeting-worthy, even if not a pure observability owner.');
  lines.push('- `Likely noise` means the current signals are too weak for this workflow.');

  return `${lines.join('\n')}\n`;
}

function renderCandidateBullet(candidate) {
  const topScoreComponents = candidate.topScoreComponents || summarizeTopScoreComponents(candidate.scoreBreakdown);
  const parts = [
    `- **${candidate.fullName || 'Unknown'}**`,
    candidate.title || 'Unknown title',
    candidate.company || null,
    Number.isFinite(candidate.score) ? `score ${candidate.score}` : null,
    topScoreComponents.length ? `top score signals ${formatScoreComponents(topScoreComponents)}` : null,
    candidate.listSelectionReason ? `selection ${candidate.listSelectionReason}` : null,
    candidate.coverageBucket ? `bucket ${candidate.coverageBucket}` : null,
    formatBucketReason(candidate),
    candidate.sweeps?.length ? `found via ${candidate.sweeps.join(', ')}` : null,
  ].filter(Boolean);

  if (candidate.deepReview?.changed) {
    parts.push(`deep review changed bucket to ${candidate.deepReview.reviewedBucket}`);
  } else if (candidate.deepReview) {
    parts.push('deep review confirmed current bucket');
  }

  return parts.join(' | ');
}

function summarizeTopScoreComponents(scoreBreakdown, limit = 3) {
  const components = scoreBreakdown?.components || {};
  return Object.entries(components)
    .filter(([, value]) => Number(value) !== 0)
    .map(([component, value]) => ({ component, value: Number(value) }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, limit);
}

function formatScoreComponents(components) {
  return components
    .map(({ component, value }) => `${value > 0 ? '+' : ''}${value} ${component}`)
    .join(', ');
}

function formatBucketReason(candidate) {
  const details = [
    candidate.roleFamily ? `roleFamily=${candidate.roleFamily}` : null,
    candidate.seniority ? `seniority=${candidate.seniority}` : null,
  ].filter(Boolean);
  return details.length ? `bucket reason ${details.join(', ')}` : null;
}

module.exports = {
  renderCoverageReviewMarkdown,
};
