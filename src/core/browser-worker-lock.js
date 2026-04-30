/**
 * In-process Browser Worker lock: serializes async browser-backed jobs for one LinkedIn session (v1).
 */

function createBrowserWorkerLock() {
  let tail = Promise.resolve();
  /** @type {Array<Record<string, unknown>>} */
  const telemetry = [];

  /**
   * @param {string} jobId
   * @param {() => Promise<unknown>} fn
   */
  async function runExclusive(jobId, fn) {
    const previous = tail;
    /** @type {(value?: unknown) => void} */
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    const startedAt = Date.now();
    let status = 'completed';
    try {
      return await fn();
    } catch (err) {
      status = 'failed';
      throw err;
    } finally {
      telemetry.push({
        jobId,
        startedAt,
        finishedAt: Date.now(),
        status,
      });
      release();
    }
  }

  function getTelemetry() {
    return [...telemetry];
  }

  return {
    runExclusive,
    getTelemetry,
  };
}

module.exports = {
  createBrowserWorkerLock,
};
