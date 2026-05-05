# SDR Operator Summary

This tool helps SDRs turn account names into reviewed Sales Navigator lead lists.

## Start Here

```bash
npm test
npm run test:release-readiness
npm run print-mvp-operator-dashboard
```

## Safe Daily Flow

1. Check that LinkedIn is logged in.
2. Give the tool three to five accounts.
3. Review the report.
4. Save reviewed leads to Sales Navigator.
5. Send connection requests only when explicitly approved.

## What To Watch

- `needs_company_resolution`: the company name is unclear. Check the right LinkedIn company page before retrying.
- `manual_review`: the tool is not confident enough. Review before acting.
- `environment_blocked`: browser or login setup needs fixing.
- `email_required`: skip the prospect.
- `connect_unavailable`: the tool cannot safely send a connection request for this profile.
