# First Run Onboarding

Sales Navigator Research Assistant runs on the user's machine and controls their own browser. It can prepare research before LinkedIn login, but it cannot create a real Sales Navigator list until setup is finished and the user is logged in.

## Friendly First Message

Use this when a new SDR opens the repo in an agent:

> I will quickly check whether the tool is installed and whether LinkedIn is logged in. If something is missing, I will guide you through it. I will not save leads or send connection requests unless you explicitly ask me to.

Then run:

```bash
npm run doctor
```

## If The Tool Is Not Installed Yet

Say:

> The repo is here, but the tool is not installed yet. I can install it, run the checks, and then help you log in to LinkedIn.

Run:

```bash
npm install
npm test
npm run test:release-readiness
```

## If LinkedIn Is Not Logged In Yet

Say:

> I can prepare research, but I cannot create a real Sales Navigator list until LinkedIn is logged in.

Offer two safe paths:

- A) Prepare the research file now; create the Sales Navigator list later.
- B) Log in first, then create the Sales Navigator list directly.

## Actions That Must Stay Explicit

- `--live-save`
- `--live-connect`
- background connect runs
- removing leads from live lists

These actions should never happen as part of a first-run setup or unattended bootstrap.

In SDR-facing language, say:

> I can research accounts safely. Saving leads or sending connection requests is a separate action and I will ask before doing it.

## What The Agent Should Use Automatically

For normal SDR list work, use:

```bash
npm run sdr-research -- --accounts="Account A, Account B, Account C"
```

If the SDR asks for a real Sales Navigator list, add `--live-save`. The tool will still stay supervised: it uses the browser UI for the actual save and uses read-only list checks when available to skip duplicates and verify the final list.

For large enterprise accounts or unclear company names, use:

```bash
npm run resolve-enterprise-entities -- --account-name="Account Name"
```

Explain this as: "I am checking which related Sales Navigator company pages belong to the account, starting with IT and digital entities, then the parent company."
