const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

class GTMBigQueryAdapter {
  constructor(options = {}) {
    this.options = {
      cliPath: options.cliPath || path.join(os.homedir(), '.claude', 'bin', 'gtm-data-api'),
      maxGb: options.maxGb || 20,
      execFileSyncImpl: options.execFileSyncImpl || execFileSync,
    };
  }

  query(sql, options = {}) {
    const maxGb = options.maxGb || this.options.maxGb;
    const commandArgs = ['bq', 'query', sql, '--max-gb', String(maxGb)];
    const output = this.options.execFileSyncImpl(this.options.cliPath, commandArgs, {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });

    return parseBigQueryRows(output);
  }

  queryFile(filePath, options = {}) {
    const sql = fs.readFileSync(filePath, 'utf8');
    return this.query(sql, options);
  }
}

function parseBigQueryRows(rawOutput) {
  const text = String(rawOutput || '').trim();
  const firstBracket = text.indexOf('[');
  if (firstBracket === -1) {
    return [];
  }

  const payload = JSON.parse(text.slice(firstBracket));
  return Array.isArray(payload) ? payload : [];
}

module.exports = {
  GTMBigQueryAdapter,
  parseBigQueryRows,
};
