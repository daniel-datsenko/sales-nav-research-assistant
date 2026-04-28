const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { computeBudgetState, resolveConnectBudgetPolicy } = require('../core/budget');
const { buildCoverageSummary } = require('../core/coverage');
const { resolveProjectPath, PRIORITY_ARTIFACTS_DIR } = require('../lib/paths');
const { loadPersonaModes } = require('../core/persona-modes');

function createDashboardServer({ repository, port = 4310, host = '127.0.0.1' }) {
  const assetsDir = path.join(__dirname, 'assets');

  const server = http.createServer(async (req, res) => {
    if (!isLoopbackRequest(req.socket?.remoteAddress)) {
      return sendJson(res, { error: 'Forbidden' }, 403);
    }

    const url = new URL(req.url, `http://localhost:${port}`);

    if (req.method === 'GET' && url.pathname === '/') {
      return sendFile(res, path.join(assetsDir, 'dashboard.html'), 'text/html');
    }

    if (req.method === 'GET' && url.pathname === '/dashboard.css') {
      return sendFile(res, path.join(assetsDir, 'dashboard.css'), 'text/css');
    }

    if (req.method === 'GET' && url.pathname === '/dashboard.js') {
      return sendFile(res, path.join(assetsDir, 'dashboard.js'), 'application/javascript');
    }

    if (req.method === 'GET' && url.pathname === '/api/summary') {
      const policy = resolveConnectBudgetPolicy({ weeklyCap: 140, budgetMode: 'balanced' });
      const rawBudget = repository.getBudgetState(policy.effectiveWeeklyCap);
      const budget = computeBudgetState({
        weeklyCap: rawBudget.weeklyCap,
        sentThisWeek: rawBudget.weekCount,
        sentToday: rawBudget.dayCount,
        budgetMode: policy.budgetMode,
        toolSharePercent: policy.toolSharePercent,
        dailyMax: policy.dailyMax,
        dailyMin: policy.dailyMin,
      });

      return sendJson(res, {
        ...repository.getDashboardSummary(),
        budget,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/candidates') {
      return sendJson(res, repository.getDashboardCandidates(150));
    }

    if (req.method === 'GET' && url.pathname === '/api/approvals') {
      return sendJson(res, repository.getApprovalQueue(150));
    }

    if (req.method === 'GET' && url.pathname === '/api/run-accounts') {
      return sendJson(
        res,
        repository.getRunAccountsForDashboard(150).map(sanitizeRunAccountForDashboard),
      );
    }

    if (req.method === 'GET' && url.pathname === '/api/coverage') {
      const runAccounts = repository.getRunAccountsForDashboard(150);
      const candidates = repository.getDashboardCandidates(500);
      const buyerGroupRoles = loadBuyerGroupRoles();
      return sendJson(res, buildCoverageSummary({ runAccounts, candidates, buyerGroupRoles }));
    }

    if (req.method === 'GET' && url.pathname === '/api/modes') {
      return sendJson(res, loadPersonaModes(resolveProjectPath('config', 'modes', 'default.json')));
    }

    if (req.method === 'GET' && url.pathname === '/api/recovery') {
      return sendJson(
        res,
        repository.getRecoveryEvents(100).map(sanitizeRecoveryEventForDashboard),
      );
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/approval/')) {
      const approvalId = url.pathname.split('/').pop();
      const body = await readRequestJson(req);
      repository.updateApprovalState(approvalId, body.state, body.reviewerNote || null);
      return sendJson(res, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/run-account/retry') {
      const body = await readRequestJson(req);
      repository.retryRunAccount(body.runId, body.accountKey);
      return sendJson(res, { ok: true });
    }

    sendJson(res, { error: 'Not found' }, 404);
  });

  return {
    listen() {
      return new Promise((resolve) => {
        server.listen(port, host, () => resolve(server));
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function loadBuyerGroupRoles() {
  const artifactPath = path.join(PRIORITY_ARTIFACTS_DIR, 'priority_score_v1.json');
  const fallbackPath = resolveProjectPath('config', 'priority-score', 'default.json');
  const sourcePath = fs.existsSync(artifactPath) ? artifactPath : fallbackPath;

  try {
    const parsed = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
    return parsed.buyerGroupRoles || {};
  } catch {
    return {};
  }
}

function isLoopbackRequest(remoteAddress) {
  if (!remoteAddress) {
    return false;
  }

  return remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1';
}

function sendJson(res, payload, statusCode = 200) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...buildSecurityHeaders(),
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendFile(res, filePath, contentType) {
  const content = fs.readFileSync(filePath, 'utf8');
  res.writeHead(200, {
    'Content-Type': contentType,
    ...buildSecurityHeaders(),
  });
  res.end(content);
}

function buildSecurityHeaders() {
  return {
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  };
}

function sanitizeRunAccountForDashboard(account) {
  return {
    ...account,
    lastError: sanitizeErrorText(account.lastError || null),
  };
}

function sanitizeRecoveryEventForDashboard(event) {
  return {
    ...event,
    details: sanitizeDashboardValue(event.details || {}),
  };
}

function sanitizeDashboardValue(value) {
  if (Array.isArray(value)) {
    return value.slice(0, 10).map(sanitizeDashboardValue);
  }

  if (!value || typeof value !== 'object') {
    return typeof value === 'string'
      ? sanitizeErrorText(value)
      : value;
  }

  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    result[key] = sanitizeDashboardField(key, raw);
  }
  return result;
}

function sanitizeDashboardField(key, value) {
  const normalizedKey = String(key).toLowerCase();

  if (normalizedKey.includes('token')
    || normalizedKey.includes('auth')
    || normalizedKey.includes('cookie')
    || normalizedKey.includes('header')) {
    return '[redacted]';
  }

  if (normalizedKey.endsWith('path')
    || normalizedKey.includes('screenshot')
    || normalizedKey.includes('htmlpath')
    || normalizedKey.includes('textpath')) {
    return value ? `[stored locally: ${path.basename(String(value))}]` : null;
  }

  if (typeof value === 'string') {
    return sanitizeErrorText(value);
  }

  if (Array.isArray(value) || (value && typeof value === 'object')) {
    return sanitizeDashboardValue(value);
  }

  return value;
}

function sanitizeErrorText(value) {
  if (!value || typeof value !== 'string') {
    return value || null;
  }

  const collapsed = value.replace(/\s+/g, ' ').trim();
  const withoutPaths = collapsed.replace(/\/Users\/[^\s]+/g, '[path]');
  const withoutBearer = withoutPaths.replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [redacted]');
  const withoutSecrets = withoutBearer.replace(/(access(token)?|auth(header)?|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]');

  return withoutSecrets.length > 240
    ? `${withoutSecrets.slice(0, 237)}...`
    : withoutSecrets;
}

function readRequestJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

module.exports = {
  buildSecurityHeaders,
  createDashboardServer,
  isLoopbackRequest,
  sanitizeErrorText,
  sanitizeRecoveryEventForDashboard,
  sanitizeRunAccountForDashboard,
};
