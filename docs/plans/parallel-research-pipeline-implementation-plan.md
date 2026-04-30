# Parallel Research Pipeline Implementation Plan

> **For Hermes:** Use Cursor CLI / Composer 2 to implement this plan task-by-task. Hermes remains Supervisor and must independently inspect diffs, run tests, and verify safety before accepting Cursor output.

**Goal:** Speed up Account Research by parallelizing dry-safe planning, company-resolution lookup, cache inspection, candidate scoring, and quality review while keeping all Sales Navigator browser navigation behind a single controlled Browser Worker.

**Architecture:** Introduce a deterministic Parallel Research Pipeline above existing Account Coverage primitives. The pipeline decomposes account research into artifact-backed jobs, lets local research workers compute safe pre-browser work concurrently, then serializes all live/browser-backed Sales Navigator interactions through one Browser Worker lock and queue. Results flow into a Merge Coordinator that deduplicates candidates, applies scoring/quality gates, and writes review artifacts compatible with existing Account Coverage, Background Runner, Autoresearch, and Speed Fitness Gate conventions.

**Tech Stack:** Node.js built-in test runner, existing `src/core/account-coverage.js`, `src/core/company-resolution.js`, `src/core/sweep-cache.js`, `src/core/background-territory-runner.js`, `src/core/background-list-maintenance.js`, `src/core/autoresearch-mvp.js`, existing Sales Navigator drivers, runtime artifacts under `runtime/artifacts/**`.

---

## Executive diagnosis

The idea is directionally right, with one important safety correction: **parallel agents should not all click Sales Navigator in parallel**. Browser-backed Sales Navigator work is the narrow waist of the system because it is rate-limit sensitive, session-stateful, DOM-fragile, and hard to debug when multiple workers share one LinkedIn identity.

The best speed win is therefore not “N browsers”. It is **Parallel Research Pipeline + Single Browser Worker**:

- parallelize dry-safe work before the browser:
  - company-target resolution planning,
  - alias/cache lookup,
  - sweep planning,
  - known-candidate dedupe,
  - stale artifact analysis,
  - scoring and quality review,
  - merge/report generation.
- serialize risky browser work:
  - account search,
  - people search,
  - search-template application,
  - profile detail opens,
  - any live-save/live-connect mutation.

This aligns with `CONTEXT.md` definitions: **Company Scope**, **Manual Review**, **Speed Fitness Gate**, **Research Loop Plan**, **Runtime Artifact**, and **Live Mutation**.

## Current repo fit

The repo already has most building blocks:

- `src/core/account-coverage.js`
  - `buildSweepTemplates()`
  - `runAccountCoverageWorkflow()`
  - `consolidateCoverageCandidates()`
  - `selectCoverageListCandidates()`
  - `selectDeepReviewCandidates()`
  - sweep cache integration via `buildSweepCacheKey()`, `readSweepCache()`, `writeSweepCache()`.
- `src/core/sweep-cache.js`
  - deterministic cache key for account + targets + template + config version.
- `src/core/company-resolution.js`
  - company target/alias resolution artifact generation.
- `src/core/background-territory-runner.js`
  - queue spec for account batches.
- `src/core/background-list-maintenance.js`
  - checkpointing, stale artifact reuse, queue loop, account productivity summaries.
- `src/core/autoresearch-mvp.js`
  - dry-safe report/gate ecosystem and speed-evaluation helpers.
- `docs/adr/0002-speed-changes-require-quality-fitness.md`
  - explicit requirement that speed changes must pass quality fitness gates.

Gap: these components are still mostly arranged as a serial browser-driven workflow. There is not yet a first-class `research-queue`, pre-browser job model, Browser Worker lock, parallel local scorer, or merge coordinator artifact.

## Non-goals

- Do not introduce multiple concurrent Sales Navigator browser sessions.
- Do not run parallel Playwright contexts against the same LinkedIn account.
- Do not add live-save, live-connect, or message sending.
- Do not execute live mutation from agents.
- Do not commit runtime artifacts, browser state, cookies, local DBs, screenshots, logs, or secrets.
- Do not claim live speed wins from synthetic tests alone.
- Do not weaken Company Scope, Manual Review, identity confidence, or Execution Gate behavior.

## Target model

### Logical agents

These are logical pipeline roles, not necessarily LLM agents in v1. Cursor should implement them as deterministic modules first. Later they can be backed by worker processes if needed.

1. **Company Resolution Planner**
   - Input: account names, aliases, prior coverage artifacts, BigQuery/GTM rows if available.
   - Output: resolved company targets, confidence, blockers, cache hints.
   - Browser: no.

2. **Sweep Planner**
   - Input: account target, coverage config, EMEA/persona mode, prior productivity/sweep-cache telemetry.
   - Output: ordered sweep jobs with dedupe keys and priority.
   - Browser: no.

3. **Coverage Cache Analyst**
   - Input: sweep cache, prior account coverage artifact, background checkpoint.
   - Output: cache-hit jobs, known candidates, skip/defer hints.
   - Browser: no.

4. **Browser Worker**
   - Input: only browser-required sweep jobs.
   - Output: raw candidates, scope evidence, rate-limit telemetry, sweep errors.
   - Browser: yes, but exactly one worker per LinkedIn session.

5. **Parallel Scoring Worker**
   - Input: raw candidates from cache and browser jobs.
   - Output: scored candidates, role families, buckets, quality diagnostics.
   - Browser: no.

6. **Quality Review Worker**
   - Input: scored candidates, hard exclusions, existing list candidates, duplicate metadata.
   - Output: selected/rejected candidates with reasons.
   - Browser: no.

7. **Merge Coordinator**
   - Input: all worker artifacts.
   - Output: consolidated Account Coverage artifact, performance metrics, Browser Worker telemetry, research-loop recommendations.
   - Browser: no.

### Dataflow

```text
accounts
  -> research queue
  -> parallel pre-browser jobs
       -> company-resolution planner
       -> sweep planner
       -> coverage/cache analyst
  -> single browser-worker queue for cache misses only
  -> parallel scoring/quality review
  -> merge coordinator
  -> Account Coverage artifact + Autoresearch Speed Fitness evidence
```

## Artifact contract v1

Create a new runtime artifact family under `runtime/artifacts/research-pipeline/`.

Example top-level artifact:

```json
{
  "version": "1.0.0",
  "pipelineId": "parallel-research-2026-04-30T12-00-00Z",
  "mode": "dry-safe",
  "accountCount": 10,
  "browserConcurrency": 1,
  "localConcurrency": 4,
  "status": "completed",
  "metrics": {
    "totalMs": 90000,
    "preBrowserMs": 8000,
    "browserMs": 70000,
    "postBrowserMs": 12000,
    "cacheHits": 18,
    "cacheMisses": 12,
    "browserJobsExecuted": 12,
    "browserJobsSkippedByCache": 18,
    "candidatesRaw": 240,
    "candidatesUnique": 125,
    "selectedForList": 31,
    "manualReviewCount": 7,
    "rateLimitHitCount": 0
  },
  "safety": {
    "liveSaveAllowed": false,
    "liveConnectAllowed": false,
    "browserWorkerLock": "held_serially",
    "companyScopeRequired": true
  },
  "accounts": []
}
```

No runtime artifact should be committed. Tests should use fixtures under `tests/fixtures/` or inline objects.

## Implementation strategy

Ship this as a stack of small PRs. Do **not** attempt one giant implementation.

Recommended branch sequence:

1. `feat/research-job-model`
2. `feat/research-cache-planner`
3. `feat/browser-worker-lock`
4. `feat/parallel-scoring-review`
5. `feat/research-merge-coordinator`
6. `feat/parallel-research-cli`
7. `perf/parallel-research-speed-eval`

---

## Task 1: Add deterministic research job model

**Objective:** Define account-level and sweep-level job records without changing browser behavior.

**Files:**

- Create: `src/core/research-pipeline.js`
- Test: `tests/research-pipeline.test.js`

**Step 1: Write failing tests**

Add tests for:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildResearchQueue,
  normalizeResearchAccount,
} = require('../src/core/research-pipeline');

test('buildResearchQueue creates deterministic account jobs with dry-safe defaults', () => {
  const queue = buildResearchQueue({
    accounts: [
      { accountId: 'a1', accountName: 'Example AG' },
      { accountId: 'a2', accountName: 'Example GmbH' },
    ],
    runId: 'research-run-1',
  });

  assert.equal(queue.version, '1.0.0');
  assert.equal(queue.runId, 'research-run-1');
  assert.equal(queue.safety.liveSaveAllowed, false);
  assert.equal(queue.safety.liveConnectAllowed, false);
  assert.deepEqual(queue.accounts.map((job) => job.accountKey), ['a1', 'a2']);
});

test('normalizeResearchAccount falls back to stable name key', () => {
  const account = normalizeResearchAccount({ accountName: 'Example AG' });
  assert.equal(account.accountKey, 'example-ag');
  assert.equal(account.accountName, 'Example AG');
});
```

**Step 2: Run RED**

```bash
node --test tests/research-pipeline.test.js
```

Expected: FAIL because `src/core/research-pipeline.js` does not exist.

**Step 3: Implement minimal module**

Export:

- `normalizeResearchAccount(account)`
- `buildResearchQueue({ accounts, runId, generatedAt })`

Keep it pure. No file writes. No browser calls.

**Step 4: Run GREEN**

```bash
node --test tests/research-pipeline.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/research-pipeline.js tests/research-pipeline.test.js
git commit -m "feat: add research pipeline job model"
```

---

## Task 2: Add company-resolution and sweep planning stage

**Objective:** Produce pre-browser sweep jobs using existing company resolution and sweep template builders.

**Files:**

- Modify: `src/core/research-pipeline.js`
- Test: `tests/research-pipeline.test.js`
- Read only for context: `src/core/account-coverage.js`, `src/core/company-resolution.js`

**Step 1: Write failing tests**

Add tests asserting:

- `planResearchJobs()` emits `company_resolution` jobs and `sweep` jobs.
- each sweep job includes:
  - `accountKey`,
  - `templateId`,
  - `keywords`,
  - `requiresBrowser: true` unless fulfilled by cache later,
  - `safety.companyScopeRequired: true`.
- no job has live mutation permissions.

Suggested test shape:

```js
test('planResearchJobs emits scoped sweep jobs without live mutation permissions', () => {
  const plan = planResearchJobs({
    queue: buildResearchQueue({ accounts: [{ accountId: 'a1', accountName: 'Example AG' }] }),
    coverageConfig: {
      broadCrawl: { enabled: true },
      sweeps: [{ id: 'platform', keywords: ['platform'] }],
    },
  });

  assert.ok(plan.jobs.some((job) => job.type === 'company_resolution'));
  const sweepJobs = plan.jobs.filter((job) => job.type === 'sweep');
  assert.equal(sweepJobs.length, 2);
  assert.equal(sweepJobs.every((job) => job.requiresBrowser === true), true);
  assert.equal(sweepJobs.every((job) => job.safety.companyScopeRequired === true), true);
  assert.equal(plan.safety.liveSaveAllowed, false);
});
```

**Step 2: Run RED**

```bash
node --test tests/research-pipeline.test.js
```

**Step 3: Implement minimal planning**

Use `buildSweepTemplates(coverageConfig, maxCandidates, options)` from `account-coverage.js`.

Do not call `runAccountCoverageWorkflow()` yet. This task only creates job records.

**Step 4: Run GREEN**

```bash
node --test tests/research-pipeline.test.js
```

**Step 5: Commit**

```bash
git add src/core/research-pipeline.js tests/research-pipeline.test.js
git commit -m "feat: plan parallel research jobs"
```

---

## Task 3: Add shared cache planner

**Objective:** Mark sweep jobs as cache hits or browser-required cache misses before the Browser Worker runs.

**Files:**

- Modify: `src/core/research-pipeline.js`
- Test: `tests/research-pipeline.test.js`
- Read only for context: `src/core/sweep-cache.js`

**Step 1: Write failing tests**

Add tests for:

- `attachSweepCacheState({ jobs, readCache })` calls `readCache` for sweep jobs only.
- cache-hit jobs become `requiresBrowser: false` and include `cacheHit: true` + cached candidates.
- cache-miss jobs remain `requiresBrowser: true`.
- failed/malformed cache reads do not crash; they become cache misses.

**Step 2: Run RED**

```bash
node --test tests/research-pipeline.test.js
```

**Step 3: Implement minimal cache planner**

Export:

- `attachSweepCacheState({ jobs, readCache })`

Keep dependency injection simple: tests can pass a fake `readCache(job)` function. Later integration can wrap `readSweepCache()`.

**Step 4: Run GREEN**

```bash
node --test tests/research-pipeline.test.js
```

**Step 5: Commit**

```bash
git add src/core/research-pipeline.js tests/research-pipeline.test.js
git commit -m "feat: add research sweep cache planner"
```

---

## Task 4: Add Browser Worker lock abstraction

**Objective:** Ensure only one browser-backed job executes at a time for a LinkedIn session.

**Files:**

- Create: `src/core/browser-worker-lock.js`
- Test: `tests/browser-worker-lock.test.js`

**Step 1: Write failing tests**

Test pure behavior with async functions:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { createBrowserWorkerLock } = require('../src/core/browser-worker-lock');

test('browser worker lock serializes async browser jobs', async () => {
  const lock = createBrowserWorkerLock();
  const events = [];

  await Promise.all([
    lock.runExclusive('job-a', async () => {
      events.push('a:start');
      await Promise.resolve();
      events.push('a:end');
      return 'a';
    }),
    lock.runExclusive('job-b', async () => {
      events.push('b:start');
      events.push('b:end');
      return 'b';
    }),
  ]);

  assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end']);
});
```

Add a second test proving the lock releases after a thrown error.

**Step 2: Run RED**

```bash
node --test tests/browser-worker-lock.test.js
```

**Step 3: Implement minimal lock**

Use an internal promise chain:

- `runExclusive(jobId, fn)` queues behind the previous promise.
- always releases in `finally`.
- records lightweight telemetry: job id, startedAt, finishedAt, status.

No file locks yet. This is in-process v1.

**Step 4: Run GREEN**

```bash
node --test tests/browser-worker-lock.test.js
```

**Step 5: Commit**

```bash
git add src/core/browser-worker-lock.js tests/browser-worker-lock.test.js
git commit -m "feat: add browser worker lock"
```

---

## Task 5: Add Browser Worker executor wrapper

**Objective:** Execute only browser-required sweep jobs through the lock and existing driver methods.

**Files:**

- Modify: `src/core/research-pipeline.js`
- Test: `tests/research-pipeline.test.js`
- Read only for context: `src/core/account-coverage.js`

**Step 1: Write failing tests**

Use a fake driver with methods:

- `openPeopleSearch(account, context)`
- `applySearchTemplate(template, context)`
- `scrollAndCollectCandidates(account, template, context)`

Assert:

- cache-hit jobs do not call the driver.
- browser-required jobs call driver in order.
- a rate-limit error marks the job failed with category `rate_limited` and stops or pauses according to v1 policy.
- no live-save/live-connect methods are referenced.

**Step 2: Run RED**

```bash
node --test tests/research-pipeline.test.js
```

**Step 3: Implement minimal executor**

Export:

- `executeBrowserSweepJobs({ jobs, driver, lock, runId, stopOnRateLimit = true })`

For each browser job:

1. `lock.runExclusive(job.id, async () => { ... })`
2. call existing driver people-search flow.
3. return raw candidates and telemetry.

Do not write artifacts yet.

**Step 4: Run GREEN**

```bash
node --test tests/research-pipeline.test.js
```

**Step 5: Commit**

```bash
git add src/core/research-pipeline.js tests/research-pipeline.test.js
git commit -m "feat: execute browser sweep jobs serially"
```

---

## Task 6: Add parallel local scoring and quality review

**Objective:** Score and review candidates in local concurrent chunks after browser/cache collection.

**Files:**

- Modify: `src/core/research-pipeline.js`
- Test: `tests/research-pipeline.test.js`
- Read only for context: `src/core/scoring.js`, `src/core/account-coverage.js`

**Step 1: Write failing tests**

Assert:

- `scoreResearchCandidates()` dedupes by normalized candidate key.
- scoring uses `scoreCandidate()` and existing ICP config.
- hard-excluded candidates stay in rejected/manual-review output.
- selected candidates use `selectCoverageListCandidates()` semantics where applicable.
- output order is deterministic regardless of chunk/concurrency size.

**Step 2: Run RED**

```bash
node --test tests/research-pipeline.test.js
```

**Step 3: Implement minimal local parallelism**

Export:

- `scoreResearchCandidates({ accountName, rawResults, icpConfig, coverageConfig, priorityModel, localConcurrency = 4 })`

Implementation note:

- In v1, chunk with `Promise.all()` over local arrays.
- Do not use `worker_threads` yet unless profiling proves CPU bottleneck.
- Maintain deterministic final sort after parallel scoring.

**Step 4: Run GREEN**

```bash
node --test tests/research-pipeline.test.js
```

**Step 5: Commit**

```bash
git add src/core/research-pipeline.js tests/research-pipeline.test.js
git commit -m "feat: score research candidates in parallel chunks"
```

---

## Task 7: Add Merge Coordinator artifact builder

**Objective:** Combine cache, browser, scoring, and quality-review outputs into one artifact with speed/safety telemetry.

**Files:**

- Modify: `src/core/research-pipeline.js`
- Test: `tests/research-pipeline.test.js`

**Step 1: Write failing tests**

Assert artifact includes:

- `version`
- `pipelineId`
- `browserConcurrency: 1`
- `localConcurrency`
- metrics:
  - `cacheHits`
  - `cacheMisses`
  - `browserJobsExecuted`
  - `browserJobsSkippedByCache`
  - `candidatesRaw`
  - `candidatesUnique`
  - `selectedForList`
  - `manualReviewCount`
  - `rateLimitHitCount`
- safety:
  - `liveSaveAllowed: false`
  - `liveConnectAllowed: false`
  - `browserWorkerLock: 'held_serially'`

**Step 2: Run RED**

```bash
node --test tests/research-pipeline.test.js
```

**Step 3: Implement minimal builder**

Export:

- `buildResearchPipelineArtifact({ queue, plannedJobs, cacheResults, browserResults, scoringResults, lockTelemetry, startedAt, finishedAt })`

No file writes in this function.

**Step 4: Run GREEN**

```bash
node --test tests/research-pipeline.test.js
```

**Step 5: Commit**

```bash
git add src/core/research-pipeline.js tests/research-pipeline.test.js
git commit -m "feat: build research pipeline artifact"
```

---

## Task 8: Add CLI command for dry-safe parallel account research

**Objective:** Expose the new pipeline through a dry-safe CLI without live mutation flags.

**Files:**

- Modify: `src/cli.js`
- Modify: `package.json`
- Test: `tests/release-readiness.test.js` or new CLI-focused test if the repo has one suitable.
- Docs: `docs/parallel-research-pipeline.md`

**Step 1: Write failing tests**

Assert:

- `parallel-account-research` refuses `--live-save`, `--live-connect`, and `--allow-background-connects` at CLI entry.
- package script exists, e.g. `"parallel-account-research": "node src/cli.js parallel-account-research"`.
- help/docs mention Browser Worker concurrency is fixed at 1.

**Step 2: Run RED**

```bash
node --test tests/release-readiness.test.js
```

**Step 3: Implement CLI shell**

Add command:

```bash
npm run parallel-account-research -- \
  --accounts="Account A,Account B" \
  --driver=hybrid \
  --local-concurrency=4 \
  --reuse-sweep-cache
```

Initial v1 can process account input and produce a plan/artifact. It should not need to outperform existing workflow until Task 9 benchmark.

Important: Browser Worker concurrency is not exposed as a user-configurable number in v1. Keep `browserConcurrency = 1` hard-coded.

**Step 4: Run GREEN**

```bash
node --test tests/release-readiness.test.js tests/research-pipeline.test.js
```

**Step 5: Commit**

```bash
git add src/cli.js package.json docs/parallel-research-pipeline.md tests/release-readiness.test.js tests/research-pipeline.test.js
git commit -m "feat: add dry-safe parallel account research cli"
```

---

## Task 9: Add speed/quality evaluation hooks

**Objective:** Make the pipeline compatible with existing Speed Fitness Gate standards.

**Files:**

- Modify: `src/core/autoresearch-mvp.js` if needed to read new metrics.
- Modify: `tests/autoresearch-mvp.test.js`
- Modify: `docs/parallel-research-pipeline.md`

**Step 1: Write failing tests**

Assert `buildAutoresearchSpeedEvaluation()` can compare artifacts that include `researchPipeline.metrics.totalMs`, `selectedForList`, `manualReviewCount`, duplicate/manual-review metrics, and rate-limit counts.

**Step 2: Run RED**

```bash
node --test tests/autoresearch-mvp.test.js
```

**Step 3: Implement minimal metric extraction**

Do not loosen existing quality checks. If new metrics are missing, decision should be `needs_more_evidence`.

**Step 4: Run GREEN**

```bash
node --test tests/autoresearch-mvp.test.js
```

**Step 5: Commit**

```bash
git add src/core/autoresearch-mvp.js tests/autoresearch-mvp.test.js docs/parallel-research-pipeline.md
git commit -m "feat: add parallel research speed fitness metrics"
```

---

## Task 10: Dry-safe benchmark harness

**Objective:** Prove mechanism speed with fake drivers before any live claim.

**Files:**

- Create: `tests/parallel-research-benchmark.test.js` or extend `tests/research-pipeline.test.js`
- Optional create: `scripts/benchmark-parallel-research.js` if repo conventions allow scripts.
- Docs: `docs/parallel-research-pipeline.md`

**Step 1: Write failing test**

Use fake driver delays to show:

- serial baseline time is slower,
- pipeline avoids browser work on cache hits,
- local scoring can run concurrently,
- browser work remains serial.

Do not assert fragile exact wall-clock numbers. Assert telemetry shape and avoided browser-job count.

**Step 2: Run RED**

```bash
node --test tests/parallel-research-benchmark.test.js
```

**Step 3: Implement minimal benchmark helpers**

Prefer deterministic timing injection (`now`) and fake delay functions over real sleeps.

**Step 4: Run GREEN**

```bash
node --test tests/parallel-research-benchmark.test.js
```

**Step 5: Commit**

```bash
git add tests/parallel-research-benchmark.test.js docs/parallel-research-pipeline.md
git commit -m "test: add parallel research benchmark harness"
```

---

## Cursor execution prompt

Use this exact high-level prompt for Cursor after opening a branch for the first slice:

```text
You are implementing the Parallel Research Pipeline plan in sales-nav-research-assistant.

Read first:
- CONTEXT.md
- AGENTS.md
- docs/adr/0001-dry-safe-by-default.md
- docs/adr/0002-speed-changes-require-quality-fitness.md
- docs/plans/parallel-research-pipeline-implementation-plan.md

Implement only Task <N> from the plan. Use strict TDD:
1. Write the failing test first.
2. Run the targeted test and confirm RED.
3. Implement the minimal code for GREEN.
4. Run the targeted test again.
5. Do not implement future tasks.

Safety constraints:
- Do not run --live-save, --live-connect, allow-background-connects, or any live mutation command.
- Do not open real Sales Navigator profiles.
- Do not modify runtime/, .env, cookies, browser profiles, screenshots, local DBs, or secrets.
- Do not weaken Company Scope, Manual Review, Execution Gate, Gate Report, Mutation Review, or existing live readiness checks.
- Browser concurrency must remain exactly 1 in v1.

Expected verification for this task:
- node --test tests/research-pipeline.test.js
- plus any targeted test named in the task

Return:
- files changed
- RED command/result
- GREEN command/result
- safety notes
- any follow-up task that should be separate
```

Suggested Cursor command for Task 1:

```bash
agent -p "<paste prompt above with Task 1>" \
  --model composer-2 \
  --workspace /tmp/sales-nav-research-assistant \
  --output-format text \
  --trust
```

Hermes should then inspect:

```bash
git diff --stat
git diff --check
node --test tests/research-pipeline.test.js
npm run test:release-readiness
```

Before any PR that touches execution paths, also run:

```bash
npm test
```

## Acceptance criteria for the full epic

- Parallel dry-safe pre-browser work exists and is covered by unit tests.
- Sweep/cache planning avoids duplicate browser jobs where cache artifacts are fresh.
- Browser Worker lock guarantees one browser job at a time per process.
- Pipeline artifacts expose browser vs local time and cache-hit/miss metrics.
- Candidate scoring and quality review are deterministic even if local chunks run concurrently.
- All live mutation flags remain refused by the new CLI.
- Speed claims are gated by `npm run autoresearch:speed` or equivalent Speed Fitness evidence.
- No runtime/session/secret artifacts are committed.

## Recommended implementation order for PRs

1. **PR A — Job model and planner**
   - Tasks 1–2.
   - Pure code only. No browser.

2. **PR B — Cache planner**
   - Task 3.
   - Pure code only. No browser.

3. **PR C — Browser Worker lock and serial executor**
   - Tasks 4–5.
   - Fake driver tests only. No real Sales Navigator.

4. **PR D — Parallel scoring + merge artifact**
   - Tasks 6–7.
   - Pure local parallelism.

5. **PR E — CLI integration**
   - Task 8.
   - Dry-safe command, no live mutation.

6. **PR F — Speed fitness + benchmark**
   - Tasks 9–10.
   - Proves mechanism; live speed claim still requires later dry-run evidence.

## Key design decisions

- **Browser concurrency is fixed at 1.** Parallelism happens around the browser, not inside LinkedIn.
- **Cache hits should bypass the browser entirely.** This is likely the biggest safe speed lever.
- **Scoring is safe to parallelize.** It is local, deterministic, and has no external side effects.
- **Merge Coordinator owns final truth.** Worker outputs are intermediate evidence, not final list state.
- **Speed must be measured against quality.** Faster but worse is rejected unless explicitly accepted and documented by the Operator.

## Risks and mitigations

- **Risk:** More architecture without actual speed win.
  - Mitigation: ship benchmark/Speed Fitness PR before calling it successful.
- **Risk:** Hidden browser parallelism sneaks in through future flags.
  - Mitigation: hard-code `browserConcurrency: 1`, test it, document it.
- **Risk:** Cache reuse creates stale/incorrect candidates.
  - Mitigation: include config version, company targets, template keywords, and freshness policy in cache keys and artifacts.
- **Risk:** Parallel scoring changes output order.
  - Mitigation: deterministic final sort and test identical output across concurrency values.
- **Risk:** Cursor over-implements worker threads or process pools too early.
  - Mitigation: v1 uses `Promise.all()` chunks and fake drivers; no worker_threads unless benchmark proves need.
