const crypto = require('node:crypto');

function randomId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function stableId(prefix, ...parts) {
  const value = parts.filter(Boolean).join('::');
  const digest = crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
  return `${prefix}-${digest}`;
}

module.exports = {
  randomId,
  stableId,
};
