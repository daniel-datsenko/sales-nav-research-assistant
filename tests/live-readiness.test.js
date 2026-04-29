const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildDriverOptions } = require('../src/lib/driver-options');
const {
  analyzeLiveReadiness,
  inspectSalesforceSecretModel,
  isSalesNavigatorLeadUrl,
} = require('../src/lib/live-readiness');

test('recognizes Sales Navigator lead URLs', () => {
  assert.equal(isSalesNavigatorLeadUrl('https://www.linkedin.com/sales/lead/ACwAAAZ123,NAME_SEARCH,abc'), true);
  assert.equal(
    isSalesNavigatorLeadUrl('https://www.linkedin.com/sales/lead/foo-bar?_ntb=1&trk=people-guest_'),
    true,
  );
  assert.equal(isSalesNavigatorLeadUrl('https://de.linkedin.com/sales/lead/regional-lead'), true);
  assert.equal(isSalesNavigatorLeadUrl('https://www.linkedin.com/in/someone'), false);
  assert.equal(isSalesNavigatorLeadUrl('https://www.linkedin.com/sales/search/people?keywords=a'), false);
  assert.equal(isSalesNavigatorLeadUrl('https://www.linkedin.com/sales/company/12345'), false);
  assert.equal(isSalesNavigatorLeadUrl('https://evil.example/phishing/www.linkedin.com/sales/lead/x'), false);
  assert.equal(isSalesNavigatorLeadUrl('not a url'), false);
  assert.equal(isSalesNavigatorLeadUrl(''), false);
  assert.equal(isSalesNavigatorLeadUrl(null), false);
  assert.equal(isSalesNavigatorLeadUrl('http://www.linkedin.com/sales/lead/plain-http'), false);
});

test('flags file-based Salesforce secrets as blockers', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salesforce-live-'));
  const sourcePath = path.join(tempDir, 'salesforce-live.json');
  fs.writeFileSync(sourcePath, JSON.stringify({
    sourceType: 'salesforce-live',
    instanceUrl: 'https://example.my.salesforce.com',
    accountQuery: 'SELECT Id FROM Account',
    accessToken: 'secret-token',
  }), 'utf8');

  const result = inspectSalesforceSecretModel({
    sourceMode: 'salesforce-live',
    sourcePath,
    env: {},
  });

  assert.equal(result.status, 'blocker');
  assert.deepEqual(result.fileSecretKeys, ['accessToken']);
});

test('passes live query mode when env-backed Salesforce auth is present', () => {
  const result = inspectSalesforceSecretModel({
    sourceMode: 'salesforce-live',
    env: {
      SALESFORCE_INSTANCE_URL: 'https://example.my.salesforce.com',
      SALESFORCE_ACCOUNT_QUERY: 'SELECT Id FROM Account',
      SALESFORCE_ACCESS_TOKEN: 'secret-token',
    },
  });

  assert.equal(result.status, 'pass');
});

test('analyzeLiveReadiness reports blockers for missing lead and list inputs', () => {
  const driverOptions = buildDriverOptions({}, { dryRun: false }, {
    sessionMode: 'persistent',
    headless: true,
    recoveryMode: 'screenshot-only',
  });

  const report = analyzeLiveReadiness({
    values: {
      'source-mode': 'auto',
    },
    driverOptions,
    sessionHealth: {
      ok: true,
      state: 'authenticated',
    },
    env: {},
  });

  assert.equal(report.overall, 'blocker');
  assert.equal(report.checks.find((check) => check.label === 'Lead URL').status, 'blocker');
  assert.equal(report.checks.find((check) => check.label === 'Target list').status, 'blocker');
});
