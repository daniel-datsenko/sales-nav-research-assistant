const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createDashboardServer,
  isLoopbackRequest,
  buildSecurityHeaders,
  sanitizeErrorText,
  sanitizeRecoveryEventForDashboard,
  sanitizeRunAccountForDashboard,
} = require('../src/server/dashboard');

test('isLoopbackRequest accepts only loopback addresses', () => {
  assert.equal(isLoopbackRequest('127.0.0.1'), true);
  assert.equal(isLoopbackRequest('::1'), true);
  assert.equal(isLoopbackRequest('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackRequest('10.0.0.5'), false);
  assert.equal(isLoopbackRequest(null), false);
});

test('buildSecurityHeaders sets strict local dashboard headers', () => {
  const headers = buildSecurityHeaders();

  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(headers.Pragma, 'no-cache');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Referrer-Policy'], 'no-referrer');
  assert.match(headers['Content-Security-Policy'], /frame-ancestors 'none'/);
});

test('createDashboardServer exposes listen and close methods', () => {
  const repository = {
    getBudgetState() {
      return { weeklyCap: 140, weekCount: 0, dayCount: 0 };
    },
    getDashboardSummary() {
      return { runs: [], approvals: 0, candidates: 0, failedAccounts: 0 };
    },
  };

  const server = createDashboardServer({ repository, port: 0, host: '127.0.0.1' });

  assert.equal(typeof server.listen, 'function');
  assert.equal(typeof server.close, 'function');
});

test('sanitizeErrorText redacts paths and secret-like fragments', () => {
  const value = sanitizeErrorText('AccessToken=abc123 /Users/example-operator/Documents/New project/runtime/file.txt Bearer xyz987');

  assert.match(value, /AccessToken=\[redacted\]/i);
  assert.match(value, /\[path\]/);
  assert.match(value, /Bearer \[redacted\]/);
});

test('sanitizeRecoveryEventForDashboard strips local paths and auth fields', () => {
  const event = sanitizeRecoveryEventForDashboard({
    recoveryId: 'recovery-1',
    runId: 'run-1',
    severity: 'error',
    eventType: 'account_processing_failed',
    details: {
      message: 'Failure at /Users/example-operator/Documents/New project/runtime/file.txt',
      screenshotPath: '/Users/example-operator/Documents/New project/runtime/artifacts/recovery/run-1.png',
      authHeader: 'Bearer abc123',
      nested: {
        cookieValue: 'session=secret',
      },
    },
  });

  assert.equal(event.details.screenshotPath, '[stored locally: run-1.png]');
  assert.equal(event.details.authHeader, '[redacted]');
  assert.equal(event.details.nested.cookieValue, '[redacted]');
  assert.match(event.details.message, /\[path\]/);
});

test('sanitizeRunAccountForDashboard truncates raw lastError detail', () => {
  const account = sanitizeRunAccountForDashboard({
    runId: 'run-1',
    accountKey: 'account-1',
    lastError: `Unexpected failure in /Users/example-operator/Documents/New project/runtime/platform.db with authHeader=secret ${'x'.repeat(400)}`,
  });

  assert.match(account.lastError, /\[path\]/);
  assert.match(account.lastError, /authHeader=\[redacted\]/i);
  assert.ok(account.lastError.length <= 240);
});
