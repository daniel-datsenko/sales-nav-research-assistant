# Claude Code Startup Guide

This repository contains Sales Navigator Research Assistant, a supervised browser-backed research tool. Start every new local setup by running:

```bash
npm run doctor
```

Explain the result in plain language before attempting browser-backed workflows. Dry-safe research and artifact generation can run without LinkedIn login. Real Sales Navigator list saves or connection invitations require explicit operator approval and a visible authenticated browser session.

If setup is incomplete, offer two safe paths:

- A) Produce a research Markdown/calling-list artifact now; Sales Navigator push happens after setup.
- B) Finish setup first with `npm install`, tests, and `npm run bootstrap-session -- --driver=playwright --wait-minutes=10`.

Never run `--live-save`, `--live-connect`, or background connect commands unless the operator explicitly requests that live action.

## Agent Operating Context

- Use `CONTEXT.md` for canonical project language before planning, implementing, or reviewing non-trivial work.
- Read relevant ADRs in `docs/adr/` before changing safety gates, live-mutation paths, performance mechanisms, or agent workflows.
- Use `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md` when creating or triaging GitHub issues.
- Use `docs/agents/ready-for-agent-brief.md` before handing work to an AFK implementation agent.
