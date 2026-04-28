const fs = require('node:fs');
const path = require('node:path');
const {
  RECOVERY_ARTIFACTS_DIR,
  RUN_ARTIFACTS_DIR,
  TERRITORY_ARTIFACTS_DIR,
} = require('./paths');

function cleanupRuntimeArtifacts({ maxAgeHours = 72, targets: overrideTargets = null } = {}) {
  const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
  const targets = overrideTargets || [
    { dir: RECOVERY_ARTIFACTS_DIR, pattern: /\.(png|html|txt)$/i },
    { dir: RUN_ARTIFACTS_DIR, pattern: /\.json$/i },
    { dir: TERRITORY_ARTIFACTS_DIR, pattern: /\.json$/i },
  ];

  const deleted = [];

  for (const target of targets) {
    if (!fs.existsSync(target.dir)) {
      continue;
    }

    for (const entry of fs.readdirSync(target.dir)) {
      const fullPath = path.join(target.dir, entry);
      if (!target.pattern.test(entry)) {
        continue;
      }
      const stats = fs.statSync(fullPath);
      if (stats.mtimeMs >= cutoff) {
        continue;
      }
      fs.rmSync(fullPath, { force: true });
      deleted.push(fullPath);
    }
  }

  return {
    deletedCount: deleted.length,
    deleted,
    maxAgeHours,
  };
}

module.exports = {
  cleanupRuntimeArtifacts,
};
