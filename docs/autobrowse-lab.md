# AutoBrowse Lab For MVP Hardening

## Purpose

AutoBrowse is used as a read-only learning loop for fragile browser behavior. It does not replace the platform runner. It produces traces and heuristics that can later be promoted into driver code and regression tests.

## Current Tasks

- `sales-nav-company-resolution`: learn how to find the right LinkedIn company targets for account scoping.
- `sales-nav-connect-surface-diagnostic`: learn how to classify Connect UI surfaces without sending invitations.

## Command

```bash
npm run autobrowse:mvp
```

This validates the workspace and prints how to run actual iterations.

Actual evaluation requires the upstream AutoBrowse skill:

```bash
npx skills add https://github.com/browserbase/skills --skill autobrowse
AUTOBROWSE_SKILL_DIR=/path/to/autobrowse npm run autobrowse:mvp -- --run --task sales-nav-company-resolution --iterations=3 --env=local
```

The wrapper intentionally fails closed if the upstream skill path or `ANTHROPIC_API_KEY` is missing.

## Promotion Rule

AutoBrowse output is not production truth. A heuristic is only promoted when:

- it is visible in trace evidence,
- it maps to a deterministic platform state,
- it has a regression test,
- it does not widen live-save or live-connect permissions.

## Safety

- No live-save.
- No live-connect.
- No background connects.
- No messages or invitations.
- No automatic policy promotion.
