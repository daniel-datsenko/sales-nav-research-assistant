const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEnterpriseEntitySearchTerms,
  classifyEnterpriseEntityCandidate,
  renderEnterpriseEntityResolutionMarkdown,
  resolveEnterpriseEntities,
} = require('../src/core/enterprise-entity-resolution');
const { loadCompanyAliasConfig } = require('../src/core/company-resolution');

test('buildEnterpriseEntitySearchTerms includes IT and digital probes plus configured aliases', () => {
  const terms = buildEnterpriseEntitySearchTerms('Globex', {
    aliasEntry: {
      subsidiaryAliases: ['Globex Digital'],
      targets: [{ linkedinName: 'Globex Group' }],
    },
  });

  assert.deepEqual(terms.slice(0, 7), [
    'Globex',
    'Globex digital',
    'Globex IT',
    'Globex systems',
    'Globex technology',
    'Globex platform',
    'Globex data',
  ]);
  assert.equal(terms.includes('Globex Digital'), true);
  assert.equal(terms.includes('Globex Group'), true);
});

test('enterprise resolver includes IT and parent entities while excluding unrelated homonyms', () => {
  const resolution = resolveEnterpriseEntities({
    accountName: 'Globex',
    aliasConfig: { accounts: {} },
    companyCandidates: [
      { name: 'Globex', companyId: '332814', salesNavigatorUrl: 'https://www.linkedin.com/sales/company/332814' },
      { name: 'Globex Digital', companyId: '70517322', salesNavigatorUrl: 'https://www.linkedin.com/sales/company/70517322' },
      { name: 'Globex Group', companyId: '164955', salesNavigatorUrl: 'https://www.linkedin.com/sales/company/164955' },
      { name: 'Globex Bank', companyId: '999', salesNavigatorUrl: 'https://www.linkedin.com/sales/company/999' },
    ],
  });

  assert.equal(resolution.status, 'resolved_multi_target_suggested');
  assert.deepEqual(
    resolution.selectedTargets.map((target) => target.companyId),
    ['70517322', '164955'],
  );
  assert.equal(resolution.included[0].entityPriority, 'it_digital_first');
  assert.equal(resolution.excluded.some((entity) => entity.name === 'Globex Bank'), true);
  assert.equal(resolution.learnedSuggestions.length >= 2, true);
});

test('enterprise resolver keeps curated config as source of truth without learned suggestions', () => {
  const aliasConfig = loadCompanyAliasConfig();
  const resolution = resolveEnterpriseEntities({
    accountName: 'EDEKA',
    aliasConfig,
    companyCandidates: [
      { name: 'EDEKA', companyId: '1' },
      { name: 'EDEKA DIGITAL GmbH', companyId: '4' },
      { name: 'Lunar GmbH', companyId: '5' },
      { name: 'Deutsche Bank', companyId: '2' },
    ],
  });

  assert.equal(resolution.status, 'resolved_multi_target_curated');
  assert.equal(resolution.source, 'curated_company_targets');
  assert.equal(resolution.learnedSuggestions.length, 0);
  assert.equal(resolution.selectedTargets.some((target) => /edeka/i.test(target.name)), true);
});

test('unrelated homonym is excluded even when it shares the account token', () => {
  const candidate = classifyEnterpriseEntityCandidate('Globex', {
    name: 'Globex Bank',
    companyId: 'bank-1',
    leadSamples: [{ title: 'Branch Manager' }],
  }, { hasStrongerRelatedTargets: true });

  assert.equal(candidate.decision, 'exclude');
  assert.equal(candidate.entityPriority, 'unrelated_homonym');
});

test('enterprise resolver markdown explains what was searched and skipped in plain English', () => {
  const resolution = resolveEnterpriseEntities({
    accountName: 'Globex',
    aliasConfig: { accounts: {} },
    companyCandidates: [
      { name: 'Globex Digital', companyId: '70517322' },
      { name: 'Globex Group', companyId: '164955' },
      { name: 'Globex Bank', companyId: '999' },
    ],
  });
  const markdown = renderEnterpriseEntityResolutionMarkdown(resolution);

  assert.match(markdown, /Searched Globex Digital first, then Globex Group; skipped 1 unrelated page/);
  assert.match(markdown, /Included Targets/);
  assert.match(markdown, /Excluded Targets/);
});

test('enterprise resolver treats shortened brand entities as related but blocks generic keyword-only companies', () => {
  const resolution = resolveEnterpriseEntities({
    accountName: 'Carl Zeiss',
    aliasConfig: { accounts: {} },
    companyCandidates: [
      { name: 'ZEISS Group', companyId: '938659' },
      { name: 'Carl Zeiss IQS Software R&D Center', companyId: '1233280' },
      {
        name: 'Carl Zeiss MES Solutions GmbH',
        companyId: '223971',
        leadSamples: [
          { title: 'Cloud Platform Engineer' },
          { title: 'DevOps Engineer' },
          { title: 'Software Architect' },
        ],
      },
      { name: 'Digital Cinema Service', companyId: '2231829' },
      { name: 'Carl Benz School of Engineering', companyId: '12425839' },
    ],
  });

  assert.equal(resolution.status, 'resolved_multi_target_suggested');
  assert.equal(resolution.selectedTargets.some((target) => target.name === 'ZEISS Group'), true);
  assert.equal(resolution.selectedTargets.some((target) => target.name === 'Carl Zeiss IQS Software R&D Center'), true);
  assert.equal(resolution.included.some((target) => target.name === 'Carl Zeiss MES Solutions GmbH'), true);
  assert.equal(resolution.excluded.some((target) => target.name === 'Digital Cinema Service'), true);
  assert.equal(resolution.excluded.some((target) => target.name === 'Carl Benz School of Engineering'), true);
});
