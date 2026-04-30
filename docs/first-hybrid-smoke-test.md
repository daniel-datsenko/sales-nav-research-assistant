# First Hybrid Smoke Test

## Goal

Validate the `hybrid` compatibility stack with the smallest real scope:

- Playwright remains the discovery engine.
- Playwright owns automated mutation paths such as save-to-list.
- Browser Harness remains available only as an explicit manual diagnostic path.
- No connects are sent.
- Only one known lead and one existing list are used.

## Preconditions

- Playwright session is already bootstrapped:
  ```bash
  npm run bootstrap-session -- --driver=playwright --wait-minutes=10
  ```
- One known-good Sales Navigator lead URL is available.
- One already existing safe test list is available.
- Browser Harness is not required for this smoke. If it is missing from `PATH`, the automated Playwright/hybrid path should still work.

## Sequence

1. `node src/cli.js check-driver-session --driver=playwright --session-mode=storage-state`
2. `node src/cli.js check-driver-session --driver=hybrid --session-mode=storage-state`
3. `node src/cli.js check-live-readiness --driver=playwright --candidate-url="https://www.linkedin.com/sales/lead/..." --list-name="Existing Test List"`
4. `node src/cli.js test-account-search --driver=hybrid --account-name="Known Account" --keywords="Known Query"`
5. `node src/cli.js test-list-save --driver=playwright --candidate-url="https://www.linkedin.com/sales/lead/..." --list-name="Existing Test List" --live-save`
6. Optional manual diagnostic only: `node src/cli.js check-driver-session --driver=browser-harness`
7. `node src/cli.js reconcile-state`

## Expected Result

- `playwright` health reports an authenticated Sales Navigator session.
- `hybrid` health reports Playwright-backed discovery and mutation readiness.
- Account search still works through the hybrid driver.
- List save succeeds through Playwright with `selectionMode: existing_list`.
- Browser Harness absence does not block automated discovery or mutation flows.
- No connect action is sent.

## Stop Conditions

- Playwright reports `reauth_required`, `blocked`, or `captcha_or_checkpoint`.
- Hybrid discovery and mutation states disagree in a way that suggests session drift.
- The safe target list is not found.
- Any unexpected modal or restriction warning appears.
