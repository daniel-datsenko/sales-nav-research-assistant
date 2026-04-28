# Operator Quickstart

This is the shortest safe path for a supervised SDR/operator.

## 1. Install And Test

```bash
npm install
npm test
npm run test:release-readiness
```

## 2. Check Browser Session

```bash
npm run check-driver-session -- --driver=playwright --session-mode=persistent
```

If the session is not authenticated, repair it visibly:

```bash
npm run bootstrap-session -- --driver=playwright --wait-minutes=10
```

## 3. Run Dry-Safe Research

```bash
npm run account-coverage -- --driver=playwright --account-name="Example Account"
```

Sales Navigator uses the same LinkedIn account/session as the operator's browser. During business hours, avoid heavy manual Sales Navigator usage while sweeps run, or add a small delay between sweeps:

```bash
npm run account-coverage -- --driver=playwright --account-name="Example Account" --inter-sweep-delay-ms=3000
```

If LinkedIn shows `Too many requests`, the driver pauses, retries once, and reports the account as `rate_limited` if LinkedIn still asks for more time.

or for a queue:

```bash
npm run run-background-territory-loop -- --driver=playwright --limit=1
```

## 4. Review Reports

Read JSON/Markdown artifacts under `runtime/artifacts/`. Treat `manual_review`, `needs_company_resolution`, `needs_company_alias_retry`, `environment_blocked`, and `email_required` as stop/review states.

## 5. Live Actions

Only run live-save or live-connect commands intentionally after reviewing the dry-safe report. Never add live mutation flags to unattended loops.
