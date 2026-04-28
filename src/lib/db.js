const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { DB_PATH, ensureRuntimeLayout } = require('./paths');
const { toIso, getWeekWindow, getDayWindow } = require('./time');
const { randomId, stableId } = require('./id');

function serialize(value) {
  return JSON.stringify(value ?? null);
}

function parseRowJson(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function createDatabase(dbPath = DB_PATH) {
  ensureRuntimeLayout();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS territory_snapshots (
      snapshot_id TEXT PRIMARY KEY,
      territory_id TEXT NOT NULL,
      territory_name TEXT NOT NULL,
      owner_id TEXT,
      owner_name TEXT,
      synced_at TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      account_key TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      name TEXT NOT NULL,
      website TEXT,
      country TEXT,
      region TEXT,
      parent_account_id TEXT,
      priority INTEGER DEFAULT 0,
      sales_nav_json TEXT,
      signals_json TEXT,
      source_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      territory_id TEXT NOT NULL,
      territory_name TEXT NOT NULL,
      snapshot_id TEXT NOT NULL,
      status TEXT NOT NULL,
      driver TEXT NOT NULL,
      dry_run INTEGER NOT NULL DEFAULT 0,
      weekly_cap INTEGER NOT NULL,
      run_spec_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      summary_json TEXT,
      FOREIGN KEY (snapshot_id) REFERENCES territory_snapshots(snapshot_id)
    );

    CREATE TABLE IF NOT EXISTS run_accounts (
      run_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      list_name TEXT,
      candidate_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (run_id, account_key),
      FOREIGN KEY (run_id) REFERENCES runs(run_id),
      FOREIGN KEY (account_key) REFERENCES accounts(account_key)
    );

    CREATE TABLE IF NOT EXISTS list_registry (
      list_key TEXT PRIMARY KEY,
      territory_id TEXT NOT NULL,
      list_name TEXT NOT NULL UNIQUE,
      external_ref TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS candidates (
      candidate_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      account_key TEXT NOT NULL,
      full_name TEXT NOT NULL,
      title TEXT NOT NULL,
      headline TEXT,
      location TEXT,
      profile_url TEXT,
      sales_navigator_url TEXT,
      role_family TEXT,
      seniority TEXT,
      score REAL NOT NULL,
      score_breakdown_json TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      recommendation TEXT NOT NULL,
      list_name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (profile_url),
      FOREIGN KEY (run_id) REFERENCES runs(run_id),
      FOREIGN KEY (account_key) REFERENCES accounts(account_key)
    );

    CREATE TABLE IF NOT EXISTS approval_items (
      approval_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL UNIQUE,
      run_id TEXT NOT NULL,
      state TEXT NOT NULL,
      reviewer_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (candidate_id) REFERENCES candidates(candidate_id),
      FOREIGN KEY (run_id) REFERENCES runs(run_id)
    );

    CREATE TABLE IF NOT EXISTS connect_events (
      event_id TEXT PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      approval_id TEXT,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      details_json TEXT NOT NULL,
      event_time TEXT NOT NULL,
      FOREIGN KEY (candidate_id) REFERENCES candidates(candidate_id),
      FOREIGN KEY (approval_id) REFERENCES approval_items(approval_id)
    );

    CREATE TABLE IF NOT EXISTS recovery_events (
      recovery_id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      account_key TEXT,
      candidate_id TEXT,
      severity TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(run_id)
    );

    CREATE TABLE IF NOT EXISTS checkpoints (
      run_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(run_id)
    );
  `);

  enforceSqliteFilePermissions(dbPath);

  ensureColumn(db, 'candidates', 'company', 'TEXT');
  ensureColumn(db, 'candidates', 'list_save_status', 'TEXT');
  ensureColumn(db, 'candidates', 'list_save_details_json', 'TEXT');
  ensureColumn(db, 'candidates', 'decision_reason', 'TEXT');

  return createRepository(db);
}

function enforceSqliteFilePermissions(dbPath) {
  const siblings = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  for (const target of siblings) {
    if (!fs.existsSync(target)) {
      continue;
    }
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // best effort
    }
  }
}

function ensureColumn(db, tableName, columnName, sqlType) {
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${sqlType}`);
  } catch {
    // already exists
  }
}

function createRepository(db) {
  const statements = {
    insertSnapshot: db.prepare(`
      INSERT INTO territory_snapshots (
        snapshot_id, territory_id, territory_name, owner_id, owner_name,
        synced_at, source_type, source_ref, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(snapshot_id) DO UPDATE SET
        synced_at = excluded.synced_at,
        payload_json = excluded.payload_json
    `),
    insertAccount: db.prepare(`
      INSERT INTO accounts (
        account_key, account_id, name, website, country, region, parent_account_id,
        priority, sales_nav_json, signals_json, source_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_key) DO UPDATE SET
        name = excluded.name,
        website = excluded.website,
        country = excluded.country,
        region = excluded.region,
        parent_account_id = excluded.parent_account_id,
        priority = excluded.priority,
        sales_nav_json = excluded.sales_nav_json,
        signals_json = excluded.signals_json,
        source_json = excluded.source_json
    `),
    insertRun: db.prepare(`
      INSERT INTO runs (
        run_id, territory_id, territory_name, snapshot_id, status, driver,
        dry_run, weekly_cap, run_spec_json, started_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateRunStatus: db.prepare(`
      UPDATE runs
      SET status = ?, finished_at = ?, summary_json = COALESCE(?, summary_json)
      WHERE run_id = ?
    `),
    upsertRunAccount: db.prepare(`
      INSERT INTO run_accounts (
        run_id, account_key, status, stage, list_name, candidate_count, last_error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id, account_key) DO UPDATE SET
        status = excluded.status,
        stage = excluded.stage,
        list_name = excluded.list_name,
        candidate_count = excluded.candidate_count,
        last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `),
    insertList: db.prepare(`
      INSERT INTO list_registry (
        list_key, territory_id, list_name, external_ref, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(list_key) DO UPDATE SET
        updated_at = excluded.updated_at,
        external_ref = COALESCE(excluded.external_ref, list_registry.external_ref)
    `),
    upsertCandidate: db.prepare(`
      INSERT INTO candidates (
        candidate_id, run_id, account_key, full_name, title, headline, location,
        profile_url, sales_navigator_url, company, role_family, seniority, score,
        score_breakdown_json, evidence_json, recommendation, list_name, status,
        list_save_status, list_save_details_json, decision_reason, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET
        run_id = excluded.run_id,
        account_key = excluded.account_key,
        full_name = excluded.full_name,
        title = excluded.title,
        headline = excluded.headline,
        location = excluded.location,
        profile_url = excluded.profile_url,
        sales_navigator_url = excluded.sales_navigator_url,
        company = excluded.company,
        role_family = excluded.role_family,
        seniority = excluded.seniority,
        score = excluded.score,
        score_breakdown_json = excluded.score_breakdown_json,
        evidence_json = excluded.evidence_json,
        recommendation = excluded.recommendation,
        list_name = excluded.list_name,
        status = excluded.status,
        list_save_status = COALESCE(excluded.list_save_status, candidates.list_save_status),
        list_save_details_json = COALESCE(excluded.list_save_details_json, candidates.list_save_details_json),
        decision_reason = COALESCE(excluded.decision_reason, candidates.decision_reason),
        updated_at = excluded.updated_at
    `),
    updateCandidateListSave: db.prepare(`
      UPDATE candidates
      SET list_save_status = ?, list_save_details_json = ?, updated_at = ?
      WHERE candidate_id = ?
    `),
    selectCandidateByProfile: db.prepare(`
      SELECT * FROM candidates WHERE profile_url = ?
    `),
    selectCandidateById: db.prepare(`
      SELECT * FROM candidates WHERE candidate_id = ?
    `),
    upsertApproval: db.prepare(`
      INSERT INTO approval_items (
        approval_id, candidate_id, run_id, state, reviewer_note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(candidate_id) DO UPDATE SET
        state = excluded.state,
        reviewer_note = COALESCE(excluded.reviewer_note, approval_items.reviewer_note),
        updated_at = excluded.updated_at
    `),
    updateApprovalState: db.prepare(`
      UPDATE approval_items
      SET state = ?, reviewer_note = ?, updated_at = ?
      WHERE approval_id = ?
    `),
    insertConnectEvent: db.prepare(`
      INSERT INTO connect_events (
        event_id, candidate_id, approval_id, action, status, details_json, event_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    insertRecovery: db.prepare(`
      INSERT INTO recovery_events (
        recovery_id, run_id, account_key, candidate_id, severity, event_type, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    upsertCheckpoint: db.prepare(`
      INSERT INTO checkpoints (run_id, payload_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `),
    selectLatestSnapshot: db.prepare(`
      SELECT * FROM territory_snapshots
      WHERE territory_id = ?
      ORDER BY synced_at DESC
      LIMIT 1
    `),
    selectSnapshotById: db.prepare(`
      SELECT * FROM territory_snapshots WHERE snapshot_id = ?
    `),
    selectRunById: db.prepare(`
      SELECT * FROM runs WHERE run_id = ?
    `),
    selectRunAccounts: db.prepare(`
      SELECT ra.*, a.name, a.country, a.region, a.priority, a.sales_nav_json, a.signals_json, a.source_json
      FROM run_accounts ra
      JOIN accounts a ON a.account_key = ra.account_key
      WHERE ra.run_id = ?
      ORDER BY a.priority DESC, a.name ASC
    `),
    selectCheckpoint: db.prepare(`
      SELECT * FROM checkpoints WHERE run_id = ?
    `),
    selectPendingApprovals: db.prepare(`
      SELECT ai.*, c.full_name, c.title, c.profile_url, c.sales_navigator_url, c.list_name, c.score
      FROM approval_items ai
      JOIN candidates c ON c.candidate_id = ai.candidate_id
      WHERE ai.state = 'approved'
      ORDER BY c.score DESC, ai.created_at ASC
      LIMIT ?
    `),
    selectApprovalQueue: db.prepare(`
      SELECT
        ai.approval_id,
        ai.candidate_id,
        ai.run_id,
        ai.state,
        ai.reviewer_note,
        ai.updated_at,
        c.full_name,
        c.title,
        c.company,
        c.location,
        c.score,
        c.list_name,
        c.sales_navigator_url
      FROM approval_items ai
      JOIN candidates c ON c.candidate_id = ai.candidate_id
      WHERE ai.state IN ('pending', 'approved', 'deferred')
      ORDER BY
        CASE ai.state
          WHEN 'approved' THEN 0
          WHEN 'pending' THEN 1
          ELSE 2
        END,
        c.score DESC,
        ai.updated_at DESC
      LIMIT ?
    `),
    selectRunSummary: db.prepare(`
      SELECT
        r.run_id,
        r.territory_name,
        r.status,
        r.driver,
        r.run_spec_json,
        r.started_at,
        r.finished_at,
        (
          SELECT COUNT(*)
          FROM approval_items ai
          WHERE ai.run_id = r.run_id AND ai.state = 'pending'
        ) AS pending_approvals,
        (
          SELECT COUNT(*)
          FROM approval_items ai
          WHERE ai.run_id = r.run_id AND ai.state = 'approved'
        ) AS approved_approvals,
        (
          SELECT COUNT(*)
          FROM approval_items ai
          WHERE ai.run_id = r.run_id AND ai.state = 'skipped'
        ) AS skipped_approvals,
        (
          SELECT COUNT(*)
          FROM run_accounts ra
          WHERE ra.run_id = r.run_id AND ra.status IN ('failed', 'review_required')
        ) AS failed_accounts,
        (
          SELECT COUNT(*)
          FROM candidates c
          WHERE c.run_id = r.run_id
        ) AS candidate_count
      FROM runs r
      ORDER BY r.started_at DESC
    `),
    selectCandidatesForDashboard: db.prepare(`
      SELECT
        c.candidate_id,
        c.run_id,
        c.account_key,
        c.full_name,
        c.title,
        c.company,
        c.location,
        c.role_family,
        c.seniority,
        c.list_name,
        c.score,
        c.recommendation,
        c.status,
        c.profile_url,
        c.sales_navigator_url,
        c.score_breakdown_json,
        c.evidence_json,
        c.list_save_status,
        c.list_save_details_json,
        c.decision_reason,
        ai.approval_id,
        ai.state AS approval_state,
        ai.reviewer_note
      FROM candidates c
      LEFT JOIN approval_items ai ON ai.candidate_id = c.candidate_id
      ORDER BY c.score DESC, c.updated_at DESC
      LIMIT ?
    `),
    selectRecoveryForDashboard: db.prepare(`
      SELECT * FROM recovery_events
      ORDER BY created_at DESC
      LIMIT ?
    `),
    selectRunAccountsForDashboard: db.prepare(`
      SELECT
        ra.run_id,
        ra.account_key,
        ra.status,
        ra.stage,
        ra.list_name,
        ra.candidate_count,
        ra.last_error,
        ra.updated_at,
        a.account_id,
        a.name,
        a.country,
        a.region,
        a.priority,
        a.sales_nav_json
      FROM run_accounts ra
      JOIN accounts a ON a.account_key = ra.account_key
      ORDER BY
        CASE ra.status
          WHEN 'review_required' THEN 0
          WHEN 'failed' THEN 1
          WHEN 'running' THEN 2
          ELSE 3
        END,
        ra.updated_at DESC
      LIMIT ?
    `),
    selectConnectCountInWindow: db.prepare(`
      SELECT COUNT(*) AS count
      FROM connect_events
      WHERE action = 'connect'
        AND status = 'sent'
        AND event_time >= ?
        AND event_time < ?
    `),
    selectListByKey: db.prepare(`
      SELECT * FROM list_registry WHERE list_key = ?
    `),
    selectSentConnectForCandidate: db.prepare(`
      SELECT event_id
      FROM connect_events
      WHERE candidate_id = ?
        AND action = 'connect'
        AND status = 'sent'
      LIMIT 1
    `),
  };

  function normalizeSnapshotRow(row) {
    if (!row) {
      return null;
    }

    return {
      snapshotId: row.snapshot_id,
      territoryId: row.territory_id,
      territoryName: row.territory_name,
      ownerId: row.owner_id,
      ownerName: row.owner_name,
      syncedAt: row.synced_at,
      sourceType: row.source_type,
      sourceRef: row.source_ref,
      payload: parseRowJson(row.payload_json, {}),
    };
  }

  return {
    db,
    upsertTerritorySnapshot(snapshot) {
      statements.insertSnapshot.run(
        snapshot.snapshotId,
        snapshot.territory.territoryId,
        snapshot.territory.territoryName,
        snapshot.territory.ownerId || null,
        snapshot.territory.ownerName || null,
        snapshot.syncedAt,
        snapshot.sourceType,
        snapshot.sourceRef,
        serialize(snapshot),
      );
    },
    upsertAccounts(accounts) {
      for (const account of accounts) {
        const accountKey = stableId('account', account.accountId, account.name);
        statements.insertAccount.run(
          accountKey,
          account.accountId,
          account.name,
          account.website || null,
          account.country || null,
          account.region || null,
          account.parentAccountId || null,
          Number.isFinite(account.priority) ? account.priority : 0,
          serialize(account.salesNav || {}),
          serialize(account.signals || {}),
          serialize(account),
        );
      }
    },
    createRun(runSpec) {
      statements.insertRun.run(
        runSpec.runId,
        runSpec.territoryId,
        runSpec.territoryName,
        runSpec.snapshotId,
        'running',
        runSpec.driver,
        runSpec.dryRun ? 1 : 0,
        runSpec.weeklyCap,
        serialize(runSpec),
        runSpec.createdAt,
      );
    },
    updateRunStatus(runId, status, summary) {
      const finishedAt = ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(status)
        ? toIso()
        : null;
      statements.updateRunStatus.run(status, finishedAt, summary ? serialize(summary) : null, runId);
    },
    attachAccountsToRun(runId, accounts, listNameResolver) {
      const now = toIso();
      for (const account of accounts) {
        const accountKey = stableId('account', account.accountId, account.name);
        const listName = listNameResolver(account);
        statements.upsertRunAccount.run(runId, accountKey, 'pending', 'queued', listName, 0, null, now);
      }
    },
    updateRunAccount(runId, accountKey, updates) {
      const current = db.prepare(`
        SELECT * FROM run_accounts WHERE run_id = ? AND account_key = ?
      `).get(runId, accountKey);

      const merged = {
        status: updates.status || current?.status || 'pending',
        stage: updates.stage || current?.stage || 'queued',
        list_name: Object.prototype.hasOwnProperty.call(updates, 'listName')
          ? updates.listName
          : (current?.list_name || null),
        candidate_count: Object.prototype.hasOwnProperty.call(updates, 'candidateCount')
          ? updates.candidateCount
          : (current?.candidate_count || 0),
        last_error: Object.prototype.hasOwnProperty.call(updates, 'lastError')
          ? updates.lastError
          : (current?.last_error || null),
      };

      statements.upsertRunAccount.run(
        runId,
        accountKey,
        merged.status,
        merged.stage,
        merged.list_name,
        merged.candidate_count,
        merged.last_error,
        toIso(),
      );
    },
    ensureList(territoryId, listName, externalRef = null) {
      const listKey = stableId('list', territoryId, listName);
      const now = toIso();
      statements.insertList.run(listKey, territoryId, listName, externalRef, now, now);
      return hydrateListRow(statements.selectListByKey.get(listKey));
    },
    saveCandidate(candidate) {
      const candidateId = stableId(
        'candidate',
        candidate.profileUrl || candidate.salesNavigatorUrl || candidate.fullName,
        candidate.accountKey,
      );
      const createdAt = candidate.createdAt || toIso();
      statements.upsertCandidate.run(
        candidateId,
        candidate.runId,
        candidate.accountKey,
        candidate.fullName,
        candidate.title,
        candidate.headline || null,
        candidate.location || null,
        candidate.profileUrl || null,
        candidate.salesNavigatorUrl || null,
        candidate.company || null,
        candidate.roleFamily || null,
        candidate.seniority || null,
        candidate.score,
        serialize(candidate.scoreBreakdown),
        serialize(candidate.evidence),
        candidate.recommendation,
        candidate.listName,
        candidate.status || 'discovered',
        candidate.listSaveStatus || null,
        candidate.listSaveDetails ? serialize(candidate.listSaveDetails) : null,
        candidate.decisionReason || null,
        createdAt,
        toIso(),
      );
      return candidateId;
    },
    updateCandidateListSave(candidateId, status, details = {}) {
      statements.updateCandidateListSave.run(status, serialize(details), toIso(), candidateId);
    },
    findExistingCandidate(profileUrl) {
      if (!profileUrl) {
        return null;
      }
      const row = statements.selectCandidateByProfile.get(profileUrl);
      return row ? hydrateCandidateRow(row) : null;
    },
    getCandidate(candidateId) {
      const row = statements.selectCandidateById.get(candidateId);
      return row ? hydrateCandidateRow(row) : null;
    },
    createOrUpdateApproval(candidateId, runId, state = 'pending', reviewerNote = null) {
      const approvalId = stableId('approval', candidateId);
      const now = toIso();
      statements.upsertApproval.run(approvalId, candidateId, runId, state, reviewerNote, now, now);
      return approvalId;
    },
    updateApprovalState(approvalId, state, reviewerNote = null) {
      statements.updateApprovalState.run(state, reviewerNote, toIso(), approvalId);
    },
    insertConnectEvent(candidateId, approvalId, action, status, details = {}) {
      statements.insertConnectEvent.run(
        randomId('connect'),
        candidateId,
        approvalId,
        action,
        status,
        serialize(details),
        toIso(),
      );
    },
    hasSentConnect(candidateId) {
      return Boolean(statements.selectSentConnectForCandidate.get(candidateId));
    },
    insertRecoveryEvent(event) {
      statements.insertRecovery.run(
        event.recoveryId || randomId('recovery'),
        event.runId,
        event.accountKey || null,
        event.candidateId || null,
        event.severity,
        event.eventType,
        serialize(event.details || {}),
        event.createdAt || toIso(),
      );
    },
    saveCheckpoint(runId, payload) {
      statements.upsertCheckpoint.run(runId, serialize(payload), toIso());
    },
    getCheckpoint(runId) {
      const row = statements.selectCheckpoint.get(runId);
      return row ? parseRowJson(row.payload_json, null) : null;
    },
    getLatestSnapshot(territoryId) {
      return normalizeSnapshotRow(statements.selectLatestSnapshot.get(territoryId));
    },
    getSnapshotById(snapshotId) {
      return normalizeSnapshotRow(statements.selectSnapshotById.get(snapshotId));
    },
    getRun(runId) {
      const row = statements.selectRunById.get(runId);
      if (!row) {
        return null;
      }

      return {
        runId: row.run_id,
        territoryId: row.territory_id,
        territoryName: row.territory_name,
        snapshotId: row.snapshot_id,
        status: row.status,
        driver: row.driver,
        dryRun: Boolean(row.dry_run),
        weeklyCap: row.weekly_cap,
        runSpec: parseRowJson(row.run_spec_json, {}),
        summary: parseRowJson(row.summary_json, null),
        startedAt: row.started_at,
        finishedAt: row.finished_at,
      };
    },
    getRunAccounts(runId) {
      return statements.selectRunAccounts.all(runId).map((row) => ({
        runId: row.run_id,
        accountKey: row.account_key,
        status: row.status,
        stage: row.stage,
        listName: row.list_name,
        candidateCount: row.candidate_count,
        lastError: row.last_error,
        updatedAt: row.updated_at,
        account: {
          accountKey: row.account_key,
          name: row.name,
          country: row.country,
          region: row.region,
          priority: row.priority,
          salesNav: parseRowJson(row.sales_nav_json, {}),
          signals: parseRowJson(row.signals_json, {}),
          ...parseRowJson(row.source_json, {}),
        },
      }));
    },
    getPendingApprovals(limit = 25) {
      return statements.selectPendingApprovals.all(limit).map((row) => ({
        approvalId: row.approval_id,
        candidateId: row.candidate_id,
        runId: row.run_id,
        accountKey: row.account_key,
        fullName: row.full_name,
        title: row.title,
        profileUrl: row.profile_url,
        salesNavigatorUrl: row.sales_navigator_url,
        listName: row.list_name,
        score: row.score,
      }));
    },
    getApprovalQueue(limit = 100) {
      return statements.selectApprovalQueue.all(limit).map((row) => ({
        approvalId: row.approval_id,
        candidateId: row.candidate_id,
        runId: row.run_id,
        state: row.state,
        reviewerNote: row.reviewer_note,
        updatedAt: row.updated_at,
        fullName: row.full_name,
        title: row.title,
        company: row.company,
        location: row.location,
        score: row.score,
        listName: row.list_name,
        salesNavigatorUrl: row.sales_navigator_url,
      }));
    },
    getDashboardSummary() {
      const runs = statements.selectRunSummary.all().map((row) => {
        const runSpec = parseRowJson(row.run_spec_json, {});
        return {
          ...row,
          runSpec,
          modeId: runSpec.modeId || null,
          runtimeMode: runSpec.runtimeMode || null,
        };
      });
      const budget = this.getBudgetState(140);
      return { runs, budget };
    },
    getDashboardCandidates(limit = 100) {
      return statements.selectCandidatesForDashboard.all(limit).map((row) => ({
        candidateId: row.candidate_id,
        runId: row.run_id,
        fullName: row.full_name,
        title: row.title,
        company: row.company,
        location: row.location,
        roleFamily: row.role_family,
        seniority: row.seniority,
        listName: row.list_name,
        score: row.score,
        recommendation: row.recommendation,
        status: row.status,
        profileUrl: row.profile_url,
        salesNavigatorUrl: row.sales_navigator_url,
        scoreBreakdown: parseRowJson(row.score_breakdown_json, {}),
        evidence: parseRowJson(row.evidence_json, {}),
        listSaveStatus: row.list_save_status || 'not_requested',
        listSaveDetails: parseRowJson(row.list_save_details_json, {}),
        decisionReason: row.decision_reason,
        approvalId: row.approval_id,
        approvalState: row.approval_state || 'unreviewed',
        reviewerNote: row.reviewer_note,
      }));
    },
    getRecoveryEvents(limit = 50) {
      return statements.selectRecoveryForDashboard.all(limit).map((row) => ({
        recoveryId: row.recovery_id,
        runId: row.run_id,
        accountKey: row.account_key,
        candidateId: row.candidate_id,
        severity: row.severity,
        eventType: row.event_type,
        details: parseRowJson(row.details_json, {}),
        createdAt: row.created_at,
      }));
    },
    getRunAccountsForDashboard(limit = 150) {
      return statements.selectRunAccountsForDashboard.all(limit).map((row) => ({
        runId: row.run_id,
        accountKey: row.account_key,
        accountId: row.account_id,
        name: row.name,
        country: row.country,
        region: row.region,
        priority: row.priority,
        status: row.status,
        stage: row.stage,
        listName: row.list_name,
        candidateCount: row.candidate_count,
        lastError: row.last_error,
        updatedAt: row.updated_at,
        salesNav: parseRowJson(row.sales_nav_json, {}),
      }));
    },
    retryRunAccount(runId, accountKey) {
      const accounts = this.getRunAccounts(runId);
      const retryIndex = accounts.findIndex((item) => item.accountKey === accountKey);
      if (retryIndex === -1) {
        throw new Error(`Run account ${accountKey} not found for ${runId}`);
      }

      const currentCheckpoint = this.getCheckpoint(runId) || {};
      this.updateRunAccount(runId, accountKey, {
        status: 'pending',
        stage: 'queued',
        lastError: null,
      });
      this.saveCheckpoint(runId, {
        ...currentCheckpoint,
        runId,
        accountIndex: Math.min(currentCheckpoint.accountIndex ?? retryIndex, retryIndex),
        currentAccountKey: null,
        lastTemplateId: null,
        updatedAt: toIso(),
      });
      this.updateRunStatus(runId, 'running');
    },
    getBudgetState(weeklyCap, now = new Date()) {
      const { weekStart, weekEnd } = getWeekWindow(now);
      const { dayStart, dayEnd } = getDayWindow(now);
      const weekCount = statements.selectConnectCountInWindow.get(weekStart, weekEnd)?.count || 0;
      const dayCount = statements.selectConnectCountInWindow.get(dayStart, dayEnd)?.count || 0;
      return { weekCount, dayCount, weeklyCap };
    },
    reconcile() {
      const issues = [];
      const orphanApprovals = db.prepare(`
        SELECT ai.approval_id, ai.candidate_id
        FROM approval_items ai
        LEFT JOIN candidates c ON c.candidate_id = ai.candidate_id
        WHERE c.candidate_id IS NULL
      `).all();

      if (orphanApprovals.length > 0) {
        issues.push({
          type: 'orphan-approvals',
          count: orphanApprovals.length,
          rows: orphanApprovals,
        });
      }

      const missingApprovals = db.prepare(`
        SELECT c.candidate_id, c.full_name
        FROM candidates c
        LEFT JOIN approval_items ai ON ai.candidate_id = c.candidate_id
        WHERE c.recommendation = 'queue_for_approval'
          AND ai.approval_id IS NULL
      `).all();

      if (missingApprovals.length > 0) {
        issues.push({
          type: 'missing-approvals',
          count: missingApprovals.length,
          rows: missingApprovals,
        });
      }

      const listSaveFailures = db.prepare(`
        SELECT candidate_id, full_name, list_save_status
        FROM candidates
        WHERE list_save_status = 'failed'
      `).all();

      if (listSaveFailures.length > 0) {
        issues.push({
          type: 'list-save-failures',
          count: listSaveFailures.length,
          rows: listSaveFailures,
        });
      }

      return issues;
    },
    close() {
      db.close();
    },
  };
}

function hydrateCandidateRow(row) {
  return {
    candidateId: row.candidate_id,
    runId: row.run_id,
    accountKey: row.account_key,
    fullName: row.full_name,
    title: row.title,
    headline: row.headline,
    company: row.company,
    location: row.location,
    profileUrl: row.profile_url,
    salesNavigatorUrl: row.sales_navigator_url,
    roleFamily: row.role_family,
    seniority: row.seniority,
    score: row.score,
    scoreBreakdown: parseRowJson(row.score_breakdown_json, {}),
    evidence: parseRowJson(row.evidence_json, {}),
    recommendation: row.recommendation,
    listName: row.list_name,
    status: row.status,
    listSaveStatus: row.list_save_status || null,
    listSaveDetails: parseRowJson(row.list_save_details_json, {}),
    decisionReason: row.decision_reason || null,
  };
}

function hydrateListRow(row) {
  if (!row) {
    return null;
  }

  return {
    listKey: row.list_key,
    territoryId: row.territory_id,
    listName: row.list_name,
    externalRef: row.external_ref,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  createDatabase,
};
