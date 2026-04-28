# Background Territory Runner

This document defines the first production shape of the background territory runner for an SDR/operator.

## Runner defaults

- SDR owner: configured by queue artifact or CLI input
- territory source: `BigQuery`
- stale account threshold: `60 days`
- qualifying activity: `meetings`, `calls`, `tasks`
- default connect policy: `assist`
- default tool share: `50%`
- default behavior: `list maintenance only`
- optional behavior: `background connects`
- territory expansion: `lead lists` + `account lists`
- subsidiary expansion: `enabled`

## What the runner should do

The runner should continuously maintain a queue of accounts that belong to the SDR and process them in this order:

1. accounts with the oldest qualifying activity
2. seed accounts discovered from lead lists and account lists
3. subsidiaries related to territory accounts or seed accounts

For each account it should:

1. resolve the right Sales Navigator account
2. run full-account coverage and focused sweeps
3. write or update the right lead list
4. optionally send connects if background connects are enabled
5. checkpoint progress so the run can resume safely

## Timeout And Recovery Behavior

- Fresh live coverage is bounded per account by `--account-timeout-ms`.
- If one account hangs, the loop records that account as `coverageStatus=timed_out`.
- A timed-out account is counted in `metrics.timedOutAccounts`.
- The checkpoint still records the account outcome so the runner can continue instead of blocking the whole batch.
- Timeout is an account-level research outcome, not an `environment_blocked` run.
- If all live sweeps fail for an account, the loop keeps the run `completed` but reports an account-level `coverageError=all_sweeps_failed`.
- Account-level sweep failures are operationally different from true zero-lead accounts and should be cooled down or reviewed for account-filter aliases.
- The first remediation step for `all_sweeps_failed` is company resolution: search for the public LinkedIn company page, capture the LinkedIn-visible company name, and add that plus parent/subsidiary aliases to `config/account-aliases/default.json`.
- Seeded hard cases now include `Example Media Germany` for `Example Media Group Germany`, `Example Logistics` for `Example Logistics Switzerland`, and guarded Example Broadcaster aliases for the `Example Broadcast Studio` timeout reference.
- Alias matching normalizes legal suffixes and punctuation before lookup, so territory variants can reuse existing hard-account entries.
- Public LinkedIn company URLs in `linkedinCompanyUrls` are converted into search/filter tokens from the company slug before Sales Navigator account resolution.
- Use `node src/cli.js resolve-company --account-name="Account"` to write a dry-safe resolution artifact, `node src/cli.js retry-company-resolution-failures --limit=3` to generate resolver artifacts for recent `all_sweeps_failed` accounts, and `node src/cli.js run-company-resolution-retries --limit=3 --driver=hybrid --max-candidates=25` to run a guarded cache-free retry only for safely resolved accounts.
- Background loop reports show `resolutionStatus`, `resolutionConfidence`, selected company targets, and `next=resolve_company_targets_then_retry` when account scoping should be retried after resolution.
- `environment_blocked` is reserved for browser/session/harness health failures before the queue can be processed.
- Environment-blocked runs write the same Markdown report format as completed runs, so operators can see `status=environment_blocked`, the environment class, `operator disposition`, `next action`, and `accountsAttempted=0` without opening raw JSON.
- Current environment next actions are `allow_browser_runtime_then_retry`, `fix_browser_runtime_then_retry`, `restart_browser_harness_then_retry`, `reauthenticate_linkedin_then_retry`, and `inspect_environment_then_retry`.
- On macOS, `browser_launch_blocked` with a `MachPortRendezvousServer` or `bootstrap_check_in` permission detail usually means the run needs an approved browser-capable execution context, not a queue or LinkedIn regression.
- Cache-only dry runs can skip the browser session check when all selected accounts have fresh coverage artifacts.
- Cache-only artifacts still use `environment.state=healthy` because no browser was required, but they also record `environment.sessionCheckSkipped=true` and the Markdown report renders `Session check: skipped (cache_only)`.
- `--reuse-empty-cache` lets a dry-run treat known zero-candidate artifacts as completed evidence for controlled verification runs.

## Data layers

### BigQuery

Used for:

- the SDR-owned territory account set
- stale-account prioritization
- historical activity signals
- subsidiary discovery inputs

Implementation note:

- Live data adapters should map the current operator from the configured warehouse or CRM source.
- Keep warehouse-specific owner aliases and query experiments in local notes, not in shared repo docs.

### LinkedIn Sales Navigator

Used for:

- account traversal
- people discovery
- list maintenance
- optional connect execution

### Local platform state

Used for:

- checkpoints
- pacing and budget state
- recovery events
- candidate history
- lead list and connect audit

## Priority model for the queue

The queue should merge three sources:

### 1. Territory accounts

Accounts directly owned by the SDR in BigQuery.

### 2. Seed-expanded accounts

Accounts pulled from:

- Sales Navigator lead lists
- Sales Navigator account lists
- local `--seed-file` JSON/CSV inputs
- future BigQuery seed datasets via `--seed-dataset`

This lets the SDR extend territory coverage from real working sets.

### 3. Subsidiary-expanded accounts

Accounts attached to parent territory or seed accounts.

This matters because enterprise work often happens in subsidiaries that do not surface as the primary parent account.

## Default pacing model

The first runner should use `assist` mode:

- weekly cap baseline: `140`
- tool share: `50%`
- effective tool weekly cap: `70`
- daily pacing target: computed from remaining business days
- daily max default: `15`

Background connects should stay disabled unless explicitly enabled.

## Execution modes

### 1. Lists-only mode

Default mode.

- no background connects
- build or maintain lead lists
- background loop stays effectively read-only until `--live-save` is explicitly provided
- keep approval and review optional

### 2. Background-connect mode

Optional mode.

- same stale-first queue
- same list maintenance
- connects require explicit opt-in and should remain disabled until list maintenance is stable on the target account set
- connects only for connect-eligible leads
- strict pacing and duplicate guards

## First implementation slices

### Slice 1

- config for the runner defaults
- BigQuery query templates for territory, seeds, and subsidiaries
- queue-building and merge logic

### Slice 2

- BigQuery-backed territory snapshot for the configured SDR owner
- stale account queue artifact
- seed-account ingestion

### Slice 3

- background list-maintenance loop
- checkpoints and restart safety
- per-account timeout handling for slow LinkedIn sweeps

### Slice 4

- optional background connects with budget modes and daily pacing

## Open follow-up areas

- live BigQuery source for exported Sales Navigator lead/account list seeds
- subsidiary heuristics beyond direct CRM parent-child relationships
- account-scoping edge cases in Sales Navigator for unusual company names
- richer reporting for `coverageStatus=timed_out` accounts in operator summaries
