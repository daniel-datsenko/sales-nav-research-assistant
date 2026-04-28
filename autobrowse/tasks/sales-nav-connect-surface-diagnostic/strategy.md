# Strategy: Sales Nav Connect Surface Diagnostic

## Fast Path

1. Open the lead URL in an authenticated browser session.
2. Wait for the lead page to hydrate.
3. Read visible action buttons and ARIA labels.
4. Inspect the lead-actions overflow menu only if opening it is non-mutating.
5. Classify the surface and stop before any send/invite action.

## Heuristics To Learn

- Pending labels mean `already_sent`.
- Connected labels mean `already_connected`.
- Generic overflow buttons may hide the only Connect action.
- Spinner-only lead shells should become `spinner_shell`, not generic failure.
- Any email prompt should become `email_required` and stop.

## Failure Recovery

- If the page never hydrates, return `spinner_shell` or `manual_review`.
- If labels conflict, return `manual_review`.
- If the browser session is not authenticated, return `manual_review` with reauth evidence.

## Safety

Read-only diagnostic only. No live-connect, no invitation send, no save, no message.
