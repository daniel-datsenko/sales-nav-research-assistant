# Parallel Research Stress Verification

Use this checklist before claiming the Parallel Research Pipeline is stable, faster, or ready to merge.

## Safety contract

Stress verification is dry-safe unless an Operator explicitly starts a separate HITL live-browser test. The default stress path must not:

- run `--live-save`, `--live-connect`, or `--allow-background-connects`
- mutate Sales Navigator or LinkedIn state
- open multiple Sales Navigator browser sessions
- commit `runtime/`, `.env`, cookies, browser profiles, screenshots, local DBs, logs, or secrets

## Required local checks

Run from the repository root:

```bash
node --test tests/research-pipeline.test.js tests/browser-worker-lock.test.js tests/parallel-research-benchmark.test.js tests/autoresearch-mvp.test.js tests/release-readiness.test.js
npm run test:release-readiness
npm test
git diff --check
```

For a dry-safe CLI smoke:

```bash
node src/cli.js parallel-account-research --accounts="Example AG, Example GmbH" --local-concurrency=2 --run-id=smoke
```

Expected invariants for the smoke output:

- `mode` is `dry-safe`
- `browserConcurrency` is `1`
- `localConcurrency` matches the requested value
- `browserJobsExecuted` is `0`
- browser-required jobs are marked skipped/planned with `reason: dry_safe_cli_plan_only`

## Concurrency stress matrix

Run the executable dry-safe stress harness:

```bash
npm run --silent parallel-research:stress
```

For a custom matrix:

```bash
node automation/parallel-research-stress.js \
  --accounts="Example AG, Example GmbH, Example SE" \
  --local-concurrency-values=1,2,4 \
  --repeat=3 \
  --run-id-prefix=stress
```

Use `--repeat=N` for merge-readiness flake detection. The harness expands every local-concurrency value for every repeat index and emits stable run IDs such as `stress-local-2-repeat-3`. The default is `--repeat=1`, which preserves the shorter run IDs used for quick smoke checks.

Expected summary invariants:

- top-level `ok` is `true`
- `mode` is `dry-safe`
- `browserConcurrencyInvariant` is `1`
- `repeat` matches the requested repeat count
- `runCount` equals `localConcurrencyValues.length * repeat`
- each run has `ok: true`
- each run has `browserConcurrency: 1`
- each run has `browserJobsExecuted: 0`

The harness intentionally parses the mixed human/JSON output from `parallel-account-research`, so callers should consume the harness summary rather than redirecting the lower-level CLI directly.

If debugging the lower-level CLI manually, remember that it may print a human-readable `[cli] ...` line before the JSON payload. Capture raw stdout and extract the JSON object before parsing:

```bash
for c in 1 2 4; do
  node src/cli.js parallel-account-research \
    --accounts="Example AG, Example GmbH, Example SE" \
    --local-concurrency="$c" \
    --run-id="stress-local-$c" \
    > "/tmp/parallel-account-research-stress-$c.raw"

  python3 - "$c" <<'PY'
import json
import pathlib
import sys

c = sys.argv[1]
raw_path = pathlib.Path(f"/tmp/parallel-account-research-stress-{c}.raw")
text = raw_path.read_text()
start = text.find("{")
if start < 0:
    raise SystemExit(f"no JSON payload found in {raw_path}")
payload = json.loads(text[start:])
assert payload["mode"] == "dry-safe"
assert payload["browserConcurrency"] == 1
assert payload["localConcurrency"] == int(c)
for account in payload["accounts"]:
    assert account["metrics"]["browserJobsExecuted"] == 0
json_path = raw_path.with_suffix(".json")
json_path.write_text(json.dumps(payload, indent=2) + "\n")
print(f"validated {json_path}")
PY
done
```

Validate each extracted JSON artifact:

- JSON parses successfully.
- `browserConcurrency` remains `1` for every run.
- `browserJobsExecuted` remains `0` for dry-safe CLI runs.
- Account count is stable.
- No output contains live flags except as refused/forbidden examples in documentation or tests.

## Flake/repeat loop

For docs or small pipeline changes, run at least one harness repeat loop before merge readiness:

```bash
npm run --silent parallel-research:stress -- \
  --accounts="Example AG, Example GmbH" \
  --local-concurrency-values=1,2 \
  --repeat=3 \
  --run-id-prefix=merge-readiness
```

For changes touching scheduler, lock, cache, scoring, or CLI behavior, increase to 5-10 iterations or add a deterministic benchmark fixture. Keep this dry-safe: do not add live/background flags to the repeat loop.

## Forbidden-path scan

Changed files should not include local runtime/session state:

```bash
git diff --name-only origin/main...HEAD | grep -E '(^runtime/|\.env|cookie|cookies|storage-state|profile|screenshots|\.sqlite|\.db|package-lock\.json)' && exit 1 || true
```

If the stack base is not `main`, compare against the stack base branch instead of `origin/main`.

## Secret scan

Before commit/push, inspect the diff for credential-like text:

```bash
git diff --cached | grep -Ei '(token|secret|password|cookie|authorization|bearer|linkedin|salesnav|client_secret)' && exit 1 || true
```

This is a coarse scan. It may flag legitimate forbidden-flag documentation. Review any match manually and redact secrets as `[REDACTED]`.

## Stack-wide merge-readiness gate

Once the stacked PRs are ready for final review, run the dry-safe stack gate from the top stack branch:

```bash
npm run --silent parallel-research:stack-readiness -- \
  --stress-repeat=3 \
  --stress-accounts="Example AG, Example GmbH" \
  --stress-local-concurrency-values=1,2,4
```

This gate runs:

- `git diff --check`
- `npm run test:release-readiness`
- `npm test`
- the repeat stress harness
- forbidden-path scan from `origin/main...HEAD`
- credential-like diff scan from `origin/main...HEAD`
- stacked PR metadata checks for PRs 25, 28, 29, 31, and 32, including `OPEN`, expected base/head/title, and `MERGEABLE` status

The gate is intentionally dry-safe and refuses `--live-save`, `--live-connect`, and `--allow-background-connects`. It emits a machine-readable JSON summary and should be followed by the requested final ChatGPT 5.5 full-stack review before any merge command.

## PR reporting requirements

Every Parallel Research PR should state:

- whether it changes browser-backed execution paths
- whether it changes Live-save or Live-connect paths
- target/targeted tests run
- release/full tests run or why skipped
- dry-safe smoke/stress evidence
- expected next stack PR
