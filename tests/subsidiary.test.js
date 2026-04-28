const test = require('node:test');
const assert = require('node:assert/strict');

const { expandAccountGraph } = require('../src/core/subsidiary');

test('expandAccountGraph adds basic subsidiary nodes', () => {
  const accounts = [
    {
      accountId: 'acc-parent',
      name: 'Parent Co',
      priority: 10,
      subsidiaries: [
        {
          accountId: 'acc-child',
          name: 'Parent Co Germany',
          priority: 8,
        },
      ],
    },
  ];

  const expanded = expandAccountGraph(accounts, { enableBasicExpansion: true });
  assert.equal(expanded.length, 2);
  assert.equal(expanded[1].parentAccountId, 'acc-parent');
});
