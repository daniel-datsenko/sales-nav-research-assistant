---
name: sales-nav-research-assistant
description: Use when an SDR or operator wants to research LinkedIn Sales Navigator accounts, build reviewable lead lists, resolve enterprise company entities, import calling lists, or run guarded Sales Navigator list-save workflows with this repository. Use the local Node/Playwright runner, keep research dry-safe by default, and only perform live Sales Navigator list saves when explicitly requested.
---

# Sales Navigator Research Assistant

Use this skill to turn account names or calling-list files into reviewed Sales Navigator lead lists. The repo is the engine; this skill chooses the safest command and explains results in SDR-friendly language.

## First Move

1. Run `npm run doctor`.
2. Check login only when Sales Navigator access is needed:
   ```bash
   npm run check-driver-session -- --driver=playwright --session-mode=persistent
   ```
3. If login expired, run:
   ```bash
   npm run bootstrap-session -- --driver=playwright --wait-minutes=10
   ```

Do not describe setup with technical jargon. Say: "I will check whether the tool is installed and whether LinkedIn is logged in."

## Command Routing

- Normal account research:
  ```bash
  npm run sdr-research -- --accounts="Account A, Account B, Account C"
  ```
- Large or messy enterprise accounts:
  ```bash
  npm run sdr-research -- --accounts="Account A, Account B" --api-read-prefetch
  ```
- Unclear parent/subsidiary/company-page scope:
  ```bash
  npm run resolve-enterprise-entities -- --account-name="Account Name"
  ```
- Smaller SaaS or scaleup accounts where strong engineering titles are found but not selected:
  ```bash
  npm run sdr-research -- --accounts="Scaleup Account" --api-read-prefetch --scaleup-selection-expanded
  ```
- Important accounts where persona quality matters more than runtime:
  ```bash
  npm run sdr-research -- --accounts="Account A, Account B" --api-read-prefetch --deep-profile-pass --profile-read-method=voyager --deep-profile-limit=20
  ```
- Create or update a real Sales Navigator list only when explicitly asked:
  ```bash
  npm run sdr-research -- --accounts="Account A, Account B" --list-name="Short List Name" --live-save
  ```

## Decision Rules

- Use `--api-read-prefetch` for enterprise, multi-entity, or speed-sensitive read-only research. Explain it as a faster read-only lookup in the logged-in browser plus a small Sales Nav rescue check, not as an official LinkedIn API.
- Treat hybrid recall as the SDR default: API reads fast first, then a bounded UI rescue pass checks first-page/high-value personas so obvious Product Owner Engineering, DevOps, IT-Architekt, Software-Architekt, Principal Architect, Senior Software Engineer, or Head of Engineering profiles are not silently missed.
- Use `--scaleup-selection-expanded` for scaleups like Skello where Engineering Manager, Engineering Director, Cloud Engineer, Data Platform Engineer, Staff Engineer AI, or VP Product & Data are useful prospects.
- Use Voyager only as an opt-in quality layer after discovery. It can improve scoring for already-found candidates; it does not replace better search keywords.
- If `voyager_reviewed_but_pitch_unknown` appears, keep the person in manual review. Do not auto-save based on Voyager alone.
- If `voyager_identity_missing` appears, report it as an identity-mapping gap, not as a bad lead.
- For enterprise entities, search IT/digital/systems/technology/platform subsidiaries first, then parent/main company. Keep all related entities in scope; exclude only unrelated homonyms.

## Safety

- Default is dry-safe: research, score, and write artifacts only.
- Never add `--live-save` unless the user explicitly asks to create/update a real Sales Navigator list.
- Never send connection requests from `sdr-research`.
- Never use API mutation, bulk add, delete, connect, or message actions.
- Do not commit `runtime/`, `.env`, browser profiles, cookies, screenshots, logs, or local result files.

## SDR-Friendly Output

End with:

- Accounts researched.
- Found vs saved.
- Strong people not saved and why.
- Company-scope or Voyager identity gaps.
- Exact Sales Navigator list name if live-save was used.
- One concrete next step, such as: "Open the list and start with platform, DevOps, cloud, and infrastructure leaders."

Avoid raw logs, bucket dumps, and unexplained internal labels.
