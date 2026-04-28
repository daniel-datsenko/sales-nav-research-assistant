function normalizeLookupValue(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractPublicLinkedInSlug(url) {
  try {
    const parsed = new URL(String(url || ''));
    const match = parsed.pathname.match(/\/in\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]).replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

function isTruncatedPersonName(fullName) {
  const tokens = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length < 2) {
    return false;
  }
  const last = tokens[tokens.length - 1].replace(/\./g, '');
  return /^[a-z]$/i.test(last);
}

function toTitleCaseName(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ');
}

function inferFullNameFromLinkedInSlug(fullName, publicLinkedInUrl) {
  if (!isTruncatedPersonName(fullName)) {
    return null;
  }

  const slug = extractPublicLinkedInSlug(publicLinkedInUrl);
  if (!slug) {
    return null;
  }

  const nameTokens = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const firstName = normalizeLookupValue(nameTokens[0]).replace(/\s+/g, '');
  const lastInitial = normalizeLookupValue(nameTokens[nameTokens.length - 1]).replace(/\s+/g, '');
  if (!firstName || !lastInitial) {
    return null;
  }

  const separatedSignals = normalizeLookupValue(String(slug).replace(/[-_]+/g, ' '))
    .split(/\s+/)
    .filter(Boolean);
  const separatedIndex = separatedSignals.findIndex((token) => token === firstName);
  if (separatedIndex >= 0 && separatedSignals[separatedIndex + 1]?.startsWith(lastInitial)) {
    return toTitleCaseName(`${firstName} ${separatedSignals[separatedIndex + 1]}`);
  }

  const compact = normalizeLookupValue(slug).replace(/\s+/g, '');
  const compactVariants = compact?.startsWith('h') ? [compact, compact.slice(1)] : [compact];
  for (const variant of compactVariants.filter(Boolean)) {
    const firstNameIndex = variant.indexOf(firstName);
    if (firstNameIndex < 0) {
      continue;
    }
    const afterFirstName = variant.slice(firstNameIndex + firstName.length);
    if (afterFirstName.length >= 3 && afterFirstName.startsWith(lastInitial)) {
      return toTitleCaseName(`${firstName} ${afterFirstName}`);
    }
  }

  return null;
}

function uniqueNames(names) {
  const output = [];
  for (const name of names) {
    const trimmed = String(name || '').trim();
    if (!trimmed) {
      continue;
    }
    if (!output.some((existing) => normalizeLookupValue(existing) === normalizeLookupValue(trimmed))) {
      output.push(trimmed);
    }
  }
  return output;
}

function resolveLeadIdentity(lead) {
  const sourceName = String(lead?.fullName || lead?.name || '').trim();
  const publicLinkedInUrl = lead?.publicLinkedInUrl || lead?.profileUrl || '';
  const inferredName = inferFullNameFromLinkedInSlug(sourceName, publicLinkedInUrl);
  const slug = extractPublicLinkedInSlug(publicLinkedInUrl);
  const searchNames = uniqueNames([inferredName, sourceName]);
  const evidence = [];

  if (sourceName) {
    evidence.push('source_name');
  }
  if (slug) {
    evidence.push('linkedin_slug');
  }
  if (isTruncatedPersonName(sourceName)) {
    evidence.push('truncated_name');
  }
  if (inferredName) {
    evidence.push('linkedin_slug_name_fallback');
  }

  const needsManualReview = searchNames.length === 0 || (isTruncatedPersonName(sourceName) && !inferredName);
  const confidence = inferredName ? 0.88 : (sourceName && !needsManualReview ? 0.7 : 0.35);

  return {
    sourceName,
    primaryName: searchNames[0] || sourceName,
    searchNames,
    confidence,
    evidence,
    needsManualReview,
  };
}

function applyIdentityResolution(lead, identityResolution = resolveLeadIdentity(lead)) {
  if (!identityResolution.primaryName || identityResolution.primaryName === (lead.fullName || lead.name)) {
    return {
      ...lead,
      identityResolution,
    };
  }

  return {
    ...lead,
    sourceFullName: identityResolution.sourceName,
    fullName: identityResolution.primaryName,
    nameResolutionEvidence: 'linkedin_slug_name_fallback',
    identityResolution,
  };
}

module.exports = {
  applyIdentityResolution,
  extractPublicLinkedInSlug,
  inferFullNameFromLinkedInSlug,
  isTruncatedPersonName,
  normalizeLookupValue,
  resolveLeadIdentity,
};
