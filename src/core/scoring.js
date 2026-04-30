function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function detectRoleFamily(candidate) {
  const text = normalizeText(`${candidate.title} ${candidate.headline || ''}`);

  if (/\b(platform engineering|director of platform engineering|head of cloud|head of platform|cloud technology|platform operations|technology foundation operations)\b/.test(text)) return 'platform_engineering';
  if (/\b(chief information officer|chief technology officer|cio|cto|directeur technique|directeur des systemes d'information|dsi|directeur informatique|director tecnico|director de tecnologia|direttore tecnico|direttore tecnologia)\b/.test(text)) return 'executive_engineering';
  if (/\b(mlops|aiops|dataops|ai platform|data platform|plateforme de donnees|plataforma de datos|datenplattform|data piattaforma|piattaforma dati)\b/.test(text)) return 'data';
  if (/microservices?.*(engineer|architect|developer)|(engineer|architect|developer).*microservices?/.test(text)) return 'platform_engineering';
  if (/\b(system owner|it product owner|product owner it|responsable technique|responsable plateforme|responsable infrastructure|responsabile piattaforma|jefe de plataforma|leiter cloud|leiterin cloud|kompetenzzentrum|competency center|centre of excellence|center of excellence|ccoe|cloud governance|cloud practice)\b/.test(text)) return 'platform_engineering';
  if (/site reliability|\bsre\b|observabilite|observability|osservabilita|monitoring|monitoraggio|monitoreo/.test(text)) return 'site_reliability';
  if (/security architect|security engineer|cyber security|cybersecurity|information security/.test(text)) return 'security';
  if (/data architect|data engineer|data engineering|data platform/.test(text)) return 'data';
  if (/chapter lead.*(tech|technology|platform|ops|operations|infrastructure|monitoring)/.test(text)) return 'platform_engineering';
  if (/operations.*monitoring|monitoring.*operations/.test(text)) return 'platform_engineering';
  if (/head of (cloud|it|it ops|it operations|technology|platform)/.test(text)) return 'platform_engineering';
  if (/\bvp (of )?(technology|it|business it)\b|\bvice president (of )?(technology|it|business it)\b/.test(text)) return 'executive_engineering';
  if (/architect|architecture|architecte|architekt|architetto|arquitecto/.test(text)) return 'platform_engineering';
  if (/platform|plateforme|plattform|piattaforma|plataforma/.test(text)) return 'platform_engineering';
  if (/devops|devsecops/.test(text)) return 'devops';
  if (/infrastructure|cloud ops|cloud operations|infraestructura|infrastruttura|infrastruktur/.test(text)) return 'infrastructure';
  if (/cto|vp engineering|head of engineering|director of engineering/.test(text)) return 'executive_engineering';
  if (/security/.test(text)) return 'security';
  if (/data/.test(text)) return 'data';
  if (/engineering manager/.test(text)) return 'platform_engineering';
  if (/engineer|software|ingenieur|ingenieur|ingeniero|ingegnere/.test(text)) return 'software_engineering';
  return 'unknown';
}

function detectSeniority(candidate) {
  const text = normalizeText(candidate.title);

  if (/\b(chief information officer|chief technology officer|cio|cto|directeur technique|directeur informatique|dsi|director tecnico|direttore tecnico)\b/.test(text)) return 'vp';
  if (/vice president|\bvp\b/.test(text)) return 'vp';
  if (/director|directeur|direktor|direttore/.test(text)) return 'director';
  if (/head|leiter|leiterin|jefe|responsable|responsabili?e/.test(text)) return 'head';
  if (/manager|gestionnaire/.test(text)) return 'manager';
  if (/staff/.test(text)) return 'staff';
  if (/principal/.test(text)) return 'principal';
  if (/lead|tech lead|technical lead/.test(text)) return 'lead';
  if (/senior|senior/.test(text)) return 'senior';
  if (/engineer|architect|developer|ingenieur|ingenieur|ingeniero|ingegnere|architecte|architekt|architetto|arquitecto/.test(text)) return 'individual_contributor';
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
