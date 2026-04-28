const test = require('node:test');
const assert = require('node:assert/strict');

const { computeBudgetState, resolveConnectBudgetPolicy } = require('../src/core/budget');

test('computeBudgetState distributes remaining budget across business days', () => {
  const budget = computeBudgetState({
    weeklyCap: 140,
    sentThisWeek: 70,
    sentToday: 10,
    now: new Date('2026-04-15T10:00:00.000Z'),
  });

  assert.equal(budget.remainingThisWeek, 70);
  assert.equal(budget.recommendedTodayLimit, 24);
  assert.equal(budget.remainingToday, 14);
});

test('resolveConnectBudgetPolicy derives tool share from budget mode', () => {
  const policy = resolveConnectBudgetPolicy({
    weeklyCap: 140,
    budgetMode: 'assist',
  });

  assert.equal(policy.toolSharePercent, 50);
  assert.equal(policy.effectiveWeeklyCap, 70);
  assert.equal(policy.dailyMax, 15);
});

test('computeBudgetState respects daily max pacing', () => {
  const budget = computeBudgetState({
    weeklyCap: 112,
    sentThisWeek: 10,
    sentToday: 4,
    dailyMax: 20,
    budgetMode: 'balanced',
    toolSharePercent: 80,
    now: new Date('2026-04-13T10:00:00.000Z'),
  });

  assert.equal(budget.recommendedTodayLimit, 20);
  assert.equal(budget.remainingToday, 16);
});
