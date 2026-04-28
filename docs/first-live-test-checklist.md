# First Live Test Checklist

## Goal
Run the first controlled `list-save smoke test` without expanding scope into connects or broad territory automation.

## Preconditions
- LinkedIn session is healthy in the dedicated persistent profile.
- Target lead URL is a valid Sales Navigator lead URL.
- Target list already exists in Sales Navigator.
- No Captcha, checkpoint, or re-auth prompt is active.
- Dashboard is only exposed on `127.0.0.1`.

## Test Sequence
1. `npm run bootstrap-session -- --driver=playwright --wait-minutes=10`
2. `npm run check-driver-session -- --driver=playwright --session-mode=persistent`
3. `npm run check-live-readiness -- --driver=playwright --candidate-url="https://www.linkedin.com/sales/lead/..." --list-name="Existing Test List"`
4. `npm run test-account-search -- --driver=playwright --account-name="Known Account" --keywords="Known Query"`
5. `npm run test-list-save -- --driver=playwright --candidate-url="https://www.linkedin.com/sales/lead/..." --list-name="Existing Test List" --live-save`
6. `npm run reconcile-state`

## Expected Result
- Session state stays `authenticated`.
- `test-account-search` returns expected candidates for the chosen account.
- `test-list-save` reports `saved` with `selectionMode: existing_list`.
- No recovery event of type `captcha_or_checkpoint`, `blocked`, or `list_save_failed`.

## Current Blockers
- We still need one known-good Sales Navigator lead URL for testing.
- We still need one already existing target list that is safe to reuse.
- Salesforce live ingest still depends on real environment variables or a normalized snapshot endpoint.
- Some Sales Navigator account names still fail company scoping in the current Playwright flow, so background territory runs can hit account-specific filter failures even when session health is good.
- Seed expansion is now available through a local `--seed-file` fallback, but a production BigQuery-backed seed source for lead lists and account lists is still not wired.
- If Playwright is being launched from a restricted sandboxed runtime, browser startup may be blocked before LinkedIn loads. In that case run the session validation and smoke test from the normal desktop context instead.

## Stop Conditions
- Session state changes to `reauth_required`, `blocked`, or `captcha_or_checkpoint`
- Save flow cannot find the target list in safe mode
- Unexpected modal or ambiguous UI appears during save
- LinkedIn shows unusual activity or account restriction signals
