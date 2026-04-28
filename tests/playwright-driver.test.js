const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDriverOptions } = require('../src/lib/driver-options');
const {
  PlaywrightSalesNavigatorDriver,
  buildBrowserProcessEnv,
  buildCompanyFilterTargets,
  buildLinkedInCompanyUrlAliases,
  classifyConnectSurfaceDiagnostic,
  classifyConnectSurfaceInspectionError,
  classifyLeadDetailSnapshot,
  classifyNoButtonConnectState,
  classifyPostClickConnectLabel,
  clickVisibleListRow,
  collectVisibleActionDescriptors,
  ensurePeopleSearchHasExpandedFilters,
  findListNameInput,
  findSemanticConnectMenuControl,
  findSaveToListButton,
  findVisibleActionControl,
  classifyOverflowConnectMenuItems,
  readConnectUnavailableContext,
  readConnectState,
  jitteredWait,
  normalizeActionLabel,
  detectRateLimit,
  cleanCompanyFilterSuggestionLabel,
  summarizeSweepPageProgress,
  scoreCompanyFilterCandidate,
  summarizeDuplicateSweepPage,
} = require('../src/drivers/playwright-sales-nav');

function createSessionHealthPage({
  url,
  pageTitle = 'Sales Navigator',
  bodyText = '',
  visibleSelectors = [],
  gotoCalls = [],
}) {
  const visible = new Set(visibleSelectors);

  return {
    url() {
      return url;
    },
    async title() {
      return pageTitle;
    },
    async goto(targetUrl) {
      gotoCalls.push(targetUrl);
      throw new Error(`Unexpected navigation to ${targetUrl}`);
    },
    locator(selector) {
      return {
        async innerText() {
          return selector === 'body' ? bodyText : '';
        },
        first() {
          return {
            async isVisible() {
              return visible.has(selector);
            },
          };
        },
      };
    },
  };
}

test('buildDriverOptions defaults to persistent steady-state config for live runs', () => {
  const options = buildDriverOptions({}, { dryRun: false }, { sessionMode: 'persistent', headless: true });
  assert.equal(options.sessionMode, 'persistent');
  assert.ok(options.userDataDir.includes('runtime'));
  assert.ok(options.storageState.includes('runtime'));
  assert.equal(options.headless, true);
  assert.equal(options.allowMutations, true);
  assert.equal(options.allowListCreate, false);
  assert.equal(options.recoveryMode, 'screenshot-only');
});

test('playwright driver uses provided session mode and preserves options', () => {
  const driver = new PlaywrightSalesNavigatorDriver({
    sessionMode: 'persistent',
    userDataDir: '/tmp/profile-dir',
    headless: true,
    maxScrollSteps: 7,
  });

  assert.equal(driver.options.sessionMode, 'persistent');
  assert.equal(driver.options.userDataDir, '/tmp/profile-dir');
  assert.equal(driver.options.headless, true);
  assert.equal(driver.options.maxScrollSteps, 7);
});

test('playwright driver defaults live connect pacing and spinner recovery guards', () => {
  const driver = new PlaywrightSalesNavigatorDriver();

  assert.equal(driver.options.connectAttemptPacingMs, 3000);
  assert.equal(driver.options.connectCacheFlushEvery, 3);
  assert.equal(driver.options.spinnerReloadWaitUntil, 'networkidle');
});

test('checkSessionHealth reads login state without navigating away from the current page', async () => {
  const gotoCalls = [];
  const driver = new PlaywrightSalesNavigatorDriver({
    sessionMode: 'persistent',
    userDataDir: '/tmp/profile-dir',
    headless: false,
  });
  driver.page = createSessionHealthPage({
    url: 'https://www.linkedin.com/sales/login',
    pageTitle: 'LinkedIn Login',
    gotoCalls,
  });

  const health = await driver.checkSessionHealth();

  assert.deepEqual(gotoCalls, []);
  assert.equal(health.ok, false);
  assert.equal(health.state, 'reauth_required');
  assert.equal(health.url, 'https://www.linkedin.com/sales/login');
  assert.equal(health.pageTitle, 'LinkedIn Login');
});

test('checkSessionHealth does not treat a non-LinkedIn blank page body as authenticated', async () => {
  const gotoCalls = [];
  const driver = new PlaywrightSalesNavigatorDriver({
    sessionMode: 'persistent',
    userDataDir: '/tmp/profile-dir',
    headless: true,
  });
  driver.page = createSessionHealthPage({
    url: 'about:blank',
    bodyText: 'blank local browser page',
    visibleSelectors: ['body'],
    gotoCalls,
  });

  const health = await driver.checkSessionHealth();

  assert.deepEqual(gotoCalls, []);
  assert.equal(health.ok, false);
  assert.equal(health.authenticated, false);
  assert.equal(health.state, 'blocked');
});

test('detectRateLimit reads LinkedIn rate-limit indicators from title and body', async () => {
  const bodyLimitedPage = {
    async title() {
      return 'Sales Navigator';
    },
    locator(selector) {
      return {
        async innerText() {
          return selector === 'body' ? 'Too many requests. Try later.' : '';
        },
      };
    },
  };
  const titleLimitedPage = {
    async title() {
      return 'Too Many Requests';
    },
    locator() {
      return {
        async innerText() {
          return 'Normal body';
        },
      };
    },
  };
  const normalPage = {
    async title() {
      return 'Sales Navigator';
    },
    locator() {
      return {
        async innerText() {
          return 'Lead results are visible';
        },
      };
    },
  };

  assert.equal(await detectRateLimit(bodyLimitedPage), true);
  assert.equal(await detectRateLimit(titleLimitedPage), true);
  assert.equal(await detectRateLimit(normalPage), false);
});

test('playwright driver backs off once and resumes after transient rate limit', async () => {
  const waits = [];
  let bodyText = 'Too many requests. Try later.';
  const driver = new PlaywrightSalesNavigatorDriver({
    rateLimitBackoffMs: 25,
    settleMs: 0,
    humanize: false,
  });
  driver.page = {
    async title() {
      return 'Sales Navigator';
    },
    locator() {
      return {
        async innerText() {
          return bodyText;
        },
      };
    },
    async waitForTimeout(ms) {
      waits.push(ms);
    },
    async reload() {
      bodyText = 'Lead results are visible';
    },
  };
  const events = [];
  const warnings = [];

  const result = await driver.handleRateLimitBackoff({
    rateLimitEvents: events,
    logger: {
      warn(message) {
        warnings.push(message);
      },
    },
  });

  assert.equal(result.rateLimited, true);
  assert.equal(result.recovered, true);
  assert.equal(events[0].backoffMs, 25);
  assert.ok(waits.includes(25));
  assert.match(warnings[0], /rate-limit detected/i);
});

test('buildCompanyFilterTargets prioritizes account list and adds useful company variants', () => {
  const targets = buildCompanyFilterTargets({
    name: 'Bosch Rexroth SE',
    parentAccountName: 'Bosch',
    salesNav: {
      accountListName: 'East Europe Assigned',
      companyFilterName: 'Bosch Rexroth SE',
      companyFilterAliases: ['Bosch Rexroth', 'Bosch Rexroth AG'],
    },
  });

  assert.deepEqual(targets, [
    'East Europe Assigned',
    'Bosch Rexroth SE',
    'Bosch Rexroth',
    'Bosch Rexroth AG',
    'Bosch',
  ]);
});

test('buildCompanyFilterTargets derives aliases from LinkedIn company URLs', () => {
  const targets = buildCompanyFilterTargets({
    name: 'Example Media Group Germany',
    salesNav: {
      linkedinCompanyUrls: [
        'https://www.linkedin.com/company/example-media-germany',
        'https://ch.linkedin.com/company/example-logistics?trk=public_profile',
      ],
    },
  });

  assert.ok(targets.includes('example media germany'));
  assert.ok(targets.includes('example logistics'));
  assert.ok(targets.includes('Example Media Group Germany'));
});

test('buildCompanyFilterTargets adds a safe variant for malformed parenthetical names', () => {
  const targets = buildCompanyFilterTargets({
    name: 'Limango Polska (A member of the Example Retail Group',
  });

  assert.ok(targets.includes('Limango Polska (A member of the Example Retail Group'));
  assert.ok(targets.includes('Limango Polska'));
});

test('buildLinkedInCompanyUrlAliases ignores malformed URLs', () => {
  assert.deepEqual(buildLinkedInCompanyUrlAliases([
    'not-a-url',
    'https://www.linkedin.com/company/example-media-germany',
    'https://www.linkedin.com/in/not-company',
  ]), ['example media germany']);
});

test('scoreCompanyFilterCandidate rejects weak subsidiary or homonym partial matches', () => {
  const wrongSubsidiary = scoreCompanyFilterCandidate('Acme France SARL', 'Acme', {
    hasIncludeButton: true,
  });
  const exactTarget = scoreCompanyFilterCandidate('Example Mobility GmbH', 'Example Mobility', {
    hasIncludeButton: true,
  });

  assert.equal(wrongSubsidiary.safeToSelect, false);
  assert.equal(wrongSubsidiary.matchType, 'starts_with');
  assert.equal(exactTarget.safeToSelect, true);
  assert.ok(exactTarget.confidence >= 0.7);
});

test('scoreCompanyFilterCandidate ignores include exclude action text in suggestion labels', () => {
  assert.equal(cleanCompanyFilterSuggestionLabel('Example Marketplace A Include Exclude'), 'Example Marketplace A');
  assert.equal(cleanCompanyFilterSuggestionLabel('Example SaaS Marketplace Einschließen Ausschließen'), 'Example SaaS Marketplace');

  const exampleMarketplaceA = scoreCompanyFilterCandidate('Example Marketplace A Include Exclude', 'Example Marketplace A', {
    hasIncludeButton: true,
  });
  const exampleSaasMarketplace = scoreCompanyFilterCandidate('Example SaaS Marketplace Einschließen Ausschließen', 'Example SaaS Marketplace', {
    hasIncludeButton: true,
  });

  assert.equal(exampleMarketplaceA.safeToSelect, true);
  assert.equal(exampleMarketplaceA.matchType, 'exact');
  assert.ok(exampleMarketplaceA.confidence >= 0.7);
  assert.equal(exampleSaasMarketplace.safeToSelect, true);
  assert.equal(exampleSaasMarketplace.matchType, 'exact');
});

test('summarizeDuplicateSweepPage detects duplicate-heavy first pages', () => {
  const seenCandidateKeys = new Set([
    'https://www.linkedin.com/sales/lead/a',
    'https://www.linkedin.com/sales/lead/b',
    'https://www.linkedin.com/sales/lead/c',
    'https://www.linkedin.com/sales/lead/d',
  ]);
  const summary = summarizeDuplicateSweepPage([
    { salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/a?_ntb=1' },
    { salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/b' },
    { salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/c' },
    { salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/d' },
    { salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/new' },
  ], seenCandidateKeys, 0.8);

  assert.equal(summary.totalCount, 5);
  assert.equal(summary.duplicateCount, 4);
  assert.equal(summary.duplicateRatio, 0.8);
  assert.equal(summary.shouldShortCircuit, true);
});

test('summarizeSweepPageProgress marks duplicate-heavy and empty first pages as early exits', () => {
  const duplicate = summarizeSweepPageProgress({
    candidates: [
      { salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/a' },
      { salesNavigatorUrl: 'https://www.linkedin.com/sales/lead/b' },
    ],
    seenCandidateKeys: new Set([
      'https://www.linkedin.com/sales/lead/a',
      'https://www.linkedin.com/sales/lead/b',
    ]),
    threshold: 0.8,
    step: 0,
    templateId: 'sweep-engineering',
  });
  const empty = summarizeSweepPageProgress({
    candidates: [],
    seenCandidateKeys: new Set(),
    threshold: 0.8,
    step: 0,
    templateId: 'sweep-empty',
  });

  assert.equal(duplicate.shouldShortCircuit, true);
  assert.equal(duplicate.exitReason, 'duplicate_overlap');
  assert.match(duplicate.logMessage, /early exit: 100% overlap/);
  assert.equal(empty.shouldShortCircuit, true);
  assert.equal(empty.exitReason, 'empty_first_page');
  assert.match(empty.logMessage, /early exit: empty first page/);
});

test('jitteredWait stays near the base timing window', () => {
  const value = jitteredWait(400);
  assert.ok(value >= 320);
  assert.ok(value <= 520);
});

test('buildBrowserProcessEnv keeps browser state inside the local runtime home', () => {
  const env = buildBrowserProcessEnv('/tmp/sales-nav-browser-home');

  assert.equal(env.HOME, '/tmp/sales-nav-browser-home');
  assert.equal(env.XDG_CONFIG_HOME, '/tmp/sales-nav-browser-home/.config');
  assert.equal(env.XDG_CACHE_HOME, '/tmp/sales-nav-browser-home/.cache');
});

test('ensurePeopleSearchHasExpandedFilters forces the expanded people-search view', () => {
  const url = ensurePeopleSearchHasExpandedFilters('https://www.linkedin.com/sales/search/people?keywords=platform');

  assert.equal(
    url,
    'https://www.linkedin.com/sales/search/people?keywords=platform&viewAllFilters=true',
  );
});

test('playwright driver enumerates account resolution method when provided options are used', async () => {
  const driver = new PlaywrightSalesNavigatorDriver({
    sessionMode: 'persistent',
    userDataDir: '/tmp/profile-dir',
    headless: true,
  });

  assert.equal(typeof driver.enumerateAccounts, 'function');
});

test('playwright driver exports live-save helpers for current LinkedIn list flows', () => {
  assert.equal(typeof findSaveToListButton, 'function');
  assert.equal(typeof findListNameInput, 'function');
  assert.equal(typeof clickVisibleListRow, 'function');
});

test('classifyLeadDetailSnapshot detects spinner-only lead shells', () => {
  const state = classifyLeadDetailSnapshot({
    title: 'Sales Navigator',
    bodyText: '',
    leadMarkerCount: 0,
    hasSaveOrConnectControls: false,
    hasSpinnerShell: true,
  }, {
    fullName: 'Darius Štukėnas',
  });

  assert.equal(state.isHydrated, false);
  assert.equal(state.isSpinnerOnlyShell, true);
});

test('classifyLeadDetailSnapshot accepts hydrated lead pages with matching content', () => {
  const state = classifyLeadDetailSnapshot({
    title: 'Sales Navigator',
    bodyText: 'Darius Štukėnas IT infrastructure manager, Baltics Save Connect Lithuania observability platform owner profile experience infrastructure cloud platform architecture engineering monitoring reliability systems operations security delivery leadership enterprise technology software services data center automation SRE Kubernetes telemetry product owner team lead.',
    leadMarkerCount: 2,
    hasSaveOrConnectControls: true,
    hasSpinnerShell: false,
  }, {
    fullName: 'Darius Štukėnas',
  });

  assert.equal(state.isHydrated, true);
  assert.equal(state.isSpinnerOnlyShell, false);
});


function createActionScope(actions) {
  return {
    locator(selector) {
      assert.equal(selector, 'button,[role="button"],[role="menuitem"],a');
      return {
        async count() {
          return actions.length;
        },
        nth(index) {
          const action = actions[index] || {};
          return {
            async isVisible() {
              return action.visible !== false;
            },
            async innerText() {
              return action.text || '';
            },
            async getAttribute(name) {
              return name === 'aria-label' ? (action.aria || '') : '';
            },
          };
        },
      };
    },
  };
}

function createConnectStatePage({ bodyText = '', controlState = {} } = {}) {
  return {
    locator(selector) {
      return {
        async innerText() {
          return selector === 'body' ? bodyText : '';
        },
      };
    },
    async evaluate() {
      return {
        hasPendingConnectControl: false,
        hasConnectedControl: false,
        hasRestrictedConnect: false,
        ...controlState,
      };
    },
  };
}

test('normalizeActionLabel collapses whitespace for visible-action matching', () => {
  assert.equal(normalizeActionLabel('  Invite\n  Asko   Tamm  '), 'Invite Asko Tamm');
});


test('collectVisibleActionDescriptors captures visible text and aria labels for dry diagnostics', async () => {
  const actions = await collectVisibleActionDescriptors(createActionScope([
    { text: ' Message  ' },
    { aria: ' Invite Asko Tamm ' },
    { text: 'Hidden', visible: false },
  ]));

  assert.deepEqual(actions, [
    { text: 'Message', aria: '' },
    { text: '', aria: 'Invite Asko Tamm' },
  ]);
});

test('findVisibleActionControl detects aria-labeled invite controls when button selectors miss', async () => {
  const control = await findVisibleActionControl(createActionScope([
    { text: 'Message' },
    { aria: 'Invite Asko Tamm' },
  ]), [
    /^invite(?:\b|\s.+)$/i,
  ]);

  assert.ok(control);
  assert.equal(await control.getAttribute('aria-label'), 'Invite Asko Tamm');
});

test('findVisibleActionControl ignores unrelated visible actions', async () => {
  const control = await findVisibleActionControl(createActionScope([
    { text: 'Message' },
    { text: 'Follow' },
  ]), [
    /^connect$/i,
    /^invite(?:\b|\s.+)$/i,
  ]);

  assert.equal(control, null);
});

test('findVisibleActionControl can match aria labels even when visible text is generic', async () => {
  const control = await findVisibleActionControl(createActionScope([
    { text: 'More', aria: 'Invite Asko Tamm' },
  ]), [
    /^invite(?:\b|\s.+)$/i,
  ]);

  assert.ok(control);
  assert.equal(await control.innerText(), 'More');
  assert.equal(await control.getAttribute('aria-label'), 'Invite Asko Tamm');
});

test('findSemanticConnectMenuControl detects semantic connect menu entries', async () => {
  const control = await findSemanticConnectMenuControl(createActionScope([
    { text: 'Message' },
    { text: 'Connect' },
    { text: 'Remove from list' },
  ]));

  assert.ok(control);
  assert.equal(await control.innerText(), 'Connect');
});

test('findSemanticConnectMenuControl ignores non-connect menu entries', async () => {
  const control = await findSemanticConnectMenuControl(createActionScope([
    { text: 'Message' },
    { text: 'Remove from list' },
    { text: 'Copy LinkedIn.com URL' },
  ]));

  assert.equal(control, null);
});


test('classifyOverflowConnectMenuItems detects named invite actions and pending states from text or aria labels', () => {
  assert.deepEqual(classifyOverflowConnectMenuItems([
    { text: 'Message', aria: '' },
    { text: 'Invite Asko Tamm to connect', aria: '' },
  ]), {
    hasPendingConnect: false,
    hasConnectAction: true,
  });

  assert.deepEqual(classifyOverflowConnectMenuItems([
    { text: 'More', aria: 'Connect — Pending' },
  ]), {
    hasPendingConnect: true,
    hasConnectAction: true,
  });

  assert.deepEqual(classifyOverflowConnectMenuItems([
    { text: 'Send message', aria: '' },
    { text: 'Remove from list', aria: '' },
  ]), {
    hasPendingConnect: false,
    hasConnectAction: false,
  });
});

test('classifyPostClickConnectLabel recognizes pending and connected visible-action states', () => {
  assert.equal(classifyPostClickConnectLabel('Pending'), 'pending');
  assert.equal(classifyPostClickConnectLabel('Connect — Pending'), 'pending');
  assert.equal(classifyPostClickConnectLabel('Invitation sent'), 'pending');
  assert.equal(classifyPostClickConnectLabel('Already connected'), 'connected');
  assert.equal(classifyPostClickConnectLabel('Vernetzt'), 'connected');
  assert.equal(classifyPostClickConnectLabel('Connect'), 'unknown');
});

test('readConnectState treats post-click pending controls as a sent/pending signal', async () => {
  const state = await readConnectState(createConnectStatePage({
    bodyText: 'Example Saved Lead Head of Platform LinkedIn Sales Navigator profile details rendered',
    controlState: {
      hasPendingConnectControl: true,
    },
  }));

  assert.equal(state.hasRenderableLeadPage, true);
  assert.equal(state.hasPendingConnectControl, true);
});

test('classifyNoButtonConnectState converts overflow pending states into already_sent', () => {
  assert.deepEqual(classifyNoButtonConnectState({
    hasPendingConnect: true,
    hasConnectAction: true,
  }), {
    status: 'already_sent',
    note: 'invitation already pending',
    driver: 'playwright',
  });

  assert.equal(classifyNoButtonConnectState({
    hasPendingConnect: false,
    hasConnectAction: true,
  }), null);
});

test('classifyNoButtonConnectState separates structural unavailable profiles from retryable render failures', () => {
  assert.deepEqual(classifyNoButtonConnectState({
    hasPendingConnect: false,
    hasConnectAction: false,
  }, {
    hasThirdDegree: true,
    hasRestrictedConnect: false,
  }), {
    status: 'connect_unavailable',
    reason: 'structural_3rd_degree',
    note: 'connect unavailable because lead appears to be 3rd-degree or out of network',
    driver: 'playwright',
  });

  assert.equal(classifyNoButtonConnectState({
    hasPendingConnect: false,
    hasConnectAction: false,
  }, {
    hasThirdDegree: false,
    hasRestrictedConnect: false,
    hasRenderableLeadPage: true,
  }), null);
});

test('readConnectUnavailableContext detects restricted or 3rd-degree profile context', async () => {
  const context = await readConnectUnavailableContext(createConnectStatePage({
    bodyText: 'Example Restricted Lead 3rd degree profile outside your network',
    controlState: {
      hasRestrictedConnect: true,
    },
  }));

  assert.equal(context.hasThirdDegree, true);
  assert.equal(context.hasRestrictedConnect, true);
});

test('classifyConnectSurfaceInspectionError normalizes spinner-shell and generic open failures', () => {
  assert.deepEqual(
    classifyConnectSurfaceInspectionError({
      code: 'LEAD_PAGE_SPINNER_STUCK',
      message: 'Lead page stuck on spinner shell for Darius Štukėnas',
    }),
    {
      code: 'LEAD_PAGE_SPINNER_STUCK',
      classification: 'spinner_shell',
      message: 'Lead page stuck on spinner shell for Darius Štukėnas',
    },
  );

  assert.deepEqual(
    classifyConnectSurfaceInspectionError({
      message: 'Navigation failed',
    }),
    {
      code: null,
      classification: 'open_failed',
      message: 'Navigation failed',
    },
  );
});

test('classifyConnectSurfaceDiagnostic distinguishes pending, overflow-only, visible-primary, and spinner-shell cases', () => {
  assert.equal(classifyConnectSurfaceDiagnostic({
    initialState: { hasInvitationSent: false, hasConnectedMessage: false, hasRenderableLeadPage: true },
    inspectionError: null,
    visibleActions: [],
    overflowClassification: { hasPendingConnect: true, hasConnectAction: true },
  }), 'already_covered_pending');

  assert.equal(classifyConnectSurfaceDiagnostic({
    initialState: { hasInvitationSent: false, hasConnectedMessage: false, hasRenderableLeadPage: true },
    inspectionError: null,
    visibleActions: [],
    overflowClassification: { hasPendingConnect: false, hasConnectAction: true },
  }), 'overflow_only_connect');

  assert.equal(classifyConnectSurfaceDiagnostic({
    initialState: { hasInvitationSent: false, hasConnectedMessage: false, hasRenderableLeadPage: true },
    inspectionError: null,
    visibleActions: [{ text: 'Connect', aria: '' }],
    overflowClassification: { hasPendingConnect: false, hasConnectAction: false },
  }), 'visible_primary_connect');

  assert.equal(classifyConnectSurfaceDiagnostic({
    initialState: { hasInvitationSent: false, hasConnectedMessage: false, hasRenderableLeadPage: true },
    inspectionError: { classification: 'spinner_shell' },
    visibleActions: [],
    overflowClassification: { hasPendingConnect: false, hasConnectAction: false },
  }), 'manual_review_spinner_shell');
});
