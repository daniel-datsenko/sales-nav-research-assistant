const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCompanySearchPath,
  buildLeadListReadbackPath,
  buildLeadSearchPath,
  buildSalesNavApiProbeArtifact,
  assessApiCompanyResolution,
  assessCuratedApiCompanyResolution,
  classifySalesNavApiFailure,
  extractCsrfFromCookieHeader,
  extractCsrfFromCookies,
  extractLeadIdFromUrn,
  normalizeCompanySearchResponse,
  normalizeLeadSearchResponse,
} = require('../src/core/sales-nav-api-probe');
const {
  buildSalesNavigatorLeadIdentity,
  salesNavigatorLeadIdentitiesMatch,
} = require('../src/core/sales-nav-identity');

test('extractCsrfFromCookies reads quoted JSESSIONID without leaking cookies', () => {
  assert.equal(extractCsrfFromCookies([
    { name: 'li_at', value: 'secret-session' },
    { name: 'JSESSIONID', value: '"ajax:123456"' },
  ]), 'ajax:123456');
  assert.equal(extractCsrfFromCookieHeader('li_at=secret; JSESSIONID="ajax:abcdef"; other=1'), 'ajax:abcdef');
});

test('build read-only Sales Nav API paths do not use mutation endpoints', () => {
  const paths = [
    buildCompanySearchPath('Example Retail Chain'),
    buildLeadSearchPath({ companyId: '123', count: 5 }),
    buildLeadListReadbackPath({ listId: '456' }),
  ];

  for (const path of paths) {
    assert.match(path, /^\/sales-api\//);
    assert.doesNotMatch(path, /bulkSave|bulkDelete|action=/i);
  }
});

test('normalizes company and lead API responses into stable identities', () => {
  const companies = normalizeCompanySearchResponse({
    elements: [{
      entityUrn: 'urn:li:fs_salesCompany:12345',
      name: 'Example Retail Chain',
      navigationUrl: 'https://www.linkedin.com/sales/company/12345',
    }],
  });
  assert.deepEqual(companies[0], {
    name: 'Example Retail Chain',
    companyId: '12345',
    entityUrn: 'urn:li:fs_salesCompany:12345',
    salesNavigatorUrl: 'https://www.linkedin.com/sales/company/12345',
  });

  const leads = normalizeLeadSearchResponse({
    elements: [{
      entityUrn: 'urn:li:fs_salesProfile:(ACwAA123,NAME_SEARCH,abc)',
      firstName: 'Example',
      lastName: 'Executive',
      currentPositions: [{ title: 'CTO Example Retail', companyName: 'Example Retail Chain', current: true }],
      pendingInvitation: true,
      saved: true,
    }],
  });

  assert.equal(leads[0].salesNavigatorLeadId, 'ACwAA123');
  assert.equal(leads[0].fullName, 'Example Executive');
  assert.equal(leads[0].title, 'CTO Example Retail');
  assert.equal(leads[0].pendingInvitation, true);
  assert.equal(leads[0].saved, true);
});

test('assessApiCompanyResolution distinguishes exact, multi-target, and ambiguous companies', () => {
  assert.equal(assessApiCompanyResolution('Example Analytics Co', [
    { name: 'Example Analytics Co', companyId: '300001' },
    { name: 'Example Analytics Factory', companyId: '300002' },
  ]).status, 'resolved_exact_api');

  const edeka = assessApiCompanyResolution('Example Retail Group', [
    { name: 'Example Retail Group', companyId: '12267150' },
    { name: 'Example Retail IT', companyId: '905440' },
    { name: 'Example Retail HQ GmbH', companyId: '2783130' },
  ]);
  assert.equal(edeka.status, 'resolved_multi_target_api');
  assert.equal(edeka.selectedTargets[0].name, 'Example Retail IT');
  assert.equal(edeka.selectedTargets[0].entityPriority, 'it_digital_first');
  assert.equal(edeka.selectedTargets.some((target) => target.name === 'Example Retail Group'), true);

  const globex = assessApiCompanyResolution('Globex', [
    { name: 'Globex', companyId: '332814' },
    { name: 'Globex', companyId: '1950279' },
    { name: 'Globex Group', companyId: '164955' },
  ]);
  assert.equal(globex.status, 'needs_company_scope_review');
  assert.equal(globex.warning, 'api_company_search_ambiguous_exact_matches');
});

test('assessCuratedApiCompanyResolution turns generic enterprise targets into safe ordered API targets', () => {
  const resolution = assessCuratedApiCompanyResolution('Globex', [
    {
      linkedinName: 'Globex Group',
      salesNavCompanyUrl: 'https://www.linkedin.com/sales/company/164955',
      targetType: 'parent',
      evidence: ['curated_parent'],
    },
    {
      linkedinName: 'Globex Digital',
      salesNavCompanyUrl: 'https://www.linkedin.com/sales/company/70517322',
      targetType: 'subsidiary',
      evidence: ['curated_it_subsidiary'],
    },
  ]);

  assert.equal(resolution.status, 'resolved_multi_target_curated');
  assert.deepEqual(
    resolution.selectedTargets.map((target) => target.companyId),
    ['70517322', '164955'],
  );
  assert.equal(resolution.selectedTargets[0].entityPriority, 'it_digital_first');
});

test('entityUrn is a first-class Sales Navigator identity match', () => {
  assert.equal(extractLeadIdFromUrn('urn:li:fs_salesProfile:(ACwAA123,NAME_SEARCH,abc)'), 'ACwAA123');
  const left = buildSalesNavigatorLeadIdentity({
    entityUrn: 'urn:li:fs_salesProfile:(ACwAA123,NAME_SEARCH,abc)',
    fullName: 'Same Name',
  });
  const right = buildSalesNavigatorLeadIdentity({
    entityUrn: 'urn:li:fs_salesProfile:(ACwAA123,NAME_SEARCH,abc)',
    fullName: 'Same Name',
  });
  assert.equal(left.salesNavigatorLeadId, 'ACwAA123');
  assert.equal(salesNavigatorLeadIdentitiesMatch(left, right), true);
});

test('probe artifact excludes CSRF/cookies and records read-only counts', () => {
  const artifact = buildSalesNavApiProbeArtifact({
    accountName: 'Example Retail Chain',
    companyResponse: {
      ok: true,
      payload: { elements: [{ name: 'Example Retail Chain', entityUrn: 'urn:li:fs_salesCompany:123' }] },
    },
    leadResponse: {
      ok: true,
      payload: { elements: [{ entityUrn: 'urn:li:fs_salesProfile:(lead-1,NAME_SEARCH,x)', fullName: 'Lead One' }] },
    },
    listResponse: {
      ok: true,
      payload: { elements: [{ entityUrn: 'urn:li:fs_salesProfile:(lead-2,NAME_SEARCH,x)', fullName: 'Lead Two' }] },
    },
  });

  assert.equal(artifact.mode, 'read_only');
  assert.equal(artifact.counts.companyCandidates, 1);
  assert.equal(artifact.counts.leadCandidates, 1);
  assert.equal(artifact.counts.listRows, 1);
  assert.equal(artifact.counts.entityUrnCoverage, 1);
  assert.equal(JSON.stringify(artifact).includes('JSESSIONID'), false);
  assert.equal(JSON.stringify(artifact).includes('csrf'), false);
});

test('classifies API failures fail-closed', () => {
  assert.equal(classifySalesNavApiFailure({ sessionState: 'reauth_required', status: 200 }), 'not_authenticated');
  assert.equal(classifySalesNavApiFailure({ status: 403, bodyText: 'Forbidden' }), 'api_blocked');
  assert.equal(classifySalesNavApiFailure({ status: 429, bodyText: 'Too many requests' }), 'rate_limited');
  assert.equal(classifySalesNavApiFailure({ status: 200, bodyText: '<html></html>' }), 'unexpected_shape');
});
