# Task: Sales Nav Company Resolution

## Goal

Given a territory account name, identify the safest LinkedIn company target set for downstream Sales Navigator people-search sweeps.

The task should learn browser heuristics for answering:

- How does the company appear on LinkedIn?
- Is there one exact company page or several relevant parent/subsidiary/regional pages?
- Which targets appear in-territory or plausibly in-scope?
- Is the confidence high enough for automated sweeps, or should the account go to manual company review?

## Inputs

Use one account per evaluation. Preferred reference accounts:

- `Example Media Group Germany`
- `Example Logistics Switzerland`
- `Example Broadcast Studio`

Optional search starting points:

- Google/Bing query: `<account name> LinkedIn company`
- LinkedIn company page URL if already known
- Sales Navigator company search if a logged-in session is available

## Required Output

Return JSON only:

```json
{
  "accountName": "string",
  "status": "resolved_exact|resolved_multi_target|resolved_low_confidence|needs_manual_company_review|all_resolution_failed",
  "targets": [
    {
      "linkedinName": "string",
      "linkedinCompanyUrl": "string|null",
      "salesNavCompanyUrl": "string|null",
      "targetType": "parent|subsidiary|regional|brand|unknown",
      "territoryFit": "exact|likely|unclear|out_of_scope",
      "confidence": 0.0,
      "evidence": ["search_result", "linkedin_url", "name_match", "domain_match", "territory_match"]
    }
  ],
  "recommendedAction": "run_people_sweeps|run_guarded_multi_target_sweeps|review_company_targets_before_retry|resolve_company_targets_then_retry",
  "notes": "short operator-readable explanation"
}
```

## Success Criteria

- Finds `Example Media Germany` as the likely target for `Example Media Group Germany`.
- Finds `Example Logistics` as the likely target for `Example Logistics Switzerland`.
- Keeps ambiguous media/public-broadcast entities in `needs_manual_company_review` unless evidence is strong.
- Never performs saves, connects, messages, invitations, or irreversible LinkedIn mutations.

## Guardrails

- Read-only browsing only.
- No live-save.
- No live-connect.
- Do not click `Connect`, `Save`, `Message`, `Follow`, or invite buttons.
- Do not research missing personal email addresses.
- Prefer company pages and visible search evidence over guessing.
