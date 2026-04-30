const test = require('node:test');
const assert = require('node:assert/strict');

const { createBrowserWorkerLock } = require('../src/core/browser-worker-lock');

test('browser worker lock serializes async browser jobs', async () => {
  const lock = createBrowserWorkerLock();
  const events = [];

  await Promise.all([
    lock.runExclusive('job-a', async () => {
      events.push('a:start');
      await Promise.resolve();
      events.push('a:end');
      return 'a';
    }),
    lock.runExclusive('job-b', async () => {
      events.push('b:start');
      events.push('b:end');
      return 'b';
    }),
  ]);

  assert.deepEqual(events, ['a:start', 'a:end', 'b:start', 'b:end']);
});

test('browser worker lock releases after thrown errors', async () => {
  const lock = createBrowserWorkerLock();
  const events = [];

  await assert.rejects(
    () => lock.runExclusive('job-a', async () => {
      events.push('a:start');
      throw new Error('boom');
    }),
    /boom/,
  );

  await lock.runExclusive('job-b', async () => {
    events.push('b:ok');
    return true;
  });

  assert.deepEqual(events, ['a:start', 'b:ok']);
  const tel = lock.getTelemetry();
  assert.equal(tel.length, 2);
  assert.equal(tel[0].status, 'failed');
  assert.equal(tel[1].status, 'completed');
});
