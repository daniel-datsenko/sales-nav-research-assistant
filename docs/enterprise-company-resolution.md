# Enterprise Company Resolution

Use this note when an account is a large parent brand but the useful IT org lives in a separate LinkedIn company page.

## When To Add A Curated Target

Add a curated target when a run shows one of these signs:

- The parent company has many employees, but almost no relevant platform, cloud, DevOps, SRE, or engineering personas.
- The report shows `needs_company_scope_review`.
- The report warns about `cross_company_contamination_detected`.
- SDR feedback says the real IT team sits under a named subsidiary.

Common examples:

- `EDEKA` -> `EDEKA DIGITAL GmbH`, `Lunar GmbH`
- `Otto Group` -> `About You`, `Bonprix`
- `Schwarz Group` -> `Schwarz IT`
- `REWE Group` -> `REWE digital`, `REWE Systems`
- `Bertelsmann` -> `Arvato Systems`

## How To Add One

Edit `config/account-aliases/default.json` and add or update the account entry:

```json
{
  "accountSearchAliases": ["Parent Brand", "IT Subsidiary"],
  "companyFilterAliases": ["Parent Brand", "IT Subsidiary GmbH"],
  "targets": [
    {
      "linkedinName": "Parent Brand",
      "targetType": "parent",
      "territoryFit": "likely",
      "evidence": ["curated_parent"]
    },
    {
      "linkedinName": "IT Subsidiary GmbH",
      "targetType": "subsidiary",
      "territoryFit": "likely",
      "evidence": ["curated_it_subsidiary"]
    }
  ],
  "subsidiaryAliases": ["IT Subsidiary", "IT Subsidiary GmbH"],
  "resolutionStatus": "resolved_multi_target"
}
```

Keep the mapping conservative. If the subsidiary is not clearly related to the territory account, prefer manual review over automatic sweeps.

## Operator Check

After changing aliases, run:

```bash
npm run test:release-readiness
node src/cli.js resolve-company --account-name="Account Name"
```

The resolution report should show the intended parent/subsidiary targets and should not include unrelated companies.
