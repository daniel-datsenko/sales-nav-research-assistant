const path = require('node:path');
const fs = require('node:fs');
const { writeJson } = require('../lib/json');
const { ACCOUNT_BATCH_ARTIFACTS_DIR } = require('../lib/paths');

function parseAccountNames(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.findIndex((entry) => entry.toLowerCase() === item.toLowerCase()) === index);
}

function buildAccountBatchListName(accountName, listPrefix = null) {
  const normalizedAccount = String(accountName || '').trim();
  const normalizedPrefix = String(listPrefix || '').trim();
  if (!normalizedPrefix) {
    return `${normalizedAccount} Coverage`;
  }
  return `${normalizedPrefix} - ${normalizedAccount}`;
}

function formatAccountBatchDuration(startedAt, endedAt) {
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return '0m';
  }
  const totalSeconds = Math.round((end - start) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) {
    return `${seconds}s`;
  }
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatIsoDateTimeParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return {
      date: '',
      startTime: '',
      endTime: '',
    };
  }
  return {
    date: date.toISOString().slice(0, 10),
    startTime: date.toISOString().slice(11, 16).replace(':', ''),
    endTime: date.toISOString().slice(11, 16).replace(':', ''),
  };
}

function renderAccountBatchListNameTemplate(template, {
  accountNames = [],
  startedAt = new Date().toISOString(),
  endedAt = startedAt,
} = {}) {
  const rawTemplate = String(template || '').trim();
  if (!rawTemplate) {
    return null;
  }
  const startParts = formatIsoDateTimeParts(startedAt);
  const endParts = formatIsoDateTimeParts(endedAt);
  const accounts = (accountNames || []).map((name) => String(name || '').trim()).filter(Boolean);
  const accountLabel = accounts.length <= 2
    ? accounts.join(', ')
    : `${accounts.slice(0, 2).join(', ')} +${accounts.length - 2}`;
  return rawTemplate
    .replace(/\{date\}/g, startParts.date)
    .replace(/\{start_time\}/g, startParts.startTime)
    .replace(/\{end_time\}/g, endParts.endTime)
    .replace(/\{duration\}/g, formatAccountBatchDuration(startedAt, endedAt))
    .replace(/\{accounts\}/g, accountLabel)
    .replace(/\s+/g, ' ')
    .trim();
}

function buildAccountBatchArtifactPath(label = 'account-batch') {
  const slug = String(label || 'account-batch')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(ACCOUNT_BATCH_ARTIFACTS_DIR, `${slug}-${timestamp}.json`);
}

function buildAccountBatchReportPath(jsonPath) {
  if (!jsonPath) {
    return buildAccountBatchArtifactPath('account-batch').replace(/\.json$/i, '.md');
  }
  return jsonPath.replace(/\.json$/i, '.md');
}

function writeAccountBatchArtifact(payload, outputPath = null) {
  const targetPath = outputPath || buildAccountBatchArtifactPath(payload?.label || 'account-batch');
  writeJson(targetPath, payload);
  return targetPath;
}

function limitBatchCandidates(candidates, maxCount = null) {
  const numeric = Number(maxCount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Array.isArray(candidates) ? candidates : [];
  }
  return (Array.isArray(candidates) ? candidates : []).slice(0, numeric);
}

function normalizeLocationValue(value) {
  return String(value || '').trim().toLowerCase();
}

function locationMatchesKeyword(location, keyword) {
  const normalizedLocation = normalizeLocationValue(location);
  const normalizedKeyword = normalizeLocationValue(keyword);
  return normalizedLocation.length > 0 && normalizedKeyword.length > 0 && normalizedLocation.includes(normalizedKeyword);
}

function assessCandidateGeoFocus(candidate, geoFocus = null) {
  const location = String(candidate?.location || '').trim();
  const preferredLocationKeywords = Array.isArray(geoFocus?.preferredLocationKeywords)
    ? geoFocus.preferredLocationKeywords
    : [];
  const excludedLocationKeywords = Array.isArray(geoFocus?.excludedLocationKeywords)
    ? geoFocus.excludedLocationKeywords
    : [];
  const matchedPreferredKeywords = preferredLocationKeywords.filter((keyword) => locationMatchesKeyword(location, keyword));
  const matchedExcludedKeywords = excludedLocationKeywords.filter((keyword) => locationMatchesKeyword(location, keyword));
  const strictInclude = Boolean(geoFocus?.strictInclude);
  const preferred = matchedPreferredKeywords.length > 0;
  const excluded = matchedExcludedKeywords.length > 0;
  const eligible = !excluded && (!strictInclude || preferred);

  return {
    location,
    preferred,
    excluded,
    eligible,
    strictInclude,
    matchedPreferredKeywords,
    matchedExcludedKeywords,
  };
}

function applyGeoFocusToCandidates(candidates, geoFocus = null) {
  const allCandidates = Array.isArray(candidates) ? candidates : [];
  const hasGeoRules = Boolean(geoFocus)
    && (
      (Array.isArray(geoFocus.preferredLocationKeywords) && geoFocus.preferredLocationKeywords.length > 0)
      || (Array.isArray(geoFocus.excludedLocationKeywords) && geoFocus.excludedLocationKeywords.length > 0)
    );

  if (!hasGeoRules) {
    return allCandidates;
  }

  return allCandidates
    .map((candidate) => ({
      ...candidate,
      geoFocus: assessCandidateGeoFocus(candidate, geoFocus),
    }))
    .filter((candidate) => candidate.geoFocus.eligible)
    .sort((left, right) => {
      const leftPreferred = left.geoFocus?.preferred ? 1 : 0;
      const rightPreferred = right.geoFocus?.preferred ? 1 : 0;
      return rightPreferred - leftPreferred;
    });
}

function summarizeBatchResult(result) {
  const saveResults = result.saveResults
    || (result.status ? [{ fullName: result.fullName || 'Unknown lead', status: result.status, note: result.note || null }] : []);
  const connectResults = result.connectResults || [];
  const successSaveStatuses = new Set(['saved', 'already_saved', 'results_row_fallback_saved', 'saved_and_verified', 'already_saved_verified']);
  const failedSaveStatuses = new Set(['failed', 'failed_runtime', 'failed_rate_limit', 'failed_network', 'failed_ui_state', 'missing_after_save', 'wrong_identity_detected']);
  return {
    saveAttemptCount: saveResults.length,
    saveSuccessCount: saveResults.filter((item) => successSaveStatuses.has(item.status)).length,
    saveFailureCount: saveResults.filter((item) => failedSaveStatuses.has(item.status) || failedSaveStatuses.has(item.failureCategory)).length,
    connectAttemptCount: connectResults.length,
    connectSentCount: connectResults.filter((item) => item.status === 'sent').length,
    connectFailureCount: connectResults.filter((item) => item.status === 'failed').length,
  };
}

function deriveSdrCoverageStatus({
  attemptedSweepsCount = 0,
  failedSweepsCount = 0,
  resolutionStatus = null,
} = {}) {
  if (resolutionStatus === 'needs_company_resolution' || resolutionStatus === 'needs_company_scope_review') {
    return 'needs_company_scope_review';
  }
  const attempted = Number(attemptedSweepsCount || 0);
  const failed = Number(failedSweepsCount || 0);
  if (attempted > 0 && failed >= attempted) {
    return 'needs_company_scope_review';
  }
  if (attempted > 0 && failed / attempted >= 0.3) {
    return 'needs_company_scope_review';
  }
  if (failed > 0) {
    return 'completed_with_sweep_warnings';
  }
  return 'completed';
}

function summarizeSdrResearchOutcome(result = {}) {
  const saveResults = result.saveResults
    || (result.status ? [{ fullName: result.fullName || 'Unknown lead', status: result.status, note: result.note || null }] : []);
  const verifiedSaveStatuses = new Set(['saved_and_verified', 'already_saved_verified']);
  const clickedUnverifiedStatuses = new Set(['saved', 'already_saved', 'results_row_fallback_saved', 'save_clicked_unverified']);
  const failedSaveStatuses = new Set(['failed', 'failed_runtime', 'failed_rate_limit', 'failed_network', 'failed_ui_state', 'missing_after_save', 'wrong_identity_detected']);
  const manualReviewStatuses = new Set(['manual_review', 'save_ui_manual_review']);
  const coverageStatus = result.coverageStatus || deriveSdrCoverageStatus({
    attemptedSweepsCount: result.attemptedSweepsCount,
    failedSweepsCount: result.failedSweepsCount,
    resolutionStatus: result.resolutionStatus,
  });
  const summary = {
    found: Number(result.candidateCount || 0),
    selectedForList: Number(result.listCandidateCount || 0),
    selectedForLiveSave: Number(result.selectedForListSaveCount || 0),
    savedVerified: saveResults.filter((item) => verifiedSaveStatuses.has(item.status)).length,
    saveClickedUnverified: saveResults.filter((item) => clickedUnverifiedStatuses.has(item.status)).length,
    failedSave: saveResults.filter((item) => failedSaveStatuses.has(item.status) || failedSaveStatuses.has(item.failureCategory)).length,
    manualReview: saveResults.filter((item) => manualReviewStatuses.has(item.status)).length,
    strongButNotAutoSaved: Number(result.strongButNotAutoSavedCount || 0),
    outOfNetwork: Number(result.outOfNetworkCount ?? result.strongButNotAutoSavedCount ?? 0),
    notAutoSaved: Math.max(0, Number(result.candidateCount || 0) - Number(result.listCandidateCount || 0)),
    relativeRankFallbackApplied: Boolean(result.relativeRankFallbackApplied),
    attemptedSweeps: Number(result.attemptedSweepsCount || 0),
    failedSweeps: Number(result.failedSweepsCount || 0),
    coverageStatus,
    nextActions: [],
  };
  if (summary.coverageStatus === 'needs_company_scope_review') {
    summary.nextActions.push('retry_company_scope');
  }
  if (summary.strongButNotAutoSaved > 0) {
    summary.nextActions.push('review_strong_not_saved');
  }
  if (summary.saveClickedUnverified > 0) {
    summary.nextActions.push('verify_list_membership');
  }
  if (summary.failedSave > 0 || summary.manualReview > 0) {
    summary.nextActions.push('manual_review');
  }
  if (summary.relativeRankFallbackApplied) {
    summary.nextActions.push('review_relative_rank_candidates');
  }
  if (summary.nextActions.length === 0) {
    summary.nextActions.push('no_action');
  }
  return summary;
}

function isSaveDiscrepancy(item = {}) {
  return new Set([
    'save_clicked_unverified',
    'missing_after_save',
    'wrong_identity_detected',
    'save_unverified_unknown',
  ]).has(item.status) || new Set([
    'missing_after_save',
    'wrong_identity_detected',
    'save_readback_unavailable',
    'save_unverified',
  ]).has(item.failureCategory);
}

function formatScoreContext(item = {}) {
  const parts = [];
  if (item.score !== undefined && item.score !== null) {
    parts.push(`score=${item.score}`);
  }
  if (item.coverageBucket) {
    parts.push(`bucket=${item.coverageBucket}`);
  }
  if (item.personaTier) {
    parts.push(`tier=${item.personaTier}`);
  }
  const components = item.topScoreComponents
    || summarizeTopScoreComponents(item.scoreBreakdown);
  if (components.length > 0) {
    parts.push(`score_breakdown=${components.map((entry) => `${entry.component}:${entry.value}`).join(',')}`);
  }
  return parts;
}

function summarizeTopScoreComponents(scoreBreakdown, limit = 3) {
  const components = scoreBreakdown?.components || {};
  return Object.entries(components)
    .filter(([, value]) => Number(value) !== 0)
    .map(([component, value]) => ({ component, value: Number(value) }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, limit);
}

function deriveConnectOperatorGuidance(item = {}) {
  const status = String(item.status || '').trim().toLowerCase();
  const note = String(item.note || '').trim().toLowerCase();
  const policyClass = String(item.policyClass || '').trim().toLowerCase();
  const surfaceClassification = String(item.surfaceClassification || '').trim().toLowerCase();

  if (status === 'skipped_by_policy') {
    if (policyClass === 'manual_review_required') {
      return {
        disposition: 'manual_review',
        action: 'review_before_connect',
      };
    }
    return {
      disposition: 'blocked_by_policy',
      action: 'no_action',
    };
  }

  if (status === 'sent') {
    return {
      disposition: 'completed',
      action: 'monitor',
    };
  }

  if (status === 'already_sent' || status === 'already_connected') {
    return {
      disposition: 'already_covered',
      action: 'no_action',
    };
  }

  if (status === 'email_required') {
    return {
      disposition: 'blocked_by_policy',
      action: 'skip_requires_email',
    };
  }

  if (status === 'manual_review') {
    return {
      disposition: 'manual_review',
      action: 'review_ui_variant',
    };
  }

  if (status === 'connect_unavailable') {
    if (/lead-page fallback|row actions|actions menu|menu_empty|button not found|unavailable after open/.test(note)) {
      return {
        disposition: 'manual_review',
        action: 'review_ui_variant',
      };
    }

    return {
      disposition: 'retry_later',
      action: 'retry_after_hardening',
    };
  }

  if (surfaceClassification === 'overflow_only_connect' || surfaceClassification === 'manual_review_spinner_shell') {
    return {
      disposition: 'manual_review',
      action: 'review_ui_variant',
    };
  }

  if (status === 'failed') {
    return {
      disposition: 'retry_later',
      action: 'retry_after_review',
    };
  }

  return {
    disposition: 'unknown',
    action: 'inspect_artifact',
  };
}

function renderAccountBatchReportMarkdown(payload) {
  const lines = [];
  lines.push(`# Account Batch Report`);
  lines.push('');
  lines.push(`- Generated at: \`${payload.generatedAt}\``);
  lines.push(`- Driver: \`${payload.driver}\``);
  lines.push(`- Live save: \`${payload.liveSave ? 'yes' : 'no'}\``);
  lines.push(`- Live connect: \`${payload.liveConnect ? 'yes' : 'no'}\``);
  if (payload.consolidatedListName) {
    lines.push(`- Consolidated list: \`${payload.consolidatedListName}\``);
  }
  if (payload.listNameTemplate) {
    lines.push(`- List name template: \`${payload.listNameTemplate}\``);
  }
  if (payload.maxListSavesPerAccount) {
    lines.push(`- Max list saves per account: \`${payload.maxListSavesPerAccount}\``);
  }
  lines.push(`- Accounts: \`${(payload.accountNames || []).join(', ')}\``);
  lines.push('');

  for (const result of payload.results || []) {
    const summary = summarizeBatchResult(result);
    const sdrSummary = result.sdrSummary || summarizeSdrResearchOutcome(result);
    lines.push(`## ${result.accountName}`);
    lines.push(`- List: \`${result.listName}\``);
    if (result.coverageArtifactPath) {
      lines.push(`- Coverage artifact: \`${result.coverageArtifactPath}\``);
    }
    if (result.candidateCount !== undefined) {
      lines.push(`- Candidates: \`${result.candidateCount}\``);
    }
    if (result.listCandidateCount !== undefined) {
      lines.push(`- List candidates: \`${result.listCandidateCount}\``);
    }
    if (result.selectedForListSaveCount !== undefined) {
      lines.push(`- Selected for live save: \`${result.selectedForListSaveCount}\``);
    }
    lines.push(`- SDR summary: found=\`${sdrSummary.found}\` | selected=\`${sdrSummary.selectedForList}\` | saved_verified=\`${sdrSummary.savedVerified}\` | save_unverified=\`${sdrSummary.saveClickedUnverified}\` | failed_save=\`${sdrSummary.failedSave}\` | manual_review=\`${sdrSummary.manualReview}\` | out_of_network=\`${sdrSummary.outOfNetwork}\` | failed_sweeps=\`${sdrSummary.failedSweeps}\` | not_auto_saved=\`${sdrSummary.notAutoSaved}\``);
    lines.push(`- Coverage status: \`${sdrSummary.coverageStatus}\``);
    if (result.apiReadPrefetch) {
      lines.push(`- API read prefetch: \`${result.apiReadPrefetch.companyResolution?.status || result.apiReadPrefetch.status}\` | leads=\`${result.apiReadPrefetch.leadCandidateCount || 0}\` | ui_sweeps_skipped=\`${result.apiReadPrefetch.uiSweepsSkipped ? 'yes' : 'no'}\``);
      if (result.apiReadPrefetch.companyResolution?.source === 'enterprise_entity_resolver') {
        lines.push(`- Enterprise entity resolver: \`used\` | report=\`${result.apiReadPrefetch.companyResolution.reportPath || 'runtime/artifacts/company-resolution/enterprise-entities'}\``);
      }
      const entityPriorities = (result.apiReadPrefetch.companyResolution?.selectedTargets || [])
        .map((target) => `${target.name || target.linkedinName || 'unknown'}=${target.entityPriority || 'related_entity'}`)
        .slice(0, 5);
      if (entityPriorities.length > 0) {
        lines.push(`- Entity priority: \`${entityPriorities.join(', ')}\``);
      }
    }
    if (result.companyScope?.warning) {
      lines.push(`- Company scope warning: \`${result.companyScope.warning}\` (${(result.companyScope.unrelatedCompanies || []).join(', ') || 'unknown company'})`);
    }
    if (result.relativeRankFallbackApplied) {
      lines.push('- Manual review fallback: `top candidates shown because no candidate passed the normal save threshold`');
    }
    if (sdrSummary.attemptedSweeps > 0) {
      lines.push(`- Sweeps: \`${sdrSummary.attemptedSweeps - sdrSummary.failedSweeps}/${sdrSummary.attemptedSweeps} succeeded\``);
    }
    lines.push(`- Next action: \`${(sdrSummary.nextActions || ['no_action']).join(', ')}\``);
    lines.push(`- Save success: \`${summary.saveSuccessCount}\``);
    lines.push(`- Save failed: \`${summary.saveFailureCount}\``);
    if (summary.connectAttemptCount > 0) {
      if (result.selectionSource) {
        lines.push(`- Connect source: \`${result.selectionSource}\``);
      }
      if (result.selectedForConnectCount !== undefined) {
        lines.push(`- Selected for connect: \`${result.selectedForConnectCount}\``);
      }
      lines.push(`- Connect sent: \`${summary.connectSentCount}\``);
      lines.push(`- Connect failed: \`${summary.connectFailureCount}\``);
    }
    lines.push('');

    const notableSaveResults = (result.saveResults
      || (result.status ? [{ fullName: result.fullName || 'Unknown lead', status: result.status, note: result.note || null, selectionMode: result.selectionMode || null, title: result.title || null }] : []))
      .slice(0, 10);
    if (notableSaveResults.length > 0) {
      lines.push(`### Save Results`);
      for (const item of notableSaveResults) {
        const noteParts = [];
        if (item.title) {
          noteParts.push(item.title);
        }
        if (item.selectionMode) {
          noteParts.push(item.selectionMode);
        }
        if (item.note) {
          noteParts.push(item.note);
        }
        noteParts.push(...formatScoreContext(item));
        const note = noteParts.length > 0 ? ` - ${noteParts.join(' | ')}` : '';
        lines.push(`- ${item.fullName}: \`${item.status}\`${note}`);
      }
      lines.push('');
    }

    const notableConnectResults = (result.connectResults || []).slice(0, 10);
    if (notableConnectResults.length > 0) {
      lines.push(`### Connect Results`);
      for (const item of notableConnectResults) {
        const noteParts = [];
        const operatorGuidance = deriveConnectOperatorGuidance(item);
        if (item.note) {
          noteParts.push(item.note);
        }
        if (item.policyClass) {
          noteParts.push(`policy=${item.policyClass}`);
        }
        if (item.surfaceClassification) {
          noteParts.push(`surface=${item.surfaceClassification}`);
        }
        if (item.connectPath) {
          noteParts.push(`path=${item.connectPath}`);
        }
        if (item.fallbackTriggeredBy) {
          noteParts.push(`triggered_by=${item.fallbackTriggeredBy}`);
        }
        if (operatorGuidance.disposition !== 'unknown') {
          noteParts.push(`operator=${operatorGuidance.disposition}`);
        }
        if (operatorGuidance.action !== 'inspect_artifact') {
          noteParts.push(`next=${operatorGuidance.action}`);
        }
        const note = noteParts.length > 0 ? ` - ${noteParts.join(' | ')}` : '';
        lines.push(`- ${item.fullName}: \`${item.status}\`${note}`);
      }
      lines.push('');
    }

    const saveDiscrepancies = (result.saveResults || []).filter(isSaveDiscrepancy).slice(0, 10);
    if (saveDiscrepancies.length > 0) {
      lines.push(`### Save Discrepancies`);
      for (const item of saveDiscrepancies) {
        const noteParts = [];
        if (item.title) {
          noteParts.push(item.title);
        }
        if (item.failureCategory) {
          noteParts.push(`reason=${item.failureCategory}`);
        }
        if (item.verificationStatus) {
          noteParts.push(`verification=${item.verificationStatus}`);
        }
        if (item.nextAction) {
          noteParts.push(`next=${item.nextAction}`);
        }
        if (item.note) {
          noteParts.push(item.note);
        }
        noteParts.push(...formatScoreContext(item));
        const note = noteParts.length > 0 ? ` - ${noteParts.join(' | ')}` : '';
        lines.push(`- ${item.fullName}: \`${item.status}\`${note}`);
      }
      lines.push('');
    }

    const strongNotSaved = (result.strongButNotAutoSavedCandidates || []).slice(0, 10);
    if (strongNotSaved.length > 0) {
      lines.push(`### Strong but not auto-saved`);
      for (const item of strongNotSaved) {
        const noteParts = [];
        if (item.title) {
          noteParts.push(item.title);
        }
        if (item.reason) {
          noteParts.push(`reason=${item.reason}`);
        }
        if (item.nextAction) {
          noteParts.push(`next=${item.nextAction}`);
        }
        noteParts.push(...formatScoreContext(item));
        const note = noteParts.length > 0 ? ` - ${noteParts.join(' | ')}` : '';
        lines.push(`- ${item.fullName}: \`${item.coverageBucket || 'unknown'}\`${note}`);
      }
      lines.push('');
    }

    const notSavedReasons = result.notSavedReasonCounts || {};
    if (Object.keys(notSavedReasons).length > 0) {
      lines.push(`### Not Saved Reasons`);
      for (const [reason, count] of Object.entries(notSavedReasons)) {
        lines.push(`- ${reason}: \`${count}\``);
      }
      lines.push('');
    }

    const notSavedExamples = (result.notSavedExamples || []).slice(0, 10);
    if (notSavedExamples.length > 0) {
      lines.push(`### Not Saved Examples`);
      for (const item of notSavedExamples) {
        const noteParts = [];
        if (item.title) {
          noteParts.push(item.title);
        }
        if (item.reason) {
          noteParts.push(`reason=${item.reason}`);
        }
        if (item.nextAction) {
          noteParts.push(`next=${item.nextAction}`);
        }
        noteParts.push(...formatScoreContext(item));
        const note = noteParts.length > 0 ? ` - ${noteParts.join(' | ')}` : '';
        lines.push(`- ${item.fullName}: \`${item.coverageBucket || 'unknown'}\`${note}`);
      }
      lines.push('');
    }

    const reviewCandidates = (result.manualReviewCandidates || []).slice(0, 10);
    if (reviewCandidates.length > 0) {
      lines.push(`### Review Before Saving`);
      for (const item of reviewCandidates) {
        const noteParts = [];
        if (item.title) {
          noteParts.push(item.title);
        }
        if (item.reason) {
          noteParts.push(`reason=${item.reason}`);
        }
        if (item.nextAction) {
          noteParts.push(`next=${item.nextAction}`);
        }
        noteParts.push(...formatScoreContext(item));
        const note = noteParts.length > 0 ? ` - ${noteParts.join(' | ')}` : '';
        lines.push(`- ${item.fullName}: \`${item.coverageBucket || 'unknown'}\`${note}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

function writeAccountBatchReport(payload, reportPath = null) {
  const targetPath = reportPath || buildAccountBatchReportPath(payload?.artifactPath || null);
  fs.writeFileSync(targetPath, renderAccountBatchReportMarkdown(payload), {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    fs.chmodSync(targetPath, 0o600);
  } catch {
    // best effort
  }
  return targetPath;
}

module.exports = {
  applyGeoFocusToCandidates,
  assessCandidateGeoFocus,
  buildAccountBatchArtifactPath,
  buildAccountBatchReportPath,
  buildAccountBatchListName,
  formatAccountBatchDuration,
  deriveSdrCoverageStatus,
  limitBatchCandidates,
  parseAccountNames,
  renderAccountBatchReportMarkdown,
  renderAccountBatchListNameTemplate,
  deriveConnectOperatorGuidance,
  summarizeSdrResearchOutcome,
  writeAccountBatchArtifact,
  writeAccountBatchReport,
};
