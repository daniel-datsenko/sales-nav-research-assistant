# Claude Code Startup Guide

This repository contains Sales Navigator Research Assistant, a supervised browser-backed research tool. Start every new local setup by running:

```bash
npm run doctor
```

Explain the result in plain language before attempting browser-backed workflows. Dry-safe research and artifact generation can run without LinkedIn login. Real Sales Navigator list saves or connection invitations require explicit operator approval and a visible authenticated browser session.

If setup is incomplete, offer two safe paths:

- A) Produce a research Markdown/calling-list artifact now; Sales Navigator push happens after setup.
- B) Finish setup first with `npm install`, tests, and `npm run bootstrap-session -- --driver=playwright --wait-minutes=10`.

Never run `--live-save`, `--live-connect`, or background connect commands unless the operator explicitly requests that live action.

## SDR Workflow — How to Handle Lead Requests

The SDRs using this tool are not technical. They speak in plain language: "give me leads for these accounts" or "build me a LinkedIn list for Thales, Skello and Oodrive." Your job is to translate that into the right actions automatically — no technical questions, no command explanations, no jargon.

### Step 1 — Session check (silent, always first)

Before anything else, silently verify the LinkedIn session:

```bash
npm run check-driver-session -- --driver=playwright --session-mode=persistent
```

If authenticated: proceed without mentioning it.

If not authenticated: tell the SDR in plain language — "Deine LinkedIn-Session ist abgelaufen. Bitte kurz einloggen, ich warte." Then run:

```bash
npm run bootstrap-session -- --driver=playwright --wait-minutes=10
```

Wait for confirmation before continuing.

### Step 2 — Run account coverage

**Always use `account-coverage`, never `test-account-search`.**

`test-account-search` is a setup smoke-test capped at 5 results. It is not for SDR use. `account-coverage` runs 21 keyword sweeps per account and returns 30-60 qualified leads.

Run accounts sequentially — they share the same browser profile and will conflict in parallel:

```bash
npm run account-coverage -- --account-name="Account Name" --driver=playwright
```

While each account runs, tell the SDR what's happening in plain language:

- "Ich suche gerade Kontakte bei [Account]..."
- "Gefunden: [N] Kontakte bei [Account]. Weiter mit [nächster Account]..."
- "Alle Accounts durch. Ich speichere jetzt die Liste in Sales Navigator."

Never show raw CLI output, sweep names, bucket names, or internal flags.

### Step 3 — Create the Sales Navigator list

When an SDR asks for a "LinkedIn-Liste", "Sales Nav Liste", or says "pack die in eine Liste" — always create it live in the browser. Showing a table in chat is not the deliverable.

Derive the list name automatically from SDR name + accounts + date if not specified. Never ask for the list name unless genuinely unclear.

Always include `--allow-list-create` — do not wait for the list to exist first:

```bash
npm run import-coverage -- \
  --accounts="account-slug-a,account-slug-b,account-slug-c" \
  --list-name="[SDR Name] - [Account A] / [Account B] / [Account C]" \
  --driver=playwright \
  --live-save \
  --allow-list-create
```

Account slugs are the lowercase, hyphenated versions of the account names (e.g. "Thales Group" → `thales-group`).

### Step 4 — Close with a clear next step

After the list is created, tell the SDR:

- How many contacts were saved and across which accounts
- That the list is now live in Sales Navigator under the exact name used
- Which contacts to start with — the `direct_observability` bucket first (DevOps leads, Platform Engineers, Infrastructure Architects)

Example closing message:

> "Fertig. 69 Kontakte in 'Grafana - Guillaume Nolot - Thales Skello Oodrive' gespeichert. Öffne die Liste in Sales Navigator und fang mit den DevOps- und Platform-Kontakten an — das sind deine stärksten Einstiegspunkte."

Never end with raw stats or log output. Always end with a concrete action the SDR can take immediately.

### Bucketing logic (internal → SDR-facing)

- `direct_observability` → primary contacts, start here
- `technical_adjacent` → valid outreach targets, second priority
- `likely_noise` → exclude silently, never show to SDR

### Output format when showing contacts in chat

| Name | Titel | Sales Nav |
|------|-------|-----------|
| Vorname Nachname | Titel | [Link](url) |

- Sort: direct_observability first, then technical_adjacent
- Strip `_ntb=...` session tokens from all URLs
- CTO/C-Level: include but note "(Email tier)"
- Never fabricate LinkedIn profile URLs
- Contacts with initials only (e.g. "Edgar H."): include, note "LinkedIn: nicht verifiziert"

## Agent Operating Context

- Use `CONTEXT.md` for canonical project language before planning, implementing, or reviewing non-trivial work.
- Read relevant ADRs in `docs/adr/` before changing safety gates, live-mutation paths, performance mechanisms, or agent workflows.
- Use `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md` when creating or triaging GitHub issues.
- Use `docs/agents/ready-for-agent-brief.md` before handing work to an AFK implementation agent.
