# Supervised MVP Release Contract

The first release is a supervised SDR assistant, not a fully automatic LinkedIn machine.

## Defaults

- Build lists first.
- Background research should not change Sales Navigator.
- Real list saves must be explicitly requested.
- Read-only Sales Navigator browser API data may be used to speed up research, resolve company IDs, and verify list membership.
- API-based list creation, lead adding, lead removal, connection requests, or messaging are not part of the default release path.
- Connection requests must be explicitly supervised.
- Background connection requests stay off unless separately approved.

## Final Connect States

Every connection request attempt should end in one clear state:

- `sent`
- `already_sent`
- `already_connected`
- `email_required`
- `connect_unavailable`
- `manual_review`
- `skipped_by_policy`

`email_required` means skip the prospect. Do not search for emails and do not retry in the same run.

## Account Scope

The tool should use the right LinkedIn company page. If it is unsure, it should stop for review instead of researching the wrong company.

For enterprise accounts, the tool should treat the account as a related company set. It should search IT, digital, systems, technology, platform, cloud, data, or engineering entities first, then the parent or main company. Parent/main entities remain in scope for buyers and observability owners. Only unrelated same-name companies should be excluded.

## List Verification

Live-save success means the intended leads were verified in the Sales Navigator list, not merely that a browser click happened. When available, read-only API list readback should verify stable Sales Navigator identities before and after saving. If verification fails, the run should finish with follow-up instead of reporting a clean completed state.

## Runner States

Browser/login problems must stay separate from account quality:

- `environment_blocked`: browser or login setup blocked the run.
- `timed_out`: this account took too long.
- `all_sweeps_failed`: the company name or Sales Navigator filter probably needs review.

## Release-Ready Definition

The MVP is release-ready when an SDR can research accounts, create reviewed lists, understand the report, and know what to do next without reading raw logs.
