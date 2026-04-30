const test = require('node:test');
const assert = require('node:assert/strict');

const {
  inferSdaTerritoryContext,
  inferProfileLanguage,
  splitCandidatesByProfileLanguage,
  buildLanguageSplitListNames,
} = require('../src/core/emea-territory');

test('inferSdaTerritoryContext requires manual territory context when no connected data exists', () => {
  const result = inferSdaTerritoryContext({});

  assert.equal(result.status, 'requires_sda_input');
  assert.equal(result.territoryId, null);
  assert.equal(result.languageSplitPolicy.defaultPrimaryLanguage, 'de');
  assert.ok(result.requiredFields.includes('territoryId'));
});

test('inferSdaTerritoryContext derives EMEA territory and language hints from BigQuery rows', () => {
  const result = inferSdaTerritoryContext({
    bigQueryRows: [
      { territory_id: 'terr-dach-01', territory_name: 'DACH Observability', region: 'EMEA', country: 'Germany', account_count: 42 },
      { territory_id: 'terr-dach-01', country: 'Switzerland', account_count: 11 },
      { territory_id: 'terr-dach-01', country: 'Austria', account_count: 7 },
    ],
  });

  assert.equal(result.status, 'inferred_from_bigquery');
  assert.equal(result.territoryId, 'terr-dach-01');
  assert.equal(result.region, 'EMEA');
  assert.deepEqual(result.countries, ['Germany', 'Switzerland', 'Austria']);
  assert.equal(result.languageSplitPolicy.defaultPrimaryLanguage, 'de');
});

test('splitCandidatesByProfileLanguage separates German profile language from English and other EMEA languages', () => {
  const candidates = [
    { fullName: 'Anna', profileLanguage: 'Deutsch', title: 'Leiterin Cloud Plattform' },
    { fullName: 'Ben', profileLanguage: 'English', title: 'Head of Platform' },
    { fullName: 'Claire', locale: 'fr-FR', title: 'Responsable Plateforme' },
    { fullName: 'Diego', title: 'Jefe de Plataforma', headline: 'Perfil en español' },
  ];

  const split = splitCandidatesByProfileLanguage(candidates, { primaryLanguage: 'de' });

  assert.deepEqual(split.de.map((candidate) => candidate.fullName), ['Anna']);
  assert.deepEqual(split.en.map((candidate) => candidate.fullName), ['Ben', 'Claire', 'Diego']);
  assert.equal(split.meta.de.count, 1);
  assert.equal(split.meta.en.label, 'EN/other');
});

test('buildLanguageSplitListNames creates deterministic email-friendly DE and EN list names', () => {
  const names = buildLanguageSplitListNames({ accountName: 'Example AG', segment: 'platform-owner' });

  assert.equal(names.de, 'Example AG - platform-owner - DE');
  assert.equal(names.en, 'Example AG - platform-owner - EN');
});
