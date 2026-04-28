function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function detectRoleFamily(candidate) {
  const text = normalizeText(`${candidate.title} ${candidate.headline || ''}`);

  if (/site reliability|sre/.test(text)) return 'site_reliability';
  if (/system owner|it product owner/.test(text)) return 'platform_engineering';
  if (/security architect|security engineer|cyber security|cybersecurity|information security/.test(text)) return 'security';
  if (/data architect|data engineer|data engineering|data platform/.test(text)) return 'data';
  if (/chapter lead.*(tech|technology|platform|ops|operations|infrastructure|monitoring)/.test(text)) return 'platform_engineering';
  if (/operations.*monitoring|monitoring.*operations/.test(text)) return 'platform_engineering';
  if (/head of (cloud|it|it ops|it operations|technology|platform)/.test(text)) return 'platform_engineering';
  if (/\bvp (of )?(technology|it|business it)\b|\bvice president (of )?(technology|it|business it)\b/.test(text)) return 'executive_engineering';
  if (/architect|architecture/.test(text)) return 'platform_engineering';
  if (/platform/.test(text)) return 'platform_engineering';
  if (/devops/.test(text)) return 'devops';
  if (/infrastructure|cloud ops|cloud operations/.test(text)) return 'infrastructure';
  if (/cto|vp engineering|head of engineering|director of engineering/.test(text)) return 'executive_engineering';
  if (/security/.test(text)) return 'security';
  if (/data/.test(text)) return 'data';
  if (/engineering manager/.test(text)) return 'platform_engineering';
  if (/engineer|software/.test(text)) return 'software_engineering';
  return 'unknown';
}

function detectSeniority(candidate) {
  const text = normalizeText(candidate.title);

  if (/vice president|\bvp\b/.test(text)) return 'vp';
  if (/director/.test(text)) return 'director';
  if (/head/.test(text)) return 'head';
  if (/manager/.test(text)) return 'manager';
  if (/staff/.test(text)) return 'staff';
  if (/principal/.test(text)) return 'principal';
  if (/lead/.test(text)) return 'lead';
  if (/senior/.test(text)) return 'senior';
  if (/engineer|architect|developer/.test(text)) return 'individual_contributor';
  return 'unknown';
}

function countMatches(text, keywords) {
  const normalized = normalizeText(text);
  return keywords.filter((keyword) => {
    const normalizedKeyword = normalizeText(keyword).trim();
    if (!normalizedKeyword) {
      return false;
    }

    if (/^[a-z0-9 ]+$/i.test(normalizedKeyword)) {
      const parts = normalizedKeyword.split(/\s+/).filter(Boolean);
      const escaped = parts
        .map((part, index) => {
          const safe = part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return index === parts.length - 1 && parts.length === 1 ? `${safe}[a-z0-9]*` : safe;
        })
        .join('\\s+');
      const matcher = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
      return matcher.test(normalized);
    }

    return normalized.includes(normalizedKeyword);
  });
}

function scoreCandidate(candidate, icpConfig) {
  const combinedText = [
    candidate.title,
    candidate.headline,
    candidate.summary,
    candidate.about,
    candidate.evidence?.snippet,
  ].filter(Boolean).join(' ');

  const excludedTitles = countMatches(candidate.title, icpConfig.titleExcludeKeywords || []);
  const includeTitles = countMatches(candidate.title, icpConfig.titleIncludeKeywords || []);
  const observabilitySignals = countMatches(combinedText, icpConfig.observabilitySignals || []);
  const championSignals = countMatches(combinedText, icpConfig.technicalChampionSignals || []);
  const profileReviewSignals = countMatches(combinedText, icpConfig.profileReviewSignals || []);
  const roleFamily = detectRoleFamily(candidate);
  const seniority = detectSeniority(candidate);

  const breakdown = {
    excludedTitles,
    includeTitles,
    observabilitySignals,
    championSignals,
    profileReviewSignals,
    roleFamily,
    seniority,
    components: {},
  };

  if (excludedTitles.length > 0) {
    breakdown.components.exclusionPenalty = -100;
    return {
      score: 0,
      roleFamily,
      seniority,
      breakdown,
      eligible: false,
    };
  }

  const roleScore = icpConfig.roleFamilyWeights?.[roleFamily] || 0;
  const seniorityScore = icpConfig.seniorityWeights?.[seniority] || 0;
  const includeScore = Math.min(includeTitles.length * 8, 24);
  const observabilityScore = Math.min(observabilitySignals.length * 6, 24);
  const championScore = Math.min(championSignals.length * 7, 21);
  const profileReviewScore = Math.min(profileReviewSignals.length * 4, 20);

  breakdown.components.roleScore = roleScore;
  breakdown.components.seniorityScore = seniorityScore;
  breakdown.components.includeScore = includeScore;
  breakdown.components.observabilityScore = observabilityScore;
  breakdown.components.championScore = championScore;
  breakdown.components.profileReviewScore = profileReviewScore;

  const score = roleScore + seniorityScore + includeScore + observabilityScore + championScore + profileReviewScore;

  return {
    score,
    roleFamily,
    seniority,
    breakdown,
    eligible: true,
  };
}

module.exports = {
  scoreCandidate,
  detectRoleFamily,
  detectSeniority,
};
