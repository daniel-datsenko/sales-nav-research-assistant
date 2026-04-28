# First Hybrid Smoke Test

## Goal

Validate the new `hybrid` stack with the smallest real scope:

- Playwright remains the discovery engine
- Browser Harness is available as the mutation path
- no connects are sent
- only one known lead and one existing list are used

## Preconditions

- `automation/browser-harness` exists and is executable
- `vendor/browser-harness/.venv` is installed
- Chrome is running in the normal desktop context
- LinkedIn Sales Navigator session is already valid in the browser you want to use
- one known-good Sales Navigator lead URL is available
- one already existing safe test list is available

## Sequence

1. `npm run bootstrap-browser-harness`
2. `node src/cli.js bootstrap-session --driver=playwright --wait-minutes=10`
3. `node src/cli.js check-driver-session --driver=browser-harness`
4. `node src/cli.js check-driver-session --driver=hybrid --session-mode=persistent`
5. `node src/cli.js check-live-readiness --driver=hybrid --candidate-url="https://www.linkedin.com/sales/lead/..." --list-name="Existing Test List"`
6. `node src/cli.js test-account-search --driver=hybrid --account-name="Known Account" --keywords="Known Query"`
7. `node src/cli.js test-list-save --driver=browser-harness --candidate-url="https://www.linkedin.com/sales/lead/..." --list-name="Existing Test List" --live-save`
8. `node src/cli.js reconcile-state`

## Expected Result

- Browser Harness is found locally through `automation/browser-harness`
- hybrid health output shows separate `Discovery` and `Mutation` states
- account search still works through the hybrid driver
- list save succeeds through Browser Harness with `selectionMode: existing_list`
- no connect action is sent

## Stop Conditions

- Browser Harness reports `reauth_required`, `blocked`, or `captcha_or_checkpoint`
- hybrid discovery and mutation states disagree in a way that suggests session drift
- the safe target list is not found
- any unexpected modal or restriction warning appears
