const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildVoyagerProfileArtifact,
  buildVoyagerProfilePaths,
  classifyPitchStrategy,
  classifyVoyagerFailure,
  extractVoyagerCsrfFromCookies,
  normalizeVoyagerProfileResponse,
  resolveVoyagerIdentity,
} = require('../src/core/voyager-profile');

test('extractVoyagerCsrfFromCookies reads quoted JSESSIONID only', () => {
  const csrf = extractVoyagerCsrfFromCookies([
    { name: 'li_at', value: 'secret-session-token' },
    { name: 'JSESSIONID', value: '"ajax:123456789"' },
  ]);

  assert.equal(csrf, 'ajax:123456789');
});

test('Voyager profile paths are read-only GET paths', () => {
  const paths = buildVoyagerProfilePaths({ publicIdentifier: 'daniel-example' });

  assert.equal(paths.length > 0, true);
  for (const path of paths) {
    assert.match(path, /^\/voyager\/api\/graphql\?/);
    assert.match(path, /memberIdentity:daniel-example/);
    assert.doesNotMatch(path, /POST|bulk|save|connect|delete/i);
  }
});

test('resolveVoyagerIdentity uses public LinkedIn slug and profile URN when available', () => {
  const identity = resolveVoyagerIdentity({
    publicProfileUrl: 'https://www.linkedin.com/in/daniel-example/',
    entityUrn: 'urn:li:fsd_profile:ACoAA123',
  });

  assert.equal(identity.status, 'resolved');
  assert.equal(identity.publicIdentifier, 'daniel-example');
  assert.equal(identity.profileUrn, 'urn:li:fsd_profile:ACoAA123');
});

test('missing Voyager identity is a skipped input, not an exception', () => {
  const identity = resolveVoyagerIdentity({
    salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ACwAA123',
  });

  assert.equal(identity.status, 'missing_voyager_identity');
  assert.equal(identity.publicIdentifier, '');
  assert.equal(identity.profileUrn, '');
});

test('normalizes Voyager profile payload into bounded stack signals and pitch strategy', () => {
  const signals = normalizeVoyagerProfileResponse({
    data: {
      profile: {
        headline: 'Cloud Platform Engineer focused on observability',
        summary: 'I run Kubernetes, Prometheus, Grafana and Datadog for production monitoring.',
        position: {
          title: 'Senior Site Reliability Engineer',
          companyName: 'Example Retail Chain',
        },
        skills: [
          { name: 'Kubernetes' },
          { name: 'OpenTelemetry' },
          { name: 'Terraform' },
        ],
      },
    },
  });

  assert.equal(signals.headline, 'Cloud Platform Engineer focused on observability');
  assert.equal(signals.currentCompany, 'Example Retail Chain');
  assert.equal(signals.observabilitySignals.includes('prometheus'), true);
  assert.equal(signals.observabilitySignals.includes('grafana'), true);
  assert.equal(signals.competitiveSignals.includes('datadog'), true);
  assert.equal(signals.platformSignals.includes('kubernetes'), true);
  assert.equal(signals.pitchStrategy, 'coexist');
  assert.equal(signals.snippet.length <= 500, true);
});

test('classifyPitchStrategy distinguishes advocate, displace, migrate and coexist', () => {
  assert.equal(classifyPitchStrategy({ observabilitySignals: ['prometheus'] }), 'advocate');
  assert.equal(classifyPitchStrategy({ competitiveSignals: ['dynatrace'] }), 'displace');
  assert.equal(classifyPitchStrategy({ legacySignals: ['zabbix'] }), 'migrate');
  assert.equal(classifyPitchStrategy({ observabilitySignals: ['grafana'], competitiveSignals: ['datadog'] }), 'coexist');
  assert.equal(classifyPitchStrategy({}), 'unknown');
});

test('Voyager artifact excludes cookies and CSRF while keeping bounded signals', () => {
  const artifact = buildVoyagerProfileArtifact({
    candidate: {
      fullName: 'Example Lead',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/ACwAA123',
      publicProfileUrl: 'https://www.linkedin.com/in/example-lead',
    },
    identity: { publicIdentifier: 'example-lead' },
    response: {
      ok: true,
      payload: {
        headline: 'Platform Engineer',
        summary: 'Prometheus and Grafana monitoring.',
      },
    },
  });

  assert.equal(artifact.mode, 'read_only');
  assert.equal(artifact.voyagerReadable, true);
  assert.equal(artifact.fieldsFound.headline, true);
  assert.equal(JSON.stringify(artifact).includes('JSESSIONID'), false);
  assert.equal(JSON.stringify(artifact).includes('csrf'), false);
  assert.equal(JSON.stringify(artifact).includes('li_at'), false);
});

test('classifies Voyager failures fail-closed', () => {
  assert.equal(classifyVoyagerFailure({ sessionState: 'reauth_required', status: 200 }), 'not_authenticated');
  assert.equal(classifyVoyagerFailure({ status: 403, bodyText: 'Forbidden' }), 'voyager_blocked');
  assert.equal(classifyVoyagerFailure({ status: 404, bodyText: 'Profile not found' }), 'profile_not_found');
  assert.equal(classifyVoyagerFailure({ status: 429, bodyText: 'Too many requests' }), 'rate_limited');
  assert.equal(classifyVoyagerFailure({ status: 200, bodyText: '<html></html>' }), 'unexpected_shape');
});
