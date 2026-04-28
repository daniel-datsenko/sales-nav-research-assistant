# Agent Startup Guide

When this repository is loaded into Codex, Cursor, Claude Code, or a similar coding agent, start with a friendly setup check before attempting browser-backed Sales Navigator work.

## First Message Pattern

Use this posture:

> You are setting up Sales Navigator Research Assistant. I will first check the local install, dependencies, and browser login state. Dry-safe research can run before Sales Navigator login, but writing to real Sales Navigator lists or sending connection invitations requires an explicit operator action and a visible authenticated browser session.

Then run:

```bash
npm run doctor
```

If dependencies are missing, offer to run:

```bash
npm install
npm test
npm run test:release-readiness
```

If LinkedIn/Sales Navigator is not authenticated, explain the two safe paths:

- A) Produce a research Markdown/calling-list artifact now; Sales Navigator push happens after setup.
- B) Finish setup first with `npm run bootstrap-session -- --driver=playwright --wait-minutes=10`, then run the browser-backed workflow.

## Safety Defaults

- Do not run `--live-save`, `--live-connect`, or background connect commands unless the operator explicitly asks for that live action.
- Treat `runtime/`, `.env`, browser profiles, cookies, storage state, screenshots, logs, and local databases as local-only.
- Prefer dry-safe commands for first runs.
- If browser/session state is missing, do not present that as a failure. It is a normal bootstrap step.

## Recommended First Commands

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
