# Driver Architecture

## Decision

Playwright headless is the automated execution engine for Sales Navigator research and live mutations.

Browser Harness is a manual diagnostic and repair tool. It can be selected explicitly with `--driver=browser-harness`, but no automated command should choose it implicitly.

## Why

Automated mutation commands must not take over the operator's visible Chrome tabs or depend on a local Browser Harness binary being installed. Playwright gives the project a predictable, repo-owned browser runtime for both discovery and supervised live-save/connect actions.

Browser Harness is still useful when LinkedIn ships a new UI shape. Use it to observe the page, understand selectors, and then move the durable implementation back into Playwright.

## Rules

- `--live-save` and `--live-connect` default to Playwright.
- `hybrid` remains a compatibility driver, but its default mutation path is Playwright-backed.
- Browser Harness is only used when the operator explicitly passes `--driver=browser-harness`.
- Missing Browser Harness binaries must not block Playwright or hybrid automated flows.
- New shipped mutation logic should be implemented in `src/drivers/playwright-sales-nav.js` first.
- Browser Harness helpers can live under `vendor/browser-harness/`, but automated `src/` flows must not require them.

## Practical Defaults

- Use `--driver=playwright` for normal supervised live-save and live-connect runs.
- Use `--driver=hybrid` only when a command still expects the hybrid adapter surface; it should behave like Playwright for automated mutations.
- Use `--driver=browser-harness` only during a watched manual debugging session.
