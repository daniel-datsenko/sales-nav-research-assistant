const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseNodeMajor,
  buildFirstRunChecklist,
  renderFirstRunOnboarding,
} = require('../src/core/first-run');

test('parseNodeMajor reads supported Node version strings', () => {
  assert.equal(parseNodeMajor('v24.13.1'), 24);
  assert.equal(parseNodeMajor('22.5.0'), 22);
  assert.equal(parseNodeMajor('not-a-version'), 0);
});

test('buildFirstRunChecklist explains install and session readiness', () => {
  const checklist = buildFirstRunChecklist({ nodeVersion: 'v24.13.1' });

  assert.equal(checklist.title, 'Sales Navigator Research Assistant first-run check');
  assert.ok(checklist.checks.some((check) => check.id === 'dependencies'));
  assert.ok(checklist.checks.some((check) => check.id === 'linkedin-session'));
  assert.match(checklist.nextCommand, /npm run (bootstrap-session|check-driver-session)|npm install/);
});

test('renderFirstRunOnboarding gives safe setup choices and no live mutation instruction', () => {
  const markdown = renderFirstRunOnboarding({
    readyForDrySafe: true,
    readyForLiveSalesNav: false,
    nextCommand: 'npm run bootstrap-session -- --driver=playwright --wait-minutes=10',
    checks: [
      {
        status: 'ok',
        label: 'NPM dependencies',
        next: 'Dependencies are installed.',
      },
      {
        status: 'missing',
        label: 'LinkedIn/Sales Navigator login',
        next: 'Run bootstrap-session.',
      },
    ],
  });

  assert.match(markdown, /Dry-safe research can run now/);
  assert.match(markdown, /Produce a research Markdown\/calling-list artifact/);
  assert.match(markdown, /Do not run live-save or live-connect/);
});
