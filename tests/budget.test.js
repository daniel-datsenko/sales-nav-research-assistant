const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildConnectBudgetOperatorNotice,
  computeBudgetState,
  resolveConnectBudgetPolicy,
} = require('../src/core/budget');

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

test('buildConnectBudgetOperatorNotice explains normal pacing', () => {
  const notice = buildConnectBudgetOperatorNotice({
    budgetMode: 'assist',
    weeklyCap: 70,
    remainingThisWeek: 60,
    recommendedTodayLimit: 15,
    remainingToday: 12,
  }, {
    requestedCount: 8,
    label: 'lead list connect',
  });

  assert.equal(notice.cappedByDailyPacing, false);
  assert.equal(notice.exhausted, false);
  assert.match(notice.lines.join('\n'), /Connect pacing notice \(lead list connect\)/);
  assert.match(notice.lines.join('\n'), /within today's pacing/);
});

test('buildConnectBudgetOperatorNotice warns when a request exceeds daily pacing', () => {
  const notice = buildConnectBudgetOperatorNotice({
    budgetMode: 'assist',
    weeklyCap: 70,
    remainingThisWeek: 40,
    recommendedTodayLimit: 15,
    remainingToday: 5,
  }, {
    requestedCount: 20,
  });

  assert.equal(notice.cappedByDailyPacing, true);
  assert.equal(notice.exhausted, false);
  assert.match(notice.lines.join('\n'), /will cap at 5/);
  assert.match(notice.lines.join('\n'), /leaves fewer connects for later this week/);
});

test('buildConnectBudgetOperatorNotice marks exhausted budgets', () => {
  const notice = buildConnectBudgetOperatorNotice({
    budgetMode: 'assist',
    weeklyCap: 70,
    remainingThisWeek: 35,
    recommendedTodayLimit: 15,
    remainingToday: 0,
  }, {
    requestedCount: 3,
  });

  assert.equal(notice.cappedByDailyPacing, true);
  assert.equal(notice.exhausted, true);
  assert.match(notice.lines.join('\n'), /pacing is exhausted/);
});
