function createLogger(scope) {
  const prefix = scope ? `[${scope}]` : '';

  return {
    info(message, extra) {
      console.log(`${prefix} ${message}`.trim(), extra || '');
    },
    warn(message, extra) {
      console.warn(`${prefix} WARN: ${message}`.trim(), extra || '');
    },
    error(message, extra) {
      console.error(`${prefix} ERROR: ${message}`.trim(), extra || '');
    },
  };
}

module.exports = {
  createLogger,
};
