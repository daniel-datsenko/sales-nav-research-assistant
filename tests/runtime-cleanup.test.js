const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { cleanupRuntimeArtifacts } = require('../src/lib/runtime-cleanup');

test('cleanupRuntimeArtifacts removes old files and keeps fresh ones', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-cleanup-'));
  const recoveryDir = path.join(tempRoot, 'recovery');
  const runDir = path.join(tempRoot, 'runs');
  const territoryDir = path.join(tempRoot, 'territories');
  fs.mkdirSync(recoveryDir, { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(territoryDir, { recursive: true });

  const oldRecovery = path.join(recoveryDir, 'old.png');
  const freshRecovery = path.join(recoveryDir, 'fresh.png');
  const oldRunArtifact = path.join(runDir, 'old.json');
  const freshTerritoryArtifact = path.join(territoryDir, 'fresh.json');

  fs.writeFileSync(oldRecovery, 'old');
  fs.writeFileSync(freshRecovery, 'fresh');
  fs.writeFileSync(oldRunArtifact, '{}');
  fs.writeFileSync(freshTerritoryArtifact, '{}');

  const oldTime = Date.now() - (96 * 60 * 60 * 1000);
  const freshTime = Date.now() - (2 * 60 * 60 * 1000);
  fs.utimesSync(oldRecovery, oldTime / 1000, oldTime / 1000);
  fs.utimesSync(oldRunArtifact, oldTime / 1000, oldTime / 1000);
  fs.utimesSync(freshRecovery, freshTime / 1000, freshTime / 1000);
  fs.utimesSync(freshTerritoryArtifact, freshTime / 1000, freshTime / 1000);

  const result = cleanupRuntimeArtifacts({
    maxAgeHours: 72,
    targets: [
      { dir: recoveryDir, pattern: /\.(png|html|txt)$/i },
      { dir: runDir, pattern: /\.json$/i },
      { dir: territoryDir, pattern: /\.json$/i },
    ],
  });

  assert.equal(result.deletedCount, 2);
  assert.equal(fs.existsSync(oldRecovery), false);
  assert.equal(fs.existsSync(oldRunArtifact), false);
  assert.equal(fs.existsSync(freshRecovery), true);
  assert.equal(fs.existsSync(freshTerritoryArtifact), true);
});
