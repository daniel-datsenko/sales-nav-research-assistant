# GOAL: Supervised MVP Release Candidate

## Objective
- Harden the LinkedIn Sales Navigator research assistant into a `supervised MVP release candidate`.
- Use dry-safe autoresearch loops to measure release readiness, collect evidence, and preserve only proven improvements.
- Do not use this goal for broad autonomous LinkedIn operation.

## Fitness Criteria
- Connect outcomes use only final states: `sent`, `already_sent`, `already_connected`, `email_required`, `connect_unavailable`, `manual_review`, `skipped_by_policy`.
- Guarded shapes stay guarded unless repeated supervised evidence justifies a policy change.
- Background-runner artifacts distinguish `completed` from `environment_blocked`.
- Account-level outcomes distinguish `cached`, `live`, `timed_out`, `all_sweeps_failed`, `noisy`, `sparse`, `mixed`, and `productive`.
- Operator reports show enough context to choose: continue, allow browser runtime, review account filters, skip email-required prospects, or keep a connect shape supervised.
- Autoresearch reports include `connectShapeMatrix`, visible evidence links, `runnerCoverageByType`, `runnerCoverageTarget`, and `operatorReadiness`.
- Target runner evidence is at least `10` healthy live dry-run accounts before the runner is considered broadly healthy for this supervised release track.

## Autoresearch Loop
1. Read the release contract, morning summary, latest connect acceptance, and latest background-runner artifacts.
2. Score the current state against the fitness criteria.
3. Create an autoresearch artifact with decision `keep`, `needs_followup`, or `blocked`.
4. If more runner evidence is needed, run only small read-only background dry-runs outside this loop.
5. Re-run release-readiness tests after code or documentation changes.

## Safety Guardrails
- No `--live-save`.
- No `--live-connect`.
- No `--allow-background-connects`.
- No automatic promotion to `connect_eligible`.
- Missing-email prospects remain final skips: do not research emails, do not retry in the same run.

## Canonical Commands
- `npm run autoresearch:mvp`
- `npm run print-mvp-morning-release-summary`
- `npm run print-mvp-operator-dashboard`
- `npm run print-latest-background-runner-report`
- `npm run test:release-readiness`
- `npm test`
