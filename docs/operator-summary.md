# Operator Summary

This repository contains a supervised Sales Navigator SDR workflow platform.

## Start Here

```bash
npm test
npm run test:release-readiness
npm run print-mvp-operator-dashboard
```

## Safe Daily Flow

1. Check the browser session.
2. Run account coverage or a small background loop.
3. Review the generated Markdown report.
4. Save only reviewed, resolved leads.
5. Keep connect actions supervised and policy-gated.

## What To Watch

- `needs_company_resolution`: resolve the LinkedIn company target before retrying.
- `manual_review`: inspect the candidate or UI shape before acting.
- `environment_blocked`: repair browser/session/harness health.
- `email_required`: skip the prospect.
- `connect_unavailable`: review whether the profile is structurally unavailable or temporarily unrendered.
