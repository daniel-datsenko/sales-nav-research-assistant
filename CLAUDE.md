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
