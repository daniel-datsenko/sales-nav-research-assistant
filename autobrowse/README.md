# AutoBrowse Lab

This workspace is a dry-safe browser-learning lab for hard Sales Navigator UI cases.

It is intentionally separate from the production runner:

- AutoBrowse learns site-specific heuristics from traces.
- The platform runner remains the only production execution path.
- Learned heuristics must be promoted into code through normal tests.

## Tasks

- `sales-nav-company-resolution`: learn how to identify the right LinkedIn company page and company name for account scoping.
- `sales-nav-connect-surface-diagnostic`: learn how to classify connect UI surfaces without sending invitations.

## Safe Command

```bash
npm run autobrowse:mvp
```

This checks task readiness without running a browser session.

To run an actual AutoBrowse evaluation, install the upstream AutoBrowse skill and provide its path:

```bash
npx skills add https://github.com/browserbase/skills --skill autobrowse
AUTOBROWSE_SKILL_DIR=/path/to/autobrowse-skill npm run autobrowse:mvp -- --run --task sales-nav-company-resolution --iterations=3 --env=local
```

The wrapper fails closed if the upstream skill path or `ANTHROPIC_API_KEY` is not configured.

## Guardrails

- No live-save.
- No live-connect.
- No sending invitations.
- No irreversible LinkedIn mutations.
- Output is evidence and heuristics only.
