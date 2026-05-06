# SDR Quickstart

This is the shortest safe path for an SDR who wants leads from Sales Navigator.

## 1. Install And Check The Tool

```bash
npm install
npm test
npm run test:release-readiness
```

## 2. Check LinkedIn Login

```bash
npm run check-driver-session -- --driver=playwright --session-mode=persistent
```

If LinkedIn is not logged in, open a visible browser and log in:

```bash
npm run bootstrap-session -- --driver=playwright --wait-minutes=10
```

## 3. Research Accounts

For normal SDR work, use this:

```bash
npm run sdr-research -- --accounts="Thales Group, Skello, Oodrive"
```

For large or messy enterprise accounts, add the faster read-only lookup:

```bash
npm run sdr-research -- --accounts="Thales Group, Skello, Oodrive" --api-read-prefetch
```

This lets the tool read company and lead IDs from the logged-in browser before running slower UI sweeps. If a company has several related pages, the tool should search IT/digital entities first, then the parent company, and stop only for truly unrelated same-name companies.

To also create/update a Sales Navigator list:

```bash
npm run sdr-research -- \
  --accounts="Thales Group, Skello, Oodrive" \
  --list-name="SDR Research - Thales Skello Oodrive" \
  --live-save
```

This command does not send connection requests.

When `--live-save` is used, the tool checks the Sales Navigator list before saving, skips people already in the list, saves only missing approved leads through the browser UI, and then checks the list again. The final answer should say whether the list was verified in Sales Navigator or whether follow-up is needed.

## 4. Advanced Single-Account Research

Use this only when you need a lower-level account check:

```bash
npm run account-coverage -- --driver=playwright --account-name="Example Account"
```

Sales Navigator uses the same LinkedIn login as the user's browser. During business hours, avoid heavy manual Sales Navigator usage while the tool researches accounts.

```bash
npm run account-coverage -- --driver=playwright --account-name="Example Account" --inter-sweep-delay-ms=3000
```

If LinkedIn shows "Too many requests", the tool pauses and reports that LinkedIn asked for more time.

For a small background queue:

```bash
npm run run-background-territory-loop -- --driver=playwright --limit=1
```

## 5. Read The Report

The report should answer:

- How many people were found?
- How many were saved?
- Who was strong but not saved automatically?
- Does the company name need review?
- What should the SDR do next?

If the report says `manual_review`, `needs_company_resolution`, `environment_blocked`, or `email_required`, stop and review instead of forcing the action.

If the report says `needs_company_scope_review`, run:

```bash
npm run resolve-enterprise-entities -- --account-name="Account Name"
```

Use the result to confirm the related IT, digital, parent, regional, or brand entities before retrying the account.

## 6. Live Actions

Only save leads or send connection requests when the SDR explicitly asks for that action. Never add live-action flags to unattended background runs.
