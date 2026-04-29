#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { parseCliArgs, getString, getBoolean } = require('./lib/args');
const { readJson, writeJson } = require('./lib/json');
const { resolveProjectPath } = require('./lib/paths');
const { createLogger } = require('./lib/logger');
const { buildDriverOptions } = require('./lib/driver-options');
const { cleanupRuntimeArtifacts } = require('./lib/runtime-cleanup');
const { analyzeLiveReadiness } = require('./lib/live-readiness');
const { GTMBigQueryAdapter } = require('./adapters/gtm-bigquery');
const { ReadOnlySalesforceAdapter } = require('./adapters/salesforce-readonly');
const { syncTerritory } = require('./core/territory-sync');
const { createRun, runTerritory } = require('./core/orchestrator');
const { scoreCandidate } = require('./core/scoring');
const {
  buildPriorityModelV1,
  loadPriorityScoreConfig,
  scoreCandidateWithPriorityModel,
  writePriorityModelArtifact,
} = require('./core/priority-score');
const {
  loadAccountCoverageConfig,
  buildSweepTemplates,
  loadPriorityModel,
  consolidateCoverageCandidates,
  runAccountCoverageWorkflow,
  selectCoverageListCandidates,
  selectDeepReviewCandidates,
  classifyReviewedCoverageBucket,
  applyDeepReviewResult,
  summarizeCoverageBuckets,
  writeAccountCoverageArtifact,
  loadExistingAccountCoverageArtifact,
} = require('./core/account-coverage');
const { renderCoverageReviewMarkdown } = require('./core/coverage-review');
const {
  loadBackgroundRunnerConfig,
  buildBackgroundRunnerDefaults,
  normalizeTerritoryAccountRows,
  buildBackgroundRunnerSpec,
  writeBackgroundRunnerArtifact,
} = require('./core/background-territory-runner');
const {
  buildBackgroundEnvironmentBlockArtifact,
  buildBackgroundLoopArtifactPath,
  classifyBackgroundEnvironmentHealth,
  defaultRunnerCheckpointPath,
  defaultVariationRegistryPath,
  executeBackgroundListMaintenanceLoop,
  isCoverageArtifactFresh,
  loadBackgroundRunnerArtifact,
  loadBackgroundRunnerCheckpoint,
  loadVariationRegistry,
  readLatestBackgroundLoopReport,
  selectBackgroundMaintenanceBatch,
  writeBackgroundLoopReport,
  writeBackgroundRunnerCheckpoint,
  writeVariationRegistry,
} = require('./core/background-list-maintenance');
const {
  applyGeoFocusToCandidates,
  buildAccountBatchListName,
  limitBatchCandidates,
  parseAccountNames,
  renderAccountBatchListNameTemplate,
  writeAccountBatchArtifact,
  writeAccountBatchReport,
} = require('./core/account-batch');
const {
  fastResolveLeads,
  buildMutationReviewArtifact,
  loadCoverageImportPlan,
  loadFailedFastListImportPlan,
  loadFastListImportSources,
  saveFastListImport,
  writeFastListImportArtifact,
  writeFastResolveArtifact,
  writeMutationReviewArtifact,
} = require('./core/fast-list-import');
const {
  loadPersonaModes,
  getPersonaModeById,
} = require('./core/persona-modes');
const {
  loadPilotConfig,
  getPilotConnectPolicyDecision,
} = require('./core/pilot-config');
const { createDriver } = require('./drivers');
const { createDashboardServer } = require('./server/dashboard');
const { sendApprovedConnects } = require('./core/connect-executor');
const { computeBudgetState, resolveConnectBudgetPolicy } = require('./core/budget');
const { reconcileState } = require('./core/reconciler');
const { maybeFallbackToLeadPageConnect } = require('./core/connect-fallback');
const { isConnectMenuActionLabel } = require('./core/connect-menu');
const { writeConnectEvidenceSprint } = require('./core/connect-evidence');
const { readLatestLeadListArtifactSnapshot } = require('./core/lead-list-snapshot');
const { normalizeCandidateLimit } = require('./core/candidate-limits');
const {
  readLatestAutoresearchArtifact,
  renderMvpOperatorDashboard,
  writeMvpAutoresearchRun,
} = require('./core/autoresearch-mvp');
const {
  buildCompanyResolution,
  findLatestCompanyResolutionArtifact,
  loadCompanyAliasConfig,
  renderCompanyResolutionMarkdown,
  summarizeCompanyResolutionArtifacts,
  writeCompanyResolutionArtifact,
} = require('./core/company-resolution');
const {
  buildCompanyResolutionRetryQueue,
  collectAllSweepsFailedAccounts,
  defaultCompanyResolutionRetryCheckpointPath,
  defaultCompanyResolutionRetryQueuePath,
  loadCompanyResolutionRetryCheckpoint,
  prepareCompanyResolutionRetryCandidates,
  updateCompanyResolutionRetryCheckpoint,
  writeCompanyResolutionRetryCheckpoint,
} = require('./core/company-resolution-retry');
const { buildFirstRunChecklist, renderFirstRunOnboarding } = require('./core/first-run');

async function main() {
  const logger = createLogger('cli');
  const { command, values } = parseCliArgs(process.argv);
  let repository = null;
  const getRepository = () => {
    if (!repository) {
      const { createDatabase } = require('./lib/db');
      repository = createDatabase();
    }
    return repository;
  };

  try {
    switch (command) {
      case 'sync-territory':
        await handleSyncTerritory(getRepository(), values, logger);
        break;
      case 'run-territory':
        await handleRunTerritory(getRepository(), values, logger, false);
        break;
      case 'resume-run':
        await handleRunTerritory(getRepository(), values, logger, true);
        break;
      case 'serve-review-dashboard':
        await handleServeDashboard(getRepository(), values, logger);
        break;
      case 'check-driver-session':
        await handleCheckDriverSession(values, logger);
        break;
      case 'doctor':
      case 'print-first-run-onboarding':
        await handleFirstRunOnboarding(values);
        break;
      case 'bootstrap-session':
        await handleBootstrapSession(values, logger);
        break;
      case 'test-account-search':
        await handleTestAccountSearch(values, logger);
        break;
      case 'account-coverage':
        await handleAccountCoverage(values, logger);
        break;
      case 'resolve-company':
        await handleResolveCompany(values, logger);
        break;
      case 'print-company-resolution':
        await handlePrintCompanyResolution(values, logger);
        break;
      case 'retry-company-resolution-failures':
        await handleRetryCompanyResolutionFailures(values, logger);
        break;
      case 'run-company-resolution-retries':
        await handleRunCompanyResolutionRetries(values, logger);
        break;
      case 'deep-review-coverage':
        await handleDeepReviewCoverage(values, logger);
        break;
      case 'render-coverage-review':
        await handleRenderCoverageReview(values, logger);
        break;
      case 'test-list-save':
        await handleTestListSave(values, logger);
        break;
      case 'fast-resolve-leads':
        await handleFastResolveLeads(values, logger);
        break;
      case 'fast-list-import':
        await handleFastListImport(values, logger);
        break;
      case 'retry-failed-fast-list-import':
        await handleRetryFailedFastListImport(values, logger);
        break;
      case 'import-coverage':
        await handleImportCoverage(values, logger);
        break;
      case 'test-connect':
        await handleTestConnect(values, logger);
        break;
      case 'inspect-connect-surface':
        await handleInspectConnectSurface(values, logger);
        break;
      case 'connect-lead-list':
        await handleConnectLeadList(getRepository(), values, logger);
        break;
      case 'remove-lead-list-members':
        await handleRemoveLeadListMembers(values, logger);
        break;
      case 'send-approved-connects':
        await handleSendApproved(getRepository(), values, logger);
        break;
      case 'reconcile-state':
        await handleReconcile(getRepository(), logger);
        break;
      case 'cleanup-runtime':
        await handleCleanupRuntime(values, logger);
        break;
      case 'print-live-test-checklist':
        await handlePrintLiveTestChecklist(logger);
        break;
      case 'print-pilot-operator-quickstart':
        await handlePrintPilotOperatorQuickstart(logger);
        break;
      case 'print-mvp-release-contract':
        await handlePrintMvpReleaseContract(logger);
        break;
      case 'print-mvp-morning-release-summary':
        await handlePrintMvpMorningReleaseSummary(logger);
        break;
      case 'print-mvp-operator-dashboard':
        await handlePrintMvpOperatorDashboard(logger);
        break;
      case 'build-connect-evidence-sprint':
        await handleBuildConnectEvidenceSprint(values, logger);
        break;
      case 'print-latest-background-runner-report':
        await handlePrintLatestBackgroundRunnerReport(logger);
        break;
      case 'check-live-readiness':
        await handleCheckLiveReadiness(values, logger);
        break;
      case 'build-priority-model':
        await handleBuildPriorityModel(values, logger);
        break;
      case 'build-background-territory-queue':
        await handleBuildBackgroundTerritoryQueue(values, logger);
        break;
      case 'run-background-territory-loop':
        await handleRunBackgroundTerritoryLoop(values, logger);
        break;
      case 'autoresearch-mvp':
        await handleAutoresearchMvp(values, logger);
        break;
      case 'run-account-batch':
        await handleRunAccountBatch(getRepository(), values, logger);
        break;
      case 'pilot-live-save-batch':
        await handlePilotLiveSaveBatch(values, logger);
        break;
      case 'pilot-connect-batch':
        await handlePilotConnectBatch(getRepository(), values, logger);
        break;
      default:
        printUsage();
    }
  } finally {
    if (repository && command !== 'serve-review-dashboard') {
      repository.close();
    }
  }
}

async function handleSyncTerritory(repository, values, logger) {
  const territoryId = getString(values, 'territory-id', 'territory') || 'terr-emea-obs-01';
  const sourcePath = getString(values, 'source');
  const sourceMode = getString(values, 'source-mode') || 'auto';
  const adapter = createSalesforceAdapter();
  const result = await syncTerritory({
    adapter,
    repository,
    territoryId,
    sourcePath,
    useSample: Boolean(values.sample),
    sourceMode,
    subsidiaryExpansion: true,
  });

  logger.info(`Synced territory ${result.snapshot.territory.territoryName}`);
  logger.info(`Snapshot: ${result.snapshot.snapshotId}`);
  logger.info(`Accounts: ${result.accountCount}`);
  logger.info(`Artifact: ${result.artifactPath}`);
}

async function handleRunTerritory(repository, values, logger, isResume) {
  const runId = getString(values, 'run-id', 'run');
  const driverName = getString(values, 'driver') || 'mock';
  const dryRun = getBoolean(values, 'dryRun', 'dry-run') || driverName === 'mock';
  const modeId = getString(values, 'mode');

  let run = null;
  if (isResume) {
    if (!runId) {
      throw new Error('resume-run requires --run-id');
    }
    run = repository.getRun(runId);
    if (!run) {
      throw new Error(`Run ${runId} not found`);
    }
  } else {
    const snapshotId = getString(values, 'snapshot');
    const territoryId = getString(values, 'territory-id', 'territory') || 'terr-emea-obs-01';
    const personaModesPath = resolveProjectPath('config', 'modes', 'default.json');
    const personaModes = loadPersonaModes(personaModesPath);
    const activeMode = modeId
      ? getPersonaModeById(personaModes, modeId)
      : null;
    if (modeId && !activeMode) {
      throw new Error(`Unknown mode "${modeId}". Check config/modes/default.json.`);
    }
    const snapshot = snapshotId
      ? repository.getSnapshotById(snapshotId)?.payload
      : repository.getLatestSnapshot(territoryId)?.payload;

    if (!snapshot) {
      throw new Error('No territory snapshot found. Run sync-territory first.');
    }

    const runSpec = await createRun({
      repository,
      snapshot,
      driverName,
      icpConfigPath: resolveProjectPath('config', 'icp', 'default-observability.json'),
      searchTemplatesPath: resolveProjectPath('config', 'search-templates', 'default.json'),
      modeId: activeMode?.id || null,
      personaModesPath,
      dryRun,
      weeklyCap: 140,
    });
    run = repository.getRun(runSpec.runId);
  }

  const driver = createDriver(run.driver, buildDriverOptions(values, run, {
    sessionMode: 'persistent',
    headless: true,
  }));
  const result = await runTerritory({ repository, driver, run });

  logger.info(`Run completed: ${result.runId}`);
  logger.info(`Processed accounts: ${result.processedAccounts}`);
  if (run.runSpec.modeId) {
    logger.info(`Mode: ${run.runSpec.modeId}`);
  }
  logger.info(`Artifact: ${result.artifactPath}`);
}

async function handleServeDashboard(repository, values, logger) {
  const port = Number(getString(values, 'port') || 4310);
  const host = getString(values, 'host') || '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error('serve-review-dashboard only supports loopback hosts');
  }
  const server = createDashboardServer({ repository, port, host });
  await server.listen();
  logger.info(`Dashboard listening on http://${host}:${port}`);
}

async function handleCheckDriverSession(values, logger) {
  const driverName = getString(values, 'driver') || 'playwright';
  const driver = createDriver(driverName, buildDriverOptions(values, null, {
    sessionMode: 'storage-state',
    headless: false,
  }));

  try {
    await driver.openSession({
      runId: 'session-check',
      territoryId: 'session-check',
      dryRun: true,
      weeklyCap: 140,
    });
    const health = await driver.checkSessionHealth();
    logger.info(`Driver: ${driverName}`);
    logger.info(`Mode: ${health.mode}`);
    logger.info(`State: ${health.state}`);
    logger.info(`Authenticated: ${health.authenticated}`);
    logger.info(`URL: ${health.url}`);
    if (health.discovery) {
      logger.info(`Discovery: ${health.discovery.mode} / ${health.discovery.state}`);
    }
    if (health.mutation) {
      logger.info(`Mutation: ${health.mutation.mode} / ${health.mutation.state}`);
      if (health.mutation.error) {
        logger.warn(health.mutation.error);
      }
    }
    if (health.storageStatePath) {
      logger.info(`Storage state: ${health.storageStatePath}`);
    }
    if (health.userDataDir) {
      logger.info(`User data dir: ${health.userDataDir}`);
    }
  } catch (error) {
    const failure = classifySessionCheckFailure(error);
    logger.info(`Driver: ${driverName}`);
    logger.info(`Mode: ${failure.mode}`);
    logger.info(`State: ${failure.state}`);
    logger.info(`Authenticated: false`);
    logger.warn(failure.detail);
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handleFirstRunOnboarding(values) {
  const asJson = getBoolean(values, 'json');
  const checklist = buildFirstRunChecklist();
  if (asJson) {
    console.log(JSON.stringify(checklist, null, 2));
    return;
  }
  console.log(renderFirstRunOnboarding(checklist));
}

async function handleBootstrapSession(values, logger) {
  const driverName = getString(values, 'driver') || 'playwright';
  const waitMinutes = Number(getString(values, 'wait-minutes') || 10);
  const options = buildDriverOptions(values, null, {
    sessionMode: 'persistent',
    headless: false,
  });
  const driver = createDriver(driverName, options);
  const timeoutAt = Date.now() + (waitMinutes * 60 * 1000);

  try {
    await driver.openSession({
      runId: 'bootstrap-session',
      territoryId: 'bootstrap-session',
      dryRun: true,
      weeklyCap: 140,
    });
    if (!isLinkedInPageUrl(driver.page.url())) {
      await driver.page.goto('https://www.linkedin.com/sales/home', { waitUntil: 'domcontentloaded' });
    }
    logger.info(`Opened ${driverName} in visible mode. Complete any LinkedIn login or re-auth in the browser window.`);

    let latest = null;
    while (Date.now() < timeoutAt) {
      latest = await driver.checkSessionHealth();
      logger.info(`Session state: ${latest.state}`);
      if (latest.ok) {
        const exported = await driver.exportStorageState(options.storageState);
        logger.info(`Session ready. Exported storage state: ${exported}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    throw new Error(`Session bootstrap timed out after ${waitMinutes} minutes. Last state: ${latest?.state || 'unknown'}`);
  } finally {
    await driver.close().catch(() => {});
  }
}

function isLinkedInPageUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

async function handleTestAccountSearch(values, logger) {
  const driverName = getString(values, 'driver') || 'playwright';
  const accountName = getString(values, 'account-name');
  if (!accountName) {
    throw new Error('test-account-search requires --account-name');
  }

  const keywords = (getString(values, 'keywords') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const maxCandidates = Number(getString(values, 'max-candidates') || 5);
  const peopleSearchUrl = getString(values, 'people-search-url') || 'https://www.linkedin.com/sales/search/people';
  const accountListName = getString(values, 'account-list');

  const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: true }, {
    sessionMode: 'persistent',
    headless: true,
  }));

  const account = {
    accountId: `live-${accountName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    name: accountName,
    salesNav: {
      peopleSearchUrl,
      ...(accountListName ? { accountListName } : {}),
    },
  };
  const template = {
    id: 'live-account-search',
    name: 'Live Account Search',
    keywords,
    maxCandidates,
    titleIncludes: [],
  };

  try {
    await driver.openSession({
      runId: 'test-account-search',
      territoryId: 'test-account-search',
      dryRun: true,
      weeklyCap: 140,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }
    await driver.openAccountSearch();
    await driver.openPeopleSearch(account, { runId: 'test-account-search', accountKey: account.accountId });
    await driver.applySearchTemplate(template, { runId: 'test-account-search', accountKey: account.accountId });
    const candidates = await driver.scrollAndCollectCandidates(account, template, {
      runId: 'test-account-search',
      accountKey: account.accountId,
    });

    logger.info(`Driver: ${driverName}`);
    logger.info(`Account target: ${accountName}`);
    if (accountListName) {
      logger.info(`Account list: ${accountListName}`);
    }
    logger.info(`Keywords: ${keywords.join(', ') || '(none)'}`);
    logger.info(`Candidates: ${candidates.length}`);

    candidates.forEach((candidate, index) => {
      logger.info([
        `${index + 1}. ${candidate.fullName || 'Unknown name'}`,
        candidate.title || 'Unknown title',
        candidate.company || 'Unknown company',
        candidate.location || 'Unknown location',
        candidate.salesNavigatorUrl || candidate.profileUrl || 'No URL',
      ].join(' | '));
    });
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handleTestListSave(values, logger) {
  const driverName = getString(values, 'driver') || 'playwright';
  const candidateUrl = getString(values, 'candidate-url');
  const listName = getString(values, 'list-name');
  if (!candidateUrl || !listName) {
    throw new Error('test-list-save requires --candidate-url and --list-name');
  }
  if (!getBoolean(values, 'live-save')) {
    throw new Error('test-list-save requires --live-save to avoid accidental mutations');
  }

  const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: false }, {
    sessionMode: 'persistent',
    headless: true,
    recoveryMode: 'screenshot-only',
  }));

  try {
    await driver.openSession({
      runId: 'test-list-save',
      territoryId: 'test-list-save',
      dryRun: false,
      weeklyCap: 140,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }

    const result = await driver.saveCandidateToList(
      {
        fullName: 'Smoke Test Candidate',
        salesNavigatorUrl: candidateUrl,
        profileUrl: candidateUrl,
      },
      { listName, externalRef: null },
      { runId: 'test-list-save', accountKey: 'smoke', dryRun: false },
    );

    logger.info(`Driver: ${driverName}`);
    logger.info(`Candidate URL: ${candidateUrl}`);
    logger.info(`List: ${listName}`);
    logger.info(`Status: ${result.status}`);
    if (result.selectionMode) {
      logger.info(`Selection mode: ${result.selectionMode}`);
    }
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handleFastListImport(values, logger) {
  const sourcePath = getString(values, 'source');
  if (!sourcePath) {
    throw new Error('fast-list-import requires --source=<markdown-or-json>');
  }
  if (getBoolean(values, 'live-connect') || getBoolean(values, 'allow-background-connects')) {
    throw new Error('fast-list-import never sends connects and refuses live-connect/background-connect flags');
  }

  const driverName = getString(values, 'driver') || 'playwright';
  const liveSave = getBoolean(values, 'live-save');
  const listName = getString(values, 'list-name');
  const maxRetries = Number(getString(values, 'max-retries') || 1);
  const bucket = getString(values, 'bucket');
  const minScore = getString(values, 'min-score');
  const importPlan = loadFastListImportSources(sourcePath, {
    listName,
    bucket,
    minScore,
    coverageDir: getString(values, 'coverage-dir') || undefined,
  });
  const runId = `fast-list-import-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  let artifact = null;

  if (!liveSave) {
    artifact = await saveFastListImport({
      importPlan,
      liveSave: false,
      maxRetries,
      runId,
    });
  } else {
    const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: false }, {
      sessionMode: 'persistent',
      headless: true,
      recoveryMode: 'screenshot-only',
    }));

    try {
      await driver.openSession({
        runId,
        territoryId: 'fast-list-import',
        dryRun: false,
        weeklyCap: 140,
      });
      const health = await driver.checkSessionHealth();
      if (!health.ok) {
        throw new Error(`Driver session is not ready: ${health.state}`);
      }
      await driver.ensureList(importPlan.listName, {
        runId,
        accountKey: 'fast-list-import',
        dryRun: false,
      });
      const existingSnapshot = readLatestLeadListArtifactSnapshot(importPlan.listName);
      const mutationReview = buildMutationReviewArtifact({
        command: 'fast-list-import',
        importPlan,
        existingLeadUrls: existingSnapshot?.rows?.map((row) => row.salesNavigatorUrl) || [],
      });
      const mutationReviewPaths = writeMutationReviewArtifact(mutationReview);
      logger.info(`Mutation review artifact: ${mutationReviewPaths.artifactPath}`);
      logger.info(`Mutation review report: ${mutationReviewPaths.reportPath}`);
      artifact = await saveFastListImport({
        driver,
        importPlan,
        liveSave: true,
        allowListCreate: getBoolean(values, 'allow-list-create'),
        maxRetries,
        runId,
        existingLeadUrls: existingSnapshot?.rows?.map((row) => row.salesNavigatorUrl) || [],
        onProgress(row) {
          logger.info(`${row.status} | ${row.accountName || 'Unknown account'} | ${row.fullName || 'Unknown lead'}${row.attempt ? ` | attempt=${row.attempt}` : ''}`);
        },
      });
    } finally {
      await driver.close().catch(() => {});
    }
  }

  const { artifactPath, reportPath } = writeFastListImportArtifact(artifact, getString(values, 'output') || null);
  logger.info(`List: ${artifact.listName}`);
  logger.info(`Live save: ${artifact.liveSave ? 'yes' : 'no'}`);
  logger.info(`Resolved: ${artifact.resolvedLeads}`);
  logger.info(`Unresolved: ${artifact.unresolvedLeads ?? artifact.unresolved}`);
  if (artifact.liveSave) {
    logger.info(`Confirmed saved this run: ${artifact.confirmedSaved ?? artifact.saved}`);
    logger.info(`Already in list: ${artifact.alreadySaved ?? 0}${artifact.snapshotSkipped ? ` (${artifact.snapshotSkipped} skipped by snapshot preflight)` : ''}`);
    logger.info(`Failed: ${artifact.failed}`);
  }
  logger.info(`Artifact: ${artifactPath}`);
  logger.info(`Report: ${reportPath}`);
}

async function handleRetryFailedFastListImport(values, logger) {
  const artifactPath = getString(values, 'artifact', 'source');
  if (!artifactPath) {
    throw new Error('retry-failed-fast-list-import requires --artifact=<fast-list-import-artifact.json>');
  }
  if (getBoolean(values, 'live-connect') || getBoolean(values, 'allow-background-connects')) {
    throw new Error('retry-failed-fast-list-import never sends connects and refuses live-connect/background-connect flags');
  }

  const driverName = getString(values, 'driver') || 'playwright';
  const liveSave = getBoolean(values, 'live-save');
  const listName = getString(values, 'list-name');
  const maxRetries = Number(getString(values, 'max-retries') || 1);
  const importPlan = loadFailedFastListImportPlan(artifactPath, { listName });
  const runId = `retry-failed-fast-list-import-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  let artifact = null;

  if (!liveSave) {
    artifact = await saveFastListImport({
      importPlan,
      liveSave: false,
      maxRetries,
      runId,
    });
  } else {
    const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: false }, {
      sessionMode: 'persistent',
      headless: true,
      recoveryMode: 'screenshot-only',
    }));

    try {
      await driver.openSession({
        runId,
        territoryId: 'retry-failed-fast-list-import',
        dryRun: false,
        weeklyCap: 140,
      });
      const health = await driver.checkSessionHealth();
      if (!health.ok) {
        throw new Error(`Driver session is not ready: ${health.state}`);
      }
      await driver.ensureList(importPlan.listName, {
        runId,
        accountKey: 'retry-failed-fast-list-import',
        dryRun: false,
      });
      const existingSnapshot = readLatestLeadListArtifactSnapshot(importPlan.listName);
      const mutationReview = buildMutationReviewArtifact({
        command: 'retry-failed-fast-list-import',
        importPlan,
        existingLeadUrls: existingSnapshot?.rows?.map((row) => row.salesNavigatorUrl) || [],
      });
      const mutationReviewPaths = writeMutationReviewArtifact(mutationReview);
      logger.info(`Mutation review artifact: ${mutationReviewPaths.artifactPath}`);
      logger.info(`Mutation review report: ${mutationReviewPaths.reportPath}`);
      artifact = await saveFastListImport({
        driver,
        importPlan,
        liveSave: true,
        allowListCreate: getBoolean(values, 'allow-list-create'),
        maxRetries,
        runId,
        existingLeadUrls: existingSnapshot?.rows?.map((row) => row.salesNavigatorUrl) || [],
        onProgress(row) {
          logger.info(`${row.status} | ${row.accountName || 'Unknown account'} | ${row.fullName || 'Unknown lead'}${row.attempt ? ` | attempt=${row.attempt}` : ''}`);
        },
      });
    } finally {
      await driver.close().catch(() => {});
    }
  }

  const { artifactPath: outputArtifactPath, reportPath } = writeFastListImportArtifact(artifact, getString(values, 'output') || null);
  logger.info(`List: ${artifact.listName}`);
  logger.info(`Retry source: ${artifact.retrySourceArtifact}`);
  logger.info(`Live save: ${artifact.liveSave ? 'yes' : 'no'}`);
  logger.info(`Retry leads: ${artifact.uniqueLeads}`);
  logger.info(`Confirmed saved this run: ${artifact.confirmedSaved ?? artifact.saved ?? 0}`);
  logger.info(`Already in list: ${artifact.alreadySaved ?? 0}${artifact.snapshotSkipped ? ` (${artifact.snapshotSkipped} skipped by snapshot preflight)` : ''}`);
  logger.info(`Failed: ${artifact.failed ?? 0}`);
  if (artifact.nextAction) {
    logger.info(`Next action: ${artifact.nextAction}`);
  }
  logger.info(`Artifact: ${outputArtifactPath}`);
  logger.info(`Report: ${reportPath}`);
}

async function handleImportCoverage(values, logger) {
  const accounts = getString(values, 'accounts', 'account-names', 'source');
  if (!accounts) {
    throw new Error('import-coverage requires --accounts=<account-a,account-b> or --source=<coverage-a.json,coverage-b.json>');
  }
  if (getBoolean(values, 'live-connect') || getBoolean(values, 'allow-background-connects')) {
    throw new Error('import-coverage never sends connects and refuses live-connect/background-connect flags');
  }

  const driverName = getString(values, 'driver') || 'playwright';
  const liveSave = getBoolean(values, 'live-save');
  const listName = getString(values, 'list-name');
  const maxRetries = Number(getString(values, 'max-retries') || 1);
  const importPlan = loadCoverageImportPlan({
    accounts,
    coverageDir: getString(values, 'coverage-dir') || undefined,
    bucket: getString(values, 'bucket'),
    minScore: getString(values, 'min-score'),
    listName,
  });
  const runId = `import-coverage-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  let artifact = null;

  if (!liveSave) {
    artifact = await saveFastListImport({
      importPlan,
      liveSave: false,
      maxRetries,
      runId,
    });
  } else {
    const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: false }, {
      sessionMode: 'persistent',
      headless: true,
      recoveryMode: 'screenshot-only',
    }));

    try {
      await driver.openSession({
        runId,
        territoryId: 'import-coverage',
        dryRun: false,
        weeklyCap: 140,
      });
      const health = await driver.checkSessionHealth();
      if (!health.ok) {
        throw new Error(`Driver session is not ready: ${health.state}`);
      }
      await driver.ensureList(importPlan.listName, {
        runId,
        accountKey: 'import-coverage',
        dryRun: false,
      });
      const existingSnapshot = readLatestLeadListArtifactSnapshot(importPlan.listName);
      const mutationReview = buildMutationReviewArtifact({
        command: 'import-coverage',
        importPlan,
        existingLeadUrls: existingSnapshot?.rows?.map((row) => row.salesNavigatorUrl) || [],
      });
      const mutationReviewPaths = writeMutationReviewArtifact(mutationReview);
      logger.info(`Mutation review artifact: ${mutationReviewPaths.artifactPath}`);
      logger.info(`Mutation review report: ${mutationReviewPaths.reportPath}`);
      artifact = await saveFastListImport({
        driver,
        importPlan,
        liveSave: true,
        allowListCreate: getBoolean(values, 'allow-list-create'),
        maxRetries,
        runId,
        existingLeadUrls: existingSnapshot?.rows?.map((row) => row.salesNavigatorUrl) || [],
        onProgress(row) {
          logger.info(`${row.status} | ${row.accountName || 'Unknown account'} | ${row.fullName || 'Unknown lead'}${row.attempt ? ` | attempt=${row.attempt}` : ''}`);
        },
      });
    } finally {
      await driver.close().catch(() => {});
    }
  }

  const { artifactPath, reportPath } = writeFastListImportArtifact(artifact, getString(values, 'output') || null);
  logger.info(`List: ${artifact.listName}`);
  logger.info(`Coverage import: ${artifact.sourcePaths?.length || 1} source(s)`);
  logger.info(`Live save: ${artifact.liveSave ? 'yes' : 'no'}`);
  logger.info(`Resolved: ${artifact.resolvedLeads}`);
  logger.info(`Unresolved: ${artifact.unresolvedLeads ?? artifact.unresolved}`);
  if (artifact.liveSave) {
    logger.info(`Confirmed saved this run: ${artifact.confirmedSaved ?? artifact.saved}`);
    logger.info(`Already in list: ${artifact.alreadySaved ?? 0}${artifact.snapshotSkipped ? ` (${artifact.snapshotSkipped} skipped by snapshot preflight)` : ''}`);
    logger.info(`Failed: ${artifact.failed}`);
  }
  logger.info(`Artifact: ${artifactPath}`);
  logger.info(`Report: ${reportPath}`);
}

async function handleFastResolveLeads(values, logger) {
  const sourcePath = getString(values, 'source');
  if (!sourcePath) {
    throw new Error('fast-resolve-leads requires --source=<markdown-or-json>');
  }
  if (getBoolean(values, 'live-save') || getBoolean(values, 'live-connect') || getBoolean(values, 'allow-background-connects')) {
    throw new Error('fast-resolve-leads is dry-safe and refuses live-save, live-connect, or background-connect flags');
  }

  const driverName = getString(values, 'driver') || 'playwright';
  const searchTimeoutMs = Number(getString(values, 'search-timeout-ms') || 8000);
  const maxCandidates = Number(getString(values, 'max-candidates') || 4);
  const listName = getString(values, 'list-name');
  const runId = `fast-resolve-leads-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: true }, {
    sessionMode: 'persistent',
    headless: true,
    recoveryMode: 'screenshot-only',
  }));

  try {
    await driver.openSession({
      runId,
      territoryId: 'fast-resolve-leads',
      dryRun: true,
      weeklyCap: 140,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }

    const artifact = await fastResolveLeads({
      driver,
      sourcePath,
      listName,
      aliasConfig: loadCompanyAliasConfig(),
      searchTimeoutMs,
      maxCandidates,
      runId,
      onProgress(row) {
        logger.info(`${row.resolutionBucket || row.resolutionStatus} | ${row.accountName || 'Unknown account'} | ${row.fullName || 'Unknown lead'} | confidence=${row.resolutionConfidence || 0}`);
      },
    });
    const { artifactPath, reportPath } = writeFastResolveArtifact(artifact, getString(values, 'output') || null);
    logger.info(`List: ${artifact.listName}`);
    logger.info(`Search timeout: ${artifact.searchTimeoutMs}ms`);
    logger.info(`Resolved safe to save: ${artifact.bucketCounts.resolved_safe_to_save}`);
    logger.info(`Needs company alias retry: ${artifact.bucketCounts.needs_company_alias_retry}`);
    logger.info(`Manual review: ${artifact.bucketCounts.manual_review}`);
    logger.info(`Artifact: ${artifactPath}`);
    logger.info(`Report: ${reportPath}`);
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handleTestConnect(values, logger) {
  const driverName = getString(values, 'driver') || 'browser-harness';
  const candidateUrl = getString(values, 'candidate-url');
  const fullName = getString(values, 'full-name') || 'Smoke Test Candidate';
  if (!candidateUrl) {
    throw new Error('test-connect requires --candidate-url');
  }
  if (!getBoolean(values, 'live-connect')) {
    throw new Error('test-connect requires --live-connect to avoid accidental mutations');
  }

  const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: false }, {
    sessionMode: 'persistent',
    headless: true,
    recoveryMode: 'screenshot-only',
  }));

  try {
    await driver.openSession({
      runId: 'test-connect',
      territoryId: 'test-connect',
      dryRun: false,
      weeklyCap: 140,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }

    const result = await driver.sendConnect(
      {
        fullName,
        salesNavigatorUrl: candidateUrl,
        profileUrl: candidateUrl,
      },
      { runId: 'test-connect', accountKey: 'smoke', dryRun: false },
    );

    logger.info(`Driver: ${driverName}`);
    logger.info(`Candidate: ${fullName}`);
    logger.info(`Candidate URL: ${candidateUrl}`);
    logger.info(`Status: ${result.status}`);
    if (result.note) {
      logger.info(`Note: ${result.note}`);
    }
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handleInspectConnectSurface(values, logger) {
  const driverName = getString(values, 'driver') || 'playwright';
  const candidateUrl = getString(values, 'candidate-url');
  const fullName = getString(values, 'full-name') || 'Connect Surface Diagnostic';
  if (!candidateUrl) {
    throw new Error('inspect-connect-surface requires --candidate-url');
  }

  const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: true }, {
    sessionMode: 'persistent',
    headless: true,
    recoveryMode: 'screenshot-only',
  }));

  if (typeof driver.inspectConnectSurface !== 'function') {
    throw new Error(`Driver ${driverName} does not support inspect-connect-surface diagnostics`);
  }

  try {
    await driver.openSession({
      runId: 'inspect-connect-surface',
      territoryId: 'inspect-connect-surface',
      dryRun: true,
      weeklyCap: 140,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }

    const diagnostic = await driver.inspectConnectSurface({
      fullName,
      salesNavigatorUrl: candidateUrl,
      profileUrl: candidateUrl,
    });

    logger.info(`Driver: ${driverName}`);
    logger.info(`Candidate: ${fullName}`);
    logger.info(`Candidate URL: ${candidateUrl}`);
    logger.info('Dry diagnostic output:');
    console.log(JSON.stringify(diagnostic, null, 2));
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handleConnectLeadList(repository, values, logger) {
  const driverName = getString(values, 'driver') || 'browser-harness';
  const listName = getString(values, 'list-name');
  const limit = Number(getString(values, 'limit') || Number.MAX_SAFE_INTEGER);
  if (!listName) {
    throw new Error('connect-lead-list requires --list-name');
  }
  if (!getBoolean(values, 'live-connect')) {
    throw new Error('connect-lead-list requires --live-connect to avoid accidental mutations');
  }

  const driverOptions = buildDriverOptions(values, { dryRun: false }, {
    sessionMode: 'persistent',
    headless: true,
    recoveryMode: 'screenshot-only',
  });
  const budgetPolicy = buildConnectBudgetPolicy(values);

  const driver = createDriver(driverName, driverOptions);
  try {
    await driver.openSession({
      runId: 'connect-lead-list',
      territoryId: 'connect-lead-list',
      dryRun: false,
      weeklyCap: budgetPolicy.weeklyCap,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }

    const snapshot = await readLeadListSnapshot(driver, listName);
    const rawBudget = repository.getBudgetState(budgetPolicy.effectiveWeeklyCap);
    const budget = computeBudgetState({
      weeklyCap: rawBudget.weeklyCap,
      sentThisWeek: rawBudget.weekCount,
      sentToday: rawBudget.dayCount,
      budgetMode: budgetPolicy.budgetMode,
      toolSharePercent: budgetPolicy.toolSharePercent,
      dailyMax: budgetPolicy.dailyMax,
      dailyMin: budgetPolicy.dailyMin,
    });

    if (budget.remainingToday <= 0 || budget.remainingThisWeek <= 0) {
      logger.info(`Driver: ${driverName}`);
      logger.info(`List: ${listName}`);
      logger.info(`Budget mode: ${budget.budgetMode}`);
      logger.info(`Budget exhausted for today. Remaining today: ${budget.remainingToday}, remaining this week: ${budget.remainingThisWeek}`);
      return;
    }

    const pendingRows = snapshot.rows
      .filter((row) => !row.invitationSent && !row.connectionSent)
      .slice(0, Math.min(limit, budget.remainingToday));

    const results = [];
    for (const row of pendingRows) {
      const knownCandidateId = resolveKnownCandidateId(repository, row);
      const candidateId = knownCandidateId || row.salesNavigatorUrl || row.fullName;
      if (knownCandidateId && repository.hasSentConnect(knownCandidateId)) {
        results.push({
          name: row.fullName,
          status: 'duplicate_skipped',
          note: 'already recorded as sent locally',
        });
        continue;
      }

      try {
        const initialResult = snapshot.source === 'artifact_fallback'
          ? await driver.sendConnect({
            fullName: row.fullName,
            salesNavigatorUrl: row.salesNavigatorUrl,
            profileUrl: row.salesNavigatorUrl,
          }, {
            runId: 'connect-lead-list-artifact-fallback',
            accountKey: listName,
            dryRun: false,
          })
          : driverName === 'browser-harness'
          ? sendConnectFromLeadListRow(driver, listName, row)
          : await sendConnectFromLeadListRowViaPlaywright(driver, snapshot.listUrl || listName, row);
        const result = await maybeFallbackToLeadPageConnect({
          initialResult,
          driver,
          row,
          accountKey: listName,
          runId: 'connect-lead-list-row-fallback',
        });

        recordConnectEventIfKnown(repository, row, null, 'connect', result.status, {
          listName,
          fullName: row.fullName,
          note: result.note || null,
        });
        results.push({
          name: row.fullName,
          status: result.status,
          note: result.note || null,
        });
      } catch (error) {
        results.push({
          name: row.fullName,
          status: 'failed',
          note: error.message,
        });
      }
    }

    const finalSnapshot = snapshot.source === 'artifact_fallback'
      ? snapshot
      : await readLeadListSnapshot(driver, listName);
    logger.info(`Driver: ${driverName}`);
    logger.info(`List: ${listName}`);
    logger.info(`Budget mode: ${budget.budgetMode}`);
    logger.info(`Tool share: ${budget.toolSharePercent}% of ${budgetPolicy.weeklyCap}/week`);
    logger.info(`Daily pacing target: ${budget.recommendedTodayLimit}`);
    logger.info(`Total leads: ${finalSnapshot.rows.length}`);
    logger.info(`Already invited before run: ${snapshot.rows.filter((row) => row.invitationSent || row.connectionSent).length}`);
    logger.info(`Attempted this run: ${pendingRows.length}`);
    results.forEach((result) => {
      logger.info(`${result.name} | ${result.status}${result.note ? ` | ${result.note}` : ''}`);
    });
    if (snapshot.source === 'artifact_fallback') {
      logger.info(`Visible list verification: skipped because Sales Nav list lookup fell back to artifact ${snapshot.artifactPath || 'unknown'}`);
    } else {
      logger.info(`Invitation sent after run: ${finalSnapshot.rows.filter((row) => row.invitationSent || row.connectionSent).length}`);
    }
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handleRemoveLeadListMembers(values, logger) {
  const driverName = getString(values, 'driver') || 'playwright';
  const listName = getString(values, 'list-name');
  const rawNames = getString(values, 'names');
  if (!listName) {
    throw new Error('remove-lead-list-members requires --list-name');
  }
  if (!rawNames) {
    throw new Error('remove-lead-list-members requires --names="Name A, Name B"');
  }
  if (!getBoolean(values, 'live-save')) {
    throw new Error('remove-lead-list-members requires --live-save to avoid accidental mutations');
  }

  const targetNames = rawNames
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (targetNames.length === 0) {
    throw new Error('remove-lead-list-members received an empty --names value');
  }

  const driverOptions = buildDriverOptions(values, { dryRun: false }, {
    sessionMode: 'persistent',
    headless: true,
    recoveryMode: 'screenshot-only',
  });

  const driver = createDriver(driverName, driverOptions);
  try {
    await driver.openSession({
      runId: 'remove-lead-list-members',
      territoryId: 'remove-lead-list-members',
      dryRun: false,
      weeklyCap: 140,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }
    if (!driver.page) {
      throw new Error(`remove-lead-list-members currently requires a playwright-compatible page-backed driver; received ${driverName}`);
    }

    const initialSnapshot = await readLeadListSnapshotViaPlaywright(driver, listName);
    const results = [];
    for (const name of targetNames) {
      const result = await removeLeadListMemberViaPlaywright(driver, initialSnapshot.listUrl, name);
      results.push(result);
    }

    const finalSnapshot = await readLeadListSnapshotViaPlaywright(driver, listName);
    logger.info(`Driver: ${driverName}`);
    logger.info(`List: ${listName}`);
    logger.info(`Initial total leads: ${initialSnapshot.rows.length}`);
    results.forEach((result) => {
      logger.info(`${result.name} | ${result.status}${result.note ? ` | ${result.note}` : ''}`);
    });
    logger.info(`Final total leads: ${finalSnapshot.rows.length}`);
  } finally {
    await driver.close().catch(() => {});
  }
}

function buildConnectBudgetPolicy(values) {
  return resolveConnectBudgetPolicy({
    weeklyCap: Number(getString(values, 'weekly-cap') || 140),
    budgetMode: getString(values, 'budget-mode') || 'assist',
    toolSharePercent: getString(values, 'tool-share-percent'),
    dailyMax: getString(values, 'daily-max'),
    dailyMin: getString(values, 'daily-min'),
  });
}

function resolveKnownCandidateId(repository, rowOrCandidate) {
  const profileUrl = rowOrCandidate?.salesNavigatorUrl || rowOrCandidate?.profileUrl || null;
  if (!profileUrl) {
    return null;
  }

  const existing = repository.findExistingCandidate(profileUrl);
  return existing?.candidateId || null;
}

function recordConnectEventIfKnown(repository, rowOrCandidate, approvalId, action, status, details = {}) {
  const candidateId = resolveKnownCandidateId(repository, rowOrCandidate);
  if (!candidateId) {
    return false;
  }

  repository.insertConnectEvent(candidateId, approvalId, action, status, details);
  return true;
}

async function readLeadListSnapshot(driver, listName) {
  try {
    if (typeof driver.runHarnessJson === 'function') {
      return readLeadListSnapshotViaHarness(driver, listName);
    }
    return readLeadListSnapshotViaPlaywright(driver, listName);
  } catch (error) {
    const artifactSnapshot = readLatestLeadListArtifactSnapshot(listName);
    if (artifactSnapshot) {
      return artifactSnapshot;
    }
    throw error;
  }
}

function readLeadListSnapshotViaHarness(driver, listName) {
  const normalizedListName = String(listName || '').trim();
  if (/^https:\/\/www\.linkedin\.com\/sales\/lists\/people\//i.test(normalizedListName)) {
    const payload = driver.runHarnessJson(`
import json
new_tab(${JSON.stringify(normalizedListName)})
wait_for_load()
wait(1)
rows = js(${JSON.stringify(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const linkNodes = [...document.querySelectorAll('a[href*="/sales/lead/"]')];
  const seen = new Set();
  const results = [];
  for (const link of linkNodes) {
    const fullName = normalize(link.innerText || link.textContent || '');
    const href = link.href || '';
    if (!fullName || !href || seen.has(href)) {
      continue;
    }
    const row = link.closest('tr,[role="row"],li,article');
    const rowText = normalize(row ? (row.innerText || row.textContent || '') : '');
    results.push({
      fullName,
      salesNavigatorUrl: href,
      rowText,
      invitationSent: /invitation sent|einladung gesendet/i.test(rowText),
      connectionSent: /connection sent|verbindung gesendet/i.test(rowText),
      noActivity: /no activity|keine aktivität/i.test(rowText),
    });
    seen.add(href);
  }
  return results;
})()
`)}) or []
print(json.dumps({
    "status": "ok",
    "listName": target_name if 'target_name' in globals() else ${JSON.stringify(normalizedListName)},
    "listUrl": ${JSON.stringify(normalizedListName)},
    "rows": rows
}))
`);

    if (payload.status !== 'ok') {
      throw new Error(payload.message || `Unable to open lead list ${normalizedListName}`);
    }

    return payload;
  }
  const payload = driver.runHarnessJson(`
import json
new_tab("https://www.linkedin.com/sales/lists/people")
wait_for_load()
wait(1)
target_name = ${JSON.stringify(normalizedListName)}
list_target = js(${JSON.stringify(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const links = [...document.querySelectorAll('a[href]')];
  const match = links.find((link) => normalize(link.innerText || link.textContent || '') === ${JSON.stringify(normalizedListName)});
  if (!match || typeof match.getBoundingClientRect !== 'function') {
    return null;
  }
  return {
    href: match.href,
    text: normalize(match.innerText || match.textContent || ''),
  };
})()
`)})
if not list_target or not list_target.get("href"):
    print(json.dumps({"status": "failed", "message": "list_not_found", "listName": target_name}))
else:
    new_tab(list_target["href"])
    wait_for_load()
    wait(1)
    rows = js(${JSON.stringify(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const linkNodes = [...document.querySelectorAll('a[href*="/sales/lead/"]')];
  const seen = new Set();
  const results = [];
  for (const link of linkNodes) {
    const fullName = normalize(link.innerText || link.textContent || '');
    const href = link.href || '';
    if (!fullName || !href || seen.has(href)) {
      continue;
    }
    let row = link.closest('tr,[role="row"],li,article');
    if (!row) {
      let current = link.parentElement;
      while (current && current !== document.body) {
        const text = normalize(current.innerText || current.textContent || '');
        if (text.includes(fullName) && (text.includes('Invitation sent') || text.includes('No activity') || text.includes('Connection sent') || text.includes('Date added'))) {
          row = current;
          break;
        }
        current = current.parentElement;
      }
    }
    const rowText = normalize(row ? (row.innerText || row.textContent || '') : '');
    results.push({
      fullName,
      salesNavigatorUrl: href,
      rowText,
      invitationSent: /invitation sent|einladung gesendet/i.test(rowText),
      connectionSent: /connection sent|verbindung gesendet/i.test(rowText),
      noActivity: /no activity|keine aktivität/i.test(rowText),
    });
    seen.add(href);
  }
  return results;
})()
`)}) or []
    print(json.dumps({
        "status": "ok",
        "listName": target_name,
        "listUrl": list_target.get("href"),
        "rows": rows
    }))
`);

  if (payload.status !== 'ok') {
    throw new Error(payload.message || `Unable to open lead list ${normalizedListName}`);
  }

  return payload;
}

async function readLeadListSnapshotViaPlaywright(driver, listName) {
  const normalizedListName = String(listName || '').trim();
  if (!driver.page) {
    throw new Error('playwright driver page not available');
  }

  if (/^https:\/\/www\.linkedin\.com\/sales\/lists\/people\//i.test(normalizedListName)) {
    await driver.page.goto(normalizedListName, { waitUntil: 'domcontentloaded' });
    await driver.page.waitForTimeout(1200);

    const rows = await driver.page.evaluate(() => {
      const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
      const linkNodes = [...document.querySelectorAll('a[href*="/sales/lead/"]')];
      const seen = new Set();
      const results = [];
      for (const link of linkNodes) {
        const fullName = normalize(link.innerText || link.textContent || '');
        const targetHref = link.href || '';
        if (!fullName || !targetHref || seen.has(targetHref)) {
          continue;
        }
        const row = link.closest('tr,[role="row"],li,article');
        const rowText = normalize(row ? (row.innerText || row.textContent || '') : '');
        results.push({
          fullName,
          salesNavigatorUrl: targetHref,
          rowText,
          invitationSent: /invitation sent|einladung gesendet/i.test(rowText),
          connectionSent: /connection sent|verbindung gesendet/i.test(rowText),
          noActivity: /no activity|keine aktivität/i.test(rowText),
        });
        seen.add(targetHref);
      }
      return results;
    });

    return {
      status: 'ok',
      listName: normalizedListName,
      listUrl: normalizedListName,
      rows,
    };
  }

  await driver.page.goto('https://www.linkedin.com/sales/lists/people', { waitUntil: 'domcontentloaded' });
  await driver.page.waitForTimeout(1000);

  const listLink = await driver.page.evaluateHandle((targetName) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const links = [...document.querySelectorAll('a[href]')];
    const match = links.find((link) => normalize(link.innerText || link.textContent || '') === targetName);
    return match || null;
  }, normalizedListName);

  const href = await listLink.evaluate((node) => node ? node.href : null).catch(() => null);
  await listLink.dispose().catch(() => {});
  if (!href) {
    throw new Error(`Unable to open lead list ${normalizedListName}`);
  }

  await driver.page.goto(href, { waitUntil: 'domcontentloaded' });
  await driver.page.waitForTimeout(1200);

  const rows = await driver.page.evaluate(() => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const linkNodes = [...document.querySelectorAll('a[href*="/sales/lead/"]')];
    const seen = new Set();
    const results = [];
    for (const link of linkNodes) {
      const fullName = normalize(link.innerText || link.textContent || '');
      const targetHref = link.href || '';
      if (!fullName || !targetHref || seen.has(targetHref)) {
        continue;
      }
      let row = link.closest('tr,[role="row"],li,article');
      if (!row) {
        let current = link.parentElement;
        while (current && current !== document.body) {
          const text = normalize(current.innerText || current.textContent || '');
          if (text.includes(fullName) && (text.includes('Invitation sent') || text.includes('No activity') || text.includes('Connection sent') || text.includes('Date added'))) {
            row = current;
            break;
          }
          current = current.parentElement;
        }
      }
      const rowText = normalize(row ? (row.innerText || row.textContent || '') : '');
      results.push({
        fullName,
        salesNavigatorUrl: targetHref,
        rowText,
        invitationSent: /invitation sent|einladung gesendet/i.test(rowText),
        connectionSent: /connection sent|verbindung gesendet/i.test(rowText),
        noActivity: /no activity|keine aktivität/i.test(rowText),
      });
      seen.add(targetHref);
    }
    return results;
  });

  return {
    status: 'ok',
    listName: normalizedListName,
    listUrl: href,
    rows,
  };
}

function sendConnectFromLeadListRow(driver, listName, row) {
  const payload = driver.runHarnessJson(`
import json
new_tab("https://www.linkedin.com/sales/lists/people")
wait_for_load()
wait(1)
target_list = ${JSON.stringify(String(listName || '').trim())}
target_name = ${JSON.stringify(String(row.fullName || '').trim())}
list_target = js(${JSON.stringify(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const links = [...document.querySelectorAll('a[href]')];
  const match = links.find((link) => normalize(link.innerText || link.textContent || '') === ${JSON.stringify(String(listName || '').trim())});
  return match ? { href: match.href } : null;
})()
`)})
if not list_target or not list_target.get("href"):
    print(json.dumps({"status": "failed", "message": "list_not_found"}))
else:
    new_tab(list_target["href"])
    wait_for_load()
    wait(1)
    row_target = js(${JSON.stringify(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const rows = [...document.querySelectorAll('tr,[role="row"],li,article,div')];
  const match = rows.find((element) => {
    const text = normalize(element.innerText || element.textContent || '');
    return text.includes(${JSON.stringify(String(row.fullName || '').trim())});
  });
  if (!match) return null;
  const text = normalize(match.innerText || match.textContent || '');
  const buttons = [...match.querySelectorAll('button,[role="button"],a')];
  const action = buttons.find((element) => {
    const label = normalize(element.getAttribute('aria-label') || '').toLowerCase();
    const textValue = normalize(element.innerText || element.textContent || '').toLowerCase();
    return label.includes('overflow') || label.includes('actions') || label.includes('aktionen') || textValue === '...';
  });
  if (!action || typeof action.getBoundingClientRect !== 'function') {
    return { rowText: text, action: null };
  }
  const rect = action.getBoundingClientRect();
  return {
    rowText: text,
    action: { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) },
  };
})()
`)})
    if not row_target:
        print(json.dumps({"status": "failed", "message": "list_row_not_found"}))
    elif "invitation sent" in (row_target.get("rowText") or "").lower() or "connection sent" in (row_target.get("rowText") or "").lower():
        print(json.dumps({"status": "already_sent", "note": "invitation already sent"}))
    elif "connected" in (row_target.get("rowText") or "").lower() or "vernetzt" in (row_target.get("rowText") or "").lower():
        print(json.dumps({"status": "already_connected", "note": "lead already connected"}))
    elif not row_target.get("action"):
        print(json.dumps({"status": "connect_unavailable", "note": "actions menu not available on list row"}))
    else:
        click(row_target["action"]["x"], row_target["action"]["y"])
        wait(1)
        connect_target = js(${JSON.stringify(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const items = [...document.querySelectorAll('[role="menuitem"],li,button,[role="button"],a')];
  const match = items.find((element) => {
    const text = normalize(element.innerText || element.textContent || '');
    return text === 'connect'
      || text === 'vernetzen'
      || text === 'einladen'
      || text.startsWith('connect — pending')
      || text.startsWith('connect - pending');
  });
  if (!match || typeof match.getBoundingClientRect !== 'function') return null;
  const rect = match.getBoundingClientRect();
  return {
    text: normalize(match.innerText || match.textContent || ''),
    x: rect.left + (rect.width / 2),
    y: rect.top + (rect.height / 2),
  };
})()
`)})
        if not connect_target:
            print(json.dumps({"status": "connect_unavailable", "note": "connect action not available on list row"}))
        elif "pending" in (connect_target.get("text") or ""):
            print(json.dumps({"status": "already_sent", "note": "connect already pending"}))
        else:
            click(connect_target["x"], connect_target["y"])
            wait(1)
            send_target = js(${JSON.stringify(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const buttons = [...document.querySelectorAll('button,[role="button"],a')];
  const match = buttons.find((element) => {
    const text = normalize(element.innerText || element.textContent || '');
    const label = normalize(element.getAttribute('aria-label') || '');
    return text === 'send invitation'
      || text === 'send without a note'
      || text === 'send'
      || text === 'einladung senden'
      || text === 'ohne nachricht senden'
      || label.includes('send invitation')
      || label.includes('einladung senden');
  });
  if (!match || typeof match.getBoundingClientRect !== 'function') return null;
  const rect = match.getBoundingClientRect();
  return { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
})()
`)})
            if not send_target:
                print(json.dumps({"status": "failed", "message": "connect_send_button_not_found"}))
            else:
                click(send_target["x"], send_target["y"])
                wait(2)
                verification = js(${JSON.stringify(`
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim();
  const rows = [...document.querySelectorAll('tr,[role="row"],li,article,div')];
  const match = rows.find((element) => {
    const text = normalize(element.innerText || element.textContent || '');
    return text.includes(${JSON.stringify(String(row.fullName || '').trim())});
  });
  const rowText = normalize(match ? (match.innerText || match.textContent || '') : '');
  return {
    rowText,
    invited: /invitation sent|connection sent|pending/i.test(rowText),
  };
})()
`)})
                if verification.get("invited"):
                    print(json.dumps({"status": "sent", "note": "invitation sent from list row"}))
                else:
                    print(json.dumps({"status": "failed", "message": "connect_not_verified"}))
  `);

  if (!['sent', 'already_sent', 'already_connected', 'connect_unavailable'].includes(payload.status)) {
    throw new Error(payload.message || `Connect flow failed for ${row.fullName}`);
  }

  return payload;
}

async function sendConnectFromLeadListRowViaPlaywright(driver, listRef, row) {
  const targetRef = String(listRef || '').trim();
  const targetName = String(row.fullName || '').trim();
  if (!driver.page) {
    throw new Error('playwright page not available for list-row connect');
  }

  const snapshot = await readLeadListSnapshotViaPlaywright(driver, targetRef);
  await driver.page.goto(snapshot.listUrl, { waitUntil: 'domcontentloaded' });
  await driver.page.waitForTimeout(1200);

  const rowLocator = driver.page.locator('tr').filter({ hasText: targetName }).first();
  if (await rowLocator.count() === 0) {
    return { status: 'failed', note: 'list_row_not_found' };
  }

  const rowText = await rowLocator.innerText().catch(() => '');
  if (/invitation sent|connection sent|einladung gesendet|verbindung gesendet/i.test(rowText)) {
    return { status: 'already_sent', note: 'invitation already sent' };
  }
  if (/vernetzt|connected/i.test(rowText)) {
    return { status: 'already_connected', note: 'lead already connected' };
  }

  const actionButton = rowLocator.locator('button.list-detail-dropdown-trigger, .list-detail__row-overflow button').first();
  if (await actionButton.count() === 0) {
    return { status: 'connect_unavailable', note: 'row actions not found' };
  }
  await actionButton.click({ force: true });
  await driver.page.waitForTimeout(700);

  const visibleMenuItems = await driver.page.evaluate(() => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('[role="menuitem"], [role="menu"] li, [role="menu"] button, [role="menu"] a')]
      .map((element) => {
        const rect = typeof element.getBoundingClientRect === 'function'
          ? element.getBoundingClientRect()
          : { width: 0, height: 0 };
        return {
          text: normalize(element.innerText || element.textContent || ''),
          aria: normalize(element.getAttribute('aria-label') || ''),
          visible: rect.width > 0 && rect.height > 0,
        };
      })
      .filter((item) => item.visible && (item.text || item.aria));
  });

  if (visibleMenuItems.length === 0) {
    await driver.page.keyboard.press('Escape').catch(() => {});
    return { status: 'menu_empty', note: 'row menu opened without visible actions' };
  }

  if (visibleMenuItems.some((item) => /pending/i.test(item.text) || /pending/i.test(item.aria))) {
    await driver.page.keyboard.press('Escape').catch(() => {});
    return { status: 'already_sent', note: 'connect already pending' };
  }

  const connectLocator = driver.page.locator('[role="menuitem"], [role="menu"] li, [role="menu"] button, [role="menu"] a');

  const connectCount = await connectLocator.count();
  let clickedConnect = false;
  for (let index = 0; index < connectCount; index += 1) {
    const item = connectLocator.nth(index);
    try {
      if (!(await item.isVisible())) {
        continue;
      }
      const text = await item.innerText().catch(() => '');
      const aria = await item.getAttribute('aria-label').catch(() => '');
      if (!isConnectMenuActionLabel(text) && !isConnectMenuActionLabel(aria)) {
        continue;
      }
      await item.click({ force: true });
      clickedConnect = true;
      break;
    } catch {
      // try next visible candidate
    }
  }

  if (!clickedConnect) {
    await driver.page.keyboard.press('Escape').catch(() => {});
    return {
      status: 'connect_unavailable',
      note: visibleMenuItems.map((item) => item.text || item.aria).filter(Boolean).join(' | ') || 'connect action not available',
    };
  }

  await driver.page.waitForTimeout(900);
  const sendLocator = driver.page.locator('button,[role="button"],a')
    .filter({ hasText: /Send invitation|Send without a note|Send$|Einladung senden|Ohne Nachricht senden/i });

  const sendCount = await sendLocator.count();
  for (let index = 0; index < sendCount; index += 1) {
    const item = sendLocator.nth(index);
    try {
      if (await item.isVisible()) {
        await item.click({ force: true });
        await driver.page.waitForTimeout(1300);
        const bodyText = await driver.page.locator('body').innerText().catch(() => '');
        if (/invitation sent|connection sent|einladung gesendet|verbindung gesendet/i.test(bodyText)) {
          return { status: 'sent', note: 'invitation sent' };
        }
        const refreshedRowText = await rowLocator.innerText().catch(() => '');
        if (/invitation sent|connection sent|einladung gesendet|verbindung gesendet/i.test(refreshedRowText)) {
          return { status: 'sent', note: 'verified on row' };
        }
        return { status: 'failed', note: 'connect_not_verified' };
      }
    } catch {
      // try next button
    }
  }

  return { status: 'connect_unavailable', note: 'send button not available' };
}

async function removeLeadListMemberViaPlaywright(driver, listUrl, fullName) {
  const normalizedName = String(fullName || '').trim();
  await driver.page.goto(listUrl, { waitUntil: 'domcontentloaded' });
  await driver.page.waitForTimeout(1200);

  const found = await driver.page.evaluate((targetName) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const rows = [...document.querySelectorAll('tr')];
    const row = rows.find((element) => normalize(element.innerText || element.textContent || '').includes(targetName));
    if (!row) {
      return false;
    }
    const checkbox = row.querySelector('label.list-detail__checkbox-label') || row.querySelector('input.list-detail__checkbox');
    if (!checkbox) {
      return false;
    }
    checkbox.click();
    return true;
  }, normalizedName);

  if (!found) {
    return {
      name: normalizedName,
      status: 'not_found',
      note: 'lead row not found in list',
    };
  }
  await driver.page.waitForTimeout(400);

  const removeButton = driver.page.locator('button.bulk_actions__remove_button').first();
  await removeButton.waitFor({ state: 'visible', timeout: 5000 });
  await removeButton.click({ force: true });

  const keepSavedRadio = driver.page.locator('#remove-without-unsave').first();
  await keepSavedRadio.waitFor({ state: 'visible', timeout: 5000 });
  await keepSavedRadio.check({ force: true });

  const confirmButton = driver.page.locator('button.remove-entity-from-list__delete-button,[data-control-name="remove_lead_from_list_confirm"]').first();
  await confirmButton.waitFor({ state: 'visible', timeout: 5000 });
  await confirmButton.click({ force: true });

  await driver.page.waitForTimeout(1200);
  const stillVisibleWithoutReload = await driver.page.evaluate((targetName) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('tr')].some((element) => normalize(element.innerText || element.textContent || '').includes(targetName));
  }, normalizedName);

  if (stillVisibleWithoutReload) {
    await driver.page.reload({ waitUntil: 'domcontentloaded' });
    await driver.page.waitForTimeout(1200);
  }

  const stillPresent = await driver.page.evaluate((targetName) => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('tr')].some((element) => normalize(element.innerText || element.textContent || '').includes(targetName));
  }, normalizedName);

  return {
    name: normalizedName,
    status: !stillPresent ? 'removed' : 'failed',
    note: !stillPresent ? 'removed from list, kept saved state' : 'lead still present after remove confirmation',
  };
}

async function handleAccountCoverage(values, logger) {
  const driverName = getString(values, 'driver') || 'hybrid';
  const accountName = getString(values, 'account-name');
  if (!accountName) {
    throw new Error('account-coverage requires --account-name');
  }

  const peopleSearchUrl = getString(values, 'people-search-url') || 'https://www.linkedin.com/sales/search/people?viewAllFilters=true';
  const accountListName = getString(values, 'account-list');
  const maxCandidates = parseOptionalCandidateLimit(getString(values, 'max-candidates'));
  const speedProfile = getString(values, 'speed-profile') || 'balanced';
  const reuseSweepCache = getBoolean(values, 'reuse-sweep-cache');
  const interSweepDelayMs = Number(getString(values, 'inter-sweep-delay-ms') || 0);
  const coverageConfig = loadAccountCoverageConfig(getString(values, 'coverage-config') || null);
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const priorityModel = loadPriorityModel();

  const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: true }, {
    sessionMode: 'persistent',
    headless: true,
  }));
  try {
    await driver.openSession({
      runId: 'account-coverage',
      territoryId: 'account-coverage',
      dryRun: true,
      weeklyCap: 140,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }
    const { templates, result, bucketSummary } = await runAccountCoverageWorkflow({
      driver,
      accountName,
      peopleSearchUrl,
      accountListName,
      coverageConfig,
      icpConfig,
      priorityModel,
      maxCandidates,
      speedProfile,
      reuseSweepCache,
      interSweepDelayMs,
      runId: 'account-coverage',
      logger: {
        info(message) {
          logger.info(summarizeErrorMessage(message));
        },
        warn(message) {
          logger.warn(summarizeErrorMessage(message));
        },
      },
    });
    const artifactPath = writeAccountCoverageArtifact(accountName, result);

    logger.info(`Driver: ${driverName}`);
    logger.info(`Account target: ${accountName}`);
    const failedSweepIds = (result.sweepErrors || []).map((error) => error.templateId).filter(Boolean);
    const succeededSweeps = Math.max(0, templates.length - failedSweepIds.length);
    logger.info(`Sweeps: ${succeededSweeps}/${templates.length} succeeded${failedSweepIds.length ? `, ${failedSweepIds.length} failed (${failedSweepIds.join(', ')})` : ''}`);
    logger.info(`Speed profile: ${result.speedProfile}`);
    if (interSweepDelayMs > 0) {
      logger.info(`Inter-sweep delay: ${interSweepDelayMs}ms`);
    }
    logger.info(`Sweep cache: hits=${result.cacheHits || 0}, misses=${result.cacheMisses || 0}`);
    if (result.rateLimit?.hitCount) {
      logger.warn(`Rate-limit hit ${result.rateLimit.hitCount}x during sweep - total backoff: ${result.rateLimit.totalBackoffMs || 0}ms`);
    }
    logger.info(`Unique candidates: ${result.candidateCount}`);
    logger.info(`Coverage artifact: ${artifactPath}`);
    logger.info(`Buckets: direct=${bucketSummary.direct_observability}, adjacent=${bucketSummary.technical_adjacent}, broad_it=${bucketSummary.broad_it_stakeholder}, noise=${bucketSummary.likely_noise}`);

    if (result.coverage) {
      logger.info(`Coverage: ${result.coverage.coveredRoleCount}/${result.coverage.totalRoleCount} roles covered`);
      logger.info(`Missing roles: ${result.coverage.missingRoles.join(', ') || '(none)'}`);
    }

    result.candidates.slice(0, 20).forEach((candidate, index) => {
      logger.info([
        `${index + 1}. ${candidate.fullName || 'Unknown name'}`,
        candidate.title || 'Unknown title',
        candidate.company || 'Unknown company',
        candidate.coverageBucket,
        candidate.priorityModel?.priorityTier || 'no-priority-tier',
        candidate.sweeps.join('+'),
        candidate.salesNavigatorUrl || candidate.profileUrl || 'No URL',
      ].join(' | '));
    });
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handleResolveCompany(values, logger) {
  const accountName = getString(values, 'account-name');
  if (!accountName) {
    throw new Error('resolve-company requires --account-name');
  }

  const resolution = buildCompanyResolution({
    accountName,
    source: getString(values, 'source') || 'manual',
    aliasConfig: loadCompanyAliasConfig(),
    priorCoverage: loadExistingAccountCoverageArtifact(accountName),
  });
  const written = writeCompanyResolutionArtifact(resolution);

  logger.info(`Company resolution: ${resolution.status}`);
  logger.info(`Confidence: ${resolution.confidence}`);
  logger.info(`Recommended action: ${resolution.recommendedAction}`);
  logger.info(`Artifact: ${written.artifactPath}`);
  logger.info(`Report: ${written.reportPath}`);
  for (const target of resolution.targets || []) {
    logger.info(`Target: ${target.linkedinName} | confidence=${target.confidence} | territory=${target.territoryFit} | evidence=${target.evidence.join('+')}`);
  }
}

async function handlePrintCompanyResolution(values, logger) {
  const accountName = getString(values, 'account-name');
  const latestPath = findLatestCompanyResolutionArtifact(accountName || null);
  if (!latestPath) {
    logger.warn(accountName
      ? `No company resolution artifact found for ${accountName}`
      : 'No company resolution artifact found');
    return;
  }

  const resolution = readJson(latestPath);
  logger.info(`Company resolution artifact: ${latestPath}`);
  logger.info(renderCompanyResolutionMarkdown(resolution).trim());
}

async function handleRetryCompanyResolutionFailures(values, logger) {
  const limit = Number(getString(values, 'limit') || 3);
  const failures = collectCompanyResolutionFailureAccounts().slice(0, Math.max(1, limit));
  if (failures.length === 0) {
    logger.info('No all_sweeps_failed company-resolution candidates found.');
    return;
  }

  for (const failure of failures) {
    const resolution = buildCompanyResolution({
      accountName: failure.accountName,
      source: failure.source || 'manual',
      aliasConfig: loadCompanyAliasConfig(),
      priorCoverage: loadExistingAccountCoverageArtifact(failure.accountName),
    });
    const written = writeCompanyResolutionArtifact(resolution);
    logger.info(`Resolved ${failure.accountName}: ${resolution.status} | confidence=${resolution.confidence} | next=${resolution.recommendedAction}`);
    logger.info(`Artifact: ${written.artifactPath}`);
  }
}

function collectCompanyResolutionFailureAccounts() {
  const dir = resolveProjectPath('runtime', 'artifacts', 'background-runner');
  if (!fs.existsSync(dir)) {
    return [];
  }

  const byAccount = new Map();
  for (const fileName of fs.readdirSync(dir).filter((entry) => /^.+-loop-.+\.json$/i.test(entry))) {
    const filePath = path.join(dir, fileName);
    let artifact = null;
    try {
      artifact = readJson(filePath);
    } catch {
      continue;
    }
    for (const result of artifact.results || []) {
      if (!/all_sweeps_failed/i.test(result.coverageError || '')) {
        continue;
      }
      if (!byAccount.has(result.accountName)) {
        byAccount.set(result.accountName, {
          accountName: result.accountName,
          source: result.source || 'manual',
          evidenceArtifactPath: filePath,
        });
      }
    }
  }

  return [...byAccount.values()];
}

async function handleRunCompanyResolutionRetries(values, logger) {
  if (
    getBoolean(values, 'liveSave', 'live-save')
    || getBoolean(values, 'liveConnect', 'live-connect')
    || getBoolean(values, 'allow-background-connects')
  ) {
    throw new Error('run-company-resolution-retries is dry-safe only and refuses live-save, live-connect, or background connects');
  }

  const limit = Number(getString(values, 'limit') || 3);
  const maxRetries = Number(getString(values, 'max-retries') || 1);
  const retryCheckpointPath = getString(values, 'retry-checkpoint') || defaultCompanyResolutionRetryCheckpointPath();
  const retryCheckpoint = loadCompanyResolutionRetryCheckpoint(retryCheckpointPath);
  const sourceCheckpointPath = getString(values, 'source-checkpoint')
    || resolveProjectPath('runtime', 'artifacts', 'background-runner', 'example-example-loop-checkpoint.json');
  const sourceCheckpoint = fs.existsSync(sourceCheckpointPath)
    ? loadBackgroundRunnerCheckpoint(sourceCheckpointPath)
    : null;
  const failures = collectAllSweepsFailedAccounts({ checkpoint: sourceCheckpoint });
  if (failures.length === 0) {
    logger.info('No all_sweeps_failed accounts found for company-resolution retry.');
    return;
  }

  const prepared = prepareCompanyResolutionRetryCandidates({
    failures,
    retryCheckpoint,
    maxRetries,
    buildResolution: (failure) => buildCompanyResolution({
      accountName: failure.accountName,
      source: failure.source || 'manual',
      aliasConfig: loadCompanyAliasConfig(),
      priorCoverage: loadExistingAccountCoverageArtifact(failure.accountName),
    }),
    writeResolution: writeCompanyResolutionArtifact,
  });
  const retryable = prepared.filter((candidate) => candidate.retryable).slice(0, Math.max(1, limit));
  const skipped = prepared.filter((candidate) => !candidate.retryable);
  if (retryable.length === 0) {
    const nextRetryCheckpoint = updateCompanyResolutionRetryCheckpoint({
      checkpoint: retryCheckpoint,
      prepared,
      results: [],
    });
    writeCompanyResolutionRetryCheckpoint(nextRetryCheckpoint, retryCheckpointPath);
    logger.info(`No retryable company-resolution accounts found. Skipped=${skipped.length}`);
    for (const candidate of skipped) {
      logger.info(`Skipped ${candidate.accountName}: ${candidate.skipReason} | resolution=${candidate.resolutionStatus || 'unknown'} | next=${candidate.nextAction || 'review_company_targets_manually'}`);
    }
    return;
  }

  const queueSpec = buildCompanyResolutionRetryQueue({
    candidates: retryable,
    maxRetries,
  });
  const queueArtifactPath = getString(values, 'queue-artifact') || defaultCompanyResolutionRetryQueuePath();
  writeJson(queueArtifactPath, queueSpec);

  const driverName = getString(values, 'driver') || 'hybrid';
  const coverageConfig = loadAccountCoverageConfig(getString(values, 'coverage-config') || resolveProjectPath('config', 'account-coverage', 'lean-observability.json'));
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const priorityModel = loadPriorityModel();
  const peopleSearchUrl = getString(values, 'people-search-url') || 'https://www.linkedin.com/sales/search/people?viewAllFilters=true';
  const maxCandidates = Number(getString(values, 'max-candidates') || 25);
  const accountTimeoutMs = Number(getString(values, 'account-timeout-ms') ?? 180000);
  const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: true }, {
    sessionMode: 'persistent',
    headless: true,
  }));
  const loopArtifactPath = buildBackgroundLoopArtifactPath(queueSpec.owner?.name);
  const runnerCheckpoint = {
    owner: queueSpec.owner,
    processedAccountIds: [],
    accountInsights: {},
    batches: [],
  };
  const variationRegistry = {
    owner: queueSpec.owner,
    observations: [],
    accountPatterns: {},
    updatedAt: null,
  };

  try {
    try {
      await driver.openSession({
        runId: 'company-resolution-retry',
        territoryId: queueSpec.owner?.name || 'company-resolution-retry',
        dryRun: true,
        weeklyCap: 140,
      });
      const health = await driver.checkSessionHealth();
      if (!health.ok) {
        const environment = classifyBackgroundEnvironmentHealth({ health });
        const loopArtifact = buildBackgroundEnvironmentBlockArtifact({
          owner: queueSpec.owner,
          queueArtifactPath,
          checkpointPath: retryCheckpointPath,
          variationRegistryPath: null,
          liveSave: false,
          driver: driverName,
          environment,
        });
        writeJson(loopArtifactPath, loopArtifact);
        const loopReportPath = writeBackgroundLoopReport({
          ...loopArtifact,
          artifactPath: loopArtifactPath,
        });
        logger.warn(`Company-resolution retry blocked by environment: ${environment.state}${environment.detail ? ` | ${environment.detail}` : ''}`);
        logger.info(`Retry queue artifact: ${queueArtifactPath}`);
        logger.info(`Retry artifact: ${loopArtifactPath}`);
        logger.info(`Retry report: ${loopReportPath}`);
        return;
      }
    } catch (error) {
      const environment = classifyBackgroundEnvironmentHealth({ error });
      const loopArtifact = buildBackgroundEnvironmentBlockArtifact({
        owner: queueSpec.owner,
        queueArtifactPath,
        checkpointPath: retryCheckpointPath,
        variationRegistryPath: null,
        liveSave: false,
        driver: driverName,
        environment,
      });
      writeJson(loopArtifactPath, loopArtifact);
      const loopReportPath = writeBackgroundLoopReport({
        ...loopArtifact,
        artifactPath: loopArtifactPath,
      });
      logger.warn(`Company-resolution retry blocked by environment: ${environment.state}${environment.detail ? ` | ${environment.detail}` : ''}`);
      logger.info(`Retry queue artifact: ${queueArtifactPath}`);
      logger.info(`Retry artifact: ${loopArtifactPath}`);
      logger.info(`Retry report: ${loopReportPath}`);
      return;
    }

    const loopResult = await executeBackgroundListMaintenanceLoop({
      driver,
      queueSpec,
      checkpoint: runnerCheckpoint,
      limit: retryable.length,
      coverageConfig,
      icpConfig,
      priorityModel,
      peopleSearchUrl,
      maxCandidates,
      liveSave: false,
      allowBackgroundConnects: false,
      variationRegistry,
      logger,
      accountTimeoutMs,
    });
    const loopArtifact = {
      artifactPath: loopArtifactPath,
      owner: queueSpec.owner,
      driver: driverName,
      queueArtifactPath,
      checkpointPath: retryCheckpointPath,
      variationRegistryPath: null,
      liveSave: false,
      processedAt: new Date().toISOString(),
      status: 'completed',
      environment: {
        ok: true,
        state: 'healthy',
        detail: null,
        sessionCheckSkipped: false,
        sessionCheckReason: null,
      },
      metrics: loopResult.metrics,
      results: loopResult.results,
      deferredAccounts: loopResult.deferredAccounts,
    };
    writeJson(loopArtifactPath, loopArtifact);
    const loopReportPath = writeBackgroundLoopReport(loopArtifact);
    const nextRetryCheckpoint = updateCompanyResolutionRetryCheckpoint({
      checkpoint: retryCheckpoint,
      prepared: retryable,
      results: loopResult.results,
    });
    writeCompanyResolutionRetryCheckpoint(nextRetryCheckpoint, retryCheckpointPath);

    logger.info(`Company-resolution retry queue: ${queueArtifactPath}`);
    logger.info(`Company-resolution retry artifact: ${loopArtifactPath}`);
    logger.info(`Company-resolution retry report: ${loopReportPath}`);
    logger.info(`Retry checkpoint: ${retryCheckpointPath}`);
    logger.info(`Accounts attempted: ${loopResult.accountsAttempted}`);
    logger.info(`Recovered accounts: ${loopResult.results.filter((result) => result.resolutionRetryStatus === 'recovered').length}`);
    logger.info(`Manual review accounts: ${loopResult.results.filter((result) => result.resolutionRetryStatus === 'manual_review').length}`);
    for (const result of loopResult.results) {
      logger.info(`${result.accountName}: retry=${result.resolutionRetryStatus} | candidates=${result.candidateCount} | list_candidates=${result.listCandidateCount} | next=${result.resolutionNextAction || 'none'}`);
    }
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handleDeepReviewCoverage(values, logger) {
  const driverName = getString(values, 'driver') || 'playwright';
  const accountName = getString(values, 'account-name');
  const artifactPath = getString(values, 'artifact')
    || (accountName
      ? resolveProjectPath('runtime', 'artifacts', 'coverage', `${accountName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`)
      : null);
  if (!artifactPath || !fs.existsSync(artifactPath)) {
    throw new Error('deep-review-coverage requires --account-name or --artifact pointing to an existing coverage artifact');
  }

  const reviewLimit = Number(getString(values, 'review-limit') || 8);
  const coverageConfig = loadAccountCoverageConfig(getString(values, 'coverage-config') || resolveProjectPath('config', 'account-coverage', 'lean-observability.json'));
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const priorityModelArtifact = loadPriorityModel();
  const coverageResult = readJson(artifactPath);
  const selected = selectDeepReviewCandidates(coverageResult, reviewLimit);

  if (selected.length === 0) {
    logger.info('No deep-review candidates matched the current selection rules.');
    return;
  }

  const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: true }, {
    sessionMode: 'persistent',
    headless: true,
  }));

  const updates = new Map();
  try {
    await driver.openSession({
      runId: 'deep-review-coverage',
      territoryId: 'deep-review-coverage',
      dryRun: true,
      weeklyCap: 140,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }

    for (const candidate of selected) {
      try {
        await driver.openCandidate(candidate, { runId: 'deep-review-coverage', accountKey: 'coverage' });
        const evidence = await driver.captureEvidence({
          ...candidate,
          fromListPage: false,
        }, {
          runId: 'deep-review-coverage',
          accountKey: 'coverage',
          deepProfileReview: true,
        });

        const rescored = scoreCandidate({
          ...candidate,
          about: evidence.snippet,
          summary: evidence.snippet,
          evidence,
        }, icpConfig);
        const reviewedPriority = priorityModelArtifact
          ? scoreCandidateWithPriorityModel({
            ...candidate,
            about: evidence.snippet,
            summary: evidence.snippet,
          }, priorityModelArtifact)
          : candidate.priorityModel || null;
        const reviewedBucket = classifyReviewedCoverageBucket({
          roleFamily: rescored.roleFamily,
          score: rescored.score,
          scoreBreakdown: rescored.breakdown,
        }, coverageConfig);

        updates.set(candidate.salesNavigatorUrl || candidate.profileUrl, applyDeepReviewResult(
          candidate,
          rescored,
          reviewedPriority,
          reviewedBucket,
          evidence,
        ));
      } catch (error) {
        updates.set(candidate.salesNavigatorUrl || candidate.profileUrl, {
          ...candidate,
          deepReview: {
            reviewedAt: new Date().toISOString(),
            failed: true,
            message: summarizeErrorMessage(error.message),
          },
        });
      }
    }
  } finally {
    await driver.close().catch(() => {});
  }

  coverageResult.candidates = coverageResult.candidates.map((candidate) =>
    updates.get(candidate.salesNavigatorUrl || candidate.profileUrl) || candidate);
  writeAccountCoverageArtifact(coverageResult.accountName, coverageResult);

  logger.info(`Driver: ${driverName}`);
  logger.info(`Artifact: ${artifactPath}`);
  logger.info(`Deep reviewed: ${selected.length}`);

  selected.forEach((candidate, index) => {
    const reviewed = updates.get(candidate.salesNavigatorUrl || candidate.profileUrl);
    const status = reviewed?.deepReview?.failed
      ? `failed: ${reviewed.deepReview.message}`
      : `${candidate.coverageBucket} -> ${reviewed.coverageBucket} | score ${candidate.score} -> ${reviewed.score}`;
    logger.info(`${index + 1}. ${candidate.fullName} | ${candidate.title} | ${status}`);
  });
}

async function handleRenderCoverageReview(values, logger) {
  const accountName = getString(values, 'account-name');
  const artifactPath = getString(values, 'artifact')
    || (accountName
      ? resolveProjectPath('runtime', 'artifacts', 'coverage', `${accountName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`)
      : null);
  if (!artifactPath || !fs.existsSync(artifactPath)) {
    throw new Error('render-coverage-review requires --account-name or --artifact pointing to an existing coverage artifact');
  }

  const coverageArtifact = readJson(artifactPath);
  const markdown = renderCoverageReviewMarkdown(coverageArtifact);
  const outputPath = getString(values, 'review-output')
    || artifactPath.replace(/\.json$/i, '-review.md');

  fs.writeFileSync(outputPath, markdown, { encoding: 'utf8', mode: 0o600 });
  try {
    fs.chmodSync(outputPath, 0o600);
  } catch {
    // best effort
  }

  logger.info(`Coverage review: ${outputPath}`);
}

async function handleSendApproved(repository, values, logger) {
  const runId = getString(values, 'run-id', 'run');
  const run = runId
    ? repository.getRun(runId)
    : repository.getDashboardSummary().runs[0]
      ? repository.getRun(repository.getDashboardSummary().runs[0].run_id)
      : null;

  if (!run) {
    throw new Error('No run available for connect execution.');
  }
  const budgetPolicy = buildConnectBudgetPolicy(values);

  const driver = createDriver(run.driver, buildDriverOptions(values, run, {
    sessionMode: 'persistent',
    headless: true,
  }));

  await driver.openSession({
    runId: run.runId,
    territoryId: run.territoryId,
    dryRun: run.dryRun,
    weeklyCap: budgetPolicy.weeklyCap,
  });
  const health = await driver.checkSessionHealth();
  if (!health.ok) {
    await driver.close().catch(() => {});
    throw new Error(`Driver session is not ready for connect execution: ${health.state}`);
  }

  const result = await sendApprovedConnects({
    repository,
    driver,
    runContext: {
      ...run,
      weeklyCap: budgetPolicy.weeklyCap,
      connectBudgetPolicy: budgetPolicy,
    },
    limit: Number(getString(values, 'limit') || 25),
  });
  await driver.close();

  logger.info(`Processed ${result.processed} approved people`);
  logger.info(`Sent ${result.sent} connect actions`);
  logger.info(`Skipped ${result.skipped} connect actions`);
  logger.info(`Budget mode: ${result.budget.budgetMode}`);
  logger.info(`Tool share: ${result.budget.toolSharePercent}%`);
  logger.info(`Remaining today: ${result.budget.remainingToday}`);
  logger.info(`Remaining this week: ${result.budget.remainingThisWeek}`);
  logger.info(`Reason: ${result.reason}`);
}

function createSalesforceAdapter() {
  return new ReadOnlySalesforceAdapter({
    snapshotUrl: process.env.SALESFORCE_SNAPSHOT_URL || null,
    instanceUrl: process.env.SALESFORCE_INSTANCE_URL || null,
    accessToken: process.env.SALESFORCE_ACCESS_TOKEN || null,
    apiVersion: process.env.SALESFORCE_API_VERSION || 'v61.0',
    territoryQuery: process.env.SALESFORCE_TERRITORY_QUERY || null,
    accountQuery: process.env.SALESFORCE_ACCOUNT_QUERY || null,
    authHeader: process.env.SALESFORCE_AUTH_HEADER || null,
  });
}

async function handleReconcile(repository, logger) {
  const issues = reconcileState(repository);
  if (issues.length === 0) {
    logger.info('No reconciliation issues found.');
    return;
  }

  logger.warn(`Found ${issues.length} reconciliation issue groups`);
  for (const issue of issues) {
    logger.warn(`${issue.type}: ${issue.count}`);
  }
}

async function handleCleanupRuntime(values, logger) {
  const maxAgeHours = Number(getString(values, 'max-age-hours') || 72);
  const result = cleanupRuntimeArtifacts({ maxAgeHours });
  logger.info(`Deleted ${result.deletedCount} runtime artifacts older than ${result.maxAgeHours} hours`);
}

async function handlePrintLiveTestChecklist(logger) {
  const checklistPath = resolveProjectPath('docs', 'first-live-test-checklist.md');
  const content = fs.readFileSync(checklistPath, 'utf8');
  logger.info(content.trim());
}

async function handlePrintPilotOperatorQuickstart(logger) {
  const quickstartPath = resolveProjectPath('docs', 'operator-quickstart.md');
  const content = fs.readFileSync(quickstartPath, 'utf8');
  logger.info(content.trim());
}

async function handlePrintMvpReleaseContract(logger) {
  const contractPath = resolveProjectPath('docs', 'release-contract.md');
  const content = fs.readFileSync(contractPath, 'utf8');
  logger.info(content.trim());
}

async function handlePrintMvpMorningReleaseSummary(logger) {
  const summaryPath = resolveProjectPath('docs', 'operator-summary.md');
  const content = fs.readFileSync(summaryPath, 'utf8');
  logger.info(content.trim());
}

async function handlePrintMvpOperatorDashboard(logger) {
  const latest = readLatestAutoresearchArtifact();
  if (!latest) {
    logger.warn('No MVP autoresearch artifact found. Run npm run autoresearch:mvp first.');
    logger.info(renderMvpOperatorDashboard(null).trim());
    return;
  }

  logger.info(`Autoresearch artifact: ${latest.artifactPath}`);
  logger.info(renderMvpOperatorDashboard(latest.artifact).trim());
}

async function handleBuildConnectEvidenceSprint(values, logger) {
  if (getBoolean(values, 'liveSave', 'live-save') || getBoolean(values, 'liveConnect', 'live-connect')) {
    throw new Error('build-connect-evidence-sprint is dry-safe only and refuses live-save or live-connect');
  }
  const acceptanceArtifactPath = getString(values, 'artifact')
    || resolveProjectPath('runtime', 'artifacts', 'account-batches', 'supervised-acceptance.json');
  if (!fs.existsSync(acceptanceArtifactPath)) {
    throw new Error(`Connect acceptance artifact not found: ${acceptanceArtifactPath}`);
  }
  const result = writeConnectEvidenceSprint({
    acceptanceArtifactPath,
    ...(getString(values, 'output') ? { artifactPath: getString(values, 'output') } : {}),
  });
  logger.info(`Connect evidence artifact: ${result.artifactPath}`);
  logger.info(`Connect evidence report: ${result.reportPath}`);
  logger.info(`Rows: ${result.artifact.summary.total}`);
  logger.info(`Guarded rows: ${result.artifact.summary.guarded}`);
  logger.info(`Candidates for supervised retest: ${result.artifact.summary.candidatesForSupervisedRetest}`);
  for (const action of result.artifact.nextActions) {
    logger.info(`Next: ${action}`);
  }
}

async function handlePrintLatestBackgroundRunnerReport(logger) {
  const latest = readLatestBackgroundLoopReport();
  if (!latest) {
    logger.warn('No background runner markdown report found. Run run-background-territory-loop first.');
    return;
  }

  logger.info(`Report: ${latest.reportPath}`);
  logger.info(latest.content.trim());
}

async function handleCheckLiveReadiness(values, logger) {
  const driverName = getString(values, 'driver') || 'playwright';
  const driverOptions = buildDriverOptions(values, { dryRun: false }, {
    sessionMode: 'persistent',
    headless: true,
    recoveryMode: 'screenshot-only',
  });

  let sessionHealth = null;
  if (!getBoolean(values, 'skip-session-check')) {
    const driver = createDriver(driverName, driverOptions);
    try {
      await driver.openSession({
        runId: 'check-live-readiness',
        territoryId: 'check-live-readiness',
        dryRun: true,
        weeklyCap: 140,
      });
      sessionHealth = await driver.checkSessionHealth();
    } catch (error) {
      sessionHealth = {
        ok: false,
        state: 'session_check_failed',
        detail: error.message,
      };
    } finally {
      await driver.close().catch(() => {});
    }
  }

  const report = analyzeLiveReadiness({
    values,
    driverOptions,
    sessionHealth,
    env: process.env,
  });

  logger.info(`Overall: ${report.overall.toUpperCase()}`);
  for (const check of report.checks) {
    logger.info(`[${check.status.toUpperCase()}] ${check.label}: ${check.detail}`);
  }

  const blockers = report.checks.filter((check) => check.status === 'blocker').length;
  const warnings = report.checks.filter((check) => check.status === 'warn').length;
  logger.info(`Summary: ${blockers} blocker(s), ${warnings} warning(s)`);
}

async function handleBuildPriorityModel(values, logger) {
  const adapter = new GTMBigQueryAdapter({
    cliPath: getString(values, 'gtm-data-api-path') || undefined,
    maxGb: Number(getString(values, 'max-gb') || 20),
  });
  const config = loadPriorityScoreConfig();
  const warnings = [];
  const winningContactRows = adapter.queryFile(
    resolveProjectPath('queries', 'priority-model', '01_winning_contact_role_baseline.sql'),
  );
  const hiddenInfluencerRows = tryQueryFile(
    adapter,
    resolveProjectPath('queries', 'priority-model', '02_hidden_influencer_detection.sql'),
    { maxGb: 50 },
    warnings,
    'hidden_influencer_detection_unavailable',
  );
  const conversation_intelligenceKeywordRows = tryQueryFile(
    adapter,
    resolveProjectPath('queries', 'priority-model', '03_conversation_intelligence_keyword_signals.sql'),
    { maxGb: 50 },
    warnings,
    'conversation_intelligence_keyword_signals_unavailable',
  );

  const model = buildPriorityModelV1({
    config,
    winningContactRows,
    hiddenInfluencerRows,
    conversation_intelligenceKeywordRows,
    warnings,
  });
  const artifactPath = writePriorityModelArtifact(model, getString(values, 'output') || null);

  logger.info(`Built priority model: ${model.modelId}`);
  logger.info(`Role families: ${model.roleFamilyScores.length}`);
  logger.info(`Hidden influencer families: ${model.hiddenInfluencerSignals.length}`);
  logger.info(`Conversation Intelligence families: ${model.conversation_intelligenceSignals.length}`);
  logger.info(`Artifact: ${artifactPath}`);
  warnings.forEach((warning) => logger.warn(warning));

  model.roleFamilyScores.slice(0, 5).forEach((entry, index) => {
    logger.info(`${index + 1}. ${entry.roleFamily} | score=${entry.priorityScore} | won_opps=${entry.wonOpportunities} | total_won_amount=${entry.totalWonAmount}`);
  });
}

async function handleBuildBackgroundTerritoryQueue(values, logger) {
  const adapter = new GTMBigQueryAdapter({
    cliPath: getString(values, 'gtm-data-api-path') || undefined,
    maxGb: Number(getString(values, 'max-gb') || 20),
  });
  const config = loadBackgroundRunnerConfig();
  const runnerDefaults = buildBackgroundRunnerDefaults(config, {
    ownerName: getString(values, 'owner-name') || config.owner?.name,
    ownerEmail: getString(values, 'owner-email') || config.owner?.email,
    staleDays: getString(values, 'stale-days'),
    weeklyCap: getString(values, 'weekly-cap'),
    budgetMode: getString(values, 'budget-mode'),
    toolSharePercent: getString(values, 'tool-share-percent'),
    dailyMax: getString(values, 'daily-max'),
    dailyMin: getString(values, 'daily-min'),
    allowBackgroundConnects: getBoolean(values, 'allow-background-connects'),
  });

  const warnings = [];
  const ownerName = runnerDefaults.owner.name || '';
  const ownerEmail = runnerDefaults.owner.email || '';
  const ownerNameReversed = reverseDisplayName(ownerName);
  const staleDays = runnerDefaults.staleAccountPolicy.activityLookbackDays;
  const ownedTerritorySql = interpolateQueryTemplate(
    resolveProjectPath('queries', 'background-runner', '01_owned_territory_accounts.sql'),
    {
      owner_name: ownerName,
      owner_name_reversed: ownerNameReversed,
      owner_email: ownerEmail,
      stale_days: staleDays,
    },
  );

  const territoryRows = adapter.query(ownedTerritorySql, { maxGb: 5 });
  const territoryAccounts = normalizeTerritoryAccountRows(territoryRows, runnerDefaults);

  let seedAccounts = [];
  const seedDataset = getString(values, 'seed-dataset');
  const seedFile = getString(values, 'seed-file');
  if (seedFile) {
    try {
      seedAccounts = await loadSeedAccountsFromFile({
        seedFile,
        adapter,
        ownerName,
      });
    } catch (error) {
      warnings.push(`seed_expansion_unavailable: ${summarizeErrorMessage(error.message)}`);
    }
  } else if (seedDataset) {
    try {
      const seedSql = interpolateQueryTemplate(
        resolveProjectPath('queries', 'background-runner', '02_seed_list_expansion.sql'),
        {
          owner_name: ownerName,
          owner_name_reversed: ownerNameReversed,
          seed_dataset: seedDataset,
        },
      );
      const seedRows = adapter.query(seedSql, { maxGb: 5 });
      seedAccounts = seedRows.map((row) => ({
        accountId: row.sfdc_account_id || row.account_id || row.accountId,
        accountName: row.account_name || row.accountName,
        ownerName: row.owner_name || row.ownerName || null,
        ownerEmail: row.owner_email || row.ownerEmail || null,
        parentAccountId: row.parent_account_id || row.parentAccountId || null,
        parentAccountName: row.parent_account_name || row.parentAccountName || null,
        region: row.region || null,
        industry: row.industry || null,
        seedType: row.seed_type || row.seedType || null,
        seedName: row.seed_name || row.seedName || null,
        stale: true,
        stalePriorityScore: 99998,
        source: 'seed',
      }));
    } catch (error) {
      warnings.push(`seed_expansion_unavailable: ${summarizeErrorMessage(error.message)}`);
    }
  } else {
    warnings.push('seed_expansion_unavailable: no --seed-dataset or --seed-file provided');
  }

  let subsidiaryAccounts = [];
  const skipSubsidiaries = getBoolean(values, 'no-subsidiaries', 'no-subsidiary-expansion');
  if (skipSubsidiaries) {
    warnings.push('subsidiary_expansion_disabled: --no-subsidiaries');
  } else {
    try {
      const subsidiarySql = interpolateQueryTemplate(
        resolveProjectPath('queries', 'background-runner', '03_subsidiary_expansion_candidates.sql'),
        {
          owner_name: ownerName,
          owner_name_reversed: ownerNameReversed,
          owner_email: ownerEmail,
        },
      );
      const subsidiaryRows = adapter.query(subsidiarySql, { maxGb: 5 });
      subsidiaryAccounts = subsidiaryRows.map((row) => ({
        accountId: row.sfdc_account_id || row.account_id || row.accountId,
        accountName: row.account_name || row.accountName,
        ownerName: row.owner_name || row.ownerName || null,
        ownerEmail: row.owner_email || row.ownerEmail || null,
        parentAccountId: row.parent_account_id || row.parentAccountId || null,
        parentAccountName: row.parent_account_name || row.parentAccountName || null,
        matchedParentAccountId: row.matched_parent_account_id || row.matchedParentAccountId || null,
        matchedParentAccountName: row.matched_parent_account_name || row.matchedParentAccountName || null,
        lastActivityAt: row.matched_parent_last_activity_at || row.matchedParentLastActivityAt || null,
        daysSinceActivity: Number(
          row.matched_parent_days_since_activity
          || row.matchedParentDaysSinceActivity
          || 99997
        ),
        stale: true,
        stalePriorityScore: Number(
          row.matched_parent_days_since_activity
          || row.matchedParentDaysSinceActivity
          || 99997
        ),
        source: 'subsidiary',
      }));
    } catch (error) {
      warnings.push(`subsidiary_expansion_unavailable: ${summarizeErrorMessage(error.message)}`);
    }
  }

  const spec = buildBackgroundRunnerSpec({
    runnerDefaults,
    territoryAccounts,
    seedAccounts,
    subsidiaryAccounts,
  });
  spec.queryContext = {
    ownerName,
    ownerEmail,
    staleDays,
    seedDataset: seedDataset || null,
    seedFile: seedFile || null,
    subsidiaryExpansionDisabled: skipSubsidiaries,
    warnings,
  };

  const artifactPath = writeBackgroundRunnerArtifact(spec, getString(values, 'output') || null);

  logger.info(`Built background territory queue for ${ownerName || ownerEmail || 'unknown owner'}`);
  logger.info(`Artifact: ${artifactPath}`);
  logger.info(`Territory accounts: ${spec.counts.territoryAccounts}`);
  logger.info(`Seed accounts: ${spec.counts.seedAccounts}`);
  logger.info(`Subsidiary accounts: ${spec.counts.subsidiaryAccounts}`);
  logger.info(`Merged queue: ${spec.counts.mergedAccounts}`);
  logger.info(`Stale accounts: ${spec.counts.staleAccounts}`);
  logger.info(`Budget mode: ${spec.connectPolicy.budgetPolicy.budgetMode}`);
  logger.info(`Tool share: ${spec.connectPolicy.budgetPolicy.toolSharePercent}%`);
  warnings.forEach((warning) => logger.warn(warning));

  spec.queue.slice(0, 10).forEach((account, index) => {
    logger.info(`${index + 1}. ${account.accountName} | stale_score=${account.stalePriorityScore} | source=${account.source || 'territory'}`);
  });
}

async function handleRunBackgroundTerritoryLoop(values, logger) {
  const queueArtifactPath = getString(values, 'queue-artifact')
    || resolveProjectPath('runtime', 'artifacts', 'background-runner', 'example-operator-territory-queue.json');
  if (!fs.existsSync(queueArtifactPath)) {
    throw new Error(`Background queue artifact not found: ${queueArtifactPath}`);
  }

  const queueSpec = loadBackgroundRunnerArtifact(queueArtifactPath);
  const checkpointPath = getString(values, 'checkpoint')
    || defaultRunnerCheckpointPath(queueSpec.owner?.name);
  const checkpoint = loadBackgroundRunnerCheckpoint(checkpointPath, queueSpec);
  const variationRegistryPath = getString(values, 'variation-registry')
    || defaultVariationRegistryPath(queueSpec.owner?.name);
  const variationRegistry = loadVariationRegistry(variationRegistryPath, queueSpec);
  const driverName = getString(values, 'driver') || 'hybrid';
  const liveSave = getBoolean(values, 'liveSave', 'live-save');
  const limit = Number(getString(values, 'limit') || 3);
  const coverageConfig = loadAccountCoverageConfig(getString(values, 'coverage-config') || resolveProjectPath('config', 'account-coverage', 'lean-observability.json'));
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const priorityModel = loadPriorityModel();
  const peopleSearchUrl = getString(values, 'people-search-url') || 'https://www.linkedin.com/sales/search/people?viewAllFilters=true';
  const maxCandidates = parseOptionalCandidateLimit(getString(values, 'max-candidates'));
  const speedProfile = getString(values, 'speed-profile') || 'balanced';
  const reuseSweepCache = getBoolean(values, 'reuse-sweep-cache') || !liveSave;
  const researchConcurrency = Number(getString(values, 'research-concurrency') || 1);
  if (liveSave && researchConcurrency > 1) {
    throw new Error('research-concurrency > 1 is only allowed for read-only research; live-save stays serial');
  }
  const accountTimeoutMs = Number(getString(values, 'account-timeout-ms') ?? 180000);
  const connectPolicy = queueSpec.connectPolicy?.budgetPolicy || resolveConnectBudgetPolicy({
    weeklyCap: 140,
    budgetMode: 'assist',
  });
  const coverageCachePolicy = {
    enabled: queueSpec.coverageCache?.enabled !== false,
    maxAgeDays: Number(queueSpec.coverageCache?.maxAgeDays ?? 7),
    reuseEmptyArtifacts: getBoolean(values, 'reuse-empty-cache')
      ? true
      : Boolean(queueSpec.coverageCache?.reuseEmptyArtifacts),
  };
  const effectiveQueueSpec = {
    ...queueSpec,
    coverageCache: coverageCachePolicy,
  };
  const selectedBatch = selectBackgroundMaintenanceBatch(effectiveQueueSpec, checkpoint, limit, variationRegistry);
  const cacheOnlyDryRun = !liveSave && selectedBatch.length > 0 && selectedBatch.every((account) => (
    isCoverageArtifactFresh(loadExistingAccountCoverageArtifact(account.accountName), effectiveQueueSpec.coverageCache)
  ));
  const emptyDryRun = !liveSave && selectedBatch.length === 0;

  const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: !liveSave }, {
    sessionMode: 'persistent',
    headless: true,
  }));
  const loopArtifactPath = buildBackgroundLoopArtifactPath(effectiveQueueSpec.owner?.name);

  try {
    if (cacheOnlyDryRun || emptyDryRun) {
      logger.info(cacheOnlyDryRun
        ? `Background loop using fresh cached coverage artifacts for ${selectedBatch.length} accounts; skipping browser session check`
        : 'Background loop has no eligible accounts in this batch; skipping browser session check');
    } else {
      try {
        await driver.openSession({
          runId: 'background-list-maintenance',
          territoryId: effectiveQueueSpec.owner?.name || 'background-runner',
          dryRun: !liveSave,
          weeklyCap: connectPolicy.weeklyCap,
        });
        const health = await driver.checkSessionHealth();
        if (!health.ok) {
          const environment = classifyBackgroundEnvironmentHealth({ health });
          const loopArtifact = buildBackgroundEnvironmentBlockArtifact({
            owner: effectiveQueueSpec.owner,
            queueArtifactPath,
            checkpointPath,
            variationRegistryPath,
            liveSave,
            driver: driverName,
            environment,
          });
          writeJson(loopArtifactPath, loopArtifact);
          const loopReportPath = writeBackgroundLoopReport({
            ...loopArtifact,
            artifactPath: loopArtifactPath,
          });
          logger.warn(`Background loop blocked by environment: ${environment.state}${environment.detail ? ` | ${environment.detail}` : ''}`);
          logger.info(`Background loop artifact: ${loopArtifactPath}`);
          logger.info(`Background loop report: ${loopReportPath}`);
          return;
        }
      } catch (error) {
        const environment = classifyBackgroundEnvironmentHealth({ error });
        const loopArtifact = buildBackgroundEnvironmentBlockArtifact({
          owner: effectiveQueueSpec.owner,
          queueArtifactPath,
          checkpointPath,
          variationRegistryPath,
          liveSave,
          driver: driverName,
          environment,
        });
        writeJson(loopArtifactPath, loopArtifact);
        const loopReportPath = writeBackgroundLoopReport({
          ...loopArtifact,
          artifactPath: loopArtifactPath,
        });
        logger.warn(`Background loop blocked by environment: ${environment.state}${environment.detail ? ` | ${environment.detail}` : ''}`);
        logger.info(`Background loop artifact: ${loopArtifactPath}`);
        logger.info(`Background loop report: ${loopReportPath}`);
        return;
      }
    }

    const loopResult = await executeBackgroundListMaintenanceLoop({
      driver,
      queueSpec: effectiveQueueSpec,
      checkpoint,
      limit,
      coverageConfig,
      icpConfig,
      priorityModel,
      peopleSearchUrl,
      maxCandidates,
      speedProfile,
      reuseSweepCache,
      liveSave,
      allowBackgroundConnects: Boolean(effectiveQueueSpec.connectPolicy?.allowBackgroundConnects),
      variationRegistry,
      logger,
      accountTimeoutMs,
      recoverDriverSession: async () => {
        await driver.openSession({
          runId: 'background-list-maintenance',
          territoryId: effectiveQueueSpec.owner?.name || 'background-runner',
          dryRun: !liveSave,
          weeklyCap: connectPolicy.weeklyCap,
        });
        const health = await driver.checkSessionHealth();
        if (!health.ok) {
          throw new Error(`Driver session is not ready after account timeout recovery: ${health.state}`);
        }
      },
    });

    writeBackgroundRunnerCheckpoint(loopResult.updatedCheckpoint, checkpointPath);
    writeVariationRegistry(loopResult.updatedVariationRegistry, variationRegistryPath);
    const loopArtifact = {
      artifactPath: loopArtifactPath,
      owner: effectiveQueueSpec.owner,
      driver: driverName,
      queueArtifactPath,
      checkpointPath,
      variationRegistryPath,
      liveSave,
      processedAt: new Date().toISOString(),
      status: 'completed',
      environment: {
        ok: true,
        state: 'healthy',
        detail: cacheOnlyDryRun
          ? 'browser_session_check_skipped_cache_only'
          : emptyDryRun
            ? 'browser_session_check_skipped_empty_batch'
            : null,
        sessionCheckSkipped: cacheOnlyDryRun || emptyDryRun,
        sessionCheckReason: cacheOnlyDryRun
          ? 'cache_only'
          : emptyDryRun
            ? 'empty_batch'
            : null,
      },
      metrics: loopResult.metrics,
      results: loopResult.results,
    };
    writeJson(loopArtifactPath, loopArtifact);
    const loopReportPath = writeBackgroundLoopReport(loopArtifact);

    logger.info(`Background loop artifact: ${loopArtifactPath}`);
    logger.info(`Background loop report: ${loopReportPath}`);
    logger.info(`Checkpoint: ${checkpointPath}`);
    logger.info(`Variation registry: ${variationRegistryPath}`);
    logger.info(`Accounts attempted: ${loopResult.accountsAttempted}`);
    logger.info(`Productive accounts: ${loopResult.metrics.productiveAccounts}`);
    logger.info(`Cached accounts: ${loopResult.metrics.cachedAccounts}`);
    loopResult.results.forEach((result, index) => {
      logger.info(`${index + 1}. ${result.accountName} | source=${result.source} | list=${result.listName} | candidates=${result.candidateCount} | list_candidates=${result.listCandidateCount} | productivity=${result.productivity.classification}${result.cacheUsed ? ' | cache=reused' : ''}${liveSave ? ` | saves=${result.saves.length}` : ''}`);
    });
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handleAutoresearchMvp(values, logger) {
  if (getBoolean(values, 'live-save') || getBoolean(values, 'live-connect') || getBoolean(values, 'allow-background-connects')) {
    throw new Error('autoresearch-mvp is dry-safe only and refuses live-save, live-connect, or background connects');
  }

  const artifactPath = getString(values, 'artifact');
  const result = writeMvpAutoresearchRun({
    ...(artifactPath ? { artifactPath } : {}),
  });

  logger.info(`MVP autoresearch decision: ${result.artifact.decision}`);
  logger.info(`Reason: ${result.artifact.reason}`);
  logger.info(`Artifact: ${result.artifactPath}`);
  logger.info(`Report: ${result.reportPath}`);
  logger.info(`Healthy background evidence: ${result.artifact.background.healthyLiveRuns}`);
  logger.info(`Guarded connect references: ${result.artifact.connect.guardedReferences.length}`);
  for (const action of result.artifact.nextActions) {
    logger.info(`Next: ${action}`);
  }
}

async function handleRunAccountBatch(repository, values, logger) {
  const batchStartedAt = new Date().toISOString();
  const explicitNames = parseAccountNames(getString(values, 'account-names'));
  const singleName = getString(values, 'account-name');
  const accountNames = explicitNames.length > 0
    ? explicitNames
    : (singleName ? [singleName] : []);
  if (accountNames.length === 0) {
    throw new Error('run-account-batch requires --account-names="Account A, Account B, Account C" or --account-name');
  }

  const listPrefix = getString(values, 'list-prefix');
  const explicitConsolidatedListName = getString(values, 'consolidate-list-name');
  const listNameTemplate = getString(values, 'list-name-template');
  const templateConsolidatedListName = renderAccountBatchListNameTemplate(listNameTemplate, {
    accountNames,
    startedAt: batchStartedAt,
    endedAt: batchStartedAt,
  });
  const consolidatedListName = explicitConsolidatedListName || templateConsolidatedListName || null;
  const liveSave = getBoolean(values, 'liveSave', 'live-save');
  const liveConnect = getBoolean(values, 'liveConnect', 'live-connect');
  const pilotConfig = getString(values, 'pilot-config') ? loadPilotConfig(getString(values, 'pilot-config')) : null;
  const driverName = getString(values, 'driver') || ((liveSave || liveConnect) ? 'hybrid' : 'playwright');
  const peopleSearchUrl = getString(values, 'people-search-url') || 'https://www.linkedin.com/sales/search/people?viewAllFilters=true';
  const maxCandidates = parseOptionalCandidateLimit(getString(values, 'max-candidates'));
  const speedProfile = getString(values, 'speed-profile') || 'balanced';
  const reuseSweepCache = getBoolean(values, 'reuse-sweep-cache');
  const researchConcurrency = Number(getString(values, 'research-concurrency') || 1);
  if ((liveSave || liveConnect) && researchConcurrency > 1) {
    throw new Error('research-concurrency > 1 is only allowed for read-only research; live-save/live-connect stay serial');
  }
  const maxListSavesPerAccount = Number(getString(values, 'max-list-saves-per-account') || 0);
  const coverageConfig = loadAccountCoverageConfig(getString(values, 'coverage-config') || resolveProjectPath('config', 'account-coverage', 'lean-observability.json'));
  const icpConfig = readJson(resolveProjectPath('config', 'icp', 'default-observability.json'));
  const priorityModel = loadPriorityModel();
  const budgetPolicy = buildConnectBudgetPolicy(values);
  const rawBudget = repository.getBudgetState(budgetPolicy.effectiveWeeklyCap);
  const budget = computeBudgetState({
    weeklyCap: rawBudget.weeklyCap,
    sentThisWeek: rawBudget.weekCount,
    sentToday: rawBudget.dayCount,
    budgetMode: budgetPolicy.budgetMode,
    toolSharePercent: budgetPolicy.toolSharePercent,
    dailyMax: budgetPolicy.dailyMax,
    dailyMin: budgetPolicy.dailyMin,
  });

  const batchSessionMode = getString(values, 'session-mode')
    || ((driverName === 'playwright' && (liveSave || liveConnect)) ? 'storage-state' : 'persistent');

  const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: !liveSave && !liveConnect }, {
    sessionMode: batchSessionMode,
    headless: true,
    recoveryMode: 'screenshot-only',
  }));

  let sentThisRun = 0;
  try {
    await driver.openSession({
      runId: 'run-account-batch',
      territoryId: 'run-account-batch',
      dryRun: !(liveSave || liveConnect),
      weeklyCap: budgetPolicy.weeklyCap,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }

    const results = [];
    for (const accountName of accountNames) {
      const listName = consolidatedListName || buildAccountBatchListName(accountName, listPrefix);
      const coverageRun = await runAccountCoverageWorkflow({
        driver,
        accountName,
        peopleSearchUrl,
        coverageConfig,
        icpConfig,
        priorityModel,
        maxCandidates,
        speedProfile,
        reuseSweepCache,
        runId: 'run-account-batch',
        logger: {
          warn(message) {
            logger.warn(summarizeErrorMessage(message));
          },
        },
      });
      const coverageArtifactPath = writeAccountCoverageArtifact(accountName, coverageRun.result);
      const listCandidates = applyGeoFocusToCandidates(
        selectCoverageListCandidates(coverageRun.result),
        pilotConfig?.geoFocus || null,
      );
      const selectedForListSave = limitBatchCandidates(listCandidates, maxListSavesPerAccount);
      const saveResults = [];
      const connectResults = [];

      if (liveSave && selectedForListSave.length > 0) {
        await driver.ensureList(listName, {
          runId: 'run-account-batch',
          accountKey: accountName,
          dryRun: false,
        });

        for (const candidate of selectedForListSave) {
          try {
            const saveResult = await driver.saveCandidateToList(
              candidate,
              { listName, externalRef: null },
              { runId: 'run-account-batch', accountKey: accountName, dryRun: false },
            );
            saveResults.push({
              fullName: candidate.fullName,
              status: saveResult.status,
              note: saveResult.note || null,
            });
          } catch (error) {
            saveResults.push({
              fullName: candidate.fullName,
              status: 'failed',
              note: summarizeErrorMessage(error.message),
            });
          }
        }
      }

      const connectCandidates = liveSave ? selectedForListSave : listCandidates;
      if (liveConnect && connectCandidates.length > 0) {
        for (const candidate of connectCandidates) {
          const candidateId = candidate.salesNavigatorUrl || candidate.profileUrl || candidate.fullName;
          const remainingToday = budget.remainingToday - sentThisRun;
          const remainingWeek = budget.remainingThisWeek - sentThisRun;
          if (remainingToday <= 0 || remainingWeek <= 0) {
            connectResults.push({
              fullName: candidate.fullName,
              status: 'budget_exhausted',
              note: 'connect budget exhausted for this run',
            });
            continue;
          }
          if (repository.hasSentConnect(candidateId)) {
            connectResults.push({
              fullName: candidate.fullName,
              status: 'duplicate_skipped',
              note: 'already recorded as sent locally',
            });
            continue;
          }

          try {
            const connectResult = await driver.sendConnect(
              candidate,
              { runId: 'run-account-batch', accountKey: accountName, dryRun: false },
            );
            repository.insertConnectEvent(candidateId, null, 'connect', connectResult.status, {
              accountName,
              listName,
              fullName: candidate.fullName,
              note: connectResult.note || null,
            });
            if (connectResult.status === 'sent') {
              sentThisRun += 1;
            }
            connectResults.push({
              fullName: candidate.fullName,
              status: connectResult.status,
              note: connectResult.note || null,
              connectPath: connectResult.connectPath || null,
              fallbackTriggeredBy: connectResult.fallbackTriggeredBy || null,
              initialStatus: connectResult.initialStatus || null,
              initialNote: connectResult.initialNote || null,
            });
          } catch (error) {
            connectResults.push({
              fullName: candidate.fullName,
              status: 'failed',
              note: summarizeErrorMessage(error.message),
            });
          }
        }
      }

      results.push({
        accountName,
        listName,
        coverageArtifactPath,
        candidateCount: coverageRun.result.candidateCount,
        listCandidateCount: listCandidates.length,
        selectedForListSaveCount: selectedForListSave.length,
        saveResults,
        connectResults,
      });
      logger.info(`${accountName} | candidates=${coverageRun.result.candidateCount} | list_candidates=${listCandidates.length}${liveSave ? ` | selected_for_save=${selectedForListSave.length} | list=${listName}` : ''}${liveConnect ? ` | connect_attempts=${connectResults.length}` : ''}`);
    }

    const artifactPayload = {
      label: consolidatedListName || listPrefix || 'account-batch',
      generatedAt: new Date().toISOString(),
      driver: driverName,
      accountNames,
      consolidatedListName,
      listNameTemplate: listNameTemplate || null,
      liveSave,
      liveConnect,
      maxListSavesPerAccount: Number.isFinite(maxListSavesPerAccount) && maxListSavesPerAccount > 0 ? maxListSavesPerAccount : null,
      geoFocus: pilotConfig?.geoFocus || null,
      budget,
      sentThisRun,
      results,
    };
    const artifactPath = writeAccountBatchArtifact(artifactPayload, getString(values, 'output') || null);
    const reportPath = writeAccountBatchReport({
      ...artifactPayload,
      artifactPath,
    });

    logger.info(`Driver: ${driverName}`);
    logger.info(`Accounts processed: ${accountNames.length}`);
    logger.info(`Budget mode: ${budget.budgetMode}`);
    logger.info(`Tool share: ${budget.toolSharePercent}%`);
    logger.info(`Sent this run: ${sentThisRun}`);
    logger.info(`Artifact: ${artifactPath}`);
    logger.info(`Report: ${reportPath}`);
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handlePilotLiveSaveBatch(values, logger) {
  const singleName = getString(values, 'account-name');
  const accountNames = getString(values, 'account-names')
    ? parseAccountNames(getString(values, 'account-names'))
    : (singleName ? [singleName] : []);
  if (accountNames.length === 0) {
    throw new Error('pilot-live-save-batch requires --account-names="Account A, Account B" or --account-name');
  }

  const listPrefix = getString(values, 'list-prefix');
  const maxListSavesPerAccount = Number(getString(values, 'max-list-saves-per-account') || 3);
  const pilotConfig = loadPilotConfig(getString(values, 'pilot-config'));
  const driverName = getString(values, 'driver') || 'playwright';
  const sessionMode = getString(values, 'session-mode') || (driverName === 'playwright' ? 'storage-state' : 'persistent');
  const driver = createDriver(driverName, buildDriverOptions(values, { dryRun: false }, {
    sessionMode,
    headless: true,
    recoveryMode: 'screenshot-only',
  }));

  try {
    await driver.openSession({
      runId: 'pilot-live-save-batch',
      territoryId: 'pilot-live-save-batch',
      dryRun: false,
      weeklyCap: 140,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }

    const results = [];
    for (const accountName of accountNames) {
      const coverageResult = loadExistingAccountCoverageArtifact(accountName);
      if (!coverageResult) {
        results.push({
          accountName,
          listName: buildAccountBatchListName(accountName, listPrefix),
          saveResults: [{
            fullName: 'n/a',
            status: 'failed',
            note: 'coverage artifact missing',
          }],
        });
        continue;
      }

      const listName = buildAccountBatchListName(accountName, listPrefix);
      const listCandidates = applyGeoFocusToCandidates(
        selectCoverageListCandidates(coverageResult),
        pilotConfig.geoFocus,
      );
      const selectedForListSave = limitBatchCandidates(listCandidates, maxListSavesPerAccount);
      const saveResults = [];

      await driver.ensureList(listName, {
        runId: 'pilot-live-save-batch',
        accountKey: accountName,
        dryRun: false,
      });

      for (const candidate of selectedForListSave) {
        try {
          const saveResult = await driver.saveCandidateToList(
            candidate,
            { listName, externalRef: null },
            { runId: 'pilot-live-save-batch', accountKey: accountName, dryRun: false },
          );
          saveResults.push({
            fullName: candidate.fullName,
            title: candidate.title,
            status: saveResult.status,
            selectionMode: saveResult.selectionMode || null,
            note: saveResult.note || null,
          });
        } catch (error) {
          saveResults.push({
            fullName: candidate.fullName,
            title: candidate.title,
            status: 'failed',
            note: summarizeErrorMessage(error.message),
          });
        }
      }

      results.push({
        accountName,
        listName,
        coverageArtifactPath: resolveProjectPath('runtime', 'artifacts', 'coverage', `${String(accountName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`),
        candidateCount: coverageResult.candidateCount,
        listCandidateCount: listCandidates.length,
        selectedForListSaveCount: selectedForListSave.length,
        saveResults,
        connectResults: [],
      });
      logger.info(`${accountName} | selected_for_save=${selectedForListSave.length} | list=${listName}`);
    }

    const artifactPayload = {
      label: listPrefix || 'pilot-live-save-batch',
      generatedAt: new Date().toISOString(),
      driver: driverName,
      sessionMode,
      accountNames,
      liveSave: true,
      liveConnect: false,
      maxListSavesPerAccount,
      geoFocus: pilotConfig.geoFocus,
      results,
    };
    const artifactPath = writeAccountBatchArtifact(artifactPayload, getString(values, 'output') || null);
    const reportPath = writeAccountBatchReport({
      ...artifactPayload,
      artifactPath,
    });

    logger.info(`Driver: ${driverName}`);
    logger.info(`Accounts processed: ${accountNames.length}`);
    logger.info(`Artifact: ${artifactPath}`);
    logger.info(`Report: ${reportPath}`);
  } finally {
    await driver.close().catch(() => {});
  }
}

async function handlePilotConnectBatch(repository, values, logger) {
  const singleName = getString(values, 'account-name');
  const accountNames = getString(values, 'account-names')
    ? parseAccountNames(getString(values, 'account-names'))
    : (singleName ? [singleName] : []);
  if (accountNames.length === 0) {
    throw new Error('pilot-connect-batch requires --account-names="Account A, Account B" or --account-name');
  }
  if (!getBoolean(values, 'live-connect')) {
    throw new Error('pilot-connect-batch requires --live-connect to avoid accidental mutations');
  }

  const listPrefix = getString(values, 'list-prefix');
  const maxConnectsPerAccount = Number(getString(values, 'max-connects-per-account') || 1);
  const driverName = getString(values, 'driver') || 'browser-harness';
  const pilotConfig = loadPilotConfig(getString(values, 'pilot-config'));
  const driverOptions = buildDriverOptions(values, { dryRun: false }, {
    sessionMode: 'persistent',
    headless: true,
    recoveryMode: 'screenshot-only',
  });
  const budgetPolicy = buildConnectBudgetPolicy(values);

  const driver = createDriver(driverName, driverOptions);
  try {
    await driver.openSession({
      runId: 'pilot-connect-batch',
      territoryId: 'pilot-connect-batch',
      dryRun: false,
      weeklyCap: budgetPolicy.weeklyCap,
    });
    const health = await driver.checkSessionHealth();
    if (!health.ok) {
      throw new Error(`Driver session is not ready: ${health.state}`);
    }

    const rawBudget = repository.getBudgetState(budgetPolicy.effectiveWeeklyCap);
    const budget = computeBudgetState({
      weeklyCap: rawBudget.weeklyCap,
      sentThisWeek: rawBudget.weekCount,
      sentToday: rawBudget.dayCount,
      budgetMode: budgetPolicy.budgetMode,
      toolSharePercent: budgetPolicy.toolSharePercent,
      dailyMax: budgetPolicy.dailyMax,
      dailyMin: budgetPolicy.dailyMin,
    });

    const results = [];
    let sentThisRun = 0;
    for (const accountName of accountNames) {
      const listName = buildAccountBatchListName(accountName, listPrefix);
      const connectPolicyDecision = getPilotConnectPolicyDecision(pilotConfig, accountName);
      if (!connectPolicyDecision.allowed) {
        results.push({
          accountName,
          listName,
          selectionSource: 'pilot_policy',
          selectedForConnectCount: 0,
          saveResults: [],
          connectResults: [{
            fullName: 'n/a',
            status: 'skipped_by_policy',
            note: connectPolicyDecision.reason,
            policyClass: connectPolicyDecision.policyClass,
          }],
        });
        logger.info(`${accountName} | selected_for_connect=0 | list=${listName} | source=pilot_policy`);
        continue;
      }

      let pendingRows = [];
      let selectionSource = 'lead_list';
      try {
        const snapshot = await readLeadListSnapshot(driver, listName);
        pendingRows = snapshot.rows
          .filter((row) => !row.invitationSent && !row.connectionSent)
          .slice(0, Math.max(0, maxConnectsPerAccount));
      } catch (error) {
        const coverageResult = loadExistingAccountCoverageArtifact(accountName);
        if (!coverageResult) {
          results.push({
            accountName,
            listName,
            selectedForConnectCount: 0,
            saveResults: [],
            connectResults: [{
              fullName: 'n/a',
              status: 'failed',
              note: `list snapshot unavailable and coverage artifact missing: ${summarizeErrorMessage(error.message)}`,
            }],
          });
          logger.info(`${accountName} | selected_for_connect=0 | list=${listName} | source=none`);
          continue;
        }

        pendingRows = limitBatchCandidates(
          selectCoverageListCandidates(coverageResult).map((candidate) => ({
            fullName: candidate.fullName,
            salesNavigatorUrl: candidate.salesNavigatorUrl || candidate.profileUrl,
            invitationSent: false,
            connectionSent: false,
          })),
          maxConnectsPerAccount,
        );
        selectionSource = 'coverage_artifact';
      }

      const connectResults = [];
      for (const row of pendingRows) {
        const remainingToday = budget.remainingToday - sentThisRun;
        const remainingWeek = budget.remainingThisWeek - sentThisRun;
        if (remainingToday <= 0 || remainingWeek <= 0) {
          connectResults.push({
            fullName: row.fullName,
            status: 'budget_exhausted',
            note: 'connect budget exhausted for this pilot run',
          });
          continue;
        }

        const knownCandidateId = resolveKnownCandidateId(repository, row);
        const candidateId = knownCandidateId || row.salesNavigatorUrl || row.fullName;
        if (knownCandidateId && repository.hasSentConnect(knownCandidateId)) {
          connectResults.push({
            fullName: row.fullName,
            status: 'duplicate_skipped',
            note: 'already recorded as sent locally',
          });
          continue;
        }

        try {
          const initialResult = driverName === 'browser-harness'
            ? sendConnectFromLeadListRow(driver, listName, row)
            : selectionSource === 'lead_list'
              ? await sendConnectFromLeadListRowViaPlaywright(driver, listName, row)
              : await driver.sendConnect(
                {
                  fullName: row.fullName,
                  salesNavigatorUrl: row.salesNavigatorUrl,
                  profileUrl: row.salesNavigatorUrl,
                },
                { runId: 'pilot-connect-batch', accountKey: accountName, dryRun: false },
              );
          const result = selectionSource === 'lead_list'
            ? await maybeFallbackToLeadPageConnect({
              initialResult,
              driver,
              row,
              accountKey: accountName,
            })
            : initialResult;
          recordConnectEventIfKnown(repository, row, null, 'connect', result.status, {
            listName,
            fullName: row.fullName,
            note: result.note || null,
          });
          if (result.status === 'sent') {
            sentThisRun += 1;
          }
          connectResults.push({
            fullName: row.fullName,
            status: result.status,
            note: result.note || null,
            connectPath: result.connectPath || null,
            fallbackTriggeredBy: result.fallbackTriggeredBy || null,
            initialStatus: result.initialStatus || null,
            initialNote: result.initialNote || null,
          });
        } catch (error) {
          connectResults.push({
            fullName: row.fullName,
            status: 'failed',
            note: summarizeErrorMessage(error.message),
          });
        }
      }

      results.push({
        accountName,
        listName,
        selectionSource,
        selectedForConnectCount: pendingRows.length,
        saveResults: [],
        connectResults,
      });
      logger.info(`${accountName} | selected_for_connect=${pendingRows.length} | list=${listName} | source=${selectionSource}`);
    }

    const artifactPayload = {
      label: listPrefix || 'pilot-connect-batch',
      generatedAt: new Date().toISOString(),
      driver: driverName,
      pilotMode: pilotConfig.mode,
      pilotConfigPath: pilotConfig.path,
      sessionMode: driverOptions.sessionMode,
      accountNames,
      liveSave: false,
      liveConnect: true,
      maxConnectsPerAccount,
      budget,
      sentThisRun,
      results,
    };
    const artifactPath = writeAccountBatchArtifact(artifactPayload, getString(values, 'output') || null);
    const reportPath = writeAccountBatchReport({
      ...artifactPayload,
      artifactPath,
    });

    logger.info(`Driver: ${driverName}`);
    logger.info(`Accounts processed: ${accountNames.length}`);
    logger.info(`Budget mode: ${budget.budgetMode}`);
    logger.info(`Tool share: ${budget.toolSharePercent}%`);
    logger.info(`Sent this run: ${sentThisRun}`);
    logger.info(`Artifact: ${artifactPath}`);
    logger.info(`Report: ${reportPath}`);
  } finally {
    await driver.close().catch(() => {});
  }
}

function interpolateQueryTemplate(filePath, variables) {
  const template = fs.readFileSync(filePath, 'utf8');
  return template.replace(/\{\{([a-z0-9_]+)\}\}/gi, (_, key) => {
    const value = variables[key];
    return value === null || value === undefined ? '' : String(value);
  });
}

function reverseDisplayName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed.includes(',')) {
    return trimmed;
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return trimmed;
  }

  const last = parts.pop();
  return `${last}, ${parts.join(' ')}`;
}

function tryQueryFile(adapter, filePath, options, warnings, warningCode) {
  try {
    return adapter.queryFile(filePath, options);
  } catch (error) {
    warnings.push(`${warningCode}: ${summarizeErrorMessage(error.message)}`);
    return [];
  }
}

function printUsage() {
  console.log(`
Usage:
  node src/cli.js sync-territory [--source=path] [--territory-id=terr-emea-obs-01]
  node src/cli.js run-territory [--territory-id=terr-emea-obs-01] [--driver=mock|playwright|browser-harness|hybrid] [--mode=technical-champion-mode] [--dry-run]
  node src/cli.js resume-run --run-id=<run-id>
  node src/cli.js serve-review-dashboard [--port=4310] [--host=127.0.0.1]
  node src/cli.js doctor [--json]
  node src/cli.js print-first-run-onboarding [--json]
  node src/cli.js check-driver-session [--driver=playwright|browser-harness|hybrid] [--session-mode=storage-state|persistent]
  node src/cli.js bootstrap-session [--driver=playwright] [--wait-minutes=10]
  node src/cli.js test-account-search --driver=playwright|browser-harness|hybrid --account-name="Acme" [--account-list="Territory List"] [--keywords="site reliability,observability"]
  node src/cli.js account-coverage --driver=hybrid --account-name="Acme" [--speed-profile=balanced] [--reuse-sweep-cache] [--inter-sweep-delay-ms=2000]
  node src/cli.js resolve-company --account-name="Acme"
  node src/cli.js print-company-resolution [--account-name="Acme"]
  node src/cli.js retry-company-resolution-failures [--limit=3]
  node src/cli.js run-company-resolution-retries [--limit=3] [--driver=hybrid] [--max-candidates=25] [--max-retries=1]
  node src/cli.js deep-review-coverage --driver=playwright --account-name="Acme" [--review-limit=8]
  node src/cli.js render-coverage-review --account-name="Acme"
  node src/cli.js test-list-save --driver=playwright|browser-harness|hybrid --candidate-url="https://www.linkedin.com/sales/lead/..." --list-name="Territory List" --live-save
  node src/cli.js fast-resolve-leads --source=/path/to/leads.md [--driver=playwright] [--search-timeout-ms=8000]
  node src/cli.js fast-list-import --source=/path/to/leads.md[,/path/to/coverage.json] [--bucket=direct_observability] [--min-score=40] [--list-name="Lead List"] [--driver=playwright] [--live-save] [--allow-list-create]
  node src/cli.js retry-failed-fast-list-import --artifact=/path/to/failed-fast-import.json [--list-name="Lead List"] [--driver=playwright] [--live-save] [--allow-list-create]
  node src/cli.js import-coverage --accounts=example-marketplace-a,example-saas-marketplace,olx-group [--bucket=direct_observability] [--min-score=40] [--list-name="Lead List"] [--driver=playwright] [--live-save] [--allow-list-create]
  node src/cli.js test-connect --driver=browser-harness|hybrid --candidate-url="https://www.linkedin.com/sales/lead/..." [--full-name="Jane Doe"] --live-connect
  node src/cli.js inspect-connect-surface --driver=playwright --candidate-url="https://www.linkedin.com/sales/lead/..." [--full-name="Jane Doe"]
  node src/cli.js connect-lead-list --driver=browser-harness --list-name="Territory List" [--limit=25] --live-connect
  node src/cli.js remove-lead-list-members --driver=playwright --list-name="Territory List" --names="Name A, Name B" --live-save
  node src/cli.js send-approved-connects [--run-id=<run-id>] [--limit=25]
  node src/cli.js reconcile-state
  node src/cli.js cleanup-runtime [--max-age-hours=72]
  node src/cli.js print-live-test-checklist
  node src/cli.js print-pilot-operator-quickstart
  node src/cli.js print-mvp-release-contract
  node src/cli.js print-mvp-morning-release-summary
  node src/cli.js print-mvp-operator-dashboard
  node src/cli.js build-connect-evidence-sprint [--artifact=runtime/artifacts/account-batches/supervised-acceptance.json]
  node src/cli.js print-latest-background-runner-report
  node src/cli.js check-live-readiness [--candidate-url="https://www.linkedin.com/sales/lead/..."] [--list-name="Existing Test List"] [--live-save]
  node src/cli.js build-priority-model [--output=runtime/artifacts/priority/priority_score_v1.json] [--max-gb=50]
  node src/cli.js build-background-territory-queue [--owner-name="Example SDR"] [--stale-days=60] [--seed-dataset=project.dataset|--seed-file=runtime/seeds/accounts.json] [--budget-mode=assist] [--no-subsidiaries]
  node src/cli.js run-background-territory-loop [--queue-artifact=runtime/artifacts/background-runner/example-operator-territory-queue.json] [--driver=hybrid] [--limit=3] [--speed-profile=balanced] [--reuse-sweep-cache] [--live-save] [--account-timeout-ms=180000]
  node src/cli.js autoresearch-mvp [--artifact=runtime/artifacts/autoresearch/mvp-autoresearch.json]
  node src/cli.js run-account-batch --account-names="Account A, Account B, Account C" [--driver=hybrid] [--list-prefix="MVP"] [--consolidate-list-name="Research List"] [--list-name-template="Research {date} {start_time} ({accounts})"] [--live-save] [--live-connect]
  node src/cli.js pilot-live-save-batch --account-names="Account A,Account B" [--driver=playwright] [--list-prefix="Pilot"] [--max-list-saves-per-account=3]
  node src/cli.js pilot-connect-batch --account-names="Example Connect Eligible Account" [--driver=playwright] [--pilot-config=config/pilot/default.json] [--list-prefix="Pilot"] [--max-connects-per-account=1] --live-connect
`);
}

async function loadSeedAccountsFromFile({ seedFile, adapter, ownerName }) {
  const absolutePath = path.isAbsolute(seedFile)
    ? seedFile
    : resolveProjectPath(seedFile);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`seed file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf8');
  const rows = absolutePath.toLowerCase().endsWith('.json')
    ? normalizeSeedFileRows(readJson(absolutePath), ownerName)
    : normalizeSeedFileRows(parseSimpleCsv(raw), ownerName);

  if (rows.length === 0) {
    return [];
  }

  const names = [...new Set(rows.map((row) => row.account_name_key).filter(Boolean))];
  const sql = `
WITH seed_names AS (
  SELECT name_key
  FROM UNNEST([${names.map((name) => `'${name.replace(/'/g, "\\'")}'`).join(', ')}]) AS name_key
)
SELECT
  a.sfdc_account_id,
  COALESCE(a.sfdc_account_name, a.name) AS account_name,
  a.sfdc_account_owner_name AS owner_name,
  a.sfdc_account_owner_email AS owner_email,
  a.parent_id AS parent_account_id,
  parent.sfdc_account_name AS parent_account_name,
  a.region,
  a.industry
FROM \`your_project.crm_marts.dim_sfdc_accounts\` a
LEFT JOIN \`your_project.crm_marts.dim_sfdc_accounts\` parent
  ON a.parent_id = parent.sfdc_account_id
  AND parent.is_current = TRUE
JOIN seed_names
  ON LOWER(TRIM(COALESCE(a.sfdc_account_name, a.name))) = seed_names.name_key
WHERE a.is_current = TRUE
`;
  const matched = adapter.query(sql, { maxGb: 5 });
  const metadataByName = new Map(rows.map((row) => [row.account_name_key, row]));

  return matched.map((row) => {
    const key = String(row.account_name || '').toLowerCase().trim();
    const meta = metadataByName.get(key) || {};
    return {
      accountId: row.sfdc_account_id,
      accountName: row.account_name,
      ownerName: row.owner_name || null,
      ownerEmail: row.owner_email || null,
      parentAccountId: row.parent_account_id || null,
      parentAccountName: row.parent_account_name || null,
      region: row.region || null,
      industry: row.industry || null,
      seedType: meta.seed_type || 'seed_file',
      seedName: meta.seed_name || path.basename(absolutePath),
      stale: true,
      stalePriorityScore: 99998,
      source: 'seed',
    };
  });
}

function normalizeSeedFileRows(rows, ownerName) {
  const targetOwner = String(ownerName || '').toLowerCase().trim();
  const input = Array.isArray(rows) ? rows : [];
  return input
    .map((row) => ({
      owner_name: row.owner_name || row.ownerName || null,
      account_name: row.account_name || row.accountName || row.name || null,
      account_name_key: String(row.account_name || row.accountName || row.name || '').toLowerCase().trim(),
      seed_type: row.seed_type || row.seedType || null,
      seed_name: row.seed_name || row.seedName || null,
    }))
    .filter((row) => row.account_name_key)
    .filter((row) => {
      if (!row.owner_name || !targetOwner) {
        return true;
      }
      const owner = String(row.owner_name).toLowerCase().trim();
      return owner === targetOwner || owner === reverseDisplayName(targetOwner).toLowerCase();
    });
}

function parseOptionalCandidateLimit(value) {
  return normalizeCandidateLimit(value);
}

function parseSimpleCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [];
  }
  const headers = lines[0].split(',').map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((value) => value.trim());
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
}

function classifySessionCheckFailure(error) {
  const rawDetail = error?.message || 'Unknown browser launch failure';
  const detail = summarizeErrorMessage(rawDetail);
  const lowered = String(rawDetail).toLowerCase();
  const state = lowered.includes('sandboxdenied')
    || lowered.includes('operation not permitted')
    || lowered.includes('crashpad')
    ? 'browser_launch_blocked'
    : lowered.includes('enoent')
      ? 'driver_not_installed'
    : 'session_check_failed';

  return {
    mode: 'unknown',
    state,
    detail,
  };
}

function summarizeErrorMessage(message) {
  const lines = String(message)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const meaningful = lines.find((line) => !/^traceback/i.test(line))
    || lines[lines.length - 1]
    || 'Unknown browser launch failure';

  return meaningful.length > 240
    ? `${meaningful.slice(0, 237)}...`
    : meaningful;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
