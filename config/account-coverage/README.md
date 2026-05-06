# Account Coverage Configuration Notes

## Company entity selection

Do not treat a large account as only one company page. Resolve the company target set first, then sweep every clearly related target. Run IT, digital, systems, technology, and platform entities first because they often own infrastructure and observability. Keep parent/main entities in the sweep too because buyers and observability owners can sit there.

Examples:

- Prioritize `About You`, `Bonprix`, or another confirmed tech subsidiary before a generic retail holding page, but do not drop the parent/main company when it is related.
- Prefer the exact LinkedIn/Sales Navigator company page over the Salesforce display name when they differ.
- If the selected company filter has low confidence or points to an unrelated homonym, stop with `needs_manual_alias` instead of collecting leads from a likely wrong entity.

## Speed guardrail

Coverage sweeps now pass already-seen lead URLs into later sweeps. If the first visible results page is at least 80% duplicates, the driver keeps the first-page novel leads but skips deeper scrolling for that duplicate-heavy sweep.

This speeds up broad territory runs without reintroducing hidden candidate caps.
