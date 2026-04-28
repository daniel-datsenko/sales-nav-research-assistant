# Task: Sales Nav Connect Surface Diagnostic

## Goal

Classify the visible Sales Navigator connect surface for a lead without sending an invitation.

The task should learn browser heuristics for recognizing:

- `visible_primary_connect`
- `overflow_only_connect`
- `already_sent`
- `already_connected`
- `email_required`
- `spinner_shell`
- `connect_unavailable`
- `manual_review`

## Inputs

Use one Sales Navigator lead URL per evaluation. Preferred reference leads:

- `Example Guarded Lead` for `overflow_only_connect`
- `Example Email Required Lead` for email-required or connect-unavailable behavior
- guarded Example Manual Review Account/Example Regional Logistics Account/Example Regional Bank Account reference leads

## Required Output

Return JSON only:

```json
{
  "leadName": "string",
  "leadUrl": "string",
  "surfaceClassification": "visible_primary_connect|overflow_only_connect|already_sent|already_connected|email_required|spinner_shell|connect_unavailable|manual_review",
  "finalStatusRecommendation": "already_sent|already_connected|email_required|connect_unavailable|manual_review",
  "evidence": ["visible text", "aria label", "menu item", "spinner", "dialog text"],
  "operatorDisposition": "already_covered|manual_review|retry_later|blocked_by_policy",
  "nextAction": "no_action|review_ui_variant|skip_requires_email|retry_after_review",
  "notes": "short operator-readable explanation"
}
```

## Success Criteria

- Identifies overflow-menu connect paths without clicking send.
- Identifies pending/connected states from visible button or menu labels.
- Identifies email-required dialog text if it appears, then stops.
- Never sends an invite or performs irreversible LinkedIn mutations.

## Guardrails

- Do not click final send/invite buttons.
- No live-save.
- No live-connect.
- Do not send connection requests.
- Do not save leads to lists.
- Do not message prospects.
- If a click would mutate state, stop and return `manual_review`.
