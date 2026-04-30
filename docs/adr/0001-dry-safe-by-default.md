# ADR 0001: Dry-safe by default

## Status

Accepted

## Context

Sales Navigator Research Assistant can generate research evidence and can also drive browser-backed Sales Navigator actions. Those capabilities have very different risk profiles. Research and reporting are useful to run frequently, including through AI agents. List saves, list membership changes, and connection invitations mutate real external state and can create wrong-list contamination, accidental lead removal, unwanted invitations, or account/session risk.

Agents often optimize for task completion. Without a durable project decision, a future implementation could turn a dry plan into an executor, leak copyable live commands from stale artifacts, or run browser flows with mutation flags in the background.

## Decision

The repository is dry-safe by default.

- Commands and scripts must not perform Sales Navigator or LinkedIn mutations unless the Operator explicitly requests the live action.
- Live list writes require explicit `--live-save` or a clearly named live-save command.
- Live connection invitations require explicit `--live-connect`.
- Autoresearch, gate reports, supervisor runbooks, company-resolution retries, speed evaluation, and agent/planner workflows are read-only or dry-safe unless a future ADR explicitly changes that contract.
- Runtime/session files, cookies, browser profiles, screenshots, local DBs, `.env`, and raw local artifacts stay local-only and must not be committed.
- Agents may propose and implement deterministic code changes, but they must not freely click through Sales Navigator or mutate external state.

## Consequences

- Some workflows require an extra Operator step before live execution. This is intentional.
- CLI handlers should refuse live flags for read-only commands.
- Operator-facing reports may render supervised live commands only for eligible decisions and must clearly require human approval.
- Tests should include regressions that prove dry-safe commands reject live flags and that non-live decisions suppress unsafe commands.
- Implementation agents should treat live mutation as HITL work, not AFK work.
