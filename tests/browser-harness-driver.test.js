const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BrowserHarnessSalesNavigatorDriver,
  classifyLinkedInPageState,
  extractHarnessJson,
} = require('../src/drivers/browser-harness-sales-nav');
const { HybridSalesNavigatorDriver } = require('../src/drivers/hybrid-sales-nav');
const { DriverAdapter } = require('../src/drivers/driver-adapter');
const { buildDriverOptions } = require('../src/lib/driver-options');

test('buildDriverOptions exposes browser harness defaults', () => {
  const options = buildDriverOptions({}, { dryRun: false }, { sessionMode: 'persistent', headless: true });

  assert.match(options.harnessCommand, /(automation\/browser-harness|browser-harness)$/);
  assert.equal(options.browserHarnessName, 'sales-nav-research-assistant');
});

test('extractHarnessJson parses the last emitted JSON object', () => {
  const parsed = extractHarnessJson('noise\n{"ok":false}\n{"ok":true,"value":3}\n');
  assert.deepEqual(parsed, { ok: true, value: 3 });
});

test('classifyLinkedInPageState detects authenticated sales navigator pages', () => {
  assert.equal(
    classifyLinkedInPageState(
      'https://www.linkedin.com/sales/home',
      'Sales Navigator Dashboard',
      'LinkedIn Sales Navigator',
    ),
    'authenticated',
  );
  assert.equal(
    classifyLinkedInPageState(
      'https://www.linkedin.com/checkpoint/challenge/',
      'Verify your identity',
      'Security verification',
    ),
    'captcha_or_checkpoint',
  );
});

test('browser harness driver checks session health through the command runner', async () => {
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }
      return {
        status: 0,
        stdout: `${JSON.stringify({
          page: {
            url: 'https://www.linkedin.com/sales/home',
            title: 'LinkedIn Sales Navigator',
          },
          body: 'Sales Navigator dashboard',
        })}\n`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const health = await driver.checkSessionHealth();

  assert.equal(health.ok, true);
  assert.equal(health.mode, 'browser-harness');
  assert.equal(health.state, 'authenticated');
});

test('browser harness driver retries a transient close-frame transport failure once', async () => {
  let invocation = 0;
  const driver = new BrowserHarnessSalesNavigatorDriver({
    commandRunner({ args }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      invocation += 1;
      if (invocation === 1) {
        return {
          status: 1,
          stdout: '',
          stderr: 'RuntimeError: no close frame received or sent',
        };
      }

      return {
        status: 0,
        stdout: `${JSON.stringify({
          page: {
            url: 'https://www.linkedin.com/sales/home',
            title: 'LinkedIn Sales Navigator',
          },
          body: 'Sales Navigator dashboard',
        })}\n`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const health = await driver.checkSessionHealth();

  assert.equal(invocation, 2);
  assert.equal(health.ok, true);
  assert.equal(health.state, 'authenticated');
});

test('browser harness candidate collection has no implicit 8-result ceiling', async () => {
  class ManyCandidateHarnessDriver extends BrowserHarnessSalesNavigatorDriver {
    runHarnessJson() {
      return {
        items: Array.from({ length: 12 }, (_, index) => ({
          fullName: `Candidate ${index + 1}`,
          title: 'Platform Engineer',
          company: 'Example',
          salesNavigatorUrl: `https://www.linkedin.com/sales/lead/${index + 1}`,
        })),
      };
    }

    runHarness() {}
  }

  const driver = new ManyCandidateHarnessDriver({ maxScrollSteps: 1 });
  const uncapped = await driver.scrollAndCollectCandidates({ name: 'Example' }, { id: 'engineering', keywords: ['engineering'] });
  const capped = await driver.scrollAndCollectCandidates({ name: 'Example' }, { id: 'engineering', keywords: ['engineering'], maxCandidates: 8 });

  assert.equal(uncapped.length, 12);
  assert.equal(capped.length, 8);
});

test('browser harness driver returns verified list-save results', async () => {
  let invocation = 0;
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      invocation += 1;
      if (invocation === 1) {
        return {
          status: 0,
          stdout: `${JSON.stringify({
            status: 'saved',
            listName: 'Existing Test List',
            selectionMode: 'existing_list',
            beforeCount: 24,
            afterCount: 25,
            successStatus: 'Dr. Frank Lehrieder wurde der Liste Existing Test List hinzugefügt.',
          })}\n`,
          stderr: '',
        };
      }

      return { status: 0, stdout: '{}\n', stderr: '' };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const result = await driver.saveCandidateToList(
    {
      fullName: 'Smoke Test Candidate',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/abc',
      profileUrl: 'https://www.linkedin.com/sales/lead/abc',
    },
    { listName: 'Existing Test List' },
    { dryRun: false },
  );

  assert.equal(result.status, 'saved');
  assert.equal(result.afterCount, 25);
  assert.equal(result.driver, 'browser-harness');
});

test('browser harness driver treats already-selected list rows as already_saved', async () => {
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      return {
        status: 0,
        stdout: `${JSON.stringify({
          status: 'already_saved',
          listName: 'Marc O\'Polo Test',
          selectionMode: 'existing_list',
          beforeCount: 11,
          afterCount: 11,
          rowText: 'Marc O\'Polo Test (11)',
        })}\n`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const result = await driver.saveCandidateToList(
    {
      fullName: 'Already Saved Candidate',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/already',
      profileUrl: 'https://www.linkedin.com/sales/lead/already',
    },
    { listName: 'Marc O\'Polo Test' },
    { dryRun: false },
  );

  assert.equal(result.status, 'already_saved');
  assert.equal(result.beforeCount, 11);
  assert.equal(result.afterCount, 11);
  assert.equal(result.driver, 'browser-harness');
});

test('browser harness driver skips connects that were already sent', async () => {
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      return {
        status: 0,
        stdout: `${JSON.stringify({
          status: 'already_sent',
          note: 'invitation already sent',
        })}\n`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const result = await driver.sendConnect(
    {
      fullName: 'Already Invited Candidate',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/invited',
      profileUrl: 'https://www.linkedin.com/sales/lead/invited',
    },
    { dryRun: false },
  );

  assert.equal(result.status, 'already_sent');
  assert.equal(result.driver, 'browser-harness');
});

test('browser harness driver returns verified connect results', async () => {
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      return {
        status: 0,
        stdout: `${JSON.stringify({
          status: 'sent',
          note: 'invitation sent',
        })}\n`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const result = await driver.sendConnect(
    {
      fullName: 'Connect Smoke Candidate',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/connect',
      profileUrl: 'https://www.linkedin.com/sales/lead/connect',
    },
    { dryRun: false },
  );

  assert.equal(result.status, 'sent');
  assert.equal(result.driver, 'browser-harness');
});

test('browser harness driver supports visible lead-page connect buttons without overflow menus', async () => {
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args, input }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      if (input.includes('visible_connect_target')) {
        return {
          status: 0,
          stdout: `${JSON.stringify({
            status: 'sent',
            note: 'invitation sent via visible button',
          })}
`,
          stderr: '',
        };
      }

      return {
        status: 0,
        stdout: `${JSON.stringify({
          status: 'failed',
          message: 'connect_overflow_not_found',
        })}
`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const result = await driver.sendConnect(
    {
      fullName: 'Visible Connect Candidate',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/visible-connect',
      profileUrl: 'https://www.linkedin.com/sales/lead/visible-connect',
    },
    { dryRun: false },
  );

  assert.equal(result.status, 'sent');
  assert.equal(result.note, 'invitation sent via visible button');
  assert.equal(result.driver, 'browser-harness');
});

test('browser harness driver treats visible pending connect buttons as already_sent', async () => {
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args, input }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      if (input.includes('visible_connect_target')) {
        return {
          status: 0,
          stdout: `${JSON.stringify({
            status: 'already_sent',
            note: 'invitation already pending',
          })}
`,
          stderr: '',
        };
      }

      return {
        status: 0,
        stdout: `${JSON.stringify({
          status: 'failed',
          message: 'connect_overflow_not_found',
        })}
`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const result = await driver.sendConnect(
    {
      fullName: 'Visible Pending Candidate',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/visible-pending',
      profileUrl: 'https://www.linkedin.com/sales/lead/visible-pending',
    },
    { dryRun: false },
  );

  assert.equal(result.status, 'already_sent');
  assert.equal(result.note, 'invitation already pending');
  assert.equal(result.driver, 'browser-harness');
});

test('browser harness driver treats post-click pending state without send button as sent', async () => {
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args, input }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      if (input.includes('post_click_visible')) {
        return {
          status: 0,
          stdout: `${JSON.stringify({
            status: 'sent',
            note: 'connect pending via post-click state',
          })}
`,
          stderr: '',
        };
      }

      return {
        status: 0,
        stdout: `${JSON.stringify({
          status: 'failed',
          message: 'connect_send_button_not_found',
        })}
`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const result = await driver.sendConnect(
    {
      fullName: 'Post Click Pending Candidate',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/post-click-pending',
      profileUrl: 'https://www.linkedin.com/sales/lead/post-click-pending',
    },
    { dryRun: false },
  );

  assert.equal(result.status, 'sent');
  assert.equal(result.note, 'connect pending via post-click state');
  assert.equal(result.driver, 'browser-harness');
});

test('browser harness driver treats post-click connected state without send button as already_connected', async () => {
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args, input }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      if (input.includes('post_click_visible')) {
        return {
          status: 0,
          stdout: `${JSON.stringify({
            status: 'already_connected',
            note: 'lead already connected',
          })}
`,
          stderr: '',
        };
      }

      return {
        status: 0,
        stdout: `${JSON.stringify({
          status: 'failed',
          message: 'connect_send_button_not_found',
        })}
`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const result = await driver.sendConnect(
    {
      fullName: 'Post Click Connected Candidate',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/post-click-connected',
      profileUrl: 'https://www.linkedin.com/sales/lead/post-click-connected',
    },
    { dryRun: false },
  );

  assert.equal(result.status, 'already_connected');
  assert.equal(result.note, 'lead already connected');
  assert.equal(result.driver, 'browser-harness');
});

test('browser harness driver paces connect attempts and flushes page cache after repeated profiles', async () => {
  const connectScripts = [];
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args, input }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      connectScripts.push(input);
      return {
        status: 0,
        stdout: `${JSON.stringify({
          status: 'already_sent',
          note: 'invitation already sent',
        })}
`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  for (let index = 0; index < 4; index += 1) {
    await driver.sendConnect(
      {
        fullName: `Paced Candidate ${index + 1}`,
        salesNavigatorUrl: `https://www.linkedin.com/sales/lead/paced-${index + 1}`,
        profileUrl: `https://www.linkedin.com/sales/lead/paced-${index + 1}`,
      },
      { dryRun: false },
    );
  }

  assert.equal(driver.options.connectAttemptPacingMs, 3000);
  assert.equal(driver.options.connectCacheFlushEvery, 3);
  assert.equal(connectScripts.length, 4);
  assert.match(connectScripts[0], /wait\(3\)/);
  assert.doesNotMatch(connectScripts[0], /about:blank/);
  assert.match(connectScripts[3], /new_tab\("about:blank"\)/);
});

test('browser harness driver looks for the lead actions overflow menu before generic overflow controls', async () => {
  let sawPreferredOverflowSelector = false;
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args, input }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      if (input.includes('open actions overflow menu')) {
        sawPreferredOverflowSelector = true;
      }

      return {
        status: 0,
        stdout: `${JSON.stringify({
          status: 'already_sent',
          note: 'invitation already sent',
        })}
`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const result = await driver.sendConnect(
    {
      fullName: 'Specific Overflow Candidate',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/specific-overflow',
      profileUrl: 'https://www.linkedin.com/sales/lead/specific-overflow',
    },
    { dryRun: false },
  );

  assert.equal(result.status, 'already_sent');
  assert.equal(sawPreferredOverflowSelector, true);
});

test('browser harness driver classifies email-required connect flows explicitly', async () => {
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args, input }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      if (input.includes('hasEmailRequired')) {
        return {
          status: 0,
          stdout: `${JSON.stringify({
            status: 'email_required',
            note: 'connect requires email address',
          })}
`,
          stderr: '',
        };
      }

      return {
        status: 0,
        stdout: `${JSON.stringify({
          status: 'failed',
          message: 'connect_not_verified',
        })}
`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const result = await driver.sendConnect(
    {
      fullName: 'Email Required Candidate',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/email-required',
      profileUrl: 'https://www.linkedin.com/sales/lead/email-required',
    },
    { dryRun: false },
  );

  assert.equal(result.status, 'email_required');
  assert.equal(result.note, 'connect requires email address');
  assert.equal(result.driver, 'browser-harness');
});

test('browser harness driver normalizes unverifiable post-click connect flows to manual_review', async () => {
  const driver = new BrowserHarnessSalesNavigatorDriver({
    allowMutations: true,
    commandRunner({ args, input }) {
      if (args?.[0] === '--help') {
        return { status: 0, stdout: 'help', stderr: '' };
      }

      if (input.includes('hasEmailRequired')) {
        return {
          status: 0,
          stdout: `${JSON.stringify({
            status: 'manual_review',
            note: 'connect outcome could not be verified',
          })}
`,
          stderr: '',
        };
      }

      return {
        status: 0,
        stdout: `${JSON.stringify({
          status: 'connect_unavailable',
          note: 'connect overflow menu not found',
        })}
`,
        stderr: '',
      };
    },
  });

  await driver.openSession({ runId: 'test', dryRun: false });
  const result = await driver.sendConnect(
    {
      fullName: 'Manual Review Candidate',
      salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/manual-review',
      profileUrl: 'https://www.linkedin.com/sales/lead/manual-review',
    },
    { dryRun: false },
  );

  assert.equal(result.status, 'manual_review');
  assert.equal(result.note, 'connect outcome could not be verified');
  assert.equal(result.driver, 'browser-harness');
});

test('hybrid driver requires mutation health for live mutation runs', async () => {
  class StubDriver extends DriverAdapter {
    constructor(health) {
      super();
      this.health = health;
      this.opened = false;
    }

    async openSession() {
      this.opened = true;
    }

    async checkSessionHealth() {
      return this.health;
    }

    async close() {}
  }

  const hybrid = new HybridSalesNavigatorDriver({
    allowMutations: true,
    discoveryDriver: new StubDriver({
      ok: true,
      authenticated: true,
      state: 'authenticated',
      mode: 'playwright',
      url: 'https://www.linkedin.com/sales/home',
    }),
    mutationDriver: new StubDriver({
      ok: false,
      authenticated: false,
      state: 'reauth_required',
      mode: 'browser-harness',
    }),
  });

  await hybrid.openSession({ runId: 'run-1', dryRun: false });
  const health = await hybrid.checkSessionHealth();

  assert.equal(health.ok, false);
  assert.equal(health.state, 'reauth_required');
  assert.equal(health.discovery.mode, 'playwright');
  assert.equal(health.mutation.mode, 'browser-harness');
});
