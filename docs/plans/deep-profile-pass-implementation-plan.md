# Deep Profile Pass Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add a safe, opt-in Deep Profile Pass to Account Coverage so Broad Crawl candidates with weak list-page signals can be enriched from individual Sales Navigator lead pages before final bucket/list-selection decisions.

**Architecture:** Reuse the existing `openCandidate()` + `captureEvidence({ fromListPage: false })` infrastructure and the already-proven territory-run deep-review pattern. Move the account-coverage deep-review logic from a CLI-only post-processing command into deterministic core helpers, then optionally call it inside `runAccountCoverageWorkflow()` after list-page consolidation and before final bucket summary/list-review artifacts. The pass remains read-only: it opens detail pages and extracts text, but never saves to lists or sends connects.

**Tech Stack:** Node.js built-in test runner, existing Sales Navigator drivers, `src/core/account-coverage.js`, `src/cli.js`, JSON config under `config/account-coverage/`, runtime artifacts under `runtime/artifacts/coverage/`.

---

## Current reality

The initial diagnosis is directionally right: list-page Broad Crawl is shallow and hidden stakeholders can be missed when their title/headline is weak. However, the current codebase already contains more infrastructure than the diagnosis implied.

Existing pieces:

- `src/drivers/playwright-sales-nav.js`
  - `openCandidate(candidate)` opens an individual Sales Navigator lead page.
  - `captureEvidence(candidate)` extracts detail-page text when `candidate.fromListPage` is false.
  - Current detail snippet is stored as `snippet: snippet.slice(0, 500)`, not 2000.
- `src/core/orchestrator.js`
  - `shouldRunDeepProfileReview()` already triggers detail-page review for territory-run borderline candidates.
  - It calls `driver.openCandidate()` and then `driver.captureEvidence({ fromListPage: false })`.
  - It rescales/re-decides candidates after enrichment.
- `src/cli.js`
  - `deep-review-coverage` already opens selected Account Coverage candidates, captures detail-page evidence, rescales them, and writes the Account Coverage artifact back.
- `src/core/account-coverage.js`
  - `selectDeepReviewCandidates()`, `classifyReviewedCoverageBucket()`, and `applyDeepReviewResult()` exist.
  - But `runAccountCoverageWorkflow()` does not call a Deep Profile Pass automatically.

Therefore the real gap is not "no connection between `selectDeepReviewCandidates()` and `openCandidate()`". The real gap is:

1. The connection exists only in the manual CLI command `deep-review-coverage`.
2. Account Coverage final artifacts are produced before any automatic profile enrichment.
3. Selection rules are too narrow and title-hint based, so vague titles like `Business Partner IT`, `Senior Manager`, or `Product Owner` may never be reviewed.
4. Detail evidence is truncated to 500 chars in `captureEvidence()`, reducing the value of About/Experience/Certification text.
5. Runtime/telemetry does not yet quantify deep-review cost, promotions, failures, or rate-limit safety.

## Non-goals

- Do not add live-save or live-connect behavior.
- Do not make Broad Crawl open every profile by default.
- Do not bypass existing company/account scoping.
- Do not persist raw full-profile text beyond the bounded snippet already stored in artifacts.
- Do not weaken Manual Review, Company Resolution, Mutation Review, or Execution Gate behavior.
- Do not introduce browser parallelism in this slice.

## Safety model

The Deep Profile Pass is a read-only enrichment step.

Allowed:

- Open individual Sales Navigator lead detail pages for candidates that came from an already company-scoped Account Coverage sweep.
- Expand visible "show more" buttons.
- Read page text through existing driver evidence extraction.
- Re-score and re-bucket candidates based on bounded detail-page evidence.
- Write updated local runtime artifacts.

Forbidden:

- `saveCandidateToList()`
- `sendConnect()`
- `--live-save`
- `--live-connect`
- background-connect allowances
- unscoped people search
- committing runtime artifacts, cookies, browser profiles, screenshots, `.env`, local DBs, or secrets

If a profile detail page fails to render, the candidate remains in its prior bucket with a `deepReview.failed` marker; it must not be promoted by failure.

## Proposed operator behavior

Default behavior should stay fast and conservative:

```bash
npm run account-coverage -- --account-name "Example Account" --driver hybrid
```

No automatic detail-page profile opening unless explicitly enabled.

Opt-in behavior:

```bash
npm run account-coverage -- \
  --account-name "Example Account" \
  --driver hybrid \
  --deep-profile-pass \
  --deep-profile-limit 12
```

Expected output additions:

- Deep-profile reviewed count
- Promoted count
- Failed count
- Runtime cost / slowest phase visibility
- Artifact path

The existing manual second-pass command remains useful:

```bash
npm run deep-review-coverage -- --account-name "Example Account" --review-limit 12
```

But it should reuse the same core helper as the integrated Account Coverage pass.

## Artifact shape

Add a top-level field to Account Coverage artifacts:

```json
{
  "deepProfilePass": {
    "enabled": true,
    "requested": true,
    "reviewLimit": 12,
    "reviewedCount": 8,
    "promotedCount": 2,
    "failedCount": 1,
    "skippedCount": 0,
    "selectionPolicy": "account_coverage_deep_profile_v1",
    "startedAt": "...",
    "finishedAt": "..."
  }
}
```

Candidate-level enrichment already mostly exists via `applyDeepReviewResult()`:

```json
{
  "deepReview": {
    "reviewedAt": "...",
    "previousBucket": "likely_noise",
    "reviewedBucket": "technical_adjacent",
    "previousScore": 12,
    "reviewedScore": 38,
    "changed": true,
    "snippet": "bounded detail-page evidence..."
  }
}
```

Add, if useful:

```json
{
  "deepReview": {
    "selectionReason": "weak_title_with_it_or_business_technology_hint",
    "source": "account_coverage_deep_profile_pass"
  }
}
```

## Selection policy

The pass should review likely-hidden-stakeholder candidates, not obvious winners.

Review candidates when all are true:

1. Candidate has `salesNavigatorUrl` or `profileUrl`.
2. Candidate is not `outOfNetwork`.
3. Candidate does not already have a successful `deepReview.reviewedAt` unless `--force-deep-profile-pass` is set.
4. Candidate is not hard-excluded by obvious non-ICP functions:
   - HR / Recruiting / Talent
   - Sales / Marketing / Business Development
   - Finance / Procurement / Legal / Privacy
5. Candidate is in one of:
   - `technical_adjacent`
   - `broad_it_stakeholder`
   - `likely_noise` with technology-adjacent hints
6. Candidate score is below direct-save confidence or has weak/no observability signals.

Selection should prioritize:

1. `technical_adjacent` below save threshold
2. `broad_it_stakeholder` with weak observability signals
3. `likely_noise` with ambiguous technology hints
4. Higher initial score within each group
5. Candidates that can fill missing buying-group/coverage roles if priority model is present

Important title/hint expansions beyond current `selectDeepReviewCandidates()`:

- `business partner it`
- `it business partner`
- `product owner`
- `service owner`
- `application owner`
- `system owner`
- `platform owner`
- `senior manager`
- `program manager`
- `project manager`
- `transformation`
- `digital`
- `enterprise applications`
- `operations manager`
- `technical operations`

Hard exclusions stay conservative and test-backed.

## Implementation tasks

### Task 1: Extract account-coverage deep-review selection metadata

**Objective:** Make `selectDeepReviewCandidates()` return selection reason metadata without changing current callers.

**Files:**

- Modify: `src/core/account-coverage.js`
- Test: `tests/account-coverage.test.js`

**Step 1: Write failing tests**

Add tests that assert:

- `Business Partner IT` in `likely_noise` is selected when it has a Sales Navigator URL.
- `Senior Manager` with a technology/headline hint is selected.
- `Recruiter`, `Sales Manager`, and `Finance Manager` are not selected.
- Already-successfully-reviewed candidates are skipped by default.
- The selector returns candidates with `deepReviewSelectionReason` or equivalent metadata.

Run:

```bash
node --test tests/account-coverage.test.js
```

Expected: FAIL because current selector is title-regex-only and has no selection reason metadata.

**Step 2: Implement minimal selector changes**

Add a helper such as:

```js
function classifyDeepProfileReviewSelection(candidate, options = {}) {
  // returns { selected: true/false, reason, rank }
}
```

Keep `selectDeepReviewCandidates(coverageResult, limit)` API backward-compatible by mapping selected candidates to `{ ...candidate, deepReviewSelectionReason, deepReviewSelectionRank }`.

**Step 3: Verify**

```bash
node --test tests/account-coverage.test.js
```

Expected: PASS.

### Task 2: Add a reusable core Deep Profile Pass helper

**Objective:** Move the duplicate CLI deep-review logic into `src/core/account-coverage.js` so integrated workflow and CLI use identical behavior.

**Files:**

- Modify: `src/core/account-coverage.js`
- Modify: `src/cli.js`
- Test: `tests/account-coverage.test.js`

**Step 1: Write failing test**

Create a fake driver with:

- `openCandidate(candidate)` recording opened URLs
- `captureEvidence(candidate)` returning detail-page observability text only after open

Assert a helper like `runAccountCoverageDeepProfilePass()`:

- opens only selected candidates
- calls `captureEvidence({ fromListPage: false })`
- promotes a hidden-signal candidate after rescoring
- leaves failed candidates unpromoted with `deepReview.failed`
- returns summary telemetry

Run:

```bash
node --test tests/account-coverage.test.js
```

Expected: FAIL because helper does not exist.

**Step 2: Implement helper**

Suggested signature:

```js
async function runAccountCoverageDeepProfilePass({
  driver,
  coverageResult,
  coverageConfig,
  icpConfig,
  priorityModel = null,
  reviewLimit = 8,
  force = false,
  runId = 'account-coverage-deep-profile',
  accountKey = 'coverage',
  now = () => new Date(),
})
```

Return:

```js
{
  coverageResult: updatedCoverageResult,
  summary: {
    enabled: true,
    requested: true,
    reviewLimit,
    selectedCount,
    reviewedCount,
    promotedCount,
    failedCount,
    selectionPolicy: 'account_coverage_deep_profile_v1'
  }
}
```

**Step 3: Refactor CLI**

Change `handleDeepReviewCoverage()` so it:

- loads artifact/config/model as today
- opens session/checks health as today
- calls `runAccountCoverageDeepProfilePass()`
- writes artifact as today
- logs from the returned summary

Do not change command semantics yet.

**Step 4: Verify**

```bash
node --test tests/account-coverage.test.js
node --test tests/scoring.test.js
```

Expected: PASS.

### Task 3: Integrate opt-in pass into `runAccountCoverageWorkflow()`

**Objective:** Add an explicit opt-in option so Account Coverage can run enrichment before returning final artifacts.

**Files:**

- Modify: `src/core/account-coverage.js`
- Modify: `src/cli.js`
- Test: `tests/account-coverage.test.js`

**Step 1: Write failing tests**

Assert:

- Default `runAccountCoverageWorkflow()` does not call `openCandidate()`.
- With `deepProfilePass: true`, it calls `openCandidate()` for selected candidates after scoring.
- A hidden stakeholder can move from `likely_noise` or `broad_it_stakeholder` to `technical_adjacent` / `direct_observability` after detail evidence.
- `bucketSummary` reflects post-review buckets.
- `deepProfilePass` summary exists in `run.result`.

Run:

```bash
node --test tests/account-coverage.test.js
```

Expected: FAIL because workflow ignores the option.

**Step 2: Implement options**

Add options to `runAccountCoverageWorkflow()`:

```js
deepProfilePass = false,
deepProfileLimit = 8,
forceDeepProfilePass = false,
```

After `finalResult` is built and before `bucketSummary`, call the helper only if:

- `deepProfilePass === true`
- not rate-limited
- `finalResult.candidateCount > 0`
- no all-sweeps company-resolution failure

If rate-limited or company-blocked, record a skipped summary rather than attempting detail opens.

**Step 3: Verify**

```bash
node --test tests/account-coverage.test.js
npm run test:release-readiness
```

Expected: PASS.

### Task 4: Add CLI flags and logging

**Objective:** Expose the integrated pass safely to operators.

**Files:**

- Modify: `src/cli.js`
- Modify: `package.json` only if needed for script docs, not expected
- Test: `tests/release-readiness.test.js` or existing CLI safety tests

**Step 1: Write failing tests**

Add/extend tests to assert package/CLI safety:

- `account-coverage --deep-profile-pass --live-save` is refused if live flags are generally refused by this command path.
- New flags do not appear in mutation commands.
- Existing dry-safe scripts stay dry-safe.

Run:

```bash
node --test tests/release-readiness.test.js
```

Expected: FAIL if parser/usage does not expose flags or safety assertion needs update.

**Step 2: Implement flags**

Read values:

```js
const deepProfilePass = getBoolean(values, 'deep-profile-pass');
const deepProfileLimit = Number(getString(values, 'deep-profile-limit') || 8);
const forceDeepProfilePass = getBoolean(values, 'force-deep-profile-pass');
```

Pass through to `runAccountCoverageWorkflow()`.

Log summary:

```js
logger.info(`Deep profile pass: reviewed=${summary.reviewedCount} promoted=${summary.promotedCount} failed=${summary.failedCount}`);
```

**Step 3: Verify**

```bash
node --test tests/release-readiness.test.js
node --test tests/account-coverage.test.js
```

Expected: PASS.

### Task 5: Increase detail snippet budget safely

**Objective:** Make detail-page evidence useful enough for About/Experience/Certifications without storing full profile dumps.

**Files:**

- Modify: `src/drivers/playwright-sales-nav.js`
- Test: `tests/playwright-driver.test.js` if feasible, otherwise `tests/account-coverage.test.js` around stored snippets

**Step 1: Write failing test**

Assert detail-page evidence snippets are bounded by a named constant and support a larger cap, e.g. 2000 chars.

Expected: FAIL because code currently slices to 500 in `captureEvidence()`.

**Step 2: Implement constant**

Add:

```js
const DETAIL_EVIDENCE_SNIPPET_MAX_CHARS = 2000;
```

Use it for detail-page extraction only. Keep candidate-level `deepReview.snippet` at a smaller review-friendly cap if desired, or explicitly set it to 1000/2000 with a test.

**Step 3: Verify**

```bash
node --test tests/playwright-driver.test.js
node --test tests/account-coverage.test.js
```

Expected: PASS.

### Task 6: Render Deep Profile Pass in coverage review report

**Objective:** Make enrichment impact visible to the Operator.

**Files:**

- Modify: `src/core/coverage-review.js`
- Test: relevant coverage-review tests, likely `tests/account-coverage.test.js` or a dedicated coverage-review test

**Step 1: Write failing test**

Given a coverage artifact with `deepProfilePass` and candidate `deepReview`, assert markdown includes:

- reviewed count
- promoted count
- failed count
- promoted candidates with previous/new bucket and score
- explicit read-only statement

**Step 2: Implement rendering**

Add a `Deep Profile Pass` section to coverage review markdown.

**Step 3: Verify**

```bash
node --test tests/account-coverage.test.js
```

Expected: PASS.

### Task 7: Add speed/quality fitness guard for the pass

**Objective:** Ensure profile enrichment improves candidate quality without exploding runtime or noise.

**Files:**

- Modify: `src/core/research-evaluation-metrics.js` or add account-coverage-specific summary helpers if cleaner
- Test: `tests/account-coverage.test.js` or `tests/autoresearch-mvp.test.js`

**Step 1: Write failing tests**

Assert metrics include:

- deep-review reviewed rate
- promotion rate
- failed rate
- incremental direct/technical-adjacent candidates
- runtime phase duration if timings are present

**Step 2: Implement summary metrics**

Keep it simple and artifact-based. Avoid requiring browser runs.

**Step 3: Verify**

```bash
node --test tests/account-coverage.test.js
npm test
```

Expected: PASS.

## Rollout strategy

### Phase 1: Manual parity

- Extract helper.
- Keep `deep-review-coverage` behavior unchanged.
- Add richer selection and telemetry.

Success:

- Existing manual command still works.
- Tests prove detail-page evidence can promote hidden stakeholders.

### Phase 2: Opt-in integrated pass

- Add `--deep-profile-pass` to `account-coverage`.
- Default remains off.
- Review limit defaults to 8 or 12.

Success:

- Operator can run one command and get enriched artifact.
- No live mutation paths touched.

### Phase 3: Evaluation loop

Run dry-safe A/B on a few accounts:

```bash
npm run account-coverage -- --account-name "X" --driver hybrid --speed-profile fast
npm run account-coverage -- --account-name "X" --driver hybrid --speed-profile fast --deep-profile-pass --deep-profile-limit 12
npm run render-coverage-review -- --account-name "X"
```

Compare:

- candidateCount
- direct_observability count
- technical_adjacent count
- list candidates selected
- manual-review/noise rate
- runtime delta
- failures/rate-limit events

### Phase 4: Controlled default decision

Only consider default-on for specific modes/accounts if evidence shows:

- materially more valid candidates,
- acceptable runtime cost,
- low failure/rate-limit rate,
- no safety regressions.

If default-on ever happens, document with an ADR.

## Acceptance criteria

- Account Coverage default behavior remains unchanged unless `--deep-profile-pass` is set.
- Integrated pass is read-only and never calls save/connect driver methods.
- Candidates selected for detail review are explainable via `deepReviewSelectionReason`.
- Hidden stakeholders with weak list-page title/headline can be promoted when detail-page evidence contains observability/platform signals.
- Review failures are contained and do not promote candidates.
- Artifacts include deep-profile telemetry.
- Coverage review markdown surfaces promotions/failures clearly.
- Full test suite and release-readiness tests pass.

## Verification commands

Run during implementation:

```bash
node --test tests/account-coverage.test.js
node --test tests/orchestrator.test.js
node --test tests/playwright-driver.test.js
node --test tests/release-readiness.test.js
npm run test:release-readiness
npm test
```

Safety checks before PR:

```bash
git diff --check
! git diff --name-only | grep -E '(^runtime/|\.env$|cookies|storageState|screenshots|\.sqlite|\.db)' >/dev/null
! git diff --name-only | grep -E 'runtime/artifacts|browser|profile|cookie|secret' >/dev/null
```

## Recommended PR slicing

1. `feat: extract account coverage deep profile helper`
2. `feat: add opt-in deep profile pass to account coverage`
3. `docs/test: surface deep profile pass telemetry and review output`
4. Optional later: `perf/eval: add deep profile pass fitness metrics`

Do not combine this with unrelated scoring changes. Keep scoring-policy expansion separate from browser-control mechanics unless a test requires one small title-hint update.
