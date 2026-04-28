function toIso(date = new Date()) {
  return new Date(date).toISOString();
}

function getIsoWeekday(date = new Date()) {
  const day = new Date(date).getUTCDay();
  return day === 0 ? 7 : day;
}

function getRemainingBusinessDaysInWeek(date = new Date()) {
  const weekday = getIsoWeekday(date);
  if (weekday > 5) {
    return 1;
  }

  return Math.max(1, 6 - weekday);
}

function getWeekWindow(date = new Date()) {
  const current = new Date(date);
  const weekday = getIsoWeekday(current);
  current.setUTCHours(0, 0, 0, 0);

  const weekStart = new Date(current);
  weekStart.setUTCDate(current.getUTCDate() - (weekday - 1));

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

  return {
    weekStart: weekStart.toISOString(),
    weekEnd: weekEnd.toISOString(),
  };
}

function getDayWindow(date = new Date()) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);

  return {
    dayStart: start.toISOString(),
    dayEnd: end.toISOString(),
  };
}

module.exports = {
  toIso,
  getIsoWeekday,
  getRemainingBusinessDaysInWeek,
  getWeekWindow,
  getDayWindow,
};
