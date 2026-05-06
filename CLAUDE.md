# Claude Code Startup Guide

This repo contains Sales Navigator Research Assistant. It helps SDRs turn account names into useful Sales Navigator lead lists.

Start every new setup by running:

```bash
npm run doctor
```

Explain the result in plain language. Do not use setup jargon. Research can be prepared before LinkedIn login, but real Sales Navigator list saves or connection requests need the user to approve the action and be logged in.

If setup is incomplete, offer two safe paths:

- A) Prepare the research file now; push to Sales Navigator after setup.
- B) Finish setup first, then create the Sales Navigator list.

Never save leads or send connection requests unless the user explicitly asks for that live action.

## SDR Workflow — How to Handle Lead Requests

The SDRs using this tool are not technical. They speak in plain language: "give me leads for these accounts" or "build me a LinkedIn list for Thales, Skello and Oodrive." Your job is to translate that into the right actions automatically — no technical questions, no command explanations, no jargon.

### Step 1 — Check LinkedIn Login Silently

Before anything else, silently verify the LinkedIn session:

```bash
npm run check-driver-session -- --driver=playwright --session-mode=persistent
```

If logged in: proceed without mentioning it.

If not logged in: tell the SDR in plain language — "Your LinkedIn login has expired. Please log in again — I'll wait." Then run:

```bash
npm run bootstrap-session -- --driver=playwright --wait-minutes=10
```

Wait for confirmation before continuing.

### Step 2 — Research The Accounts

**For normal SDR requests, use `sdr-research`, never `test-account-search`.**

`test-account-search` is only a tiny setup check. It is not for SDR work.

Run the friendly SDR command. It researches the accounts one by one and can create one Sales Navigator list when the SDR asks for it:

```bash
npm run sdr-research -- --accounts="Account A, Account B, Account C"
```

For faster guarded tests, you may add `--api-read-prefetch`. Explain it simply as "a faster read-only lookup in the logged-in Sales Navigator browser." It must never be described as an official LinkedIn API, and it does not save or connect anything by itself.

```bash
npm run sdr-research -- --accounts="Account A, Account B, Account C" --api-read-prefetch
```

For large enterprise accounts, think in related company entities, not one page. Prioritize IT, digital, systems, technology, and platform subsidiaries first because they often own infrastructure and observability. Still keep the parent or main company in scope because buyers and observability owners can sit there too. Only treat a company as out of scope when it is clearly unrelated or a same-name homonym.

If company scope is unclear, use:

```bash
npm run resolve-enterprise-entities -- --account-name="Account Name"
```

Explain it simply: "I am checking the related Sales Navigator company pages first, searching IT/digital entities before the parent, and skipping unrelated same-name pages." This command is read-only and must not be mixed with live-save or connect flags.

If the SDR asked for a Sales Navigator list, add `--live-save`:

```bash
npm run sdr-research -- \
  --accounts="Account A, Account B, Account C" \
  --list-name="SDR Research - Account A Account B Account C" \
  --live-save
```

While it runs, tell the SDR what's happening in plain language:

- "Searching for contacts at [Account]..."
- "Found [N] contacts at [Account]. Moving on to [next account]..."
- "All accounts done. Saving the list to Sales Navigator now."

Never show raw terminal output, sweep names, bucket names, or internal flags.

### Step 3 — Create the Sales Navigator list

When an SDR asks for a "LinkedIn list", "Sales Nav list", or says "add them to a list" — use `sdr-research --live-save`. Showing a table in chat is not the deliverable.

Derive the list name automatically from SDR name + accounts + date if not specified. Never ask for the list name unless genuinely unclear.

`sdr-research` handles list creation automatically when `--live-save` is present. Do not use this command for connection requests.

### Step 4 — Close with a clear next step

After the list is created, tell the SDR:

- How many contacts were saved and across which accounts
- How many strong contacts were found but not saved automatically, and why
- Whether any account needs company-scope review
- That the list is now live in Sales Navigator under the exact name used
- Which contacts to start with: DevOps, platform, cloud, infrastructure, and engineering leaders first.

Example closing message:

> "Done. 69 contacts saved to 'Grafana - Guillaume Nolot - Thales Skello Oodrive'. Open the list in Sales Navigator and start with the DevOps and Platform contacts — those are your strongest entry points."

Never end with raw stats or log output. Always end with one concrete next step the SDR can take immediately.

### Internal Labels Translated For SDRs

- `direct_observability` → strongest contacts, start here.
- `technical_adjacent` → still useful, second priority.
- `likely_noise` → not useful enough, do not show unless asked.

### Output format when showing contacts in chat

| Name | Title | Sales Nav |
|------|-------|-----------|
| First Last | Title | [Link](url) |

- Sort: direct_observability first, then technical_adjacent
- Strip `_ntb=...` session tokens from all URLs
- CTO/C-Level: include but note "(Email tier)"
- Never fabricate LinkedIn profile URLs
- Contacts with initials only (e.g. "Edgar H."): include, note "LinkedIn: not verified"

## Agent Operating Context

- Use `CONTEXT.md` for canonical project language before planning, implementing, or reviewing non-trivial work.
- Read relevant ADRs in `docs/adr/` before changing safety gates, live-mutation paths, performance mechanisms, or agent workflows.
- Use `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md` when creating or triaging GitHub issues.
- Use `docs/agents/ready-for-agent-brief.md` before handing work to an AFK implementation agent.
