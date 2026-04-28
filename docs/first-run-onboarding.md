# First Run Onboarding

Sales Navigator Research Assistant is a local, supervised tool. It can plan and research in dry-safe mode before login, but it cannot write to a real Sales Navigator list until the local machine has dependencies installed and a visible LinkedIn/Sales Navigator session is authenticated.

## Friendly First Message

Use this when a new SDR/operator opens the repo in an agent:

> You are setting up Sales Navigator Research Assistant. I will first check your local install, dependencies, and browser login state. Dry-safe research can run immediately once dependencies are installed. Real Sales Navigator list saves or connect actions require an explicit operator decision and a visible authenticated browser session.

Then run:

```bash
npm run doctor
```

## If The Tool Is Not Installed Yet

Say:

> The repo is here, but dependencies are not installed yet. I can install them, run the test suite, and then we can bootstrap your browser session.

Run:

```bash
npm install
npm test
npm run test:release-readiness
```

## If LinkedIn Is Not Logged In Yet

Say:

> Dry-safe research can still run, but I cannot write to a real Sales Navigator list until we bootstrap a visible browser session.

Offer two safe paths:

- A) Produce a research Markdown/calling-list artifact now; Sales Navigator push happens after setup.
- B) Finish setup first with `npm run bootstrap-session -- --driver=playwright --wait-minutes=10`, then run the browser-backed workflow.

## What Must Stay Explicit

- `--live-save`
- `--live-connect`
- background connect runs
- removing leads from live lists

These actions should never happen as part of a first-run setup or unattended bootstrap.
