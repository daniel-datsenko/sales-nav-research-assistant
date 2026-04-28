# Account Discovery Playbook

This playbook captures the account-first workflow that worked well during the live `Example Retail Brand SE` run.

## Extra title guidance from historical Salesforce wins

Won opportunities show a strong concentration around these contact-title families:

- engineering
- manager
- director
- head
- architect / architecture
- platform
- cloud
- infrastructure
- operations
- IT / technology

This does not mean every manager or director is a good lead. It means that for technical-account discovery we should bias toward:

- technical management
- enterprise / platform architecture
- infrastructure or security ownership
- software or platform engineering leadership

And we should down-rank broad business roles that only happen to contain words such as `production` or `product` when the surrounding profile context is not technical.

## Recommended Flow

1. Resolve the exact Sales Navigator account first.
2. Open the account page before jumping into people search.
3. Use built-in account persona links when they are relevant.
4. Run several narrow keyword sweeps instead of one broad query.
5. Save strong candidates to a dedicated list.
6. Run a second-pass profile review for borderline candidates.

## Why this works

A single broad query misses too many good leads. Narrow sweeps such as `platform`, `security`, `cloud`, `architect`, and `data` surface different slices of the org:

- `platform` finds architecture, product-platform, and internal platform owners
- `security` finds infrastructure and technology owners who often influence observability tooling
- `cloud` finds DevOps and delivery-heavy platform operators
- `architect` finds enterprise and systems owners with cross-stack influence
- `data` finds analytics or data-platform leaders who sometimes own telemetry and monitoring pipelines

## Current App Behavior

The current scoring pass uses:

- title
- headline
- summary
- about
- captured evidence snippet

That means the app already reads more than just the visible title when detail-page evidence is available. It does not yet do a mandatory deep profile review for every candidate.

## Recommended Next Upgrade

Add a two-stage ranking model:

1. `Fast sweep`
   Search result cards, account persona links, and keyword sweeps collect a broad candidate set quickly.
2. `Deep review`
   Open only the top and borderline candidates, then rescore using richer body text and profile signals such as:
   `observability`, `monitoring`, `observability-platform`, `prometheus`, `logging`, `tracing`, `incident response`, `platform operations`, and `cloud engineering`.

This keeps throughput high while reducing false negatives from weak job titles.
