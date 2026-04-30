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

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function limitCandidatesByTemplate(candidates = [], template = {}) {
  const limit = normalizeCandidateLimit(template.maxCandidates);
  const titleExcludes = (template.titleExcludes || [])
    .map((value) => normalizeText(value).trim())
    .filter(Boolean);
  const filtered = titleExcludes.length === 0
    ? candidates
    : candidates.filter((candidate) => {
      const text = normalizeText(`${candidate.title || ''} ${candidate.headline || ''}`);
      return !titleExcludes.some((keyword) => text.includes(keyword));
    });
  return limit === null ? filtered : filtered.slice(0, limit);
}

module.exports = {
  hasCandidateLimit,
  limitCandidatesByTemplate,
  normalizeCandidateLimit,
};
