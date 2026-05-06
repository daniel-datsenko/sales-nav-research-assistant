# Enterprise Company Resolution

Use this note when an account is a large parent brand but the useful IT org lives in one or more separate LinkedIn company pages.

The rule is: prioritize IT/digital entities first, but keep every clearly related entity in the sweep. Parent or main company pages stay in scope because executive buyers and observability owners can sit there. `out_of_scope` is only for unrelated homonyms or clearly wrong companies, not for parent or holding entities that look less technical.

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

When multiple related targets exist, the sweep order should be:

1. IT, digital, systems, technology, platform, cloud, data, or engineering subsidiaries.
2. Parent or main company pages for buyer coverage.
3. Regional, product, brand, or other related entities.

## Operator Check

After changing aliases, run:

```bash
npm run test:release-readiness
node src/cli.js resolve-company --account-name="Account Name"
```

The resolution report should show the intended parent/subsidiary targets and should not include unrelated companies.

## Read-Only Resolver Skill

Before adding a permanent alias, you can let the tool inspect related Sales Navigator company pages in read-only mode:

```bash
npm run resolve-enterprise-entities -- --account-name="Example Enterprise"
```

The resolver writes JSON and Markdown under `runtime/artifacts/company-resolution/enterprise-entities/`. It reports which pages should be included, suggested for review, or excluded as unrelated homonyms. New findings stay as learned suggestions in the runtime artifact first; they are not automatically promoted into `config/account-aliases/default.json`.

When `--api-read-prefetch` is used for `account-coverage` or `sdr-research`, the same resolver can be used automatically if the first company lookup is ambiguous. Safe related targets continue the sweep; unclear targets keep the run in `needs_company_scope_review`.
