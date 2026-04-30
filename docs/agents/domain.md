# Agent Domain Docs

## Layout

This repository uses a single shared domain context:

- `CONTEXT.md` — canonical project language and ambiguity notes.
- `docs/adr/` — accepted architectural and operating decisions.
- `docs/agents/` — agent operating docs: issue tracker, triage labels, Agent Brief conventions, and stacked PR runbooks.
- `docs/testing/` — verification and stress-check runbooks for dry-safe pipeline work.

## Consumer rules

Before planning, implementing, or reviewing non-trivial work, agents should read:

1. `CONTEXT.md`
2. any ADR in `docs/adr/` relevant to the area being touched
3. this file and the issue tracker/triage docs when creating or updating issues

Use the exact terms from `CONTEXT.md` in:

- issue titles and bodies
- test names and descriptions
- PR summaries
- operator-facing reports
- implementation plans

## Updating CONTEXT.md

Update `CONTEXT.md` when a new project term becomes load-bearing across multiple tasks or when a fuzzy term causes confusion.

Good additions:

- domain concepts used by Operators or implementation agents
- safety states that affect Live Mutation eligibility
- artifact/report names with specific semantics
- accepted ambiguous term resolutions

Avoid adding:

- one-off implementation details
- private customer/account data
- raw runtime artifact contents
- temporary branch/session state

## Updating ADRs

Create an ADR only when the decision is:

1. hard to reverse,
2. surprising without context, and
3. the result of a real trade-off.

Do not create ADRs for obvious implementation choices or temporary priorities.

## Multi-context rule

If this repository becomes a monorepo with separate product contexts, add `CONTEXT-MAP.md` at the root and split domain docs by context. Until then, `CONTEXT.md` is authoritative.
