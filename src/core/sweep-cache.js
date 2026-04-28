const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson } = require('../lib/json');
const { COVERAGE_ARTIFACTS_DIR, ensureDir } = require('../lib/paths');

const DEFAULT_SWEEP_CACHE_DIR = path.join(COVERAGE_ARTIFACTS_DIR, 'sweep-cache');

function normalizeValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function summarizeCompanyTargets(account = {}) {
  const targets = account?.salesNav?.companyTargets || [];
  const urls = account?.salesNav?.linkedinCompanyUrls || [];
  const aliases = account?.salesNav?.companyFilterAliases || account?.salesNav?.accountSearchAliases || [];
  return [
    ...targets.map((target) => ({
      name: normalizeValue(target.linkedinName || target.name || target.companyName),
      url: normalizeValue(target.linkedinCompanyUrl || target.url),
    })),
    ...urls.map((url) => ({ url: normalizeValue(url) })),
    ...aliases.map((alias) => ({ name: normalizeValue(alias) })),
  ].filter((target) => target.name || target.url);
}

function buildSweepCacheKey({
  account,
  accountName,
  template,
  coverageConfigVersion = 'default',
} = {}) {
  const payload = {
    accountName: normalizeValue(accountName || account?.name),
    accountUrl: normalizeValue(account?.salesNav?.accountUrl),
    targets: summarizeCompanyTargets(account),
    templateId: template?.id || null,
    keywords: (template?.keywords || []).map(normalizeValue).sort(),
    titleIncludes: (template?.titleIncludes || []).map(normalizeValue).sort(),
    configVersion: String(coverageConfigVersion || 'default'),
  };
  return crypto.createHash('sha256').update(stableJson(payload)).digest('hex');
}

function readSweepCache(cacheDir, key) {
  const filePath = path.join(cacheDir || DEFAULT_SWEEP_CACHE_DIR, `${key}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    return readJson(filePath);
  } catch {
    return null;
  }
}

function writeSweepCache(cacheDir, key, payload) {
  const dir = ensureDir(cacheDir || DEFAULT_SWEEP_CACHE_DIR, 0o700);
  const filePath = path.join(dir, `${key}.json`);
  writeJson(filePath, {
    version: '1.0.0',
    writtenAt: new Date().toISOString(),
    ...payload,
  });
  return filePath;
}

module.exports = {
  DEFAULT_SWEEP_CACHE_DIR,
  buildSweepCacheKey,
  readSweepCache,
  writeSweepCache,
};
