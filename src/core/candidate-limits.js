function normalizeCandidateLimit(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.floor(parsed);
}

function hasCandidateLimit(template = {}) {
  return normalizeCandidateLimit(template.maxCandidates) !== null;
}

function limitCandidatesByTemplate(candidates = [], template = {}) {
  const limit = normalizeCandidateLimit(template.maxCandidates);
  return limit === null ? candidates : candidates.slice(0, limit);
}

module.exports = {
  hasCandidateLimit,
  limitCandidatesByTemplate,
  normalizeCandidateLimit,
};
