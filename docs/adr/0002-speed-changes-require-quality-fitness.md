# ADR 0002: Speed changes require quality fitness gates

## Status

Accepted

## Context

Sales Navigator research flows can be slow because they depend on browser-backed search, account coverage sweeps, lead identity resolution, retries, and review artifact generation. Faster flows are valuable, but speed optimizations can silently reduce lead quality: fewer safe-to-save candidates, higher manual-review rate, more duplicate warnings, stale fallback evidence, or unresolved company blockers.

Recent speed mechanisms include Adaptive Sweep Pruning and Fast Resolve Query Cache. Both improve runtime only if they preserve safety and lead quality.

## Decision

Performance optimizations must be evaluated with a Speed Fitness Gate before they are treated as production improvements.

A Speed Fitness Gate must be dry-safe and read-only. It compares baseline and candidate artifacts and emits an advisory decision such as `keep_candidate`, `revert_candidate`, or `needs_more_evidence`.

A candidate can be kept only when it improves speed without regressing safety or lead-quality metrics, including:

- safe-to-save resolution count/rate
- manual-review rate
- duplicate rate or duplicate warnings
- company-resolution blockers
- alias disagreements or scope ambiguity
- stale fallback usage for live-save candidates
- Live-connect or Live-save safety violations

Missing or malformed evidence is not success. It should produce `needs_more_evidence`.

## Consequences

- Browser parallelism, pruning, caching, and query dedupe should land with measurement artifacts or deterministic tests that prove the mechanism and safety behavior.
- Synthetic benchmarks are useful mechanism evidence, but they are not proof of live Sales Navigator speed until real dry-run artifacts confirm the win.
- Speed claims in PRs should name the evidence source and whether the evidence is synthetic, dry-run, or live-observed.
- If speed and quality trade off, quality wins unless the Operator explicitly accepts a narrower workflow and documents the trade-off.
