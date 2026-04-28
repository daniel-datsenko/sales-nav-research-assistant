# Account Coverage Configuration Notes

## Company entity selection

Do not sweep a holding entity directly when the real engineering teams live in named subsidiaries or product companies. Resolve the company target set first, then sweep the pages that match the territory and the technical org.

Examples:

- Prefer `About You`, `Bonprix`, or another confirmed tech subsidiary over a generic retail holding page when the holding mostly contains corporate-management roles.
- Prefer the exact LinkedIn/Sales Navigator company page over the Salesforce display name when they differ.
- If the selected company filter has low confidence, stop with `needs_manual_alias` instead of collecting leads from a likely wrong entity.

## Speed guardrail

Coverage sweeps now pass already-seen lead URLs into later sweeps. If the first visible results page is at least 80% duplicates, the driver keeps the first-page novel leads but skips deeper scrolling for that duplicate-heavy sweep.

This speeds up broad territory runs without reintroducing hidden candidate caps.
