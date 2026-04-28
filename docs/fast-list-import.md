# Fast List Import

Fast List Import turns an external lead file into a Sales Navigator lead-list workflow with less manual overhead.

## What It Does

1. Reads a Markdown or JSON lead source.
2. Derives the default Sales Navigator list name from the filename.
3. Resolves leads to Sales Navigator lead URLs from:
   - the source file itself,
   - existing coverage artifacts,
   - previous account-batch/import manifests.
4. Writes a dry-safe plan artifact by default.
5. Saves resolved leads to a Sales Navigator lead list only when `--live-save` is explicitly provided.
6. Retries transient lead-detail render failures once by default.

It never sends connects.

## Safe Plan Run

```bash
npm run fast-list-import -- --source="/path/to/leads.md"
```

Expected output:

- `Live save: no`
- `Resolved: <count>`
- `Unresolved: <count>`
- JSON and Markdown artifacts under `runtime/artifacts/account-batches/`

You can also point `fast-list-import` directly at one or more coverage artifacts:

```bash
npm run fast-list-import -- \
  --source="runtime/artifacts/coverage/example-marketplace-a.json,runtime/artifacts/coverage/example-saas-marketplace.json" \
  --bucket=direct_observability \
  --min-score=40 \
  --list-name="DD_CEE_Sweep3_2026-04-28"
```

Coverage artifacts use their `candidates` array as the lead source. `--bucket` and `--min-score` keep the import scoped to the candidates you actually want to save.

## Coverage Import Run

After running account sweeps, use `import-coverage` to turn existing coverage artifacts into one Sales Navigator list without re-running the sweeps:

```bash
npm run import-coverage -- \
  --accounts=example-marketplace-a,example-saas-marketplace,olx-group \
  --bucket=direct_observability \
  --list-name="DD_CEE_Sweep3_2026-04-28"
```

Add `--live-save --allow-list-create` only when you are ready to perform the supervised Sales Navigator save step. Without `--live-save`, the command writes a dry-safe plan.

## Fast Resolve Run

For new lists that only contain public LinkedIn `/in/` URLs, run the resolver before live save:

```bash
npm run fast-resolve-leads -- \
  --source="/path/to/leads.md" \
  --driver=playwright \
  --search-timeout-ms=8000
```

The resolver is dry-safe: it reads Sales Navigator search results but does not save lists and does not send connects.

It writes three operator buckets:

- `resolved_safe_to_save`: exact person + safe company match; eligible for `fast-list-import --live-save`.
- `needs_company_alias_retry`: likely company naming/scoping problem; add or retry aliases before saving.
- `manual_review`: ambiguous or low-confidence match; do not save automatically.

Use the generated JSON artifact as the source for live save. `fast-list-import` will only save rows where `resolutionStatus=resolved`, so unresolved rows remain out of the live mutation path.

## Live Save Run

Use this only after the plan resolves the expected leads.

```bash
npm run fast-list-import -- \
  --source="/path/to/fast-resolve-artifact.json" \
  --driver=playwright \
  --live-save \
  --allow-list-create
```

If the list already exists, `--allow-list-create` is harmless. If it does not exist, it allows the first save to create it.

## Why This Is Faster

The old flow often required manual one-off resolution and ad-hoc retries. The fast flow centralizes that into a reusable import manifest:

- cached Sales Navigator URLs avoid repeated lookup,
- one browser session handles the batch,
- transient render failures retry automatically,
- unresolved leads are reported instead of silently skipped.

## Current Learning

Observed behavior:

- Dry-safe import planning is sub-second.
- Cached or previously resolved leads can be prepared immediately.
- Fresh public-profile leads need a Sales Navigator resolution pass.
- Unscoped `Name + Account` search is fast when it finds a confident match.
- No-result searches are too slow today because Sales Navigator can wait roughly 25-28 seconds before returning an empty result.
- Blind matching is unsafe: a same-name person at the wrong company must stay unresolved instead of being saved to the list.
- Lead detail render failures should fall back to result-row save when a safe row is visible.

Next hardening targets:

- Keep tuning the dedicated `fast-resolve-leads` command.
- Enforce a hard 6-8 second timeout for no-result resolution searches.
- Use public LinkedIn profile slugs as an additional matching signal.
- Run account-alias/company-target retries for unresolved leads before manual review.
- Prefer result-row save when the correct result row is already visible.
- Persist every successful public-profile to Sales-Nav-URL mapping as a reusable cache entry.

## Safety Rules

- No live save without `--live-save`.
- No list creation unless the driver is allowed to create the list.
- No live connect, ever.
- Public LinkedIn `/in/` URLs are not saved directly; the lead must resolve to a Sales Navigator `/sales/lead/` URL first.
