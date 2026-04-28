# Sales Navigator Research Assistant

<p align="center">
  <img src="docs/assets/grots-linkedin.jpg" alt="Sales Navigator Research Assistant hero image" width="900">
</p>

Supervised research assistant for LinkedIn Sales Navigator workflows.

The app helps an SDR/operator move from territory accounts to relevant technical stakeholders, reviewable lead candidates, and guarded Sales Navigator list workflows. It is designed for supervised use: research and reporting can run in dry-safe mode, while any live Sales Navigator action requires explicit operator intent.

## What It Does

- Resolves territory accounts into reliable LinkedIn/Sales Navigator company targets.
- Runs account coverage sweeps for observability, platform, cloud, infrastructure, and related personas.
- Classifies accounts and runs as `productive`, `mixed`, `sparse`, `noisy`, `all_sweeps_failed`, or environment-blocked.
- Imports external lead lists quickly and buckets people into `resolved_safe_to_save`, `needs_company_alias_retry`, and `manual_review`.
- Plans Sales Navigator lead-list updates and only performs live list saves when explicitly run with live-save flags.
- Models guarded connect workflows for supervised testing and maps attempts into deterministic operator statuses.
- Produces JSON and Markdown artifacts for review, handoff, and release-readiness checks.

## Safety Model

The default posture is intentionally conservative.

- No live list saves happen unless a command is run with `--live-save`.
- No connection invitations are sent by dry-safe or background workflows.
- Supervised connect test commands require explicit live-connect flags and should only be used by an authorized operator.
- Background/autoresearch flows are dry-safe and must not send invitations or mutate LinkedIn lists.
- Runtime data, browser profiles, cookies, sessions, logs, screenshots, and local databases live under ignored paths.
- Salesforce credentials, BigQuery credentials, LinkedIn session state, and any API keys must be provided through local environment variables or local-only files, never committed.

## MVP Scope

Ready or close to ready:

- Account discovery and coverage sweeps.
- Company resolution and alias/target handling for difficult account names.
- Safe list creation/list-save workflows with visible Sales Navigator verification.
- Fast lead-list import from Markdown calling lists.
- Deterministic connect status modeling.
- Operator reports, release summaries, and local dashboard tooling.

Still guarded:

- Broad fully automatic connect across all LinkedIn UI variations.
- Fully unattended background territory machine over large account batches.
- SDR self-serve UX beyond CLI/runbook/operator-dashboard flows.
- Automatic handling of uncertain company scope or low-confidence people matches.

## Quick Start

Run the local readiness check first:

```bash
npm run doctor
```

Install dependencies:

```bash
npm install
```

Run the full regression suite:

```bash
npm test
```

Run release-readiness tests:

```bash
npm run test:release-readiness
```

Print the operator dashboard:

```bash
npm run print-mvp-operator-dashboard
```

Print the current release contract:

```bash
npm run print-mvp-release-contract
```

## Environment Setup

Create a local `.env` from `.env.example` if you need live integrations:

```bash
cp .env.example .env
```

Only fill in values on your own machine or runner. Do not commit `.env`, browser sessions, cookies, storage state, or runtime artifacts.

## First Run In An Agent

If you open this repo in Codex, Cursor, Claude Code, or a similar agent, the first step should be a local readiness check:

```bash
npm run doctor
```

If dependencies or login are missing, that is normal. Dry-safe research can still be prepared after install, but real Sales Navigator list writes require a visible authenticated browser session via:

```bash
npm run bootstrap-session -- --driver=playwright --wait-minutes=10
```

See [docs/first-run-onboarding.md](docs/first-run-onboarding.md), [AGENTS.md](AGENTS.md), and [CLAUDE.md](CLAUDE.md) for agent-specific startup guidance.

## Common Workflows

### Check Browser Session

```bash
npm run check-driver-session -- --driver=playwright --session-mode=persistent
```

### Bootstrap A Visible Session

Use this when the browser profile needs a manual login or checkpoint repair:

```bash
npm run bootstrap-session -- --driver=playwright --wait-minutes=10
```

### Dry-Run Territory/Account Research

```bash
npm run run-background-territory-loop -- --driver=playwright --limit=1
```

### Research Several Accounts Into One List

Use `--consolidate-list-name` when you want one shared Sales Navigator list instead of one list per account:

```bash
node src/cli.js run-account-batch \
  --account-names="Example Marketplace A, Example SaaS Marketplace, Example Mobility Co" \
  --driver=playwright \
  --consolidate-list-name="Research 2026-04-28 Example Batch" \
  --live-save
```

Or let the tool generate a consistent name:

```bash
node src/cli.js run-account-batch \
  --account-names="Example Marketplace A, Example SaaS Marketplace, Example Mobility Co" \
  --list-name-template="Research {date} {start_time} ({accounts})" \
  --driver=playwright \
  --live-save
```

### Resolve A Difficult Company

```bash
node src/cli.js resolve-company --account-name="Example Company"
```

### Retry Company Resolution Failures

```bash
node src/cli.js run-company-resolution-retries --limit=3 --driver=hybrid --max-candidates=25
```

### Fast Resolve A Calling List

```bash
npm run fast-resolve-leads -- \
  --source="/absolute/path/to/calling_list.md" \
  --driver=playwright \
  --search-timeout-ms=8000 \
  --max-candidates=4
```

### Dry Plan A List Import

```bash
npm run fast-list-import -- \
  --source="/absolute/path/to/fast-resolve-artifact.json" \
  --list-name="Example Lead List"
```

### Live Save A Safe Resolved List

Only run this intentionally after reviewing the dry plan:

```bash
npm run fast-list-import -- \
  --source="/absolute/path/to/fast-resolve-artifact.json" \
  --list-name="Example Lead List" \
  --driver=playwright \
  --live-save \
  --allow-list-create
```

## Project Structure

- `src/cli.js`: command-line entry point.
- `src/core/`: orchestration, company resolution, connect handling, list import, background runner, reports.
- `src/drivers/`: Playwright, Browser Harness, hybrid, and mock drivers.
- `src/adapters/`: read-only Salesforce and BigQuery adapters.
- `config/`: ICP, pilot policy, account aliases, coverage, runner, scoring, and mode configs.
- `docs/`: runbooks, release contract, MVP status, and operator guidance.
- `tests/`: Node test suite.
- `runtime/`: local-only state and artifacts; ignored by Git.
- `automation/`: local helper wrappers for browser/harness workflows.
- `vendor/browser-harness/`: vendored Browser Harness helper package.

## Usage And Compliance

This tool controls a real browser and can interact with Sales Navigator UI when explicitly configured to do so. Operators are responsible for using it only with accounts, systems, and workflows they are authorized to access, and for following applicable platform terms, internal security policies, and customer-data handling rules.

This repository is intentionally conservative: dry-safe research is the default, live mutations are opt-in, and uncertain company or person matches are routed to review instead of being silently acted on.

## Sharing This Repo

This repository is intended to be safe to share as source code, but every operator is responsible for their local runtime state.

- Keep `runtime/`, `.env`, browser profiles, screenshots, cookies, storage state, logs, and local databases out of Git.
- Use `.env.example` as a template; do not commit real Salesforce, BigQuery, LinkedIn, or browser-session credentials.
- Treat live Sales Navigator workflows as supervised operations. Dry-safe commands are the default; live mutations require explicit flags.
- Review LinkedIn/Sales Navigator terms, internal security policy, and customer data-handling requirements before wider rollout.

## License

This repository is not open source. It is shared under a proprietary internal evaluation license. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Release Readiness Definition

The first release target is a supervised MVP, not a broad autonomous release. It is release-ready when:

- Discovery reliably finds relevant technical stakeholders.
- Save-to-list flows are stable and visibly verifiable in Sales Navigator.
- Known connect UI shapes end in deterministic statuses instead of generic failures.
- `email_required` is treated as a normal skip state.
- Guarded account classes remain guarded unless supervised evidence proves otherwise.
- Operators can use reports and dashboards without reading raw logs.
- Background runs produce useful dry-safe evidence and separate environment failures from account logic failures.

## GitHub Publishing Checklist

Before pushing a new public or shared remote:

1. Run `npm test`.
2. Run `npm run test:release-readiness`.
3. Confirm `git status --short` is clean.
4. Confirm no `runtime/`, browser profile, session, cookie, token, log, or `.env` files are tracked.
5. Run the secret scan described in [docs/github-release-checklist.md](docs/github-release-checklist.md).
6. Review organization policies and LinkedIn/Sales Navigator usage requirements before any broader rollout.
