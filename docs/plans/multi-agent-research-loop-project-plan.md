# Multi-Agent Sales Navigator Research Loop — Project Plan

This document is the authoritative planning artifact for evolving **Sales Navigator Research Assistant** into a safer multi-agent research system. It is written for human operators and for agent runtimes (**Cursor**, **Codex**, **Hermes**) doing supervised implementation—not for autonomous live Sales Navigator mutations.

---

## Executive Summary

The repository already ships a substantial supervised pipeline: CLI orchestration, SQLite-backed runs, territory/account coverage, fast-list import with grouped company resolution, background territory runners, **autoresearch:mvp** dry-safe automation, Playwright plus **browser-harness** plus **hybrid** drivers, operator review dashboard, and explicit `--live-save` / `--live-connect` opt-in for mutations.

**North-star outcomes**

1. **Better lead identification** — fewer misses and clearer evidence trails without weakening guardrails.
2. **Avoid wrong-list contamination** — never promote weak identity or ambiguous company scope to “safe to save.”
3. **Never remove correct membership accidentally** — especially list-row interactions that can toggle membership off (see P0 backlog).
4. **Operator-approved mutations only** — no agent or CI path should execute live Sales Navigator writes or connects without explicit human intent and matching CLI flags.

**Delivery strategy**: ship **milestone 1 (critical safety)** before expanding planner/metrics/orchestration work; treat evaluation metrics and dashboards as layered on top of hard safety invariants.

---

## Current Architecture Map

### CLI entry and orchestration

| Surface | Role |
|--------|------|
| `src/cli.js` | Single Node entry (`main`: `src/cli.js`); parses args via `src/lib/args.js`; routes commands to workflows. |
| `src/core/orchestrator.js` | Territory runs: create runs, scoring, decisions, dry-run vs mutation semantics. |
| `src/core/territory-sync.js` | Territory intake/sync from adapters. |
| `src/core/decision-engine.js` | Candidate action decisions (`decideCandidateActions`). |

### Coverage, batches, background processing

| Module | Role |
|--------|------|
| `src/core/account-coverage.js` | Account coverage sweep, buckets, artifacts. |
| `src/core/coverage-review.js` | Markdown coverage review rendering. |
| `src/core/account-batch.js` | Named account batches, list naming templates. |
| `src/core/background-territory-runner.js` | Queue/spec artifacts for background territory processing. |
| `src/core/background-list-maintenance.js` | Background loop execution, checkpoints, variation registry, reports (`--live-save` optional). |

### Fast import and identity

| Module | Role |
|--------|------|
| `src/core/fast-list-import.js` | Resolve leads, grouped company pool, save plans, optional `--live-save`. |
| `src/core/lead-identity-resolution.js` | Name/slug inference, confidence, `needsManualReview`. |
| `src/core/lead-list-snapshot.js` | Snapshot reads for preflight/dedupe semantics. |

### Company resolution

| Module | Role |
|--------|------|
| `src/core/company-resolution.js` | Build artifacts, markdown, alias config loading. |
| `src/core/company-resolution-retry.js` | Retry queues and checkpoints (CLI marks dry-safe only). |

### Autoresearch MVP

| Module | Role |
|--------|------|
| `src/core/autoresearch-mvp.js` | Dry-safe command bundles, prohibited mutation flags, dashboard helpers. |

### Browser drivers

| Module | Role |
|--------|------|
| `src/drivers/playwright-sales-nav.js` | Discovery-heavy flows; `saveCandidateToList`, company filter/scoping, URL checks for `/sales/lead/`. |
| `src/drivers/browser-harness-sales-nav.js` | CDP-backed mutations; **already_saved** path checks selection **before** secondary clicks (lines ~418–426 region). |
| `src/drivers/hybrid-sales-nav.js` | Playwright-backed discovery + mutations; Browser Harness is manual-only unless explicitly selected as `--driver=browser-harness`. |
| `src/drivers/driver-adapter.js` | Adapter surface. |
| `src/drivers/mock-driver.js` | Tests/offline. |

### Storage, readiness, dashboard

| Module | Role |
|--------|------|
| `src/lib/db.js` | SQLite repository factory. |
| `src/lib/live-readiness.js` | Live readiness signals (includes Sales Nav URL helpers like `isSalesNavigatorLeadUrl`). |
| `src/server/dashboard.js` | Review dashboard server (`serve-review-dashboard`). |

### Adapters (readonly / ingest)

| Module | Role |
|--------|------|
| `src/adapters/gtm-bigquery.js`, `src/adapters/salesforce-readonly.js` | External data; Salesforce secrets policy surfaced in live readiness. |

### NPM scripts (from `package.json`)

Operational scripts agents should reference precisely:

- **Setup / health**: `npm run doctor`, `npm run check-driver-session`, `npm run bootstrap-session`, `npm run bootstrap-browser-harness`
- **Territory / runs**: `npm run sync-territory`, `npm run run-territory`, `npm run resume-run`
- **Coverage / batches**: `npm run account-coverage`; account batch flows are exposed through `node src/cli.js run-account-batch` rather than an npm script.
- **Fast path**: `npm run fast-resolve-leads`, `npm run fast-list-import`, `npm run retry-failed-fast-list-import`, `npm run import-coverage`
- **Background**: `npm run build-background-territory-queue`, `npm run run-background-territory-loop`
- **Research MVP**: `npm run autoresearch:mvp`
- **Dashboard**: `npm run serve-review-dashboard`
- **Tests**: `npm test`, `npm run test:release-readiness`
- **Pilot / live-oriented** (operator-only execution): `test-list-save`, `test-connect`, flows documented in `src/cli.js` help text (`--live-save`, `--live-connect`)

---

## Target Multi-Agent Architecture

### Principles

1. **Split cognition from execution**: planners and critics propose artifacts; **execution touchpoints** are CLI commands with stable contracts.
2. **Single writer for mutations**: only designated operator-approved processes invoke `--live-save` / `--live-connect`; agents document implementation plans in `docs/` and dry-run/runtime outcomes in local `runtime/artifacts/**` review artifacts that are not committed.
3. **Fail closed**: ambiguous scope, identity, or URL validity blocks promotion to save/connect—not “best effort save.”
4. **Observable artifacts**: every batch produces machine-readable summaries plus human-readable Markdown for review.

### Agent roles (logical)

| Agent | Responsibility | Primary inputs | Primary outputs |
|-------|----------------|----------------|-----------------|
| **Supervisor / Product** | Goals, priorities, acceptance criteria | Business territory goals, risk appetite | Milestones, ordered backlog |
| **Safety Auditor** | Invariants, threat modeling for list/connect flows | Driver code, CLI gates, tests | P0 findings, required tests |
| **Research Planner** | Next searches, coverage gaps, retry strategy | Coverage artifacts, pilot config, prior run logs | Plan JSON/Markdown (e.g. under `docs/` or committed templates—not `runtime/`) |
| **Implementation Agent** | Code + tests | Tasks from this plan | PR-ready diffs |
| **Verification Agent** | Test runs, static checks, dry CLI smoke | Changed modules | Report: commands run + results |
| **Operator** | Session bootstrap, live mutations, approvals | Dashboard + artifacts | Explicit CLI flags for live actions |

### Allowed vs forbidden surfaces

| Allowed | Forbidden without explicit operator approval |
|---------|-----------------------------------------------|
| Edit `src/**`, `tests/**`, `docs/**`, `config/**` (non-secret) | `--live-save`, `--live-connect`, `--allow-background-connects` on real sessions |
| Run `npm test`, `npm run test:release-readiness`, dry CLI defaults | Writing cookies, storage state, or scraping production LinkedIn outside supervised bootstrap |
| Read sample fixtures under repo | Bulk export of `runtime/`, `.env`, or session artifacts to shared channels |

**Safety boundaries**

- **`runtime/`**: local-only artifacts (logs, checkpoints, browser artifacts). Agents **must not** commit or normalize mutation of operator runtime content as “implementation.”
- **`.env` / secrets**: never commit; live readiness already warns on Salesforce secret patterns (`src/lib/live-readiness.js`).
- **Grouped keys / dedupe keys**: changes must preserve uniqueness semantics across grouped pools (`src/core/fast-list-import.js` grouped maps).

---

## Milestone Implementation Plan

### Milestone 1 — Critical safety fixes (P0)

**Objective**: Eliminate classes of “silent wrong save” and “accidental unsave,” align harness/playwright semantics, validate URLs before any save path reaches drivers where inconsistent.

| Task | Acceptance criteria | Tests to add/run | Risk notes |
|------|---------------------|------------------|------------|
| **M1-T1**: Playwright list row selection must not toggle off existing membership | Saving when lead already on target list yields `already_saved` or no-op without deselecting; unit/integration tests mock DOM state | `npm test` + targeted driver tests in `tests/playwright-driver.test.js` | DOM variance across locales |
| **M1-T2**: Unified Sales Nav lead URL validation | Shared helper used by Playwright + browser-harness + fast-import planning; rejects non-`/sales/lead/` URLs before mutation classification | Tests in `tests/fast-list-import.test.js` or new `tests/url-validation.test.js` | False rejects on rare URL shapes |
| **M1-T3**: Browser-harness / hybrid fail-closed when company scope unverified | Document and enforce: coverage/account flows do not silently widen people search when company filter fails (align with Playwright `needs_manual_alias` / filter errors) | Extend `tests/browser-harness-driver.test.js`, hybrid smoke docs | May increase manual_review volume |
| **M1-T4**: Identity confidence gates save | `needsManualReview` / low confidence cannot classify row as production-save eligibility without explicit override flag | `tests/fast-list-import.test.js`, `lead-identity-resolution` unit tests | Operator friction—mitigate with dashboard surfacing |
| **M1-T5**: Grouped row keys collision-safe | Keys incorporate stable row IDs or hashed URLs where present; collision test fixture | `tests/fast-list-import.test.js` | Migration of existing artifacts |

**Exit**: All new tests green; `npm run test:release-readiness` passes; documented operator checklist updated only if strictly necessary (prefer this plan doc iteration first).

---

### Milestone 2 — Research-loop planner

**Objective**: Deterministic planner that consumes coverage artifacts and emits the **next** dry-safe CLI DAG (no mutation).

| Task | Acceptance criteria | Tests | Risks |
|------|---------------------|-------|-------|
| Planner module or documented algorithm in code | Inputs/outputs versioned schema; reproducible given same artifacts | Unit tests with fixtures | Scope creep—keep v1 minimal |
| Integration hook | callable from `autoresearch:mvp` or sibling dry command | Snapshot tests for emitted Markdown/JSON | |

---

### Milestone 3 — Evaluation metrics

**Objective**: Measurable precision/recall proxies **without** requiring live labels—e.g., duplicate rate, manual_review rate, company-alias disagreement rate, sweep stability.

| Task | Acceptance criteria | Tests | Risks |
|------|---------------------|-------|-------|
| Metrics aggregation | Defined fields on existing artifacts + optional small reporter CLI | Pure unit tests on calculators | Metric gaming—pair with audits |

---

### Milestone 4 — List mutation review artifact

**Objective**: Export intended adds/removes **before** live-save with stable diff format for dashboard/email review.

| Task | Acceptance criteria | Tests | Risks |
|------|---------------------|-------|-------|
| Diff artifact | Markdown + JSON alongside existing snapshot flows | Snapshot tests | PII handling—keep local |

---

### Milestone 5 — Lead quality diagnostics

**Objective**: Explain **why** a lead scored/decisioned a certain way (signals, negatives).

| Task | Acceptance criteria | Tests | Risks |
|------|---------------------|-------|-------|
| Diagnostic strings | Attached to candidate assessments in artifacts | Decision/scoring tests | Verbosity |

---

### Milestone 6 — Company alias suggestions

**Objective**: Assist operators with ambiguous companies without auto-applying risky aliases.

| Task | Acceptance criteria | Tests | Risks |
|------|---------------------|-------|-------|
| Suggest-only mode | Writes suggestions artifact; never silently patches prod territory JSON | Company resolution tests | Trust—pair with M1 |

---

### Milestone 7 — Agent orchestration wrapper (Hermes + Cursor/Codex)

**Objective**: Thin wrapper docs + optional scripts that sequence dry phases and pause points for operators—not autonomous live loops.

| Task | Acceptance criteria | Tests | Risks |
|------|---------------------|-------|-------|
| Wrapper contract | ENV hooks documented; single entry for “dry pipeline” | Lint/smoke only | Misleading “full auto” naming—avoid |

---

### Milestone 8 — Operator approval / dashboard flow

**Objective**: Tie dashboard queues to planner outputs and mutation review artifacts.

| Task | Acceptance criteria | Tests | Risks |
|------|---------------------|-------|-------|
| Dashboard UX/docs | Shows pending approvals; links to artifact paths | Dashboard tests (`tests/dashboard.test.js`) | Scope |

---

## P0 Bug Backlog (Supervisor Analysis → Concrete Tracking)

Below items tie supervisor themes to **files** and **proposed tests**. Implementers should convert each into an issue with acceptance criteria mirroring Milestone 1.

### B1 — List row click may toggle membership off (Playwright path)

- **Symptom**: `clickVisibleListRow` (`src/drivers/playwright-sales-nav.js`, ~`clickVisibleListRow`) clicks matching buttons without detecting **already selected** state—could flip saved leads off target lists.
- **Contrast**: Browser harness path explicitly handles `before_state.selected` (`src/drivers/browser-harness-sales-nav.js`, ~418–426).
- **Proposed tests**: DOM-fixture test asserting **no click** when row already selected; golden tests for aria patterns.

### B2 — Hybrid mutation readiness vs company-scope verification

- **Symptom**: Discovery may succeed while company filter/scoping failed closed insufficiently on harness-only paths.
- **Files**: `src/drivers/playwright-sales-nav.js` (company filter errors), `src/drivers/hybrid-sales-nav.js` (`checkSessionHealth`), account/openPeopleSearch flows.
- **Proposed tests**: Hybrid unit tests forcing filter failure → **no candidate promotion** to save-eligible without explicit recovery state.

### B3 — Name-only / truncated-name resolution must not imply safe-to-save

- **Files**: `src/core/lead-identity-resolution.js` (`needsManualReview`, confidence tiers), consumers in `src/core/fast-list-import.js`, `src/core/decision-engine.js`.
- **Proposed tests**: Fixtures with truncated names **without** slug inference → blocked from automatic save tier unless operator flag.

### B4 — Grouped pool row key collisions

- **Files**: `src/core/fast-list-import.js` — `resolvedRows.set(... lead.row || \`${groupKey}:${fullName}\`)`, `groupedRows.get(...)`.
- **Proposed tests**: Two distinct rows normalize to same key → collision detected or keys include disambiguator (lead URL hash).

### B5 — Sales Navigator URL consistency before live save

- **Files**: Playwright validates `/linkedin\.com\/sales\/lead\//i` in `saveCandidateToList` (`src/drivers/playwright-sales-nav.js`); harness uses target URLs from caller—centralize validation (`src/lib/live-readiness.js` already exposes `isSalesNavigatorLeadUrl`).
- **Proposed tests**: Invalid URLs rejected at planner/driver boundary uniformly.

---

## Cursor Usage Strategy

### Models

| Mode | Recommended use |
|------|-----------------|
| **composer-2** | Implementation: production code changes, tests, refactors constrained by acceptance criteria |
| **composer-2-fast** | Reviews, plans, diffs-only critique, test-plan generation |

### `--trust` requirement

Workspace rules require `--trust` for headless Cursor CLI runs in this repo. Use it intentionally with tight prompts and file-scope constraints; it is not permission to touch `runtime/`, `.env`, lockfiles, or browser/session data unless the operator explicitly tasks it. Implementation agents should normally limit edits to `src/`, `tests/`, `docs/`, and non-secret `config/` files.

### Prompt patterns that work well

1. **Safety-first**: “Implement M1-T1 only; do not change hybrid routing; add tests before implementation where possible; cite failing invariant.”
2. **Scope-bound**: “Touch only `src/drivers/playwright-sales-nav.js` and `tests/playwright-driver.test.js`; no README edits.”
3. **Test-first**: “Write failing tests for URL validation helper then implement in `src/lib/` re-exported by drivers.”

### Measuring Cursor limits / usage conservatively

- **CLI `about`** may indicate **Team tier** but **does not expose** remaining tokens or pool balances—assume budgets are opaque.
- **Conservative habits**: reuse composer-2-fast for exploratory reads/plans; batch file reads in Cursor instead of iterative micro-prompts; prefer repo grep/`npm test` locally over repeated LLM summarization of logs.
- **Diff discipline**: ask implementation agents for smallest reversible commits per milestone task.

---

## Safety Gates — Live Save / Live Connect / Remove

Summary aligned with `src/cli.js` enforcement patterns (representative—not exhaustive):

| Operation area | Typical CLI affordance | Gate |
|----------------|----------------------|------|
| Smoke save test | `test-list-save ... --live-save` | Throws if `--live-save` omitted (`handleTestListSave`) |
| Fast import saves | `fast-list-import`, `retry-failed-fast-list-import`, `import-coverage` | `--live-save` optional dry path; rejects `--live-connect` / `--allow-background-connects` |
| Connect sends | `test-connect`, `connect-lead-list`, `pilot-connect-batch` | Requires `--live-connect` |
| Remove members | `remove-lead-list-members` | Requires `--live-save` |
| Autoresearch | `autoresearch-mvp` | Refuses live mutation flags entirely |
| Fast resolve | `fast-resolve-leads` | Refuses live flags |
| Background loop | `run-background-territory-loop` | Serial concurrency when `--live-save`; hybrid readiness |

**Hermes/Cursor agents**: treat these gates as **hard dependencies**—never suggest wrapping live commands into unattended cron without operator signing each escalation path.

---

## Suggested First Three Cursor Implementation Prompts

Copy-paste friendly; each assumes Milestone 1 posture.

### Prompt A — Centralize Sales Navigator lead URL validation

> Introduce a single exported validator (reuse logic from `isSalesNavigatorLeadUrl` in `src/lib/live-readiness.js` or consolidate there). Call it from Playwright `saveCandidateToList`, browser-harness mutation entry, and fast-list-import planning paths where URLs become save-eligible. Add unit tests covering valid `/sales/lead/` URLs and rejecting `/in/` or malformed URLs. Do not modify `runtime/` or `.env`. Run `npm test`.

### Prompt B — Playwright list selection parity with harness already_saved semantics

> In `clickVisibleListRow` / save panel flow (`src/drivers/playwright-sales-nav.js`), detect when the target list row is already selected **before** clicking; return `{ status: 'already_saved', ... }` aligned with harness payload shape consumed by `saveFastListImport`. Add regression tests with mocked page/locator behavior. Run targeted tests plus `npm run test:release-readiness`.

### Prompt C — Confidence gate from `resolveLeadIdentity` through fast-list-import save eligibility

> Trace `needsManualReview` and confidence from `src/core/lead-identity-resolution.js` into fast-list-import decisioning so rows flagged manual review cannot appear as eligible for `--live-save` batch saves unless an explicit opt-in flag exists (default off). Tests in `tests/fast-list-import.test.js` must demonstrate blocked vs allowed paths.

---

## Document Control

- **Location**: `docs/plans/multi-agent-research-loop-project-plan.md`
- **Living updates**: revise milestones when Milestone 1 exits; keep P0 backlog synchronized with implemented fixes (strike-through or appendix changelog optional).

---

## Appendix — Tests Commands Cheat Sheet

```bash
npm run doctor
npm test
npm run test:release-readiness
```

Dry-safe research and artifact generation remain valid **without** LinkedIn login; browser-backed workflows require operator session bootstrap per `AGENTS.md` / `CLAUDE.md`.
