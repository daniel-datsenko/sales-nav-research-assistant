const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = process.cwd();
const RUNTIME_DIR = path.join(ROOT_DIR, 'runtime');
const ARTIFACTS_DIR = path.join(RUNTIME_DIR, 'artifacts');
const SESSIONS_DIR = path.join(RUNTIME_DIR, 'sessions');
const BROWSER_PROFILE_DIR = path.join(RUNTIME_DIR, 'browser-profile');
const DB_PATH = path.join(RUNTIME_DIR, 'platform.db');
const DEFAULT_SESSION_STATE_PATH = path.join(SESSIONS_DIR, 'linkedin-state.json');
const DEFAULT_BROWSER_PROFILE_DIR = path.join(BROWSER_PROFILE_DIR, 'sales-nav-driver');
const TERRITORY_ARTIFACTS_DIR = path.join(ARTIFACTS_DIR, 'territories');
const RUN_ARTIFACTS_DIR = path.join(ARTIFACTS_DIR, 'runs');
const RECOVERY_ARTIFACTS_DIR = path.join(ARTIFACTS_DIR, 'recovery');
const PRIORITY_ARTIFACTS_DIR = path.join(ARTIFACTS_DIR, 'priority');
const COVERAGE_ARTIFACTS_DIR = path.join(ARTIFACTS_DIR, 'coverage');
const BACKGROUND_RUNNER_ARTIFACTS_DIR = path.join(ARTIFACTS_DIR, 'background-runner');
const ACCOUNT_BATCH_ARTIFACTS_DIR = path.join(ARTIFACTS_DIR, 'account-batches');
const AUTORESEARCH_ARTIFACTS_DIR = path.join(ARTIFACTS_DIR, 'autoresearch');
const COMPANY_RESOLUTION_ARTIFACTS_DIR = path.join(ARTIFACTS_DIR, 'company-resolution');

function ensureDir(dirPath, mode = 0o755) {
  fs.mkdirSync(dirPath, { recursive: true, mode });
  try {
    fs.chmodSync(dirPath, mode);
  } catch {
    // best effort on platforms that do not fully support chmod here
  }
  return dirPath;
}

function ensureRuntimeLayout() {
  ensureDir(RUNTIME_DIR, 0o700);
  ensureDir(ARTIFACTS_DIR, 0o700);
  ensureDir(SESSIONS_DIR, 0o700);
  ensureDir(BROWSER_PROFILE_DIR, 0o700);
  ensureDir(TERRITORY_ARTIFACTS_DIR, 0o700);
  ensureDir(RUN_ARTIFACTS_DIR, 0o700);
  ensureDir(RECOVERY_ARTIFACTS_DIR, 0o700);
  ensureDir(PRIORITY_ARTIFACTS_DIR, 0o700);
  ensureDir(COVERAGE_ARTIFACTS_DIR, 0o700);
  ensureDir(BACKGROUND_RUNNER_ARTIFACTS_DIR, 0o700);
  ensureDir(ACCOUNT_BATCH_ARTIFACTS_DIR, 0o700);
  ensureDir(AUTORESEARCH_ARTIFACTS_DIR, 0o700);
  ensureDir(COMPANY_RESOLUTION_ARTIFACTS_DIR, 0o700);
}

function resolveProjectPath(...parts) {
  return path.join(ROOT_DIR, ...parts);
}

module.exports = {
  ROOT_DIR,
  RUNTIME_DIR,
  ARTIFACTS_DIR,
  SESSIONS_DIR,
  BROWSER_PROFILE_DIR,
  DB_PATH,
  DEFAULT_SESSION_STATE_PATH,
  DEFAULT_BROWSER_PROFILE_DIR,
  TERRITORY_ARTIFACTS_DIR,
  RUN_ARTIFACTS_DIR,
  RECOVERY_ARTIFACTS_DIR,
  PRIORITY_ARTIFACTS_DIR,
  COVERAGE_ARTIFACTS_DIR,
  BACKGROUND_RUNNER_ARTIFACTS_DIR,
  ACCOUNT_BATCH_ARTIFACTS_DIR,
  AUTORESEARCH_ARTIFACTS_DIR,
  COMPANY_RESOLUTION_ARTIFACTS_DIR,
  ensureDir,
  ensureRuntimeLayout,
  resolveProjectPath,
};
