# Sales Navigator Research Assistant Context

This document defines the shared language for this repository. Agents should use these terms in plans, issues, tests, PRs, and operator reports so the project stays concise and consistent.

## Language

**Operator**
The human approving setup, review, and any live Sales Navigator mutation. Live list saves and connection invitations require explicit Operator intent.
_Avoid_: user, maintainer, approver when the meaning is live-action approval.

**Dry-safe**
A command, workflow, or artifact that does not write to Sales Navigator, send connection invitations, alter browser session state intentionally, or require live mutation permission. Dry-safe work may inspect code, produce reports, read local artifacts, or run deterministic tests.
_Avoid_: dry-run when the workflow may still have non-obvious side effects.

**Live Mutation**
Any action that changes Sales Navigator or LinkedIn state: saving/removing leads from lists, creating lists, sending connection invitations, or messaging. A Live Mutation must be serial, explicit, visible to the Operator, and guarded by the relevant CLI flag.
_Avoid_: push, sync, execute when the action is specifically Sales Navigator state mutation.

**Live-save**
A Live Mutation that writes Sales Navigator list state, enabled only by `--live-save` or an explicitly named live-save command.
_Avoid_: save when discussing dry-safe planning; say planned save or intended add instead.

**Live-connect**
A Live Mutation that sends or attempts LinkedIn/Sales Navigator connection invitations, enabled only by `--live-connect`.
_Avoid_: connect when referring to analysis of connectability; say connect eligibility or connect surface instead.

**Runtime Artifact**
A local generated file under `runtime/artifacts/**`. Runtime Artifacts can be JSON or Markdown, are review evidence, and must not be committed unless explicitly promoted into docs as a sanitized example.
_Avoid_: report if persistence/location matters.

**Review Artifact**
A human-readable or machine-readable artifact produced so the Operator can inspect evidence before any Live Mutation. Review Artifacts should include enough context to understand intended actions and blockers without raw local secrets/session data.

**Mutation Review**
The dry-safe review step that summarizes intended adds, skips, exclusions, duplicate warnings, and required checks before any Live-save. Rows excluded by Mutation Review must not become live-save attempts.

**Execution Gate**
The decision object that classifies whether the latest autoresearch evidence allows only dry runs, is blocked, requires Operator review, or is eligible for supervised Live-save. Execution Gates are advisory/control evidence; they are not executors.

**Gate Report**
A read-only Operator-facing rendering of an Execution Gate. Gate Reports must suppress unsafe commands for non-live decisions and must refuse live flags at CLI entry.

**Supervisor Runbook**
A read-only next-action report that maps Execution Gate decisions to safe Operator actions. A Supervisor Runbook can recommend commands and checklists, but `autoExecute` remains false and live actions require human approval.

**Research Loop Plan**
A deterministic, dry-safe ordered plan derived from autoresearch evidence. Valid steps include environment checks, company-resolution retries, background dry runs, autoresearch refreshes, and Operator review gates.

**Company Scope**
Evidence that a people search is constrained to the intended account/company. If Company Scope is missing or ambiguous, browser-backed people search must fail closed rather than search broadly.

**Company Resolution Blocker**
A state where an account/company target cannot be safely resolved or scoped. Live-save candidates from blocked accounts are not eligible until the blocker is cleared or explicitly reviewed.

**Lead Identity**
The resolved person identity for a candidate, including name, company/account corroboration, profile URL evidence, title/location signals, confidence, and manual-review status.

**Safe-to-save Candidate**
A lead whose Lead Identity, Company Scope, URL validity, duplicate state, and confidence meet the project's save eligibility rules. Manual-review or low-confidence leads are never Safe-to-save Candidates.
_Avoid_: good lead unless discussing sales quality only.

**Manual Review**
A lead/account state requiring human inspection before mutation. Manual Review is a safety classification, not a failure. It blocks live-save and live-connect eligibility until resolved.

**Already-saved No-op**
A list-save interaction that detects the target row is already selected/saved and returns without clicking. This prevents accidentally toggling membership off.

**Autoresearch**
The dry-safe automation layer that collects and summarizes research evidence, execution gate state, evaluation metrics, and recommended next steps. Autoresearch is not a live executor.

**Speed Fitness Gate**
A read-only comparison of baseline vs candidate artifacts that accepts a performance optimization only when speed improves and lead quality/safety metrics do not regress.

**Adaptive Sweep Pruning**
An opt-in account-coverage speed mechanism that can skip low-yield rest sweeps after broad and priority evidence. It is disabled by default and never prunes exhaustive profiles.

**Fast Resolve Query Cache**
A per-run cache that deduplicates repeated Fast Resolve searches by query shape. It caches raw candidate lists only; every lead is scored independently from cached candidates.

**Agent Brief**
A durable issue/comment describing an implementation slice that an AFK coding agent can execute without extra context. It must include scope, acceptance criteria, safety constraints, commands, and forbidden actions.

**AFK Slice**
A narrow vertical implementation task that an agent can complete without additional human decisions. AFK Slices must include tests or deterministic verification.

**HITL Slice**
A task that requires human-in-the-loop judgment, live external access, design approval, or operator review before completion.

## Relationships

- An **Operator** approves any **Live Mutation**.
- **Autoresearch** produces **Runtime Artifacts**, a **Research Loop Plan**, evaluation metrics, and an **Execution Gate**.
- A **Gate Report** and **Supervisor Runbook** render the **Execution Gate** without executing live actions.
- A **Safe-to-save Candidate** requires valid **Lead Identity**, verified **Company Scope**, no blocking **Manual Review**, and acceptable duplicate/already-saved state.
- A **Speed Fitness Gate** protects lead quality when adding speed mechanisms such as **Adaptive Sweep Pruning** or **Fast Resolve Query Cache**.
- **Agent Briefs** convert approved plans into **AFK Slices** or mark work as **HITL Slices**.

## Flagged Ambiguities

- "Save" can mean planned list addition or real Sales Navigator mutation. Use **planned save** for dry-safe intent and **Live-save** for real mutation.
- "Connect" can mean connect eligibility, connect surface diagnostics, or real invitation sending. Use **Live-connect** only for real invitation attempts.
- "Report" can mean runtime evidence, Operator rendering, or project documentation. Prefer **Runtime Artifact**, **Review Artifact**, **Gate Report**, or **Supervisor Runbook**.
- "Agent" can mean Hermes Supervisor, Cursor/Codex implementation worker, or a logical research role. Use **Supervisor**, **Implementation Agent**, or the specific role name when safety authority matters.
