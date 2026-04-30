# Multi-Agent PR Stack Runbook

Use this runbook when evolving the Parallel Research Pipeline through multiple PRs with Hermes, Cursor, Codex, Claude Code, or other coding agents.

## Operating model

- **Hermes Supervisor** owns scope, sequencing, safety review, verification, and merge readiness.
- **Implementation Agent** owns one narrow AFK Slice at a time, usually in Cursor/Composer 2 or an isolated subagent/worktree.
- **Spec Reviewer** checks the implementation against the issue/Agent Brief acceptance criteria before quality review starts.
- **Quality Reviewer** checks module depth, test quality, error handling, maintainability, and integration fit after spec compliance passes.
- **Safety Reviewer** checks dry-safe defaults, live flag refusal, forbidden path changes, Browser Worker serialization, and secret/runtime hygiene.
- **Stress/Evaluation Agent** runs deterministic loops, smoke commands, Speed Fitness checks, and flake/stability probes.

These may be separate humans/agents or separate passes by Hermes. The role boundary matters more than the tool.

## Stacked PR rules

1. Build from the current stack base, not stale `main`.
2. Keep one vertical slice per PR. A completed slice must be independently reviewable and testable.
3. Prefer docs/guardrails before autonomy. Add vocabulary, ADRs, and verification runbooks before adding executor behavior.
4. Do not let two implementation agents edit the same high-risk files in parallel unless Hermes explicitly coordinates the merge.
5. Treat agent self-reports as untrusted. Hermes must inspect diffs and run verification locally.
6. Do not merge any stack PR until its lower dependency PRs are merged or the stack is intentionally retargeted and reverified.
7. After merging the stack bottom-up, update `main` and rerun final verification on `main`.

## Required Agent Brief sections

Every AFK Slice handed to an Implementation Agent should include:

- Objective: one end-to-end behavior.
- Context: relevant terms from `CONTEXT.md` and ADRs.
- Scope: exact in/out boundaries.
- Safety constraints: forbidden flags, forbidden files, Browser Worker rules.
- Suggested files/modules.
- Acceptance criteria.
- Verification commands.
- Required PR notes.

Use `docs/agents/ready-for-agent-brief.md` as the template.

## PR gate sequence

For each PR:

1. **Pre-flight gate**
   - Read `CONTEXT.md`.
   - Read relevant ADRs under `docs/adr/`.
   - Confirm branch base and working tree cleanliness.
   - Confirm no live browser/Sales Navigator action is required.

2. **Implementation gate**
   - Use strict TDD for production code changes.
   - Add behavior tests before implementation where applicable.
   - Keep docs-only changes explicit; docs-only PRs still need markdown/safety verification.

3. **Spec gate**
   - Compare diff against issue/Agent Brief acceptance criteria.
   - Reject missing acceptance criteria and unrequested scope expansion.

4. **Quality gate**
   - Review public interfaces, module depth, test seams, naming, and integration with existing pipeline vocabulary.
   - Prefer deep modules with small interfaces over pass-through helpers.

5. **Safety gate**
   - Confirm dry-safe defaults remain intact.
   - Confirm Browser Worker concurrency remains `1` unless a new ADR explicitly changes it.
   - Confirm no Live-save/Live-connect behavior changed unless the PR is explicitly HITL.
   - Confirm no `runtime/`, `.env`, cookies, browser profiles, screenshots, local DBs, or secrets are committed.

6. **Verification gate**
   - Run targeted tests for touched code.
   - Run `npm run test:release-readiness` for release/safety surfaces.
   - Run `npm test` before merge readiness unless the PR is explicitly docs-only and the Supervisor records why full tests were skipped.
   - Run `git diff --check`.
   - Run a forbidden-path/secret scan over changed files.

7. **PR publication gate**
   - PR body must include Summary, Safety, Verification, Stack position, and Next PR.
   - State whether browser-backed execution paths or live-mutation paths changed.

## Recommended stack for the Parallel Research Pipeline

- Foundation: Research Queue, Research Jobs, dry-safe CLI, Browser Worker Lock, scoring/merge helpers.
- Operating Context: `CONTEXT.md`, ADRs, Agent Briefs, verification/stress runbooks.
- Stress Harness: repeated dry-safe pipeline runs, local-concurrency checks, browser-concurrency invariants.
- Cache Adapter: read existing sanitized cache/artifacts and bypass browser-required jobs where possible.
- Merge Coordinator: richer quality diagnostics, duplicate handling, missing-data reporting.
- Optional Browser Integration: explicit opt-in, serial Browser Worker only, HITL review required.

## Merge procedure

When the stack is ready:

1. Verify the bottom PR is mergeable and green.
2. Merge bottom-up, preferably squash merge.
3. Retarget the next PR to the new base (`main` after the lower PR lands).
4. Re-check mergeability and resolve conflicts locally if needed.
5. Rerun targeted/release tests for the retargeted PR.
6. Repeat until the stack is merged.
7. Pull `main` locally and run final verification on `main`.
