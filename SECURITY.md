# Security Policy

## Runtime Data

Do not commit local runtime data. The following must stay local and are ignored by Git:

- `.env` and environment-specific config files
- browser profiles, cookies, sessions, and storage state
- `runtime/` artifacts and local databases
- screenshots, traces, logs, and Playwright reports

## Credentials

Provide credentials through environment variables or local-only secret stores. Do not store tokens, cookies, refresh tokens, Salesforce credentials, BigQuery credentials, or LinkedIn session state in tracked files.

## Live Mutations

The platform is designed for supervised operation. Dry-safe research and reporting are the default. Live Sales Navigator mutations require explicit command flags such as `--live-save` or an approved live-connect command path.

## Reporting Issues

If you find a security issue, do not open a public issue with secrets or screenshots. Share a minimal reproduction without credentials and rotate any exposed credentials immediately.
