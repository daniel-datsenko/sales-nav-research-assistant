const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildCompanyResolution,
  companyNameFromLinkedInUrl,
  findCompanyAliasEntry,
  normalizeCompanyName,
  renderCompanyResolutionMarkdown,
  summarizeCompanyResolutionArtifacts,
  writeCompanyResolutionArtifact,
} = require('../src/core/company-resolution');
const { readJson } = require('../src/lib/json');
const { resolveProjectPath } = require('../src/lib/paths');

test('companyNameFromLinkedInUrl converts company slugs into aliases', () => {
  assert.equal(
    companyNameFromLinkedInUrl('https://www.linkedin.com/company/example-logistics?trk=public_profile'),
    'example logistics',
  );
  assert.equal(companyNameFromLinkedInUrl('https://www.linkedin.com/in/not-company'), null);
});

test('findCompanyAliasEntry tolerates legal suffix and punctuation variants', () => {
  const aliasConfig = readJson(resolveProjectPath('config', 'account-aliases', 'default.json'));

  assert.equal(normalizeCompanyName('Example Logistics Switzerland AG'), 'example logistics switzerland');
  assert.equal(
    findCompanyAliasEntry(aliasConfig, 'Example Logistics Switzerland AG').targets[0].linkedinName,
    'Example Logistics',
  );
});

test('buildCompanyResolution resolves seeded hard accounts', () => {
  const aliasConfig = readJson(resolveProjectPath('config', 'account-aliases', 'default.json'));
  const mediaGroup = buildCompanyResolution({
    accountName: 'Example Media Group Germany',
    source: 'territory',
    aliasConfig,
    now: new Date('2026-04-24T08:00:00.000Z'),
  });
  const logisticsGroup = buildCompanyResolution({
    accountName: 'Example Logistics Switzerland AG',
    source: 'territory',
    aliasConfig,
    now: new Date('2026-04-24T08:00:00.000Z'),
  });

  assert.equal(mediaGroup.status, 'resolved_exact');
  assert.equal(mediaGroup.targets[0].linkedinName, 'Example Media Germany');
  assert.ok(mediaGroup.confidence >= 0.85);
  assert.equal(logisticsGroup.status, 'resolved_exact');
  assert.equal(logisticsGroup.targets[0].linkedinName, 'Example Logistics');
});

test('buildCompanyResolution marks low-confidence manual-review accounts', () => {
  const aliasConfig = readJson(resolveProjectPath('config', 'account-aliases', 'default.json'));
  const resolution = buildCompanyResolution({
    accountName: 'Example Broadcast Studio',
    source: 'subsidiary',
    aliasConfig,
    now: new Date('2026-04-24T08:00:00.000Z'),
  });

  assert.equal(resolution.status, 'needs_manual_company_review');
  assert.equal(resolution.recommendedAction, 'review_company_targets_before_retry');
  assert.ok(resolution.targets.length >= 2);
});

test('writeCompanyResolutionArtifact writes JSON and Markdown reports', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'company-resolution-'));
  const artifactPath = path.join(tempDir, 'resolution.json');
  const resolution = buildCompanyResolution({
    accountName: 'Unknown Account',
    source: 'manual',
    aliasConfig: { accounts: {} },
    now: new Date('2026-04-24T08:00:00.000Z'),
  });

  const written = writeCompanyResolutionArtifact(resolution, artifactPath);
  const json = readJson(written.artifactPath);
  const markdown = fs.readFileSync(written.reportPath, 'utf8');

  assert.equal(json.status, 'all_resolution_failed');
  assert.match(markdown, /Company Resolution Report/);
  assert.match(renderCompanyResolutionMarkdown(json), /Recommended action/);
  assert.equal(summarizeCompanyResolutionArtifacts(tempDir).failed, 1);
});
