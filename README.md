# Sales Navigator Research Assistant

<p align="center">
  <img src="docs/assets/grots-linkedin.jpg" alt="Sales Navigator Research Assistant hero image" width="900">
</p>

Sales Navigator Research Assistant helps SDRs build better LinkedIn Sales Navigator lead lists faster.

Give it a few accounts. It researches the right technical people, explains who it found, and can create a Sales Navigator list when you explicitly ask it to.

## What It Does

- Finds relevant people at target accounts: DevOps, platform, cloud, infrastructure, engineering leaders, and related personas.
- Creates Sales Navigator lead lists when you explicitly ask it to save leads.
- Explains the result in plain language: found, saved, not saved, and what needs review.
- Helps with messy company names by trying to find the right LinkedIn company page.
- Imports calling lists from files and helps match those names to Sales Navigator profiles.
- Keeps risky actions guarded, especially list saves and connection requests.

## Safety Model

The tool is intentionally cautious.

- It does not save leads to a real Sales Navigator list unless you explicitly ask for live save.
- It does not send connection requests from the normal SDR research command.
- If LinkedIn asks for an email address before connecting, the tool skips that prospect.
- Login/session files, cookies, screenshots, and credentials stay local and must not be committed.
- If the tool is unsure about a company or person, it asks for review instead of guessing silently.

## Current Scope

Works well today:

- Researching accounts and finding relevant technical stakeholders.
- Creating reviewed Sales Navigator lead lists.
- Explaining why some leads were not saved.
- Handling many difficult company-name cases.
- Importing name lists and matching people to Sales Navigator profiles.

Still intentionally guarded:

- Broad automatic connection requests.
- Large unattended background runs.
- Unclear company matches.
- Low-confidence people matches.

## Quick Start

Check that the tool is ready:

```bash
npm run doctor
```

Install dependencies:

```bash
npm ci --ignore-scripts
```

The repo intentionally uses locked, script-free installs for public/shared setup. This reduces npm supply-chain risk by using the checked-in lockfile and preventing dependency lifecycle scripts from running during install.

For contributors: run all tests:

```bash
npm test
```

For contributors: run release-readiness checks:

```bash
npm run test:release-readiness
```

Print the current operator dashboard:

```bash
npm run print-mvp-operator-dashboard
```

Print the current release contract:

```bash
npm run print-mvp-release-contract
```

## SDR Quick Action

For day-to-day SDR testing, start here. Give the tool three to five accounts and let it work.

Research only:

```bash
npm run sdr-research -- --accounts="Example Account A, Example Account B, Example Account C"
```

Faster experimental read-only prefetch:

```bash
npm run sdr-research -- \
  --accounts="Example Account A, Example Account B, Example Account C" \
  --api-read-prefetch
```

Optional deep profile quality pass:

```bash
npm run sdr-research -- \
  --accounts="Example Account A, Example Account B, Example Account C" \
  --api-read-prefetch \
  --deep-profile-pass \
  --profile-read-method=voyager \
  --deep-profile-limit=20
```

This reads bounded profile signals for the best and borderline candidates, then re-scores them. In plain terms: it can notice signals like Prometheus, Grafana, OpenTelemetry, Datadog, Kubernetes, SRE, or localized observability wording that did not fit in the Sales Navigator result row. It is read-only, opt-in, and does not save or connect anyone by itself.

For large companies, the tool treats the account as a related company set. It checks IT, digital, systems, technology, and platform entities first, then the parent or main company, because useful observability contacts can live in either place. Same-name companies that are not clearly related still stop for review.

Research and create/update one Sales Navigator list:

```bash
npm run sdr-research -- \
  --accounts="Example Account A, Example Account B, Example Account C" \
  --list-name="SDR Research - Account A Account B Account C" \
  --live-save
```

This command never sends connection invitations. It reports what it found, what it saved, what it skipped, and what needs review.

When live-save is used, the tool now checks the target Sales Navigator list before and after saving with a read-only browser API path when available. In plain terms: it first skips people who are already in the list, saves only missing approved leads through the browser UI, then verifies the final list membership by stable Sales Navigator IDs. If the read-only API is not available, the tool falls back to the older UI snapshot check.

## Environment Setup

Create a local `.env` from `.env.example` only if you need Salesforce, BigQuery, or other live integrations:

```bash
cp .env.example .env
```

Only fill in values on your own machine. Do not commit `.env`, browser sessions, cookies, screenshots, or local result files.

## First Run In An Agent

If you open this repo in Codex, Cursor, Claude Code, or a similar agent, the first step should be a local readiness check:

```bash
npm run doctor
```

If install or LinkedIn login is missing, that is normal. The agent should help you set it up. Real Sales Navigator list writes require a visible LinkedIn login:

```bash
npm run bootstrap-session -- --driver=playwright --wait-minutes=10
```

See [SKILL.md](SKILL.md), [docs/first-run-onboarding.md](docs/first-run-onboarding.md), [AGENTS.md](AGENTS.md), and [CLAUDE.md](CLAUDE.md) for startup guidance.

## Common Workflows

### Check LinkedIn Login

```bash
npm run check-driver-session -- --driver=playwright --session-mode=persistent
```

### Experimental Read-Only Sales Nav API Probe

Use this only to test whether the logged-in browser can read Sales Navigator API data. It does not save, delete, or connect anything.

```bash
npm run test-sales-nav-api -- --account-name="Example Company"
```

Optional list readback test:

```bash
npm run test-sales-nav-api -- \
  --account-name="Example Company" \
  --list-name="Existing Test List"
```

To use the same read-only API pool as an opt-in accelerator for account research:

```bash
npm run account-coverage -- \
  --driver=playwright \
  --account-name="Example Company" \
  --api-read-prefetch
```

The API prefetch only reads data from the logged-in browser. In normal SDR runs it uses hybrid recall: it reads fast first, then still runs a small Sales Nav rescue check for obvious high-value personas such as Product Owner Engineering, Product Owner DevOps, IT-Architekt, Software-Architekt, Principal Architect, Senior Software Engineer, and Head of Engineering. Real list saves still require `--live-save`.

### Experimental Read-Only Voyager Profile Probe

Use this to test whether the logged-in browser can read bounded LinkedIn profile signals for one known lead. It is a diagnostics command only: no saves, no deletes, no connection requests, and no raw profile dump in the artifact.

```bash
npm run test-voyager-profile -- --sales-nav-lead-url="https://www.linkedin.com/sales/lead/..."
```

To use Voyager as an opt-in quality layer during account research:

```bash
npm run account-coverage -- \
  --driver=playwright \
  --account-name="Example Company" \
  --api-read-prefetch \
  --deep-profile-pass \
  --profile-read-method=voyager \
  --deep-profile-limit=20
```

Default research does not use Voyager. Keep it as a supervised quality booster until enough SDR test runs prove that it improves persona quality.

Voyager is intentionally guarded. It is best for borderline candidates that were already found by Sales Navigator search; it is not the primary discovery engine. By default, unknown-pitch Voyager promotions stay in review instead of being auto-selected, and candidates without a readable Voyager identity are reported as identity gaps instead of consuming deep-profile budget.

For smaller SaaS or scaleup accounts where strong engineering roles can otherwise look "adjacent", use:

```bash
npm run sdr-research -- \
  --accounts="Example Scaleup" \
  --api-read-prefetch \
  --scaleup-selection-expanded
```

### Autoresearch Voyager Evaluation

Use this when you want to test whether Voyager actually improves lead quality on benchmark accounts. It compares baseline research against Voyager-assisted research, checks optional gold/reference lead lists, and writes a recommendation report. It is read-only and never saves leads or sends connection requests.

Offline comparison with existing artifacts:

```bash
npm run autoresearch:voyager -- \
  --accounts="Example Company" \
  --gold-dir=fixtures/gold-lists \
  --baseline=runtime/artifacts/coverage/example-baseline.json \
  --candidate=runtime/artifacts/coverage/example-voyager.json
```

Run fresh read-only experiments from the logged-in browser:

```bash
npm run autoresearch:voyager -- \
  --accounts="Example Account A, Example Account B" \
  --gold-dir=fixtures/gold-lists \
  --run-experiments \
  --deep-profile-limit=20
```

The report shows recall, selected recall, approximate false positives, promoted candidates, blocked unknown-pitch promotions, identity gaps, missed persona families, runtime delta, Voyager reviewed/skipped/failed counts, and a clear `recommend_voyager_policy`, `needs_more_evidence`, or `reject_or_tighten_policy` decision.

For list creation and list updates, API usage is read-only by default. The app may use it to find the list, read existing members, skip duplicates, and verify the final result, but the actual lead save still happens through the guarded browser UI. Use `--skip-api-list-readback` only when debugging the fallback path.

### Enterprise Entity Resolver

Use this when an enterprise account has several related LinkedIn company pages, for example a parent brand plus IT, digital, systems, or platform subsidiaries. The resolver is read-only: it checks possible company pages, prioritizes IT/digital entities first, keeps the parent company in scope, and skips unrelated same-name companies.

```bash
npm run resolve-enterprise-entities -- --account-name="Example Enterprise"
```

With `--api-read-prefetch`, account research can call this resolver automatically when the first company lookup is ambiguous. If the resolver finds safe related entities, the run continues; if not, the report asks for company-scope review instead of searching the wrong company.

### Log In Again If Needed

Use this when LinkedIn needs a fresh manual login:

```bash
npm run bootstrap-session -- --driver=playwright --wait-minutes=10
```

### Background Account Research

```bash
npm run run-background-territory-loop -- --driver=playwright --limit=1
```

### Research Several Accounts Into One List

For SDRs, prefer `npm run sdr-research`. The commands below are advanced.

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

### Resolve A Difficult Company Name

```bash
node src/cli.js resolve-company --account-name="Example Company"
```

### Retry Accounts With Company-Name Problems

```bash
node src/cli.js run-company-resolution-retries --limit=3 --driver=hybrid --max-candidates=25
```

### Match A Calling List To Sales Navigator

```bash
npm run fast-resolve-leads -- \
  --source="/absolute/path/to/calling_list.md" \
  --driver=playwright \
  --search-timeout-ms=8000 \
  --max-candidates=4
```

### Preview A List Import

```bash
npm run fast-list-import -- \
  --source="/absolute/path/to/fast-resolve-artifact.json" \
  --list-name="Example Lead List"
```

### Retry Only Failed List Saves

If a save run hit a temporary LinkedIn issue, retry only the failed people instead of reprocessing the whole file:

```bash
node src/cli.js retry-failed-fast-list-import \
  --artifact="/absolute/path/to/failed-fast-import-artifact.json" \
  --driver=playwright \
  --live-save
```

The retry command is for temporary save problems, not for people the tool already marked as bad matches.

### Save A Reviewed Calling List

Only run this intentionally after reviewing the preview:

```bash
npm run fast-list-import -- \
  --source="/absolute/path/to/fast-resolve-artifact.json" \
  --list-name="Example Lead List" \
  --driver=playwright \
  --live-save \
  --allow-list-create
```

## Project Structure For Contributors

- `src/`: the tool logic.
- `config/`: persona rules, account aliases, and safety settings.
- `docs/`: setup notes, operating notes, and release notes.
- `tests/`: automated checks for contributors.
- `runtime/`: local-only browser/login/results data. This is ignored by Git.

## Usage And Compliance

This tool controls a real browser. Use it only with LinkedIn, Salesforce, and company systems you are allowed to access.

The tool is intentionally conservative: research is safe by default, real Sales Navigator changes require explicit approval, and uncertain company or person matches are sent to review instead of guessed.

## Sharing This Repo

This repository is intended to be safe to share as source code, but every operator is responsible for their local runtime state.

- Keep `runtime/`, `.env`, browser profiles, screenshots, cookies, logs, and local databases out of Git.
- Use `.env.example` as a template; do not commit real Salesforce, BigQuery, LinkedIn, or browser-session credentials.
- Treat real Sales Navigator list saves and connection requests as supervised actions.
- Review LinkedIn/Sales Navigator terms, internal security policy, and customer data-handling requirements before wider rollout.

## License

This repository is not open source. It is shared under a proprietary internal evaluation license. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Release Readiness Definition

The first release target is a supervised MVP, not a fully automatic broad rollout. It is release-ready when:

- Account research reliably finds relevant technical people.
- List saves are stable and can be checked in Sales Navigator.
- Connection-request attempts end in clear outcomes.
- Email-required prospects are skipped.
- Guarded accounts stay guarded until reviewed.
- SDRs can understand the report without reading logs.
- Background research produces useful findings without hiding browser/login problems.

## GitHub Publishing Checklist

Before pushing a new public or shared remote:

1. Run `npm test`.
2. Run `npm run test:release-readiness`.
3. Confirm `git status --short` is clean.
4. Confirm no `runtime/`, browser profile, session, cookie, token, log, or `.env` files are tracked.
5. Run the secret scan described in [docs/github-release-checklist.md](docs/github-release-checklist.md).
6. Review organization policies and LinkedIn/Sales Navigator usage requirements before any broader rollout.
