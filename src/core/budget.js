const { getRemainingBusinessDaysInWeek } = require('../lib/time');

const DEFAULT_CONNECT_BUDGET_MODES = {
  assist: {
    budgetMode: 'assist',
    toolSharePercent: 50,
    dailyMax: 15,
  },
  balanced: {
    budgetMode: 'balanced',
    toolSharePercent: 80,
    dailyMax: 24,
  },
  'full-auto': {
    budgetMode: 'full-auto',
    toolSharePercent: 100,
    dailyMax: 30,
  },
};

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolveConnectBudgetPolicy({
  weeklyCap = 140,
  budgetMode = 'balanced',
  toolSharePercent = null,
  dailyMax = null,
  dailyMin = 0,
} = {}) {
  const basePolicy = DEFAULT_CONNECT_BUDGET_MODES[budgetMode] || DEFAULT_CONNECT_BUDGET_MODES.balanced;
  const resolvedShare = clampNumber(
    toolSharePercent !== null
      && toolSharePercent !== undefined
      && Number.isFinite(Number(toolSharePercent))
      ? Number(toolSharePercent)
      : basePolicy.toolSharePercent,
    0,
    100,
  );
  const resolvedDailyMax = dailyMax !== null
    && dailyMax !== undefined
    && Number.isFinite(Number(dailyMax))
    ? Math.max(0, Number(dailyMax))
    : basePolicy.dailyMax;
  const resolvedDailyMin = dailyMin !== null
    && dailyMin !== undefined
    && Number.isFinite(Number(dailyMin))
    ? Math.max(0, Number(dailyMin))
    : 0;
  const effectiveWeeklyCap = Math.max(0, Math.floor(Number(weeklyCap) * (resolvedShare / 100)));

  return {
    budgetMode: basePolicy.budgetMode,
    weeklyCap: Number(weeklyCap),
    toolSharePercent: resolvedShare,
    effectiveWeeklyCap,
    dailyMax: resolvedDailyMax,
    dailyMin: resolvedDailyMin,
  };
}

function computeBudgetState({
  weeklyCap,
  sentThisWeek,
  sentToday,
  now = new Date(),
  budgetMode = 'balanced',
  toolSharePercent = 100,
  dailyMax = null,
  dailyMin = 0,
}) {
  const remainingThisWeek = Math.max(0, weeklyCap - sentThisWeek);
  const daysRemaining = getRemainingBusinessDaysInWeek(now);
  let recommendedTodayLimit = Math.max(0, Math.ceil(remainingThisWeek / daysRemaining));
  if (dailyMax !== null && dailyMax !== undefined) {
    recommendedTodayLimit = Math.min(recommendedTodayLimit, Math.max(0, dailyMax));
  }
  if (dailyMin > 0 && remainingThisWeek > 0) {
    recommendedTodayLimit = Math.max(recommendedTodayLimit, dailyMin);
  }
  recommendedTodayLimit = Math.min(recommendedTodayLimit, remainingThisWeek);
  const remainingToday = Math.max(0, recommendedTodayLimit - sentToday);

  return {
    budgetMode,
    weeklyCap,
    toolSharePercent,
    sentThisWeek,
    remainingThisWeek,
    sentToday,
    daysRemaining,
    dailyMax,
    dailyMin,
    recommendedTodayLimit,
    remainingToday,
  };
}

module.exports = {
  DEFAULT_CONNECT_BUDGET_MODES,
  computeBudgetState,
  resolveConnectBudgetPolicy,
};
