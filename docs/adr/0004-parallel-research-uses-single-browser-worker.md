# ADR 0004: Parallel research uses one Browser Worker

## Status

Accepted

## Context

Account Research needs to become faster, and the useful work is naturally decomposable: account normalization, Research Queue generation, cache inspection, scoring, quality review, merge metrics, and benchmark evaluation can all run without touching Sales Navigator.

The risky part is different. Browser-backed Sales Navigator work is session-stateful, rate-limit sensitive, DOM-fragile, and hard to debug when multiple workers share one LinkedIn identity. Running multiple browser sessions in parallel could also blur Company Scope, hide accidental Live Mutation, and make operator review less trustworthy.

The project therefore needs a durable decision that "parallel research" means parallel dry-safe work plus serialized browser work, not N autonomous browser agents clicking Sales Navigator.

## Decision

The Parallel Research Pipeline may process dry-safe Local Research Worker jobs concurrently, but all browser-backed Sales Navigator work must flow through exactly one Browser Worker per LinkedIn/Sales Navigator session.

Required invariants:

- `browserConcurrency` remains fixed at `1` in v1.
- Browser-required Research Jobs must be explicit in the Research Queue.
- A Browser Worker Lock must serialize browser-backed jobs and emit telemetry when the lock is used.
- Local Research Workers may perform planning, cache analysis, candidate scoring, quality review, merge coordination, and speed/stress evaluation without browser access.
- Cache hits should bypass browser work entirely.
- CLI surfaces that are intended to be dry-safe must not create fake browser execution. They should report browser-required jobs as planned/skipped unless an explicit, separately reviewed browser integration path is in scope.
- Browser Worker execution is not Live Mutation permission. Live-save and Live-connect still require the Operator gates from ADR 0001.

## Consequences

- The Browser Worker is the intentionally narrow waist of the system. Throughput gains should come first from cache hits, pre-browser planning, local scoring concurrency, and better merge/evaluation logic.
- Stress tests should assert that increasing local concurrency never increases browser concurrency.
- PRs that add or modify browser-backed execution must be HITL unless they are fully fake-driver/dry-safe tests.
- Any future proposal to use multiple concurrent Sales Navigator browser sessions requires a new ADR and explicit Operator approval.
- PR descriptions for parallel-research work must state whether they touch browser-backed execution paths and whether any live-mutation path changed.
