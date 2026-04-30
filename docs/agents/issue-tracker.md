# Agent Issue Tracker

## Tracker

This repository uses GitHub Issues in `daniel-datsenko/sales-nav-research-assistant` as the shared issue tracker.

Agents should use the GitHub CLI (`gh`) when they need to read, create, or update issues and PRs. If `gh` is unavailable or unauthenticated, stop and report the blocker instead of inventing a separate backlog.

## Required posture

- Use project language from `CONTEXT.md` in issue titles and bodies.
- Respect ADRs in `docs/adr/` before proposing architecture or safety changes.
- Prefer small vertical slices over large horizontal tasks.
- Mark each implementation slice as AFK or HITL.
- Do not include secrets, cookies, browser profiles, local DB paths with sensitive names, screenshots, or raw runtime artifacts in GitHub issues.
- Do not post commands with `--live-save`, `--live-connect`, or background-connect allowances unless the issue is explicitly HITL and the command is clearly labeled as Operator-approved only.

## Issue creation flow

When turning a plan into issues:

1. Read the current plan/conversation and relevant code/docs.
2. Identify thin vertical slices that each produce verifiable behavior.
3. Classify each slice:
   - **AFK**: an implementation agent can complete it without new human decisions.
   - **HITL**: requires Operator judgment, external access, live Sales Navigator state, or product/risk approval.
4. Publish issues in dependency order.
5. Apply exactly one category label and one state label from `docs/agents/triage-labels.md`.
6. For AFK work, include or link an Agent Brief using `docs/agents/ready-for-agent-brief.md`.

## Useful commands

```bash
gh issue list --state open --limit 50
gh issue view <number> --comments
gh issue create --title "..." --body-file /tmp/issue.md --label "enhancement,needs-triage"
gh issue edit <number> --add-label ready-for-agent --remove-label needs-triage
```

## PR relationship

PRs should reference the issue or plan they implement. For safety-sensitive changes, PR bodies should include:

- Summary
- Safety invariants preserved
- Test plan
- Any live-mutation paths touched
- Whether the change is AFK-safe or HITL-only
