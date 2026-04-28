const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createDatabase } = require('../src/lib/db');
const { syncTerritory } = require('../src/core/territory-sync');
const { createRun, runTerritory } = require('../src/core/orchestrator');
const { ReadOnlySalesforceAdapter } = require('../src/adapters/salesforce-readonly');
const { MockDriver } = require('../src/drivers/mock-driver');
const { DriverAdapter } = require('../src/drivers/driver-adapter');

test('orchestrator creates candidates and approvals from a synced territory', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsn-platform-'));
  const dbPath = path.join(tempDir, 'platform.db');
  const repository = createDatabase(dbPath);

  try {
    const adapter = new ReadOnlySalesforceAdapter();
    const syncResult = await syncTerritory({
      adapter,
      repository,
      territoryId: 'terr-emea-obs-01',
      useSample: true,
      subsidiaryExpansion: true,
    });

    const runSpec = await createRun({
      repository,
      snapshot: syncResult.snapshot,
      driverName: 'mock',
      icpConfigPath: path.join(process.cwd(), 'config', 'icp', 'default-observability.json'),
      searchTemplatesPath: path.join(process.cwd(), 'config', 'search-templates', 'default.json'),
      dryRun: true,
      weeklyCap: 140,
    });

    const run = repository.getRun(runSpec.runId);
    const driver = new MockDriver();
    await runTerritory({ repository, driver, run });

    const summary = repository.getDashboardSummary();
    const candidates = repository.getDashboardCandidates(20);

    assert.equal(summary.runs.length >= 1, true);
    assert.equal(candidates.length > 0, true);
    assert.equal(candidates.some((candidate) => candidate.approvalState === 'pending'), true);
    assert.equal(candidates.some((candidate) => candidate.listSaveStatus === 'simulated'), true);
  } finally {
    repository.close();
  }
});

class DeepReviewTestDriver extends DriverAdapter {
  constructor() {
    super();
    this.openedCandidates = new Set();
  }

  async openSession() {}

  async checkSessionHealth() {
    return {
      ok: true,
      authenticated: true,
      state: 'authenticated',
      mode: 'test',
    };
  }

  async openAccountSearch() {}

  async openAccount() {}

  async openPeopleSearch() {}

  async applySearchTemplate() {}

  async scrollAndCollectCandidates(account, template) {
    if (template.id !== 'champions-core') {
      return [];
    }

    return [
      {
        fullName: 'Taylor Hidden Signal',
        title: 'Enterprise Architect',
        headline: 'Leads architecture transformation',
        company: 'Hidden Signal Co',
        location: 'Berlin',
        profileUrl: 'https://www.linkedin.com/in/taylor-hidden-signal',
        salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/taylor-hidden-signal',
        summary: 'Cross-functional architecture leader',
      },
    ];
  }

  async openCandidate(candidate) {
    this.openedCandidates.add(candidate.profileUrl);
  }

  async captureEvidence(candidate) {
    if (this.openedCandidates.has(candidate.profileUrl)) {
      return {
        pageTitle: candidate.fullName,
        pageUrl: candidate.salesNavigatorUrl,
        snippet: 'Owns Observability Platform dashboards, Prometheus metrics, monitoring strategy, incident response and platform operations.',
      };
    }

    return {
      snippet: candidate.summary,
      extraction: 'list-page',
    };
  }

  async saveCandidateToList(candidate, listInfo, context) {
    return {
      status: context.dryRun ? 'simulated' : 'saved',
      listName: listInfo.list_name || listInfo.listName || candidate.listName,
    };
  }
}

test('orchestrator promotes borderline candidates via deep profile review', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsn-platform-deep-review-'));
  const dbPath = path.join(tempDir, 'platform.db');
  const repository = createDatabase(dbPath);

  try {
    const adapter = new ReadOnlySalesforceAdapter();
    const syncResult = await syncTerritory({
      adapter,
      repository,
      territoryId: 'terr-emea-obs-01',
      useSample: true,
      subsidiaryExpansion: true,
    });

    const runSpec = await createRun({
      repository,
      snapshot: syncResult.snapshot,
      driverName: 'test-deep-review',
      icpConfigPath: path.join(process.cwd(), 'config', 'icp', 'default-observability.json'),
      searchTemplatesPath: path.join(process.cwd(), 'config', 'search-templates', 'default.json'),
      dryRun: true,
      weeklyCap: 140,
    });

    const run = repository.getRun(runSpec.runId);
    const driver = new DeepReviewTestDriver();
    await runTerritory({ repository, driver, run });

    const candidates = repository.getDashboardCandidates(20);
    const deepReviewedCandidate = candidates.find((candidate) => candidate.fullName === 'Taylor Hidden Signal');

    assert.ok(deepReviewedCandidate);
    assert.equal(deepReviewedCandidate.recommendation, 'queue_for_approval');
    assert.equal(deepReviewedCandidate.listSaveStatus, 'simulated');
    assert.equal(
      deepReviewedCandidate.scoreBreakdown.reviewMeta.promoted,
      true,
    );
    assert.match(
      deepReviewedCandidate.decisionReason,
      /^deep_review_promoted_from_.*_to_above_approval_threshold$/,
    );
  } finally {
    repository.close();
  }
});

class ModeTemplateDriver extends DriverAdapter {
  constructor() {
    super();
    this.appliedTemplateIds = [];
  }

  async openSession() {}

  async checkSessionHealth() {
    return {
      ok: true,
      authenticated: true,
      state: 'authenticated',
      mode: 'test',
    };
  }

  async openAccountSearch() {}

  async enumerateAccounts(accounts) {
    return accounts.slice(0, 1);
  }

  async openAccount() {}

  async openPeopleSearch() {}

  async applySearchTemplate(template) {
    this.appliedTemplateIds.push(template.id);
  }

  async scrollAndCollectCandidates() {
    return [];
  }

  async captureEvidence() {
    return { snippet: '' };
  }

  async saveCandidateToList() {
    return { status: 'simulated' };
  }
}

test('orchestrator restricts search templates when a persona mode is selected', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsn-platform-mode-'));
  const dbPath = path.join(tempDir, 'platform.db');
  const repository = createDatabase(dbPath);

  try {
    const adapter = new ReadOnlySalesforceAdapter();
    const syncResult = await syncTerritory({
      adapter,
      repository,
      territoryId: 'terr-emea-obs-01',
      useSample: true,
      subsidiaryExpansion: true,
    });

    const runSpec = await createRun({
      repository,
      snapshot: syncResult.snapshot,
      driverName: 'test-mode',
      icpConfigPath: path.join(process.cwd(), 'config', 'icp', 'default-observability.json'),
      searchTemplatesPath: path.join(process.cwd(), 'config', 'search-templates', 'default.json'),
      modeId: 'executive-buyer-mode',
      personaModesPath: path.join(process.cwd(), 'config', 'modes', 'default.json'),
      dryRun: true,
      weeklyCap: 140,
    });

    const run = repository.getRun(runSpec.runId);
    const driver = new ModeTemplateDriver();
    await runTerritory({ repository, driver, run });

    assert.deepEqual(driver.appliedTemplateIds, [
      'decision-makers',
      'account-platform-sweep',
      'account-architecture-sweep',
    ]);
  } finally {
    repository.close();
  }
});
