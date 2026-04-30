const test = require('node:test');
const assert = require('node:assert/strict');

const { scoreCandidate } = require('../src/core/scoring');
const icpConfig = require('../config/icp/default-observability.json');

test('scoreCandidate ranks observability technical champions highly', () => {
  const result = scoreCandidate({
    title: 'Director of Platform Engineering',
    headline: 'Owns observability, tracing, metrics and reliability for production systems',
  }, icpConfig);

  assert.equal(result.eligible, true);
  assert.ok(result.score >= icpConfig.approvalThreshold);
  assert.equal(result.roleFamily, 'platform_engineering');
});

test('scoreCandidate excludes obviously irrelevant roles', () => {
  const result = scoreCandidate({
    title: 'Senior Recruiter',
    headline: 'Hiring across engineering',
  }, icpConfig);

  assert.equal(result.eligible, false);
  assert.equal(result.score, 0);
});

test('scoreCandidate boosts strong deep-profile observability signals', () => {
  const result = scoreCandidate({
    title: 'Enterprise Architect',
    headline: 'Owns core architecture initiatives',
    about: 'Built Observability Platform dashboards, Prometheus metrics pipelines, monitoring standards and incident response workflows for platform operations.',
  }, icpConfig);

  assert.equal(result.eligible, true);
  assert.ok(result.breakdown.profileReviewSignals.length >= 4);
  assert.ok(result.breakdown.components.profileReviewScore > 0);
  assert.ok(result.score >= icpConfig.saveToListThreshold);
});

test('scoreCandidate does not match short title keywords inside unrelated words', () => {
  const result = scoreCandidate({
    title: 'Service Quality Senior Analyst',
    headline: 'Owns customer quality processes',
  }, icpConfig);

  assert.equal(result.breakdown.includeTitles.includes('it'), false);
});

test('scoreCandidate lets technical operations roles through without blanket exclusion', () => {
  const result = scoreCandidate({
    title: 'IT Operations Manager',
    headline: 'Owns infrastructure, incidents and production tooling',
  }, icpConfig);

  assert.equal(result.eligible, true);
  assert.equal(result.breakdown.excludedTitles.length, 0);
  assert.ok(result.score > 0);
});

test('scoreCandidate keeps non-technical operations roles below the save threshold naturally', () => {
  const result = scoreCandidate({
    title: 'Director Of Operations',
    headline: 'Owns regional operations and delivery',
  }, icpConfig);

  assert.equal(result.eligible, true);
  assert.equal(result.breakdown.excludedTitles.length, 0);
  assert.ok(result.score < icpConfig.saveToListThreshold);
});

test('scoreCandidate treats Engineering Manager as platform engineering', () => {
  const result = scoreCandidate({
    title: 'Engineering Manager',
    headline: 'Leads engineering delivery and tooling decisions',
  }, icpConfig);

  assert.equal(result.roleFamily, 'platform_engineering');
  assert.equal(result.eligible, true);
  assert.ok(result.score >= 30);
  assert.ok(result.score >= icpConfig.saveToListThreshold);
});

test('scoreCandidate recognizes system owners as platform-adjacent fits', () => {
  const result = scoreCandidate({
    title: 'System Owner',
    headline: 'Owns critical internal IT systems and platform reliability',
  }, icpConfig);

  assert.equal(result.roleFamily, 'platform_engineering');
  assert.equal(result.eligible, true);
  assert.ok(result.score >= 25);
});

test('scoreCandidate recognizes chapter lead monitoring and head of cloud titles', () => {
  const chapterLead = scoreCandidate({
    title: 'Chapter Lead Technology Foundation Operations & Monitoring',
    headline: 'Owns platform operations and monitoring foundations',
  }, icpConfig);
  const headOfCloud = scoreCandidate({
    title: 'Head of Cloud Technology',
    headline: 'Owns cloud platform strategy and operations',
  }, icpConfig);

  assert.equal(chapterLead.roleFamily, 'platform_engineering');
  assert.equal(headOfCloud.roleFamily, 'platform_engineering');
  assert.ok(chapterLead.score >= icpConfig.saveToListThreshold);
  assert.ok(headOfCloud.score >= icpConfig.saveToListThreshold);
});

test('scoreCandidate recognizes VP technology and business IT as executive engineering', () => {
  const vpTechnology = scoreCandidate({
    title: 'VP Technology',
    headline: 'Leads engineering and platform technology teams',
  }, icpConfig);
  const vpBusinessIt = scoreCandidate({
    title: 'VP of Business IT',
    headline: 'Owns enterprise IT platforms and architecture',
  }, icpConfig);

  assert.equal(vpTechnology.roleFamily, 'executive_engineering');
  assert.equal(vpBusinessIt.roleFamily, 'executive_engineering');
  assert.ok(vpTechnology.score >= icpConfig.saveToListThreshold);
  assert.ok(vpBusinessIt.score >= icpConfig.saveToListThreshold);
});

test('scoreCandidate recognizes CIO and CTO titles as executive engineering', () => {
  const cio = scoreCandidate({
    title: 'Chief Information Officer',
    headline: 'Owns technology strategy and enterprise platforms',
  }, icpConfig);
  const shortCto = scoreCandidate({
    title: 'CTO',
    headline: 'Leads engineering, cloud platform and architecture',
  }, icpConfig);
  const ciso = scoreCandidate({
    title: 'CISO',
    headline: 'Owns security and risk',
  }, icpConfig);

  assert.equal(cio.roleFamily, 'executive_engineering');
  assert.equal(shortCto.roleFamily, 'executive_engineering');
  assert.equal(cio.seniority, 'vp');
  assert.equal(shortCto.seniority, 'vp');
  assert.notEqual(ciso.roleFamily, 'executive_engineering');
});

test('scoreCandidate recognizes microservices builders as platform engineering', () => {
  const developer = scoreCandidate({
    title: 'Senior Microservices Developer',
    headline: 'Builds distributed backend services',
  }, icpConfig);
  const architect = scoreCandidate({
    title: 'Microservices Architect',
    headline: 'Owns service architecture and production reliability',
  }, icpConfig);

  assert.equal(developer.roleFamily, 'platform_engineering');
  assert.equal(architect.roleFamily, 'platform_engineering');
  assert.equal(developer.eligible, true);
  assert.equal(architect.eligible, true);
});

test('scoreCandidate keeps security and data compound titles out of platform engineering', () => {
  const cyberSecurityArchitect = scoreCandidate({
    title: 'Cyber Security Architect',
    headline: '',
  }, icpConfig);
  const dataArchitect = scoreCandidate({
    title: 'Data Architect',
    headline: '',
  }, icpConfig);
  const securityEngineer = scoreCandidate({
    title: 'Security Engineer',
    headline: '',
  }, icpConfig);

  assert.equal(cyberSecurityArchitect.roleFamily, 'security');
  assert.equal(dataArchitect.roleFamily, 'data');
  assert.equal(securityEngineer.roleFamily, 'security');
  assert.ok(cyberSecurityArchitect.score < icpConfig.saveToListThreshold);
  assert.ok(dataArchitect.score < icpConfig.saveToListThreshold);
  assert.ok(securityEngineer.score < icpConfig.saveToListThreshold);
});

test('scoreCandidate recognizes SDR-sourced EMEA platform personas and profile signals', () => {
  const candidates = [
    {
      title: 'Responsable Plateforme Cloud',
      headline: 'Leads CCOE, Cloud Governance and Terraform standards across EMEA',
      expectedRoleFamily: 'platform_engineering',
    },
    {
      title: 'Leiter Cloud Kompetenzzentrum',
      headline: 'Owns FinOps, Kubernetes, Prometheus and observability platform adoption',
      expectedRoleFamily: 'platform_engineering',
    },
    {
      title: 'Responsabile Osservabilità e Piattaforma',
      headline: 'Runs Datadog migration, OpenTelemetry, Grafana and SRE practices',
      expectedRoleFamily: 'site_reliability',
    },
    {
      title: 'Jefe de Plataforma de Datos',
      headline: 'Owns Data Platform, MLOps, AIOps and cloud infrastructure',
      expectedRoleFamily: 'data',
    },
  ];

  for (const candidate of candidates) {
    const result = scoreCandidate(candidate, icpConfig);
    assert.equal(result.eligible, true, candidate.title);
    assert.equal(result.roleFamily, candidate.expectedRoleFamily, candidate.title);
    assert.ok(result.score >= icpConfig.saveToListThreshold, `${candidate.title} score ${result.score}`);
    assert.ok(
      result.breakdown.observabilitySignals.length
        + result.breakdown.championSignals.length
        + result.breakdown.profileReviewSignals.length >= 2,
      candidate.title,
    );
  }
});

test('scoreCandidate hard-excludes common EMEA commercial and operational false positives', () => {
  const titles = [
    'Facilities Manager Cloud Campus',
    'Head of Fleet Technology',
    'Responsable Achats Cloud',
    'Direttore Vendite Cloud',
    'HSEQ Manager Technology',
    'Category Manager Datadog Procurement',
  ];

  for (const title of titles) {
    const result = scoreCandidate({ title, headline: 'Mentions cloud and platform vendors' }, icpConfig);
    assert.equal(result.eligible, false, title);
    assert.equal(result.score, 0, title);
  }
});
