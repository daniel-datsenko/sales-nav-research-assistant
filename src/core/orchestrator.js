const path = require('node:path');
const fs = require('node:fs');
const { readJson, writeJson } = require('../lib/json');
const { randomId, stableId } = require('../lib/id');
const { RUN_ARTIFACTS_DIR, RECOVERY_ARTIFACTS_DIR, PRIORITY_ARTIFACTS_DIR } = require('../lib/paths');
const { scoreCandidate } = require('./scoring');
const { scoreCandidateWithPriorityModel } = require('./priority-score');
const { decideCandidateActions } = require('./decision-engine');
const { buildDeterministicListName } = require('./list-naming');
const {
  loadPersonaModes,
  getPersonaModeById,
  expandModeSearchTemplates,
} = require('./persona-modes');
const {
  getCandidateCoverageRoles,
  getMissingCoverageRoles,
  buildCoverageSummary,
} = require('./coverage');
const { toIso } = require('../lib/time');

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function shouldRunDeepProfileReview(assessment, icpConfig) {
  const config = icpConfig.deepProfileReview || {};
  if (!config.enabled || assessment.existing || !assessment.score.eligible) {
    return false;
  }

  const scoreValue = assessment.score.score || 0;
  const minScore = config.minScore ?? 0;
  const maxScore = config.maxScore ?? Number.MAX_SAFE_INTEGER;
  if (scoreValue < minScore || scoreValue > maxScore) {
    return false;
  }

  const allowedRoleFamilies = config.roleFamilies || [];
  if (allowedRoleFamilies.length > 0 && !allowedRoleFamilies.includes(assessment.score.roleFamily)) {
    return false;
  }

  const combinedText = normalizeText([
    assessment.rawCandidate.title,
    assessment.rawCandidate.headline,
    assessment.rawCandidate.summary,
    assessment.evidence?.snippet,
  ].filter(Boolean).join(' '));
  const hintKeywords = config.titleHintKeywords || [];
  const hasTitleHint = hintKeywords.some((keyword) => combinedText.includes(normalizeText(keyword)));
  const hasWeakObservability = (assessment.score.breakdown.observabilitySignals || []).length === 0
    && (assessment.score.breakdown.profileReviewSignals || []).length === 0;

  return hasTitleHint || hasWeakObservability || assessment.decision.recommendation === 'defer';
}

function buildDecisionReason(decisionReason, assessment) {
  if (!assessment.deepReview) {
    return decisionReason;
  }

  if (assessment.deepReview.promoted) {
    return `deep_review_promoted_from_${assessment.deepReview.fastDecisionReason}_to_${decisionReason}`;
  }

  return `${decisionReason}_after_deep_review`;
}

async function createRun({
  repository,
  snapshot,
  driverName,
  icpConfigPath,
  searchTemplatesPath,
  modeId = null,
  personaModesPath = null,
  dryRun = true,
  weeklyCap = 140,
}) {
  const runId = randomId('run');
  const runSpec = {
    runId,
    territoryId: snapshot.territory.territoryId,
    territoryName: snapshot.territory.territoryName,
    snapshotId: snapshot.snapshotId,
    driver: driverName,
    icpConfigPath,
    searchTemplatesPath,
    modeId,
    personaModesPath,
    subsidiaryExpansion: true,
    dryRun,
    weeklyCap,
    sourceType: snapshot.sourceType,
    sourceRef: snapshot.sourceRef,
    runtimeMode: dryRun ? 'bootstrap' : 'steady-state',
    createdAt: toIso(),
  };

  repository.createRun(runSpec);
  const icpConfig = readJson(icpConfigPath);
  repository.attachAccountsToRun(runId, snapshot.accounts, (account) =>
    buildDeterministicListName({
      territoryName: snapshot.territory.territoryName,
      account,
      template: { id: 'default', listSegment: 'territory' },
      icpConfig,
    }));

  repository.saveCheckpoint(runId, {
    runId,
    accountIndex: 0,
    currentAccountKey: null,
    lastTemplateId: null,
    updatedAt: toIso(),
  });

  return runSpec;
}

async function runTerritory({
  repository,
  driver,
  run,
}) {
  const icpConfig = readJson(run.runSpec.icpConfigPath);
  const allSearchTemplates = readJson(run.runSpec.searchTemplatesPath);
  const modeId = run.runSpec.modeId || null;
  const personaModesPath = run.runSpec.personaModesPath || null;
  const personaModes = personaModesPath && fs.existsSync(personaModesPath)
    ? loadPersonaModes(personaModesPath)
    : [];
  const activeMode = modeId
    ? getPersonaModeById(personaModes, modeId)
    : null;
  const searchTemplates = activeMode
    ? expandModeSearchTemplates(activeMode, allSearchTemplates)
    : allSearchTemplates;
  if (activeMode && searchTemplates.length === 0) {
    throw new Error(`Mode ${activeMode.id} resolved to zero search templates.`);
  }
  const runAccounts = repository.getRunAccounts(run.runId);
  const checkpoint = repository.getCheckpoint(run.runId) || {
    accountIndex: 0,
  };
  const priorityModelPath = path.join(PRIORITY_ARTIFACTS_DIR, 'priority_score_v1.json');
  const priorityModel = fs.existsSync(priorityModelPath)
    ? readJson(priorityModelPath)
    : null;
  const runArtifactPath = path.join(RUN_ARTIFACTS_DIR, `${run.runId}.json`);
  const runArtifact = {
    runId: run.runId,
    territoryId: run.territoryId,
    startedAt: run.startedAt,
    driver: run.driver,
    modeId: activeMode?.id || null,
    modeName: activeMode?.name || null,
    priorityModelId: priorityModel?.modelId || null,
    accounts: [],
  };
  let reviewRequiredAccounts = 0;

  await driver.openSession({
    runId: run.runId,
    territoryId: run.territoryId,
    territoryName: run.territoryName,
    dryRun: run.dryRun,
    weeklyCap: run.weeklyCap,
  });
  const health = await driver.checkSessionHealth();
  if (!health.ok) {
    await driver.close().catch(() => {});
    repository.updateRunStatus(run.runId, 'failed', {
      sessionState: health.state,
      reason: 'session_not_ready',
    });
    throw new Error(`Driver session not ready: ${health.state}`);
  }
  await driver.openAccountSearch({
    runId: run.runId,
    territoryId: run.territoryId,
  });

  const orderedAccounts = await driver.enumerateAccounts(runAccounts.map((item) => item.account), {
    runId: run.runId,
  });

  for (let index = checkpoint.accountIndex || 0; index < orderedAccounts.length; index += 1) {
    const account = orderedAccounts[index];
    const accountKey = stableId('account', account.accountId, account.name);
    const listTemplateFallback = searchTemplates[0] || { id: 'default', listSegment: 'territory' };
    const listName = buildDeterministicListName({
      territoryName: run.territoryName,
      account,
      template: listTemplateFallback,
      icpConfig,
    });

    repository.ensureList(run.territoryId, listName);
    repository.updateRunAccount(run.runId, accountKey, {
      status: 'running',
      stage: 'opening_account',
      listName,
      lastError: null,
    });

    repository.saveCheckpoint(run.runId, {
      runId: run.runId,
      accountIndex: index,
      currentAccountKey: accountKey,
      lastTemplateId: null,
      updatedAt: toIso(),
    });

    const accountArtifact = {
      accountKey,
      accountId: account.accountId,
      name: account.name,
      templates: [],
      errors: [],
    };

    try {
      await driver.openAccount(account, { runId: run.runId, accountKey });
      await driver.openPeopleSearch(account, { runId: run.runId, accountKey });

      let accountCandidateCount = 0;
      const acceptedCoverageCandidates = [];

      for (const template of searchTemplates) {
        repository.updateRunAccount(run.runId, accountKey, {
          status: 'running',
          stage: `template:${template.id}`,
          listName,
        });
        repository.saveCheckpoint(run.runId, {
          runId: run.runId,
          accountIndex: index,
          currentAccountKey: accountKey,
          lastTemplateId: template.id,
          updatedAt: toIso(),
        });

        await driver.applySearchTemplate(template, { runId: run.runId, accountKey });
        const rawCandidates = await driver.scrollAndCollectCandidates(account, template, {
          runId: run.runId,
          accountKey,
        });

        const templateArtifact = {
          templateId: template.id,
          templateName: template.name,
          candidateCount: rawCandidates.length,
          deepReviewedCount: 0,
          candidates: [],
        };

        let relevantHits = 0;
        const assessments = [];

        for (const rawCandidate of rawCandidates) {
          const existing = repository.findExistingCandidate(rawCandidate.profileUrl);
          const evidence = await driver.captureEvidence(rawCandidate, {
            runId: run.runId,
            accountKey,
          });
          const score = scoreCandidate({
            ...rawCandidate,
            evidence,
          }, icpConfig);
          const priority = priorityModel
            ? scoreCandidateWithPriorityModel(rawCandidate, priorityModel)
            : null;
          const missingCoverageRoles = getMissingCoverageRoles(
            acceptedCoverageCandidates,
            priorityModel?.buyerGroupRoles || {},
          );
          const coverageRoles = getCandidateCoverageRoles({
            roleFamily: score.roleFamily,
            priorityModel: priority,
          }, priorityModel?.buyerGroupRoles || {});
          const coverageContext = {
            coverageRoles,
            missingCoverageRoles,
            fillsMissingRole: coverageRoles.some((roleId) => missingCoverageRoles.includes(roleId)),
          };
          const decision = decideCandidateActions(
            score,
            icpConfig,
            priority,
            priorityModel?.decisioning || {},
            coverageContext,
          );
          assessments.push({
            rawCandidate,
            existing,
            evidence,
            score,
            decision,
            priority,
            coverageContext,
            deepReview: null,
          });
        }

        const maxDeepReviews = icpConfig.deepProfileReview?.maxCandidatesPerTemplate ?? 0;
        const deepReviewQueue = assessments
          .filter((assessment) => shouldRunDeepProfileReview(assessment, icpConfig))
          .sort((left, right) => (right.score.score || 0) - (left.score.score || 0))
          .slice(0, Math.max(0, maxDeepReviews));

        for (const assessment of deepReviewQueue) {
          try {
            await driver.openCandidate(assessment.rawCandidate, {
              runId: run.runId,
              accountKey,
              templateId: template.id,
            });
            const detailEvidence = await driver.captureEvidence({
              ...assessment.rawCandidate,
              fromListPage: false,
            }, {
              runId: run.runId,
              accountKey,
              templateId: template.id,
              deepProfileReview: true,
            });
            const rescored = scoreCandidate({
              ...assessment.rawCandidate,
              about: detailEvidence.snippet,
              evidence: detailEvidence,
            }, icpConfig);
            assessment.deepReview = {
              triggered: true,
              fastScore: assessment.score.score,
              fastDecisionReason: assessment.decision.reason,
              promoted: false,
            };
            assessment.evidence = detailEvidence;
            assessment.score = rescored;
            assessment.priority = priorityModel
              ? scoreCandidateWithPriorityModel({
                ...assessment.rawCandidate,
                about: detailEvidence.snippet,
                summary: detailEvidence.snippet,
              }, priorityModel)
              : assessment.priority;
            const missingCoverageRoles = getMissingCoverageRoles(
              acceptedCoverageCandidates,
              priorityModel?.buyerGroupRoles || {},
            );
            assessment.coverageContext = {
              coverageRoles: getCandidateCoverageRoles({
                roleFamily: rescored.roleFamily,
                priorityModel: assessment.priority,
              }, priorityModel?.buyerGroupRoles || {}),
              missingCoverageRoles,
              fillsMissingRole: false,
            };
            assessment.coverageContext.fillsMissingRole = assessment.coverageContext.coverageRoles
              .some((roleId) => missingCoverageRoles.includes(roleId));
            const redecision = decideCandidateActions(
              rescored,
              icpConfig,
              assessment.priority,
              priorityModel?.decisioning || {},
              assessment.coverageContext,
            );
            assessment.deepReview.promoted = redecision.recommendation !== assessment.decision.recommendation;
            assessment.decision = redecision;
            templateArtifact.deepReviewedCount += 1;
          } catch (error) {
            assessment.deepReview = {
              triggered: true,
              failed: true,
              message: error.message,
              fastScore: assessment.score.score,
              fastDecisionReason: assessment.decision.reason,
              promoted: false,
            };
            repository.insertRecoveryEvent({
              runId: run.runId,
              accountKey,
              severity: 'warning',
              eventType: 'deep_profile_review_failed',
              details: {
                message: error.message,
                fullName: assessment.rawCandidate.fullName,
                templateId: template.id,
              },
            });
          }
        }

        for (const assessment of assessments) {
          const { rawCandidate, existing, evidence, score, decision } = assessment;
          const candidateRecord = {
            runId: run.runId,
            accountKey,
            fullName: rawCandidate.fullName,
            title: rawCandidate.title,
            headline: rawCandidate.headline,
            company: rawCandidate.company,
            location: rawCandidate.location,
            profileUrl: rawCandidate.profileUrl,
            salesNavigatorUrl: rawCandidate.salesNavigatorUrl,
            roleFamily: score.roleFamily,
            seniority: score.seniority,
            score: score.score,
            scoreBreakdown: {
              ...score.breakdown,
              priorityModel: assessment.priority || null,
              coverageRecommendation: assessment.coverageContext || null,
              reviewMeta: assessment.deepReview || null,
            },
            evidence,
            recommendation: existing ? 'skip' : decision.recommendation,
            listName,
            status: existing ? 'duplicate' : decision.status,
            decisionReason: buildDecisionReason(decision.reason, assessment),
            listSaveStatus: decision.shouldSaveToList && !existing ? 'pending' : null,
          };

          if (candidateRecord.recommendation !== 'skip') {
            relevantHits += 1;
          }

          const candidateId = repository.saveCandidate(candidateRecord);
          accountCandidateCount += 1;

          if (decision.shouldSaveToList && !existing) {
            const listInfo = repository.ensureList(run.territoryId, listName);
            try {
              const listResult = await driver.saveCandidateToList(
                { ...rawCandidate, candidateId, listName },
                listInfo,
                { runId: run.runId, accountKey, dryRun: run.dryRun },
              );
              repository.updateCandidateListSave(candidateId, listResult.status, listResult);
            } catch (error) {
              repository.updateCandidateListSave(candidateId, 'failed', { message: error.message });
              repository.insertRecoveryEvent({
                runId: run.runId,
                accountKey,
                candidateId,
                severity: 'warning',
                eventType: 'list_save_failed',
                details: {
                  message: error.message,
                  candidateId,
                  fullName: rawCandidate.fullName,
                  listName,
                },
              });
            }
          }

          if (decision.shouldQueueForApproval && !existing) {
            repository.createOrUpdateApproval(candidateId, run.runId, 'pending');
          }

          if (!existing && (decision.shouldSaveToList || decision.shouldQueueForApproval)) {
            acceptedCoverageCandidates.push({
              candidateId,
              roleFamily: score.roleFamily,
              score: score.score,
              scoreBreakdown: {
                priorityModel: assessment.priority || null,
              },
            });
          }

          templateArtifact.candidates.push({
            candidateId,
            fullName: rawCandidate.fullName,
            title: rawCandidate.title,
            score: score.score,
            recommendation: candidateRecord.recommendation,
            duplicate: Boolean(existing),
            priorityTier: assessment.priority?.priorityTier || null,
            fillsMissingCoverageRole: assessment.coverageContext?.fillsMissingRole || false,
            deepReviewed: Boolean(assessment.deepReview?.triggered),
          });
        }

        if (relevantHits < (template.minimumRelevantHits || 0)) {
          templateArtifact.insufficientHits = true;
        }

        accountArtifact.templates.push(templateArtifact);
      }

      accountArtifact.coverage = buildCoverageSummary({
        runAccounts: [{
          runId: run.runId,
          accountKey,
          name: account.name,
          listName,
        }],
        candidates: repository.getDashboardCandidates(500).filter((candidate) => candidate.accountKey === accountKey),
        buyerGroupRoles: priorityModel?.buyerGroupRoles || {},
      })[0] || null;

      repository.updateRunAccount(run.runId, accountKey, {
        status: 'completed',
        stage: 'finished',
        listName,
        candidateCount: accountCandidateCount,
      });
    } catch (error) {
      const screenshotPath = path.join(RECOVERY_ARTIFACTS_DIR, `${run.runId}-${accountKey}.png`);
      const recovery = await driver.recoverFromInterruption({
        runId: run.runId,
        accountKey,
        severity: 'error',
        eventType: 'account_processing_failed',
        details: { message: error.message },
        screenshotPath,
      }, {
        runId: run.runId,
        accountKey,
      });

      repository.insertRecoveryEvent({
        runId: run.runId,
        accountKey,
        severity: 'error',
        eventType: 'account_processing_failed',
        details: {
          message: error.message,
          screenshotPath: recovery.screenshotPath || null,
        },
      });

      repository.updateRunAccount(run.runId, accountKey, {
        status: 'review_required',
        stage: 'failed',
        lastError: error.message,
      });
      reviewRequiredAccounts += 1;
      accountArtifact.errors.push({ message: error.message });
    }

    runArtifact.accounts.push(accountArtifact);
    writeJson(runArtifactPath, runArtifact);

    repository.saveCheckpoint(run.runId, {
      runId: run.runId,
      accountIndex: index + 1,
      currentAccountKey: null,
      lastTemplateId: null,
      updatedAt: toIso(),
    });
  }

  repository.updateRunStatus(run.runId, reviewRequiredAccounts > 0 ? 'completed_with_errors' : 'completed', {
    finishedAt: toIso(),
    accountCount: orderedAccounts.length,
    reviewRequiredAccounts,
  });
  await driver.close();

  return {
    runId: run.runId,
    artifactPath: runArtifactPath,
    processedAccounts: orderedAccounts.length,
  };
}

module.exports = {
  createRun,
  runTerritory,
};
