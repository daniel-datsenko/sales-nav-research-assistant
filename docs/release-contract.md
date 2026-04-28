# Supervised MVP Release Contract

The first release target is a supervised MVP, not a broad autonomous Sales Navigator automation product.

## Defaults

- `lists-first` is the default operating model.
- Background research is dry-safe by default.
- Live list saves require `--live-save`.
- Connect actions require explicit supervised live-connect command paths.
- Background connects are disabled unless explicitly configured and approved.

## Final Connect States

Every connect attempt should end in one of these operator states:

- `sent`
- `already_sent`
- `already_connected`
- `email_required`
- `connect_unavailable`
- `manual_review`
- `skipped_by_policy`

`email_required` means skip the prospect. Do not research emails, do not retry in the same run, and do not treat this as a bug.

## Account Scope

Company resolution must prefer exact or high-confidence LinkedIn/Sales Navigator targets. Low-confidence company matches should stop as review states instead of silently sweeping the wrong entity.

## Runner States

Environment failures must stay separate from account logic:

- `environment_blocked` means browser/session/harness health prevented the run.
- `timed_out` is an account-level coverage outcome.
- `all_sweeps_failed` means account scoping or filters likely need company resolution.

## Release-Ready Definition

The MVP is release-ready when discovery, company resolution, list planning, guarded list save, deterministic connect statuses, operator reports, and dry-safe background evidence work without requiring raw-log interpretation.
