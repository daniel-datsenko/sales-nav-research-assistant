const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  ReadOnlySalesforceAdapter,
  normalizeLiveQueryPayload,
} = require('../src/adapters/salesforce-readonly');

test('normalizeLiveQueryPayload maps live Salesforce query records into platform accounts', () => {
  const result = normalizeLiveQueryPayload({
    territoryId: 'terr-1',
    territoryRecord: {
      Id: 'terr-1',
      Name: 'Named Accounts',
      Owner: {
        Name: 'Example Operator',
        Email: 'operator@example.com',
      },
      Region__c: 'EMEA',
    },
    accountRecords: [
      {
        Account: {
          Id: '001',
          Name: 'Example Software Co',
          Website: 'https://example.com',
          BillingCountry: 'Germany',
          Industry: 'Software',
          NumberOfEmployees: 4500,
        },
        Priority__c: 10,
        SalesNavAccountListName__c: 'Example-Territory-FY2026',
        SalesNavCompanyFilterName__c: 'Example Software Co',
      },
    ],
  });

  assert.equal(result.territory.territoryId, 'terr-1');
  assert.equal(result.territory.ownerName, 'Example Operator');
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].name, 'Example Software Co');
  assert.equal(result.accounts[0].salesNav.accountListName, 'Example-Territory-FY2026');
  assert.equal(result.accounts[0].signals.employeeCount, 4500);
});

test('live adapter refuses secrets embedded in local config files', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salesforce-live-'));
  const configPath = path.join(tempDir, 'salesforce-live.json');
  fs.writeFileSync(configPath, JSON.stringify({
    sourceType: 'salesforce-live',
    snapshotUrl: 'https://example.invalid/snapshot',
    accessToken: 'secret-should-not-be-here',
  }), 'utf8');

  const adapter = new ReadOnlySalesforceAdapter();
  await assert.rejects(
    () => adapter.loadTerritorySnapshot({
      territoryId: 'terr-1',
      sourcePath: configPath,
      sourceMode: 'salesforce-live',
    }),
    /Refusing to load Salesforce secrets/,
  );
});
