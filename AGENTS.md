# Agent Startup Guide

When this repository is loaded into Codex, Cursor, Claude Code, or a similar coding agent, start with a friendly setup check before doing Sales Navigator work.

## First Message Pattern

Use this posture:

> You are setting up Sales Navigator Research Assistant. I will first check the local install, dependencies, and browser login state. Dry-safe research can run before Sales Navigator login, but writing to real Sales Navigator lists or sending connection invitations requires an explicit operator action and a visible authenticated browser session.

For SDRs, prefer this simpler version:

> I will quickly check whether the tool is installed and whether LinkedIn is logged in. If something is missing, I will guide you through it. I will not save leads or send connection requests unless you explicitly ask me to.

Then run:

```bash
npm run doctor
```

If setup is missing, say this in plain language:

> I need to install the project files and run the checks once. After that, we can log in to LinkedIn and start researching accounts.

Then offer to run:

```bash
npm install
npm test
npm run test:release-readiness
```

If LinkedIn/Sales Navigator is not logged in, explain the two safe paths:

- A) Prepare the research file now; create the Sales Navigator list after setup.
- B) Finish setup and login first, then create the Sales Navigator list directly.

## Safety Defaults

- Do not save leads or send connection requests unless the user explicitly asks for that live action.
- For live list saves, prefer the standard `sdr-research --live-save` or `fast-list-import --live-save` path. The app already uses read-only list readback when available to skip existing leads and verify the final Sales Navigator list.
- Do not attempt API-based list creation, bulk add, delete, connect, or message actions. API usage in the normal flow is read-only verification and research acceleration only.
- Treat `runtime/`, `.env`, browser profiles, cookies, screenshots, logs, and local databases as local-only.
- Prefer research-only runs for first tests.
- If LinkedIn login is missing, do not present that as a failure. It is a normal setup step.

## Agent Operating Context

- Use `CONTEXT.md` for canonical project language before planning, implementing, or reviewing non-trivial work.
- Read relevant ADRs in `docs/adr/` before changing safety gates, live-mutation paths, performance mechanisms, or agent workflows.
- Use `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md` when creating or triaging GitHub issues.
- Use `docs/agents/ready-for-agent-brief.md` before handing work to an AFK implementation agent.
- Use `docs/agents/multi-agent-pr-stack.md` when splitting Parallel Research or agent-orchestration work across stacked PRs.
- Use `docs/testing/parallel-research-stress-verification.md` before claiming Parallel Research stability, speed, or merge readiness.

## Recommended First Commands For Agents

```bash
npm run doctor
npm test
npm run test:release-readiness
npm run check-driver-session -- --driver=playwright --session-mode=persistent
```

If session check fails:

```bash
npm run bootstrap-session -- --driver=playwright --wait-minutes=10
```

For enterprise accounts with unclear company scope, use the read-only resolver before retrying research:

```bash
npm run resolve-enterprise-entities -- --account-name="Account Name"
```
