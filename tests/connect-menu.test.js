const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeConnectMenuLabel,
  classifyConnectMenuActionLabel,
  isConnectMenuActionLabel,
} = require('../src/core/connect-menu');

test('normalizeConnectMenuLabel collapses whitespace', () => {
  assert.equal(normalizeConnectMenuLabel('  Invite   to   connect  '), 'Invite to connect');
});

test('isConnectMenuActionLabel matches broader connect phrasing', () => {
  assert.equal(isConnectMenuActionLabel('Invite Asko Tamm to connect'), true);
  assert.equal(isConnectMenuActionLabel('Mit Asko Tamm vernetzen'), true);
  assert.equal(isConnectMenuActionLabel('Einladen'), true);
});

test('isConnectMenuActionLabel rejects other visible menu actions', () => {
  assert.equal(isConnectMenuActionLabel('Send message'), false);
  assert.equal(isConnectMenuActionLabel('Save to list'), false);
  assert.equal(isConnectMenuActionLabel('Remove from list'), false);
});

test('classifyConnectMenuActionLabel tracks pending connect variants without treating unrelated sent text as connect', () => {
  assert.deepEqual(classifyConnectMenuActionLabel('Invite Asko Tamm to connect'), {
    normalized: 'invite asko tamm to connect',
    isConnectAction: true,
    isPendingAction: false,
  });
  assert.deepEqual(classifyConnectMenuActionLabel('Connect — Pending'), {
    normalized: 'connect — pending',
    isConnectAction: true,
    isPendingAction: true,
  });
  assert.deepEqual(classifyConnectMenuActionLabel('Invitation sent'), {
    normalized: 'invitation sent',
    isConnectAction: false,
    isPendingAction: false,
  });
});
