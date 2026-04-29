function buildResearchEvaluationMetrics({
  fastResolveArtifacts = [],
  background = {},
  companyResolution = {},
} = {}) {
  const fastResolve = summarizeFastResolveMetrics(fastResolveArtifacts);
  const backgroundMetrics = summarizeBackgroundMetrics(background);
  const companyResolutionMetrics = summarizeCompanyResolutionMetrics(companyResolution);
  const riskLevel = classifyResearchRisk({
    fastResolve,
    background: backgroundMetrics,
    companyResolution: companyResolutionMetrics,
  });

  return {
    drySafe: true,
    version: 1,
    fastResolve,
    background: backgroundMetrics,
    companyResolution: companyResolutionMetrics,
    overall: {
      riskLevel,
      indicators: buildRiskIndicators({
        fastResolve,
        background: backgroundMetrics,
        companyResolution: companyResolutionMetrics,
      }),
    },
  };
}

function summarizeFastResolveMetrics(artifacts = []) {
  const leads = artifacts.flatMap((artifact) => Array.isArray(artifact?.leads) ? artifact.leads : []);
  const totalLeads = leads.length;
  const manualReview = countBucket(leads, 'manual_review') || sumBucketCounts(artifacts, 'manual_review');
  const companyAliasRetry = countBucket(leads, 'needs_company_alias_retry') || sumBucketCounts(artifacts, 'needs_company_alias_retry');
  const resolvedSafeToSave = countBucket(leads, 'resolved_safe_to_save') || sumBucketCounts(artifacts, 'resolved_safe_to_save');
  const resolvedViaAliasResearch = countBucket(leads, 'resolved_via_alias_research') || sumBucketCounts(artifacts, 'resolved_via_alias_research');
  const duplicateUrls = countDuplicateUrls(leads);

  return {
    totalArtifacts: artifacts.length,
    totalLeads,
    resolvedSafeToSave,
    resolvedViaAliasResearch,
    manualReview,
    companyAliasRetry,
    duplicateUrls,
    manualReviewRate: ratio(manualReview, totalLeads),
    companyAliasRetryRate: ratio(companyAliasRetry, totalLeads),
    duplicateRate: ratio(duplicateUrls, totalLeads),
  };
}

function summarizeBackgroundMetrics(background = {}) {
  const buckets = background.runnerCoverageByType || {};
  const productive = countRunnerBucket(buckets, 'productive');
  const mixed = countRunnerBucket(buckets, 'mixed');
  const sparse = countRunnerBucket(buckets, 'sparse');
  const noisy = countRunnerBucket(buckets, 'noisy');
  const allSweepsFailed = countRunnerBucket(buckets, 'all_sweeps_failed');
  const timedOut = countRunnerBucket(buckets, 'timed_out');
  const totalClassified = productive + mixed + sparse + noisy;
  const noisyOrSparse = noisy + sparse;

  return {
    productive,
    mixed,
    sparse,
    noisy,
    allSweepsFailed,
    timedOut,
    totalClassified,
    noisyOrSparse,
    noiseRate: ratio(noisyOrSparse, totalClassified),
    allSweepsFailedRate: ratio(allSweepsFailed, Math.max(1, totalClassified + allSweepsFailed)),
  };
}

function summarizeCompanyResolutionMetrics(companyResolution = {}) {
  const total = Number(companyResolution.total || 0);
  const needsManualReview = Number(companyResolution.needsManualReview || 0);
  const failed = Number(companyResolution.failed || 0);
  const multiTarget = Number(companyResolution.multiTarget || 0);
  const aliasDisagreements = needsManualReview + failed + multiTarget;
  return {
    total,
    needsManualReview,
    failed,
    multiTarget,
    aliasDisagreements,
    aliasDisagreementRate: ratio(aliasDisagreements, total),
  };
}

function countBucket(leads, bucket) {
  return leads.filter((lead) => lead.resolutionBucket === bucket).length;
}

function sumBucketCounts(artifacts, bucket) {
  return artifacts.reduce((sum, artifact) => sum + Number(artifact?.bucketCounts?.[bucket] || 0), 0);
}

function countDuplicateUrls(leads) {
  const seen = new Set();
  const duplicates = new Set();
  for (const lead of leads) {
    const url = normalizeUrl(lead.salesNavigatorUrl || lead.profileUrl || '');
    if (!url) {
      continue;
    }
    if (seen.has(url)) {
      duplicates.add(url);
      continue;
    }
    seen.add(url);
  }
  return duplicates.size;
}

function countRunnerBucket(buckets, key) {
  return Number(buckets?.[key]?.count || 0);
}

function normalizeUrl(value) {
  return String(value || '').trim().replace(/\?.*$/, '').replace(/\/$/, '').toLowerCase();
}

function ratio(numerator, denominator) {
  if (!denominator) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

function classifyResearchRisk({ fastResolve, background, companyResolution }) {
  const high = fastResolve.manualReviewRate >= 0.4
    || fastResolve.duplicateRate >= 0.4
    || companyResolution.aliasDisagreementRate >= 0.75
    || background.noiseRate >= 0.75;
  if (high) {
    return 'high';
  }
  const medium = fastResolve.manualReviewRate >= 0.2
    || fastResolve.duplicateRate > 0
    || fastResolve.companyAliasRetryRate >= 0.2
    || companyResolution.aliasDisagreementRate >= 0.3
    || background.noiseRate >= 0.3
    || background.allSweepsFailed > 0;
  return medium ? 'medium' : 'low';
}

function buildRiskIndicators({ fastResolve, background, companyResolution }) {
  const indicators = [];
  if (fastResolve.manualReviewRate >= 0.2) {
    indicators.push('fast_resolve_manual_review_rate');
  }
  if (fastResolve.duplicateRate > 0) {
    indicators.push('duplicate_sales_nav_urls');
  }
  if (fastResolve.companyAliasRetryRate >= 0.2) {
    indicators.push('company_alias_retry_rate');
  }
  if (companyResolution.aliasDisagreementRate >= 0.3) {
    indicators.push('company_alias_disagreement_rate');
  }
  if (background.noiseRate >= 0.3) {
    indicators.push('background_noise_rate');
  }
  if (background.allSweepsFailed > 0) {
    indicators.push('all_sweeps_failed_present');
  }
  return indicators;
}

module.exports = {
  buildResearchEvaluationMetrics,
};
