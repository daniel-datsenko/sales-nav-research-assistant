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
  const failedSaveStatuses = new Set(['failed', 'failed_runtime', 'failed_rate_limit', 'failed_network', 'failed_ui_state']);
  return {
    saveAttemptCount: saveResults.length,
    saveSuccessCount: saveResults.filter((item) => ['saved', 'already_saved', 'results_row_fallback_saved'].includes(item.status)).length,
    saveFailureCount: saveResults.filter((item) => failedSaveStatuses.has(item.status)).length,
    connectAttemptCount: connectResults.length,
    connectSentCount: connectResults.filter((item) => item.status === 'sent').length,
    connectFailureCount: connectResults.filter((item) => item.status === 'failed').length,
  };
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
  limitBatchCandidates,
  parseAccountNames,
  renderAccountBatchReportMarkdown,
  renderAccountBatchListNameTemplate,
  deriveConnectOperatorGuidance,
  writeAccountBatchArtifact,
  writeAccountBatchReport,
};
