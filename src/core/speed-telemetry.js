function nowMs(now = Date.now) {
  const value = typeof now === 'function' ? now() : now;
  const dateValue = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(dateValue) ? dateValue : Date.now();
}

function createRunTimings(now = Date.now) {
  const startedAtMs = nowMs(now);
  return {
    startedAtMs,
    endedAtMs: null,
    totalMs: 0,
    byPhase: {},
    events: [],
  };
}

function recordPhaseTiming(timings, phase, startedAtMs, endedAtMs, meta = {}) {
  if (!timings || !phase) {
    return null;
  }
  const durationMs = Math.max(0, Math.round(Number(endedAtMs || 0) - Number(startedAtMs || 0)));
  timings.byPhase[phase] = Math.round((timings.byPhase[phase] || 0) + durationMs);
  const event = {
    phase,
    durationMs,
    ...meta,
  };
  timings.events.push(event);
  return event;
}

async function timePhase(timings, phase, fn, options = {}) {
  const now = options.now || Date.now;
  const startedAtMs = nowMs(now);
  try {
    return await fn();
  } finally {
    recordPhaseTiming(timings, phase, startedAtMs, nowMs(now), options.meta || {});
  }
}

function finishRunTimings(timings, now = Date.now) {
  if (!timings) {
    return null;
  }
  timings.endedAtMs = nowMs(now);
  timings.totalMs = Math.max(0, Math.round(timings.endedAtMs - timings.startedAtMs));
  return {
    totalMs: timings.totalMs,
    byPhase: timings.byPhase,
  };
}

function summarizeSlowestSweeps(events = [], limit = 5) {
  return (events || [])
    .filter((event) => /^sweep:/i.test(event.phase || ''))
    .sort((left, right) => Number(right.durationMs || 0) - Number(left.durationMs || 0))
    .slice(0, Math.max(0, limit))
    .map((event) => ({
      templateId: event.templateId || event.phase.replace(/^sweep:/i, ''),
      durationMs: event.durationMs,
      cacheHit: Boolean(event.cacheHit),
      candidateCount: Number(event.candidateCount || 0),
      errorCategory: event.errorCategory || null,
    }));
}

module.exports = {
  createRunTimings,
  finishRunTimings,
  nowMs,
  recordPhaseTiming,
  summarizeSlowestSweeps,
  timePhase,
};
