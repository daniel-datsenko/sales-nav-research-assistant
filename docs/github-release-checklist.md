# GitHub Release Checklist

This checklist prepares the current supervised MVP snapshot for a shared GitHub repository.

## Required Before First Push

- `npm test` passes.
- `npm run test:release-readiness` passes.
- `git status --short` is clean.
- No local runtime artifacts are tracked.
- No browser sessions, cookies, storage state, screenshots, local databases, logs, `.env` files, or credentials are tracked.
- If the repository is public, remove internal handoff notes, dated acceptance reports, customer-specific artifacts, and any private account history first.

## What The First Repo Snapshot Contains

- Sales Navigator account discovery and lead coverage workflows.
- Company resolution, account aliasing, and retry handling for difficult account scopes.
- Fast external lead-list import and safe list-save planning.
- Deterministic connect status handling and guarded connect policies.
- Background-runner dry-safe artifacts and operator reports.
- Runbooks, setup notes, safety rules, and operator dashboard commands.

## What Remains Guarded

- Broad fully automatic connect across all LinkedIn UI variations.
- Fully unattended large-batch territory runs.
- Automatic retries for low-confidence company or lead matches.
- Any live-save or live-connect behavior without explicit operator flags.

## Recommended First Remote Flow

1. Create or open the target GitHub repository.
2. Add it as `origin`.
3. Push only the cleaned release branch or `main` snapshot.
4. Continue day-to-day work from feature branches using the same guardrails.

```bash
git remote add origin git@github.com:<org>/<repo>.git
git push -u origin <clean-release-branch>
```

## Lightweight Secret Scan

Run these before sharing:

```bash
git status --short
git ls-files runtime .env .env.local '*.log' 'playwright-report/**' 'test-results/**'
rg -n "(access_token|refresh_token|client_secret|session_key|cookie|password|private_key)" \
  --glob '!node_modules/**' \
  --glob '!runtime/**' \
  --glob '!package-lock.json'
```

Expected result:

- `git ls-files` should not show runtime/session files.
- `rg` should only show test fixtures, redaction tests, documentation warnings, or placeholder names.
