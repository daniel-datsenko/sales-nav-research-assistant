# Strategy: Sales Nav Company Resolution

## Fast Path

1. Search the web for `<accountName> LinkedIn company`.
2. Prefer official LinkedIn company-page results over third-party directory pages.
3. Extract the visible LinkedIn company name from the result title or company page.
4. If multiple relevant pages appear, keep a target set instead of forcing one target.

## Heuristics To Learn

- Legal suffixes and geography often make Sales Navigator scoping fail; strip them when searching.
- Parent companies can be valid targets when the local subsidiary has no distinct LinkedIn page.
- Regional pages are useful only when the territory fit remains plausible.
- Ambiguity is not failure: classify it as `needs_manual_company_review`.

## Evidence Rules

- Strong evidence: LinkedIn company URL plus name/domain/territory match.
- Medium evidence: LinkedIn result title plus parent/subsidiary relationship.
- Weak evidence: name similarity only.

## Failure Recovery

- If the page is blocked or unhydrated, use search-result snippets and mark confidence lower.
- If search results mix unrelated brands, output `needs_manual_company_review`.
- If no plausible LinkedIn company appears, output `all_resolution_failed`.

## Safety

Read-only only. No live-save, no live-connect, no messages, no invitations.
