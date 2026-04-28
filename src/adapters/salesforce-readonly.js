const fs = require('node:fs');
const path = require('node:path');
const { readJson } = require('../lib/json');
const { randomId } = require('../lib/id');
const { toIso } = require('../lib/time');
const { resolveProjectPath } = require('../lib/paths');

class ReadOnlySalesforceAdapter {
  constructor(options = {}) {
    this.options = options;
  }

  async loadTerritorySnapshot({
    territoryId,
    sourcePath,
    useSample = false,
    sourceMode = 'auto',
  }) {
    const effectiveMode = resolveSourceMode({
      sourceMode,
      sourcePath,
      useSample,
      options: this.options,
    });

    if (effectiveMode === 'salesforce-live') {
      return this.loadLiveTerritorySnapshot({ territoryId, sourcePath });
    }

    const resolvedPath = useSample
      ? resolveProjectPath('fixtures', 'salesforce-territory.sample.json')
      : path.resolve(sourcePath || resolveProjectPath('fixtures', 'salesforce-territory.sample.json'));

    const payload = readJson(resolvedPath);
    const normalized = normalizePayload(payload, territoryId);

    return {
      snapshotId: randomId('snapshot'),
      territory: normalized.territory,
      accounts: normalized.accounts,
      sourceType: 'salesforce-readonly-json',
      sourceRef: resolvedPath,
      syncedAt: normalized.territory.syncedAt || toIso(),
    };
  }

  async loadLiveTerritorySnapshot({ territoryId, sourcePath }) {
    const config = buildLiveConfig({
      sourcePath,
      options: this.options,
    });

    if (config.snapshotUrl) {
      const payload = await fetchSnapshotPayload(config.snapshotUrl, territoryId, config);
      const normalized = normalizePayload(payload, territoryId);
      return {
        snapshotId: randomId('snapshot'),
        territory: normalized.territory,
        accounts: normalized.accounts,
        sourceType: 'salesforce-readonly-live-snapshot',
        sourceRef: config.snapshotUrl,
        syncedAt: normalized.territory.syncedAt || toIso(),
      };
    }

    if (!config.instanceUrl || !config.accessToken || !config.accountQuery) {
      throw new Error('Salesforce live mode requires either snapshotUrl or instanceUrl + accessToken + accountQuery.');
    }

    const territoryRecord = config.territoryQuery
      ? await runSalesforceQuery(config, interpolateTemplate(config.territoryQuery, { territoryId }))
          .then((result) => result.records?.[0] || null)
      : null;

    const accountRecords = await runSalesforceQuery(
      config,
      interpolateTemplate(config.accountQuery, { territoryId }),
    ).then((result) => result.records || []);

    const payload = normalizeLiveQueryPayload({
      territoryId,
      territoryRecord,
      accountRecords,
    });

    return {
      snapshotId: randomId('snapshot'),
      territory: payload.territory,
      accounts: payload.accounts,
      sourceType: 'salesforce-readonly-live-query',
      sourceRef: config.instanceUrl,
      syncedAt: payload.territory.syncedAt || toIso(),
    };
  }
}

function resolveSourceMode({ sourceMode, sourcePath, useSample, options }) {
  if (useSample) {
    return 'json';
  }

  if (sourceMode && sourceMode !== 'auto') {
    return sourceMode;
  }

  const hasLiveConfig = Boolean(options?.snapshotUrl)
    || Boolean(process.env.SALESFORCE_SNAPSHOT_URL)
    || (
      Boolean(options?.instanceUrl || process.env.SALESFORCE_INSTANCE_URL)
      && Boolean(options?.accessToken || process.env.SALESFORCE_ACCESS_TOKEN)
      && Boolean(options?.accountQuery || process.env.SALESFORCE_ACCOUNT_QUERY)
    );

  if (hasLiveConfig) {
    return 'salesforce-live';
  }

  if (sourcePath && fs.existsSync(sourcePath)) {
    return 'json';
  }

  return 'json';
}

function buildLiveConfig({ sourcePath, options }) {
  let fileConfig = {};

  if (sourcePath && fs.existsSync(sourcePath)) {
    const parsed = readJson(path.resolve(sourcePath));
    if (parsed?.sourceType === 'salesforce-live' || parsed?.snapshotUrl || parsed?.accountQuery) {
      assertNoFileSecrets(parsed, sourcePath);
      fileConfig = parsed;
    }
  }

  return {
    snapshotUrl: options.snapshotUrl || fileConfig.snapshotUrl || process.env.SALESFORCE_SNAPSHOT_URL || null,
    instanceUrl: options.instanceUrl || fileConfig.instanceUrl || process.env.SALESFORCE_INSTANCE_URL || null,
    accessToken: options.accessToken || process.env.SALESFORCE_ACCESS_TOKEN || null,
    apiVersion: options.apiVersion || fileConfig.apiVersion || process.env.SALESFORCE_API_VERSION || 'v61.0',
    territoryQuery: options.territoryQuery || fileConfig.territoryQuery || process.env.SALESFORCE_TERRITORY_QUERY || null,
    accountQuery: options.accountQuery || fileConfig.accountQuery || process.env.SALESFORCE_ACCOUNT_QUERY || null,
    authHeader: options.authHeader || process.env.SALESFORCE_AUTH_HEADER || null,
  };
}

function assertNoFileSecrets(parsed, sourcePath) {
  const forbiddenKeys = ['accessToken', 'authHeader'];
  const present = forbiddenKeys.filter((key) => Boolean(parsed?.[key]));
  if (present.length > 0) {
    throw new Error(`Refusing to load Salesforce secrets from ${sourcePath}. Move ${present.join(', ')} to environment variables.`);
  }
}

async function fetchSnapshotPayload(snapshotUrl, territoryId, config) {
  const url = new URL(snapshotUrl);
  if (territoryId) {
    url.searchParams.set('territoryId', territoryId);
  }

  const response = await fetch(url, {
    headers: buildAuthHeaders(config),
  });
  if (!response.ok) {
    throw new Error(`Salesforce snapshot endpoint returned ${response.status}`);
  }

  return response.json();
}

async function runSalesforceQuery(config, soql) {
  const url = new URL(`/services/data/${config.apiVersion}/query`, config.instanceUrl);
  url.searchParams.set('q', soql);

  const response = await fetch(url, {
    headers: buildAuthHeaders(config),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => '');
    throw new Error(`Salesforce query failed (${response.status}): ${message.slice(0, 240)}`);
  }

  return response.json();
}

function buildAuthHeaders(config) {
  if (config.authHeader) {
    return {
      Authorization: config.authHeader,
      Accept: 'application/json',
    };
  }

  if (config.accessToken) {
    return {
      Authorization: `Bearer ${config.accessToken}`,
      Accept: 'application/json',
    };
  }

  return {
    Accept: 'application/json',
  };
}

function interpolateTemplate(template, values) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => values[key] || '');
}

function normalizeLiveQueryPayload({ territoryId, territoryRecord, accountRecords }) {
  const territory = {
    territoryId: territoryId || pickField(territoryRecord, ['Territory2Id', 'territoryId', 'Id']) || null,
    territoryName: pickField(territoryRecord, ['Name', 'territoryName']) || territoryId || 'Salesforce Territory',
    ownerId: pickField(territoryRecord, ['OwnerId', 'ownerId', 'Owner.Id']) || null,
    ownerName: pickField(territoryRecord, ['Owner.Name', 'ownerName']) || null,
    ownerEmail: pickField(territoryRecord, ['Owner.Email', 'ownerEmail']) || null,
    region: pickField(territoryRecord, ['Region__c', 'Region', 'region']) || null,
    syncedAt: toIso(),
  };

  const accounts = accountRecords.map((record) => normalizeAccountRecord(record));
  return { territory, accounts };
}

function normalizePayload(payload, territoryId) {
  if (!payload?.territory || !Array.isArray(payload.accounts)) {
    throw new Error('Invalid Salesforce snapshot payload. Expected territory + accounts.');
  }

  const territory = {
    territoryId: territoryId || payload.territory.territoryId,
    territoryName: payload.territory.territoryName,
    ownerId: payload.territory.ownerId || null,
    ownerName: payload.territory.ownerName || null,
    ownerEmail: payload.territory.ownerEmail || null,
    region: payload.territory.region || null,
    syncedAt: payload.territory.syncedAt || toIso(),
  };

  const accounts = payload.accounts.map((account) => normalizeAccount(account, null));
  return { territory, accounts };
}

function normalizeAccount(account, parentAccountId) {
  return {
    accountId: account.accountId,
    name: account.name,
    website: account.website || null,
    country: account.country || null,
    region: account.region || null,
    priority: Number.isFinite(account.priority) ? account.priority : 0,
    parentAccountId,
    salesNav: account.salesNav || {},
    signals: account.signals || {},
    subsidiaries: (account.subsidiaries || []).map((subsidiary) =>
      normalizeAccount(subsidiary, account.accountId)),
  };
}

function normalizeAccountRecord(record) {
  const account = record.Account || {};
  const root = Object.keys(account).length > 0 ? account : record;

  return {
    accountId: pickField(root, ['Id', 'accountId', 'AccountId']) || pickField(record, ['AccountId']) || randomId('account'),
    name: pickField(root, ['Name', 'name', 'AccountName']) || 'Unnamed account',
    website: pickField(root, ['Website', 'website']) || null,
    country: pickField(root, ['BillingCountry', 'ShippingCountry', 'Country__c', 'country']) || null,
    region: pickField(root, ['Region__c', 'Region', 'region']) || null,
    priority: Number(pickField(record, ['Priority__c', 'priority'])) || 0,
    parentAccountId: pickField(root, ['ParentId', 'parentAccountId']) || null,
    salesNav: {
      accountUrl: pickField(record, ['SalesNavAccountUrl__c', 'salesNav.accountUrl']) || null,
      peopleSearchUrl: pickField(record, ['SalesNavPeopleSearchUrl__c', 'salesNav.peopleSearchUrl']) || null,
      accountListName: pickField(record, ['SalesNavAccountListName__c', 'salesNav.accountListName']) || null,
      companyFilterName: pickField(record, ['SalesNavCompanyFilterName__c', 'salesNav.companyFilterName']) || null,
    },
    signals: {
      employeeCount: toNullableNumber(pickField(root, ['NumberOfEmployees', 'EmployeeCount__c'])),
      subsidiary: Boolean(pickField(record, ['IsSubsidiary__c', 'isSubsidiary'])),
      industry: pickField(root, ['Industry', 'industry']) || null,
      ownerId: pickField(record, ['OwnerId', 'ownerId', 'Owner.Id']) || null,
      ownerName: pickField(record, ['Owner.Name', 'ownerName']) || null,
    },
    subsidiaries: [],
  };
}

function pickField(record, candidates) {
  if (!record) {
    return null;
  }

  for (const candidate of candidates) {
    const value = getPath(record, candidate);
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

function getPath(record, pathValue) {
  const parts = String(pathValue).split('.');
  let current = record;

  for (const part of parts) {
    if (current == null || typeof current !== 'object' || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

function toNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = {
  ReadOnlySalesforceAdapter,
  normalizePayload,
  normalizeAccountRecord,
  normalizeLiveQueryPayload,
};
