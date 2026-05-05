const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { DriverAdapter } = require('./driver-adapter');
const { classifyConnectMenuActionLabel } = require('../core/connect-menu');
const { limitCandidatesByTemplate, normalizeCandidateLimit } = require('../core/candidate-limits');
const { isSalesNavigatorLeadUrl } = require('../lib/live-readiness');

const SALES_HOME_URL = 'https://www.linkedin.com/sales/home';
const MIN_COMPANY_FILTER_CONFIDENCE = 0.7;

const DEFAULT_SELECTORS = {
  peopleSearchPageMarkers: [
    'main[role="main"]',
    '[data-x-search-results-page]',
    '[data-view-name*="search-results"]',
  ],
  keywordInputs: [
    'input[placeholder="Keywords für Suche"]',
    'input[placeholder="Search keywords"]',
    'input[placeholder*="Keywords"]',
    'input[aria-label*="Keywords"]',
  ],
  currentCompanyFilterButtons: [
    'button:has-text("Aktuelles Unternehmen")',
    'button:has-text("Current company")',
    'button[aria-label*="Aktuelles Unternehmen"]',
    'button[aria-label*="Current company"]',
  ],
  accountFiltersButtons: [
    'button:has-text("Account filters")',
    'button:has-text("Account-Filter")',
    'button[aria-label*="Account filters"]',
    'button[aria-label*="Account-Filter"]',
  ],
  leadFiltersButtons: [
    'button:has-text("Lead filters")',
    'button:has-text("Lead-Filter")',
    'button[aria-label*="Lead filters"]',
    'button[aria-label*="Lead-Filter"]',
  ],
  allFiltersButtons: [
    'button:has-text("View all filters")',
    'button:has-text("Alle Filter")',
    'a[href*="viewAllFilters=true"]',
  ],
  currentCompanyInputs: [
    'input[placeholder="Aktuelle Unternehmen und Account-Listen hinzufügen"]',
    'input[placeholder="Add current companies and account lists"]',
    'input[aria-label*="Aktuelle Unternehmen"]',
    'input[aria-label*="Current companies"]',
  ],
  currentCompanySuggestionRows: [
    '.artdeco-typeahead__result',
    '[data-test-typeahead-result]',
  ],
  accountResultLinks: [
    'a[href*="/sales/company/"]',
  ],
  accountPeopleLinks: [
    'a[href*="/sales/search/people"]',
    'a:has-text("People")',
    'a:has-text("Personen")',
  ],
  includeButtons: [
    'button:has-text("Einschließen")',
    'button:has-text("Include")',
    '[role="button"]:has-text("Einschließen")',
    '[role="button"]:has-text("Include")',
    '[role="button"][aria-label*="einschließen"]',
    '[role="button"][aria-label*="include"]',
  ],
  candidateCards: [
    '[data-view-name*="search-results"] li',
    '.artdeco-list__item',
    '[data-test-search-result]',
    '[data-x-search-result]',
  ],
  leadLinks: [
    'a[href*="/sales/lead/"]',
  ],
  leadDetailMarkers: [
    'h1',
    '[data-anonymize="person-name"]',
    '[data-test-lead-name]',
    'button:has-text("Speichern")',
    'button:has-text("Save")',
    'button:has-text("Vernetzen")',
    'button:has-text("Connect")',
  ],
  showMoreButtons: [
    'button:has-text("Mehr anzeigen")',
    'button:has-text("Show more")',
    'button[aria-label*="Mehr anzeigen"]',
    'button[aria-label*="Show more"]',
  ],
  savePanelMarkers: [
    'text="Zur Liste hinzufügen"',
    'text="Add to list"',
    'text="Create new list"',
    '[role="dialog"]',
  ],
  createListButtons: [
    'button[data-x--hue-list-dropdown--create-new-list]',
    'button:has-text("Create new list")',
    'button:has-text("Liste erstellen")',
    'button:has-text("Create list")',
    '[role="button"]:has-text("Liste erstellen")',
    '[role="button"]:has-text("Create list")',
  ],
  createListInputs: [
    'input[placeholder*="Q4 Leads"]',
    'input[id^="text-input-ember"]',
    'input[placeholder*="Liste"]',
    'input[placeholder*="list"]',
    'input[name*="list"]',
  ],
  createListConfirmButtons: [
    'button:has-text("Create and save")',
    'button:has-text("Erstellen")',
    'button:has-text("Create")',
    '[role="button"]:has-text("Create and save")',
    '[role="button"]:has-text("Erstellen")',
    '[role="button"]:has-text("Create")',
  ],
  saveButton: [
    'button[data-x--lead-lists--dropdown-trigger-save]',
    'button[aria-label*="Save to list"]',
    'button[aria-label*="Add to a custom list"]',
    'button[class*="_save-to-list-button_"]',
    'button:has-text("Saved")',
    'button:has-text("Speichern")',
    'button:has-text("Save")',
    'button[aria-label*="Save"]',
    'button[aria-label*="speichern"]',
    '[data-control-name*="save"]',
  ],
  connectButton: [
    'button:has-text("Vernetzen")',
    'button:has-text("Einladen")',
    'button:has-text("Connect")',
    'button[aria-label*="Connect"]',
    '[data-control-name*="connect"]',
  ],
  connectOverflowButtons: [
    'button[aria-label*="Open actions overflow menu"]',
    'button[aria-label*="Open Actions Overflow Menu"]',
    'button[aria-label*="Aktions-Überlaufmenü öffnen"]',
    'button[aria-label*="More actions"]',
    'button[aria-label*="Weitere Aktionen"]',
    'button[aria-label*="Actions"]',
    'button[aria-label*="Aktionen"]',
    'button[aria-label*="overflow"]',
    'button[aria-label*="Overflow"]',
  ],
  connectMenuItems: [
    '[role="menuitem"]:has-text("Connect")',
    '[role="menuitem"]:has-text("Vernetzen")',
    '[role="menuitem"]:has-text("Einladen")',
    'button:has-text("Connect")',
    'button:has-text("Vernetzen")',
    'button:has-text("Einladen")',
    'a:has-text("Connect")',
  ],
  connectSendButtons: [
    'button:has-text("Send Invitation")',
    'button:has-text("Send invitation")',
    'button:has-text("Send without a note")',
    'button:has-text("Send")',
    'button:has-text("Einladung senden")',
    'button:has-text("Ohne Nachricht senden")',
    'button[aria-label*="Send invitation"]',
    'button[aria-label*="Einladung senden"]',
  ],
  signedInMarkers: [
    '[data-test-global-nav-link="sales-nav-home"]',
    'a[href*="/sales/home"]',
    'input[placeholder*="Search keywords"]',
    'body',
  ],
  loginMarkers: [
    'form[action*="/checkpoint/lg/login-submit"]',
    '#username',
    'input[name="session_key"]',
    'a[href*="/login"]',
  ],
};

class PlaywrightSalesNavigatorDriver extends DriverAdapter {
  constructor(options = {}) {
    super();
    this.options = {
      sessionMode: 'storage-state',
      headless: false,
      slowMo: 0,
      settleMs: 350,
      maxScrollSteps: 10,
      humanize: true,
      userDataDir: null,
      storageState: null,
      allowMutations: false,
      allowListCreate: false,
      recoveryMode: 'screenshot-only',
      dryRun: true,
      connectAttemptPacingMs: 3000,
      connectCacheFlushEvery: 3,
      spinnerReloadWaitUntil: 'networkidle',
      rateLimitBackoffMs: 60000,
      ...options,
    };
    this.browser = null;
    this.context = null;
    this.page = null;
    this.currentTemplate = null;
    this.currentSearchUrl = null;
    this.currentAccountKey = null;
    this.launchedPersistentContext = false;
    this.connectAttemptCount = 0;
  }

  async openSession(context) {
    const browserHomeDir = resolveBrowserHomeDir(this.options);
    const browserOptions = {
      headless: this.options.headless,
      slowMo: this.options.slowMo,
      args: [
        '--disable-crash-reporter',
        '--disable-crashpad',
        '--no-crash-upload',
      ],
      env: buildBrowserProcessEnv(browserHomeDir),
    };

    if (this.options.executablePath && fs.existsSync(this.options.executablePath)) {
      browserOptions.executablePath = this.options.executablePath;
    }

    if (this.options.sessionMode === 'persistent') {
      const userDataDir = this.options.userDataDir;
      if (!userDataDir) {
        throw new Error('Persistent session mode requires userDataDir');
      }

      fs.mkdirSync(userDataDir, { recursive: true });
      ensureLocalBrowserHome(browserHomeDir);
      this.context = await chromium.launchPersistentContext(userDataDir, {
        ...browserOptions,
        viewport: { width: 1440, height: 960 },
      });
      this.page = this.context.pages()[0] || await this.context.newPage();
      this.browser = this.context.browser();
      this.launchedPersistentContext = true;
    } else {
      ensureLocalBrowserHome(browserHomeDir);
      this.browser = await chromium.launch(browserOptions);
      this.context = await this.browser.newContext({
        storageState: this.options.storageState && fs.existsSync(this.options.storageState)
          ? this.options.storageState
          : undefined,
        viewport: { width: 1440, height: 960 },
      });
      this.page = await this.context.newPage();
    }

    this.page.setDefaultTimeout(30000);
    this.runContext = context;

    if (shouldNavigateToInitialSalesHome(this.page.url())) {
      await this.page.goto(SALES_HOME_URL, { waitUntil: 'domcontentloaded' });
      await this.pacedWait();
    }
  }

  async checkSessionHealth() {
    ensurePage(this.page);

    const url = this.page.url();
    const pageTitle = await this.page.title().catch(() => '');
    const sessionState = await this.getSessionState();
    const authenticated = sessionState === 'authenticated';

    return {
      ok: authenticated,
      authenticated,
      state: sessionState,
      mode: this.options.sessionMode,
      url,
      pageTitle,
      headless: this.options.headless,
      userDataDir: this.options.sessionMode === 'persistent' ? this.options.userDataDir : null,
      storageStatePath: this.options.sessionMode === 'storage-state' ? this.options.storageState : null,
    };
  }

  async saveSession() {
    if (this.context && this.options.storageState) {
      const dir = path.dirname(this.options.storageState);
      fs.mkdirSync(dir, { recursive: true });
      await this.context.storageState({ path: this.options.storageState });
      return this.options.storageState;
    }

    return this.options.userDataDir || null;
  }

  async exportStorageState(targetPath) {
    if (!this.context) {
      return null;
    }

    const resolvedPath = targetPath || this.options.storageState;
    if (!resolvedPath) {
      return null;
    }

    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    await this.context.storageState({ path: resolvedPath });
    try {
      fs.chmodSync(resolvedPath, 0o600);
    } catch {
      // best effort
    }
    return resolvedPath;
  }

  async openAccountSearch() {
    ensurePage(this.page);
    await this.navigateIfNeeded('https://www.linkedin.com/sales/search/company');
  }

  async resolveCompanyAlias(accountName) {
    ensurePage(this.page);
    return resolvePublicLinkedInCompanyAlias(this.page, accountName, this.options.settleMs);
  }

  async enumerateAccounts(accounts) {
    ensurePage(this.page);
    const resolved = [];

    for (const account of accounts || []) {
      const enriched = await resolveSalesNavAccountTarget(this.page, account, this.options.settleMs).catch(() => account);
      resolved.push(enriched || account);
    }

    return resolved;
  }

  async openAccount(account) {
    ensurePage(this.page);
    this.currentAccountKey = `${account.accountId}:${account.name}`;

    if (account.salesNav?.accountUrl) {
      await this.navigateIfNeeded(account.salesNav.accountUrl);
      return;
    }

    if (account.salesNav?.peopleSearchUrl) {
      await this.navigateIfNeeded(account.salesNav.peopleSearchUrl);
      return;
    }

    throw new Error(`No Sales Navigator URL available for account ${account.name}`);
  }

  async openPeopleSearch(account) {
    ensurePage(this.page);
    if (account.salesNav?.accountUrl) {
      const openedFromAccount = await openPeopleSearchFromAccountPage(this.page, account, this.options.settleMs);
      if (openedFromAccount) {
        this.currentSearchUrl = this.page.url();
        return;
      }
    }

    const targetUrl = ensurePeopleSearchHasExpandedFilters(
      account.salesNav?.peopleSearchUrl || 'https://www.linkedin.com/sales/search/people',
    );

    await this.navigateIfNeeded(targetUrl);
    await waitForAnySelector(this.page, DEFAULT_SELECTORS.peopleSearchPageMarkers, 12000).catch(() => {});
    await this.ensureAccountScopedSearch(account);
    this.currentSearchUrl = this.page.url();
  }

  async applySearchTemplate(template) {
    this.currentTemplate = template;
    if (!this.page || !this.currentSearchUrl) {
      return;
    }

    const keywords = (template.keywords || []).join(' ');
    await waitForAnySelector(this.page, DEFAULT_SELECTORS.keywordInputs, 12000).catch(() => {});
    const keywordInput = await findFirstVisible(this.page, DEFAULT_SELECTORS.keywordInputs);
    if (keywordInput && keywords) {
      await keywordInput.click();
      await keywordInput.press('Meta+A').catch(async () => {
        await keywordInput.press('Control+A').catch(() => {});
      });
      await keywordInput.fill(keywords);
      await keywordInput.press('Enter');
      await this.pacedWait(3);
      await this.handleRateLimitBackoff();
      this.currentSearchUrl = this.page.url();
      return;
    }

    const searchUrl = new URL(this.currentSearchUrl);
    if (keywords) {
      searchUrl.searchParams.set('keywords', keywords);
    }
    const nextUrl = searchUrl.toString();
    await this.navigateIfNeeded(nextUrl);
    this.currentSearchUrl = nextUrl;
  }

  async scrollAndCollectCandidates(account, template, context = {}) {
    ensurePage(this.page);

    const resultTimeoutMs = Number(context.resultTimeoutMs || 12000);
    const hydrateTimeoutMs = Number(context.hydrateTimeoutMs || 12000);
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    await this.page.waitForTimeout(this.options.settleMs * 4);
    await waitForAnySelector(this.page, [...DEFAULT_SELECTORS.leadLinks, ...DEFAULT_SELECTORS.candidateCards], resultTimeoutMs).catch(() => {});
    await waitForHydratedLeadResults(this.page, hydrateTimeoutMs).catch(() => {});

    const results = new Map();
    let previousCount = -1;
    let stagnantScrolls = 0;
    const seenCandidateKeys = normalizeSeenCandidateKeys(context.seenCandidateKeys || context.seenUrls);
    const duplicateShortCircuitThreshold = Number.isFinite(Number(context.duplicateShortCircuitThreshold))
      ? Number(context.duplicateShortCircuitThreshold)
      : 0.8;

    for (let step = 0; step < this.options.maxScrollSteps; step += 1) {
      await this.handleRateLimitBackoff(context);
      const extracted = await extractCandidatesFromListPage(this.page, account, template);
      for (const candidate of extracted) {
        const key = normalizeCandidateCollectionKey(candidate);
        if (!results.has(key)) {
          results.set(key, candidate);
        }
      }

      const progressSummary = summarizeSweepPageProgress({
        candidates: extracted,
        seenCandidateKeys,
        threshold: duplicateShortCircuitThreshold,
        step,
        templateId: template.id,
      });
      if (progressSummary.shouldShortCircuit) {
        logSweepEarlyExit(context.logger, progressSummary);
        break;
      }

      const candidateLimit = normalizeCandidateLimit(template.maxCandidates);
      if (candidateLimit !== null && results.size >= candidateLimit) {
        break;
      }

      if (results.size === previousCount) {
        stagnantScrolls += 1;
      } else {
        stagnantScrolls = 0;
      }

      if (stagnantScrolls >= 2) {
        break;
      }

      previousCount = results.size;
      const advanced = await progressiveScroll(this.page, this.options.settleMs);
      if (!advanced) {
        break;
      }
    }

    return limitCandidatesByTemplate(Array.from(results.values()), template);
  }

  async openCandidate(candidate) {
    ensurePage(this.page);
    const target = candidate.salesNavigatorUrl || candidate.profileUrl;
    if (!target) {
      throw new Error(`Candidate ${candidate.fullName} has no profile URL`);
    }

    await this.navigateIfNeeded(target);
    await waitForLeadDetailContent(this.page, candidate, this.options.settleMs);
  }

  async ensureList(listName) {
    return {
      listName,
      externalRef: null,
      status: this.options.allowMutations ? 'ready' : 'simulated',
    };
  }

  async saveCandidateToList(candidate, listInfo, context) {
    if (!this.options.allowMutations) {
      return { status: context.dryRun ? 'simulated' : 'planned', listName: listInfo.listName };
    }
    if (!candidate.salesNavigatorUrl && !candidate.profileUrl) {
      throw new Error(`Candidate ${candidate.fullName} is missing a Sales Navigator URL`);
    }
    if (!isSalesNavigatorLeadUrl(candidate.salesNavigatorUrl || candidate.profileUrl || '')) {
      throw new Error(`Candidate ${candidate.fullName} does not point to a Sales Navigator lead URL`);
    }

    const sessionState = await this.getSessionState();
    if (sessionState !== 'authenticated') {
      throw new Error(`Cannot save candidate while session state is ${sessionState}`);
    }

    try {
      await this.openCandidate(candidate);
      const saveButton = await findSaveToListButton(this.page);
      if (!saveButton) {
        throw new Error(`Save button not found for ${candidate.fullName}`);
      }

      await saveButton.click();
      await this.pacedWait(2);
      await waitForAnySelector(this.page, DEFAULT_SELECTORS.savePanelMarkers, 12000).catch(() => {});

      const rowOutcome = await clickVisibleListRow(this.page, listInfo.listName);
      if (rowOutcome?.outcome === 'already_saved') {
        await this.pacedWait(2);
        return {
          status: 'already_saved',
          listName: listInfo.listName,
          selectionMode: rowOutcome.selectionMode || 'existing_list',
        };
      }
      if (rowOutcome?.outcome === 'clicked') {
        await this.pacedWait(2);
        return { status: 'saved', listName: listInfo.listName, selectionMode: 'existing_list' };
      }

      if (!this.options.allowListCreate) {
        throw new Error(`List ${listInfo.listName} was not found. Creation is disabled in safe mode.`);
      }

      const created = await this.tryCreateList(listInfo.listName);
      if (created) {
        await this.pacedWait(2);
        return { status: 'saved', listName: listInfo.listName, selectionMode: 'created_list' };
      }
    } catch (error) {
      if (isSaveRowFallbackError(error) && candidate.accountName) {
        const fallbackAccount = {
          accountId: `fallback-${String(candidate.accountName).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          name: candidate.accountName,
          salesNav: {
            peopleSearchUrl: 'https://www.linkedin.com/sales/search/people?viewAllFilters=true',
          },
        };
        await this.openFallbackPeopleSearchForSave(fallbackAccount);
        const keywordSets = buildFallbackSearchKeywordSets(candidate);
        for (const fallbackKeywords of keywordSets) {
          await this.applySearchTemplate({
            id: 'row-save-fallback',
            name: 'Row Save Fallback',
            keywords: fallbackKeywords,
            maxCandidates: 12,
            titleIncludes: [],
          });
          const fallbackResult = await saveCandidateToListFromVisibleResults(this.page, candidate, listInfo, {
            settleMs: this.options.settleMs,
            allowListCreate: this.options.allowListCreate,
            maxScrollSteps: 5,
          });
          if (fallbackResult) {
            return fallbackResult;
          }
          if (this.options.allowListCreate) {
            const created = await this.tryCreateList(listInfo.listName);
            if (created) {
              await this.pacedWait(2);
              return { status: 'saved', listName: listInfo.listName, selectionMode: 'results_row_created_list' };
            }
          }
        }
      }
      throw error;
    }

    throw new Error(`List ${listInfo.listName} not found and could not be created`);
  }

  async openFallbackPeopleSearchForSave(account) {
    await this.openAccountSearch().catch(() => {});
    try {
      await this.openPeopleSearch(account);
      return;
    } catch (error) {
      if (!isCompanyFilterUnavailableError(error)) {
        throw error;
      }
      const targetUrl = ensurePeopleSearchHasExpandedFilters(
        account.salesNav?.peopleSearchUrl || 'https://www.linkedin.com/sales/search/people',
      );
      await this.navigateIfNeeded(targetUrl);
      await waitForAnySelector(this.page, DEFAULT_SELECTORS.peopleSearchPageMarkers, 12000).catch(() => {});
      this.currentSearchUrl = this.page.url();
    }
  }

  async sendConnect(candidate, context) {
    if (!this.options.allowMutations) {
      return { status: context.dryRun ? 'simulated' : 'planned', note: 'mutations disabled' };
    }

    const connectTargetUrl = candidate.salesNavigatorUrl || candidate.profileUrl || '';
    if (!connectTargetUrl || !isSalesNavigatorLeadUrl(connectTargetUrl)) {
      throw new Error(`Candidate ${candidate.fullName || 'unknown'} does not point to a Sales Navigator lead URL`);
    }

    if (
      this.connectAttemptCount > 0
      && this.options.connectCacheFlushEvery > 0
      && this.connectAttemptCount % this.options.connectCacheFlushEvery === 0
    ) {
      await this.page.goto('about:blank', { waitUntil: 'domcontentloaded' }).catch(() => {});
      await this.page.waitForTimeout(this.options.settleMs).catch(() => {});
    }
    this.connectAttemptCount += 1;
    if (this.options.connectAttemptPacingMs > 0) {
      await this.page.waitForTimeout(this.options.connectAttemptPacingMs).catch(() => {});
    }

    await this.openCandidate(candidate);
    const initialState = await readConnectState(this.page);
    if (initialState.hasInvitationSent || initialState.hasPendingConnectControl) {
      return { status: 'already_sent', note: 'invitation already sent', driver: 'playwright' };
    }
    if (initialState.hasConnectedMessage || initialState.hasConnectedControl) {
      return { status: 'already_connected', note: 'lead already connected', driver: 'playwright' };
    }
    if (initialState.hasEmailRequired) {
      return { status: 'email_required', note: 'connect requires email address', driver: 'playwright' };
    }
    if (!initialState.hasRenderableLeadPage) {
      return { status: 'manual_review', note: 'lead page did not render usable connect controls', driver: 'playwright' };
    }

    let connectButton = await findFirstVisible(this.page, DEFAULT_SELECTORS.connectButton);
    if (!connectButton) {
      const overflowButton = await findFirstVisible(this.page, DEFAULT_SELECTORS.connectOverflowButtons);
      if (overflowButton) {
        await overflowButton.click().catch(() => {});
        await this.page.waitForTimeout(this.options.settleMs);
        connectButton = await findFirstVisible(this.page, DEFAULT_SELECTORS.connectMenuItems)
          || await findSemanticConnectMenuControl(this.page);
      }
    }
    if (!connectButton) {
      connectButton = await findVisibleActionControl(this.page, CONNECT_ACTION_PATTERNS);
    }

    if (!connectButton) {
      const noButtonState = classifyNoButtonConnectState(
        await readOverflowConnectState(this.page),
        await readConnectUnavailableContext(this.page),
      );
      if (noButtonState) {
        return noButtonState;
      }
      return {
        status: 'connect_unavailable',
        reason: 'render_failure_retry_suggested',
        note: 'connect button not found on lead page',
        driver: 'playwright',
      };
    }

    const connectLabel = await connectButton.innerText().catch(() => '')
      || await connectButton.getAttribute('aria-label').catch(() => '')
      || '';
    if (/pending|ausstehend/i.test(connectLabel)) {
      return { status: 'already_sent', note: 'invitation already pending', driver: 'playwright' };
    }

    await connectButton.click().catch(() => {});
    await this.page.waitForTimeout(this.options.settleMs);

    let sendButton = await findFirstVisible(this.page, DEFAULT_SELECTORS.connectSendButtons)
      || await findVisibleActionControl(this.page, SEND_INVITATION_PATTERNS);
    if (!sendButton) {
      const deadline = Date.now() + Math.max(2500, this.options.settleMs * 6);
      while (!sendButton && Date.now() < deadline) {
        await this.page.waitForTimeout(250).catch(() => {});
        sendButton = await findFirstVisible(this.page, DEFAULT_SELECTORS.connectSendButtons)
          || await findVisibleActionControl(this.page, SEND_INVITATION_PATTERNS);
      }
    }
    if (!sendButton) {
      const postClickUiState = await readConnectState(this.page);
      if (postClickUiState.hasInvitationSent || postClickUiState.hasPendingConnectControl) {
        return { status: 'sent', note: 'invitation sent', driver: 'playwright' };
      }
      if (postClickUiState.hasConnectedMessage || postClickUiState.hasConnectedControl) {
        return { status: 'already_connected', note: 'lead already connected', driver: 'playwright' };
      }
      if (postClickUiState.hasEmailRequired) {
        return { status: 'email_required', note: 'connect requires email address', driver: 'playwright' };
      }
      if (!postClickUiState.hasRenderableLeadPage) {
        return { status: 'manual_review', note: 'lead page did not render verifiable connect controls after click', driver: 'playwright' };
      }
      const postClickConnectLabel = normalizeActionLabel(
        await connectButton.innerText().catch(() => '')
        || await connectButton.getAttribute('aria-label').catch(() => '')
        || '',
      );
      const postClickLabelState = classifyPostClickConnectLabel(postClickConnectLabel);
      if (postClickLabelState === 'pending') {
        return { status: 'sent', note: 'connect pending via visible action', driver: 'playwright' };
      }
      if (postClickLabelState === 'connected') {
        return { status: 'already_connected', note: 'lead already connected', driver: 'playwright' };
      }
    }
    if (sendButton) {
      await sendButton.click().catch(() => {});
      await this.page.waitForTimeout(this.options.settleMs * 2);
    }

    const finalState = await readConnectState(this.page);
    if (finalState.hasInvitationSent || finalState.hasPendingConnectControl) {
      return { status: 'sent', note: 'invitation sent', driver: 'playwright' };
    }
    if (finalState.hasConnectedMessage || finalState.hasConnectedControl) {
      return { status: 'already_connected', note: 'lead already connected', driver: 'playwright' };
    }
    if (finalState.hasEmailRequired) {
      return { status: 'email_required', note: 'connect requires email address', driver: 'playwright' };
    }
    const overflowState = await readOverflowConnectState(this.page);
    if (overflowState.hasPendingConnect) {
      return { status: 'sent', note: 'connect pending', driver: 'playwright' };
    }
    if (!overflowState.hasConnectAction) {
      return classifyNoButtonConnectState(overflowState, await readConnectUnavailableContext(this.page))
        || {
          status: 'connect_unavailable',
          reason: 'render_failure_retry_suggested',
          note: 'connect action unavailable after open',
          driver: 'playwright',
        };
    }

    return { status: 'manual_review', note: `connect outcome could not be verified for ${candidate.fullName}`, driver: 'playwright' };
  }

  async inspectConnectSurface(candidate) {
    let inspectionError = null;
    try {
      await this.openCandidate(candidate);
    } catch (error) {
      inspectionError = classifyConnectSurfaceInspectionError(error);
    }
    const pageTitle = await this.page.title().catch(() => '');
    const initialState = inspectionError
      ? await readConnectState(this.page).catch(() => ({
        hasInvitationSent: false,
        hasConnectedMessage: false,
        hasRenderableLeadPage: false,
      }))
      : await readConnectState(this.page);
    const visibleActions = await collectVisibleActionDescriptors(this.page).catch(() => []);
    const overflowMenuItems = await readOverflowConnectMenuItems(this.page).catch(() => null);
    const overflowClassification = classifyOverflowConnectMenuItems(overflowMenuItems || []);
    const surfaceClassification = classifyConnectSurfaceDiagnostic({
      initialState,
      inspectionError,
      visibleActions,
      overflowClassification,
    });

    return {
      driver: 'playwright',
      candidate: {
        fullName: candidate?.fullName || null,
        salesNavigatorUrl: candidate?.salesNavigatorUrl || null,
        profileUrl: candidate?.profileUrl || null,
      },
      page: {
        url: this.page.url(),
        title: pageTitle,
      },
      initialState: {
        hasInvitationSent: initialState.hasInvitationSent,
        hasConnectedMessage: initialState.hasConnectedMessage,
        hasRenderableLeadPage: initialState.hasRenderableLeadPage,
      },
      inspectionError,
      visibleActions,
      matchedVisibleConnectActions: visibleActions.filter((action) => matchesAnyActionPattern(action, CONNECT_ACTION_PATTERNS)),
      matchedVisibleSendActions: visibleActions.filter((action) => matchesAnyActionPattern(action, SEND_INVITATION_PATTERNS)),
      surfaceClassification,
      overflow: {
        hasOverflowButton: Array.isArray(overflowMenuItems),
        items: overflowMenuItems || [],
        classification: overflowClassification,
      },
    };
  }

  async captureEvidence(candidate) {
    if (!this.page) {
      return {
        snippet: candidate.summary || candidate.headline || candidate.title,
      };
    }

    if (candidate.fromListPage) {
      return {
        pageTitle: await this.page.title().catch(() => ''),
        pageUrl: this.page.url(),
        snippet: candidate.summary || candidate.headline || candidate.title,
        extraction: 'list-page',
      };
    }

    const title = await this.page.title().catch(() => candidate.title);
    const url = this.page.url();
    await expandVisibleShowMoreButtons(this.page).catch(() => {});
    const snippet = await extractLeadDetailSnippet(this.page, candidate);
    return {
      pageTitle: title,
      pageUrl: url,
      snippet: snippet.slice(0, 500),
      extraction: 'detail-page',
    };
  }

  async recoverFromInterruption(event) {
    const screenshotPath = event.screenshotPath;
    const shouldWriteFull = this.options.recoveryMode === 'full';
    const htmlPath = shouldWriteFull && screenshotPath ? screenshotPath.replace(/\.png$/i, '.html') : null;
    const textPath = shouldWriteFull && screenshotPath ? screenshotPath.replace(/\.png$/i, '.txt') : null;
    if (this.page && screenshotPath) {
      await this.page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      try {
        fs.chmodSync(screenshotPath, 0o600);
      } catch {
        // best effort
      }
      if (htmlPath) {
        const html = await this.page.content().catch(() => '');
        fs.writeFileSync(htmlPath, html, { encoding: 'utf8', mode: 0o600 });
      }
      if (textPath) {
        const text = await this.page.locator('body').innerText().catch(() => '');
        fs.writeFileSync(textPath, text, { encoding: 'utf8', mode: 0o600 });
      }
    }

    return {
      status: 'captured',
      screenshotPath: screenshotPath || null,
      htmlPath: htmlPath || null,
      textPath: textPath || null,
    };
  }

  async close() {
    await this.saveSession().catch(() => {});

    if (this.context && this.launchedPersistentContext) {
      await this.context.close();
      return;
    }

    if (this.browser) {
      await this.browser.close();
    }
  }

  async navigateIfNeeded(url) {
    if (this.page.url() === url) {
      await this.handleRateLimitBackoff();
      return;
    }

    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    await this.pacedWait();
    await this.handleRateLimitBackoff();
  }

  async isAuthenticated() {
    return (await this.getSessionState()) === 'authenticated';
  }

  async getSessionState() {
    const currentUrl = this.page.url();
    const bodyText = await this.page.locator('body').innerText().catch(() => '');
    const normalized = bodyText.toLowerCase();

    if (!isLinkedInUrl(currentUrl)) {
      return 'blocked';
    }

    if (/\/checkpoint\//i.test(currentUrl) || /captcha|sicherheitsüberprüfung|security verification|verify your identity/i.test(normalized)) {
      return 'captcha_or_checkpoint';
    }

    if (/\/login/i.test(currentUrl)) {
      return 'reauth_required';
    }

    for (const selector of DEFAULT_SELECTORS.loginMarkers) {
      if (await this.page.locator(selector).first().isVisible().catch(() => false)) {
        return 'reauth_required';
      }
    }

    if (/temporarily restricted|eingeschränkt|unusual activity|zu viele anfragen/i.test(normalized)) {
      return 'blocked';
    }

    for (const selector of DEFAULT_SELECTORS.signedInMarkers) {
      if (await this.page.locator(selector).first().isVisible().catch(() => false)) {
        return 'authenticated';
      }
    }

    return 'blocked';
  }

  async ensureAccountScopedSearch(account) {
    const filterTargets = buildCompanyFilterTargets(account);
    if (filterTargets.length === 0) {
      return { status: 'skipped', reason: 'no_company_targets' };
    }

    const alreadyScopedToTarget = await this.page.evaluate((targets) => {
      const normalize = (value) => (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const text = normalize(document.body?.innerText || '');
      return targets.some((target) => {
        const normalized = normalize(target);
        return normalized && text.includes(normalized);
      });
    }, filterTargets).catch(() => false);

    if (!alreadyScopedToTarget) {
      await ensureCurrentCompanyFilterExpanded(this.page, this.options.settleMs);
    }

    const lowConfidenceMatches = [];
    for (const target of filterTargets) {
      const selection = await selectCurrentCompanyFilterTarget(this.page, target, this.options.settleMs);
      if (selection?.ok) {
        await this.pacedWait(3);
        return {
          status: 'selected',
          target,
          label: selection.label,
        };
      }
      if (selection?.reason === 'low_confidence_company_filter_match') {
        lowConfidenceMatches.push(selection);
      }
    }

    if (lowConfidenceMatches.length > 0) {
      const labels = lowConfidenceMatches
        .map((match) => `${match.target} -> ${match.label} (${Math.round(Number(match.confidence || 0) * 100)}%)`)
        .join('; ');
      throw new Error(`needs_manual_alias: low-confidence company filter match for ${account.name}: ${labels}`);
    }

    throw new Error(`Unable to scope people search to account filter for ${account.name}`);
  }

  async pacedWait(multiplier = 1) {
    const base = Math.max(120, this.options.settleMs * multiplier);
    const waitMs = this.options.humanize
      ? Math.round(base * (0.8 + (Math.random() * 0.5)))
      : Math.round(base);
    await this.page.waitForTimeout(waitMs);
  }

  async handleRateLimitBackoff(context = {}) {
    const rateLimited = await detectRateLimit(this.page);
    if (!rateLimited) {
      return {
        rateLimited: false,
        recovered: false,
        backoffMs: 0,
      };
    }

    const backoffMs = Math.max(0, Number(context.rateLimitBackoffMs ?? this.options.rateLimitBackoffMs ?? 60000));
    const event = {
      detectedAt: new Date().toISOString(),
      backoffMs,
    };
    if (Array.isArray(context.rateLimitEvents)) {
      context.rateLimitEvents.push(event);
    }
    const logger = context.logger;
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`rate-limit detected - pausing sweep for ${Math.round(backoffMs / 1000)}s`);
    }

    if (backoffMs > 0) {
      await this.page.waitForTimeout(backoffMs);
    }
    await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await this.pacedWait();

    const stillRateLimited = await detectRateLimit(this.page);
    if (stillRateLimited) {
      const error = new Error(`rate_limited: LinkedIn too many requests after ${backoffMs}ms backoff`);
      error.code = 'rate_limited';
      error.backoffMs = backoffMs;
      throw error;
    }

    return {
      rateLimited: true,
      recovered: true,
      backoffMs,
    };
  }

  async tryCreateList(listName) {
    const createButton = await findFirstVisible(this.page, DEFAULT_SELECTORS.createListButtons);
    if (!createButton) {
      return false;
    }

    await createButton.click();
    await this.pacedWait();
    const input = await findListNameInput(this.page);
    if (!input) {
      return false;
    }

    await input.click().catch(() => {});
    await input.fill('');
    await input.type(listName, { delay: 25 }).catch(async () => {
      await input.fill(listName);
    });
    await this.pacedWait();

    const confirm = await findFirstVisible(this.page, DEFAULT_SELECTORS.createListConfirmButtons);
    if (!confirm) {
      return false;
    }

    await confirm.click();
    return true;
  }
}

function resolveBrowserHomeDir(options) {
  if (options.browserHomeDir) {
    return options.browserHomeDir;
  }

  if (options.userDataDir) {
    return path.join(options.userDataDir, '.browser-home');
  }

  if (options.storageState) {
    return path.join(path.dirname(options.storageState), '.browser-home');
  }

  return path.join(process.cwd(), 'runtime', '.browser-home');
}

function ensureLocalBrowserHome(browserHomeDir) {
  fs.mkdirSync(browserHomeDir, { recursive: true });
  fs.mkdirSync(path.join(browserHomeDir, '.config'), { recursive: true });
  fs.mkdirSync(path.join(browserHomeDir, '.cache'), { recursive: true });
}

function buildBrowserProcessEnv(browserHomeDir) {
  return {
    ...process.env,
    HOME: browserHomeDir,
    XDG_CONFIG_HOME: path.join(browserHomeDir, '.config'),
    XDG_CACHE_HOME: path.join(browserHomeDir, '.cache'),
  };
}

function ensurePage(page) {
  if (!page) {
    throw new Error('Driver session not opened');
  }
}

function isLinkedInUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com');
  } catch {
    return false;
  }
}

function shouldNavigateToInitialSalesHome(value) {
  return !isLinkedInUrl(value);
}

function isCompanyFilterUnavailableError(error) {
  return /current company filter (toggle not found|input did not appear)/i.test(String(error?.message || error || ''));
}

function isSaveRowFallbackError(error) {
  const message = String(error?.message || error || '');
  return error?.code === 'LEAD_PAGE_SPINNER_STUCK'
    || /lead detail did not render|save button not found|current company filter/i.test(message);
}

async function waitForAnySelector(page, selectors, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const selector of selectors) {
      const visible = await page.locator(selector).first().isVisible().catch(() => false);
      if (visible) {
        return selector;
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error('No matching selector became visible');
}

function classifyLeadDetailSnapshot(snapshot, candidate) {
  const expectedName = String(candidate?.fullName || '').trim().toLowerCase();
  const normalizedBody = String(snapshot?.bodyText || '').toLowerCase();
  const bodyLength = normalizedBody.trim().length;
  const hasLeadMarkers = Number(snapshot?.leadMarkerCount || 0) > 0;
  const hasSaveOrConnectControls = Boolean(snapshot?.hasSaveOrConnectControls);
  const hasSpinnerShell = Boolean(snapshot?.hasSpinnerShell);
  const title = String(snapshot?.title || '').trim().toLowerCase();
  const matchesExpectedName = !expectedName || normalizedBody.includes(expectedName);
  const isHydrated = bodyLength > 200 && matchesExpectedName && (hasLeadMarkers || hasSaveOrConnectControls);
  const isSpinnerOnlyShell = hasSpinnerShell && bodyLength < 120 && !hasLeadMarkers && !hasSaveOrConnectControls;
  const looksUnhydratedShell = title === 'sales navigator' && bodyLength < 120 && !hasLeadMarkers && !hasSaveOrConnectControls;

  return {
    expectedName,
    bodyLength,
    hasLeadMarkers,
    hasSaveOrConnectControls,
    hasSpinnerShell,
    matchesExpectedName,
    isHydrated,
    isSpinnerOnlyShell,
    looksUnhydratedShell,
  };
}

async function readLeadDetailSnapshot(page) {
  return page.evaluate((selectors) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const leadMarkerCount = selectors.leadDetailMarkers.reduce((count, selector) => {
      try {
        return count + document.querySelectorAll(selector).length;
      } catch {
        return count;
      }
    }, 0);
    const saveOrConnectControls = selectors.saveButton.concat(selectors.connectButton).reduce((count, selector) => {
      try {
        return count + document.querySelectorAll(selector).length;
      } catch {
        return count;
      }
    }, 0);
    const spinnerSelectors = [
      '.initial-load-animation',
      '.initial-loading-state',
      '.loading-bar',
      '.blue-bar',
    ];
    const hasSpinnerShell = spinnerSelectors.some((selector) => {
      const element = document.querySelector(selector);
      if (!element) {
        return false;
      }
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    });

    return {
      title: document.title || '',
      bodyText: normalize(document.body?.innerText || ''),
      leadMarkerCount,
      hasSaveOrConnectControls: saveOrConnectControls > 0,
      hasSpinnerShell,
    };
  }, {
    leadDetailMarkers: DEFAULT_SELECTORS.leadDetailMarkers,
    saveButton: DEFAULT_SELECTORS.saveButton,
    connectButton: DEFAULT_SELECTORS.connectButton,
  }).catch(() => ({
    title: '',
    bodyText: '',
    leadMarkerCount: 0,
    hasSaveOrConnectControls: false,
    hasSpinnerShell: false,
  }));
}

async function waitForLeadDetailContent(page, candidate, settleMs) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await waitForAnySelector(page, DEFAULT_SELECTORS.leadDetailMarkers, 4000).catch(() => {});

  const start = Date.now();
  let reloadAttempts = 0;
  while (Date.now() - start < 14000) {
    const snapshot = await readLeadDetailSnapshot(page);
    const state = classifyLeadDetailSnapshot(snapshot, candidate);
    if (state.isHydrated) {
      await page.waitForTimeout(jitteredWait(settleMs * 2));
      return state;
    }

    if ((state.isSpinnerOnlyShell || state.looksUnhydratedShell) && reloadAttempts < 2) {
      reloadAttempts += 1;
      await page.waitForTimeout(jitteredWait(settleMs * (2 + reloadAttempts)));
      await page.reload({ waitUntil: 'networkidle' }).catch(async () => {
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      });
      continue;
    }

    await page.waitForTimeout(350);
  }

  const finalSnapshot = await readLeadDetailSnapshot(page);
  const finalState = classifyLeadDetailSnapshot(finalSnapshot, candidate);
  if (finalState.isSpinnerOnlyShell || finalState.looksUnhydratedShell) {
    const error = new Error(`Lead page stuck on spinner shell for ${candidate?.fullName || 'unknown lead'}`);
    error.code = 'LEAD_PAGE_SPINNER_STUCK';
    throw error;
  }

  throw new Error(`Lead detail did not render for ${candidate?.fullName || 'unknown lead'}`);
}

function buildFallbackSearchKeywordSets(candidate) {
  const fullName = String(candidate?.fullName || '').trim();
  const title = String(candidate?.title || '').trim();
  const titleTokens = title
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 4);
  const rawSets = [
    fullName ? [fullName] : [],
    title ? [title] : [],
    titleTokens.length ? titleTokens : [],
    [],
  ];
  const seen = new Set();
  return rawSets.filter((set) => {
    const key = set.join(' ').toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function expandVisibleShowMoreButtons(page) {
  for (const selector of DEFAULT_SELECTORS.showMoreButtons) {
    const buttons = page.locator(selector);
    const count = await buttons.count().catch(() => 0);
    const limit = Math.min(count, 4);
    for (let index = 0; index < limit; index += 1) {
      const button = buttons.nth(index);
      const visible = await button.isVisible().catch(() => false);
      if (!visible) {
        continue;
      }
      await button.click().catch(() => {});
      await page.waitForTimeout(150).catch(() => {});
    }
  }
}

async function extractLeadDetailSnippet(page, candidate) {
  const snippet = await page.evaluate((payload) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const interestingSelectors = [
      '[data-anonymize="person-name"]',
      '[data-test-lead-name]',
      'h1',
      '.profile-topcard',
      '[data-test-profile-topcard]',
      'main',
      '[role="main"]',
      'section',
      'article',
    ];

    const fragments = [];
    for (const selector of interestingSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector)).slice(0, 12);
      for (const node of nodes) {
        const text = normalize(node.textContent || '');
        if (!text || text.length < 20) {
          continue;
        }
        fragments.push(text);
      }
      if (fragments.join(' ').length > 1200) {
        break;
      }
    }

    const bodyText = normalize(document.body?.innerText || '');
    const combined = normalize([...fragments, bodyText].join(' '));
    return combined;
  }, {
    fullName: candidate?.fullName || '',
  }).catch(() => '');

  const fallback = candidate.summary || candidate.headline || candidate.title || '';
  const merged = String(snippet || fallback || '').replace(/\s+/g, ' ').trim();
  return merged.slice(0, 2000);
}

async function readConnectState(page) {
  const body = await page.locator('body').innerText().catch(() => '');
  const normalized = String(body || '').toLowerCase();
  const controlState = await readConnectControlState(page);
  return {
    hasInvitationSent: /invitation sent|invitation pending|connection sent|einladung gesendet|einladung ausstehend|verbindung gesendet/i.test(normalized),
    hasConnectedMessage: /already connected|bereits vernetzt|vernetzt:/i.test(normalized),
    hasEmailRequired: /email address|e-mail address|geschäftliche e-mail-adresse|gib .*e-mail-adresse ein|enter .*email/i.test(normalized),
    hasRenderableLeadPage: normalized.length > 50,
    hasPendingConnectControl: controlState.hasPendingConnectControl,
    hasConnectedControl: controlState.hasConnectedControl,
    body: normalized,
  };
}

async function readConnectControlState(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const selectors = [
      'button',
      '[role="button"]',
      '[role="menuitem"]',
      'a',
      '[data-test-pending-connect]',
      '.artdeco-toast--success',
    ];
    const fragments = [];
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const rect = typeof element.getBoundingClientRect === 'function'
          ? element.getBoundingClientRect()
          : { width: 0, height: 0 };
        const visible = rect.width > 0 && rect.height > 0;
        if (!visible && !element.matches('[data-test-pending-connect],.artdeco-toast--success')) {
          continue;
        }
        fragments.push(normalize(element.innerText || element.textContent || ''));
        fragments.push(normalize(element.getAttribute('aria-label') || ''));
        fragments.push(normalize(element.getAttribute('data-test-pending-connect') || ''));
        if (element.disabled || element.getAttribute('aria-disabled') === 'true') {
          fragments.push(`disabled ${normalize(element.innerText || element.getAttribute('aria-label') || '')}`);
        }
      }
    }
    const text = fragments.filter(Boolean).join(' ');
    return {
      hasPendingConnectControl: /\b(connect|invite|invitation|vernetzen|einladung)\b[^.]{0,80}\b(pending|sent|ausstehend|gesendet)\b|\b(pending|sent|ausstehend|gesendet)\b[^.]{0,80}\b(connect|invite|invitation|vernetzen|einladung)\b/.test(text),
      hasConnectedControl: /\b(already connected|connected|vernetzt)\b/.test(text),
    };
  }).catch(() => ({
    hasPendingConnectControl: false,
    hasConnectedControl: false,
  }));
}

async function readConnectUnavailableContext(page) {
  const state = await readConnectState(page).catch(() => ({
    body: '',
    hasRenderableLeadPage: false,
  }));
  const controlState = await page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const fragments = [...document.querySelectorAll('button,[role="button"],[role="menuitem"],a')]
      .map((element) => [
        normalize(element.innerText || element.textContent || ''),
        normalize(element.getAttribute('aria-label') || ''),
      ].join(' '))
      .join(' ');
    return {
      hasRestrictedConnect: /\b(can't connect|cannot connect|unable to connect|connect not available|not able to connect|außerhalb deines netzwerks|outside your network)\b/.test(fragments),
    };
  }).catch(() => ({
    hasRestrictedConnect: false,
  }));
  const body = String(state.body || '').toLowerCase();
  const hasThirdDegree = /\b3rd\b|\b3\.\s*grades\b|\bdritten grades\b|\bthird degree\b/.test(body);
  const hasRestrictedConnect = Boolean(controlState.hasRestrictedConnect)
    || /\b(can't connect|cannot connect|unable to connect|connect not available|outside your network|außerhalb deines netzwerks)\b/.test(body);
  return {
    hasThirdDegree,
    hasRestrictedConnect,
    hasRenderableLeadPage: Boolean(state.hasRenderableLeadPage),
  };
}

function classifyOverflowConnectMenuItems(items) {
  const normalizedItems = Array.isArray(items)
    ? items.map((item) => ({
      text: String(item?.text || ''),
      aria: String(item?.aria || ''),
    }))
    : [];

  let hasConnectAction = false;
  let hasPendingConnect = false;
  for (const item of normalizedItems) {
    const variants = [item.text, item.aria].filter(Boolean);
    for (const value of variants) {
      const classification = classifyConnectMenuActionLabel(value);
      if (!classification.isConnectAction) {
        continue;
      }
      hasConnectAction = true;
      if (classification.isPendingAction) {
        hasPendingConnect = true;
      }
    }
  }

  return { hasPendingConnect, hasConnectAction };
}

async function readOverflowConnectState(page) {
  const menuItems = await readOverflowConnectMenuItems(page);
  if (!menuItems) {
    return { hasPendingConnect: false, hasConnectAction: false };
  }
  return classifyOverflowConnectMenuItems(menuItems);
}

async function readOverflowConnectMenuItems(page) {
  const overflowButton = await findFirstVisible(page, DEFAULT_SELECTORS.connectOverflowButtons);
  if (!overflowButton) {
    return null;
  }

  await overflowButton.click().catch(() => {});
  await page.waitForTimeout(350).catch(() => {});

  const menuItems = await page.evaluate(() => {
    const normalize = (value) => (value || '').replace(/\s+/g, ' ').trim();
    return [...document.querySelectorAll('[role="menuitem"],li,button,[role="button"],a')]
      .map((element) => ({
        text: normalize(element.innerText || element.textContent || ''),
        aria: normalize(element.getAttribute('aria-label') || ''),
      }))
      .filter((item) => item.text || item.aria);
  }).catch(() => []);

  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(100).catch(() => {});
  return menuItems;
}

async function resolveSalesNavAccountTarget(page, account, settleMs) {
  if (account?.salesNav?.accountUrl || account?.salesNav?.peopleSearchUrl) {
    return account;
  }

  const accountName = String(account?.name || '').trim();
  const searchQueries = [
    ...(Array.isArray(account?.salesNav?.accountSearchAliases) ? account.salesNav.accountSearchAliases : []),
    ...(Array.isArray(account?.salesNav?.companyFilterAliases) ? account.salesNav.companyFilterAliases : []),
    ...buildCompanyTargetAliases(account?.salesNav?.companyTargets),
    ...buildLinkedInCompanyUrlAliases(account?.salesNav?.linkedinCompanyUrls),
    accountName,
  ].map((value) => String(value || '').trim()).filter(Boolean)
    .filter((value, index, all) => all.findIndex((entry) => entry.toLowerCase() === value.toLowerCase()) === index);

  if (searchQueries.length === 0) {
    return account;
  }

  const scoreAccountSearchResults = async (query) => page.evaluate((payload) => {
    const normalize = (value) => (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const stripLegal = (value) => normalize(value).replace(/\b(gmbh|mbh|ag|se|sa|spa|s\.a\.|s\.p\.a\.|ltd|limited|inc|corp|corporation|llc|plc|group|holdings?)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const tokenSet = (value) => new Set(stripLegal(value).split(' ').filter(Boolean));
    const targetValue = normalize(payload.query);
    const targetCore = stripLegal(payload.query);
    const targetTokens = tokenSet(payload.query);

    const links = Array.from(document.querySelectorAll(payload.linkSelector))
      .filter((link) => {
        const rect = link.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((link) => {
        const row = link.closest('li, article, div') || link;
        const rowText = (row.innerText || '').replace(/\s+/g, ' ').trim();
        const linkText = (link.textContent || '').replace(/\s+/g, ' ').trim();
        const label = rowText && rowText.length <= 160 ? rowText : linkText || rowText;
        const href = link.href || null;
        const parsedHref = href ? new URL(href, window.location.origin) : null;
        const isDirectCompanyLink = parsedHref
          && /\/sales\/company\/\d+/i.test(parsedHref.pathname)
          && !parsedHref.searchParams.has('anchor')
          && !parsedHref.searchParams.has('aiqSection');
        const normalizedLabel = normalize(label);
        const normalizedCore = stripLegal(label);
        let score = 0;

        if (!isDirectCompanyLink) {
          score -= 40;
        } else {
          score += 12;
        }

        if (normalizedLabel === targetValue || normalizedCore === targetCore) {
          score += 100;
        } else if (normalizedLabel.startsWith(targetValue) || normalizedCore.startsWith(targetCore)) {
          score += 70;
        } else if (normalizedLabel.includes(targetValue) || normalizedCore.includes(targetCore)) {
          score += 45;
        }

        const rowTokens = tokenSet(label);
        let overlap = 0;
        for (const token of targetTokens) {
          if (rowTokens.has(token)) {
            overlap += 1;
          }
        }
        score += overlap * 12;

        return {
          label,
          href,
          score,
          isDirectCompanyLink,
        };
      })
      .filter((entry) => entry.href && entry.score > 0 && entry.label)
      .sort((left, right) => right.score - left.score);

    return links[0] || null;
  }, {
    query,
    linkSelector: DEFAULT_SELECTORS.accountResultLinks.join(','),
  }).catch(() => null);

  let match = null;
  let matchedQuery = null;
  for (const query of searchQueries) {
    const searchUrl = new URL('https://www.linkedin.com/sales/search/company');
    searchUrl.searchParams.set('keywords', query);
    await page.goto(searchUrl.toString(), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(jitteredWait(settleMs * 2));
    await waitForAnySelector(page, DEFAULT_SELECTORS.accountResultLinks, 12000).catch(() => {});

    match = await scoreAccountSearchResults(query);
    if (match?.href) {
      matchedQuery = query;
      break;
    }
  }

  if (!match?.href) {
    return account;
  }

  let peopleSearchUrl = account?.salesNav?.peopleSearchUrl || null;
  try {
    await page.goto(match.href, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(jitteredWait(settleMs * 2));
    peopleSearchUrl = await extractAccountPagePeopleSearchUrl(page);
  } catch {
    peopleSearchUrl = peopleSearchUrl || null;
  }

  return {
    ...account,
    salesNav: {
      ...(account.salesNav || {}),
      accountUrl: match.href,
      ...(peopleSearchUrl ? { peopleSearchUrl } : {}),
      companyFilterName: account.salesNav?.companyFilterName || match.label || matchedQuery || accountName,
    },
  };
}

async function resolvePublicLinkedInCompanyAlias(page, accountName, settleMs = 350) {
  const query = String(accountName || '').trim();
  if (!query) {
    return null;
  }

  const searchUrl = new URL('https://www.linkedin.com/search/results/companies/');
  searchUrl.searchParams.set('keywords', query);
  await page.goto(searchUrl.toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(jitteredWait(settleMs * 2));
  await page.waitForSelector('a[href*="/company/"]', { timeout: 8000 }).catch(() => {});

  return page.evaluate((payload) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const links = Array.from(document.querySelectorAll('a[href*="/company/"]'));
    for (const link of links) {
      const href = link.href || link.getAttribute('href') || '';
      let parsed = null;
      try {
        parsed = new URL(href, window.location.origin);
      } catch {
        parsed = null;
      }
      if (!parsed || !/linkedin\.com$/i.test(parsed.hostname) || !/^\/company\/[^/]+\/?$/i.test(parsed.pathname)) {
        continue;
      }

      const row = link.closest('li, article, [data-chameleon-result-urn], .reusable-search__result-container') || link;
      const rowText = normalize(row.innerText || '');
      const linkText = normalize(link.innerText || link.textContent || '');
      const linkedinName = (linkText || rowText)
        .split(/\s{2,}|\n/)
        .map((part) => normalize(part))
        .find((part) => part && !/^(follow|folgen|view|ansicht)$/i.test(part));

      if (!linkedinName) {
        continue;
      }

      parsed.search = '';
      parsed.hash = '';
      return {
        linkedinName,
        linkedinCompanyUrl: parsed.toString().replace(/\/$/, ''),
        evidence: ['linkedin_company_search'],
        sourceQuery: payload.query,
      };
    }
    return null;
  }, { query }).catch(() => null);
}

function buildCompanyFilterTargets(account) {
  const candidates = [
    account?.salesNav?.accountListName,
    account?.salesNav?.companyFilterName,
    ...(Array.isArray(account?.salesNav?.companyFilterAliases) ? account.salesNav.companyFilterAliases : []),
    ...buildCompanyTargetAliases(account?.salesNav?.companyTargets),
    ...buildLinkedInCompanyUrlAliases(account?.salesNav?.linkedinCompanyUrls),
    account?.parentAccountName,
    account?.name,
  ];
  const unique = [];

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') {
      continue;
    }
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }
    if (!unique.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) {
      unique.push(trimmed);
    }

    for (const variant of buildCompanyNameVariants(trimmed)) {
      if (!unique.some((existing) => existing.toLowerCase() === variant.toLowerCase())) {
        unique.push(variant);
      }
    }
  }

  return unique;
}

function buildCompanyTargetAliases(targets) {
  return (Array.isArray(targets) ? targets : [])
    .map((target) => String(target?.linkedinName || target?.name || '').trim())
    .filter(Boolean);
}

function buildLinkedInCompanyUrlAliases(urls) {
  if (!Array.isArray(urls)) {
    return [];
  }

  const aliases = [];
  for (const url of urls) {
    try {
      const parsed = new URL(String(url));
      const match = parsed.pathname.match(/\/company\/([^/?#]+)/i);
      const slug = match?.[1];
      if (!slug) {
        continue;
      }
      const label = slug
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (label && !aliases.some((existing) => existing.toLowerCase() === label.toLowerCase())) {
        aliases.push(label);
      }
    } catch {
      // Ignore malformed operator-entered URLs; explicit aliases still carry the account.
    }
  }

  return aliases;
}

function normalizeCompanyFilterText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function cleanCompanyFilterSuggestionLabel(value) {
  return String(value || '')
    .replace(/\b(include|exclude|einschließen|ausschließen)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripCompanyLegalSuffixes(value) {
  return normalizeCompanyFilterText(value)
    .replace(/\b(gmbh|mbh|ag|se|sa|spa|s\.a\.|s\.p\.a\.|ltd|limited|inc|corp|corporation|llc|plc|group|holdings?)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreCompanyFilterCandidate(label, target, { hasIncludeButton = false } = {}) {
  const cleanLabel = cleanCompanyFilterSuggestionLabel(label);
  const normalizedLabel = normalizeCompanyFilterText(cleanLabel);
  const normalizedTarget = normalizeCompanyFilterText(target);
  const labelCore = stripCompanyLegalSuffixes(cleanLabel);
  const targetCore = stripCompanyLegalSuffixes(target);
  const targetTokens = new Set(targetCore.split(' ').filter(Boolean));
  const rowTokens = new Set(labelCore.split(' ').filter(Boolean));
  let score = 0;
  let matchType = 'none';

  if (normalizedLabel === normalizedTarget) {
    score += 100;
    matchType = 'exact';
  } else if (labelCore === targetCore) {
    score += 95;
    matchType = 'legal_suffix_exact';
  } else if (normalizedLabel.startsWith(normalizedTarget) || labelCore.startsWith(targetCore)) {
    score += 60;
    matchType = 'starts_with';
  } else if (normalizedLabel.includes(normalizedTarget) || labelCore.includes(targetCore)) {
    score += 40;
    matchType = 'partial';
  }

  for (const token of targetTokens) {
    if (rowTokens.has(token)) {
      score += 12;
    }
  }
  if (hasIncludeButton) {
    score += 10;
  }

  const confidence = Math.min(1, score / 120);
  return {
    score,
    confidence,
    matchType,
    safeToSelect: confidence >= MIN_COMPANY_FILTER_CONFIDENCE,
  };
}

function buildCompanyNameVariants(name) {
  const variants = new Set();
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return [];
  }

  const withoutParens = trimmed.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (withoutParens && withoutParens.toLowerCase() !== trimmed.toLowerCase()) {
    variants.add(withoutParens);
  }
  const withoutDanglingParens = withoutParens
    .replace(/\([^)]*$/g, ' ')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    withoutDanglingParens
    && withoutDanglingParens.toLowerCase() !== trimmed.toLowerCase()
    && withoutDanglingParens.toLowerCase() !== withoutParens.toLowerCase()
  ) {
    variants.add(withoutDanglingParens);
  }

  const withoutLegalSuffix = withoutParens
    .replace(/\b(gmbh|mbh|ag|se|sa|spa|s\.a\.|s\.p\.a\.|ltd|limited|inc|corp|corporation|llc|plc|group|holdings?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (withoutLegalSuffix && withoutLegalSuffix.toLowerCase() !== trimmed.toLowerCase()) {
    variants.add(withoutLegalSuffix);
  }

  const beforeDash = withoutParens.split(/\s[-|/]\s/)[0]?.trim();
  if (beforeDash && beforeDash.toLowerCase() !== trimmed.toLowerCase()) {
    variants.add(beforeDash);
  }

  const ampNormalized = withoutParens.replace(/\s*&\s*/g, ' and ').replace(/\s+/g, ' ').trim();
  if (ampNormalized && ampNormalized.toLowerCase() !== trimmed.toLowerCase()) {
    variants.add(ampNormalized);
  }

  return [...variants].filter((value) => value && value.length >= 3);
}

async function ensureCurrentCompanyFilterExpanded(page, settleMs) {
  await waitForAnySelector(
    page,
    [
      ...DEFAULT_SELECTORS.currentCompanyFilterButtons,
      ...DEFAULT_SELECTORS.currentCompanyInputs,
      ...DEFAULT_SELECTORS.accountFiltersButtons,
      ...DEFAULT_SELECTORS.leadFiltersButtons,
      ...DEFAULT_SELECTORS.allFiltersButtons,
    ],
    12000,
  ).catch(() => {});

  const existingInput = await findFirstVisible(page, DEFAULT_SELECTORS.currentCompanyInputs);
  if (existingInput) {
    return existingInput;
  }

  for (const selectors of [
    DEFAULT_SELECTORS.allFiltersButtons,
    DEFAULT_SELECTORS.accountFiltersButtons,
    DEFAULT_SELECTORS.leadFiltersButtons,
  ]) {
    const control = await findFirstVisible(page, selectors);
    if (!control) {
      continue;
    }
    await control.click().catch(() => {});
    await page.waitForTimeout(jitteredWait(settleMs));

    const inputAfterExpand = await findFirstVisible(page, DEFAULT_SELECTORS.currentCompanyInputs);
    if (inputAfterExpand) {
      return inputAfterExpand;
    }

    const toggleAfterExpand = await findFirstVisible(page, DEFAULT_SELECTORS.currentCompanyFilterButtons);
    if (toggleAfterExpand) {
      await toggleAfterExpand.click().catch(() => {});
      await page.waitForTimeout(jitteredWait(settleMs));
      const inputAfterToggle = await findFirstVisible(page, DEFAULT_SELECTORS.currentCompanyInputs);
      if (inputAfterToggle) {
        return inputAfterToggle;
      }
    }
  }

  const toggleButton = await findFirstVisible(page, DEFAULT_SELECTORS.currentCompanyFilterButtons);
  if (!toggleButton) {
    throw new Error('Current company filter toggle not found');
  }

  await toggleButton.click();
  await page.waitForTimeout(jitteredWait(settleMs));

  const input = await findFirstVisible(page, DEFAULT_SELECTORS.currentCompanyInputs);
  if (!input) {
    throw new Error('Current company filter input did not appear');
  }

  return input;
}

async function openPeopleSearchFromAccountPage(page, account, settleMs) {
  const accountUrl = account?.salesNav?.accountUrl;
  if (!accountUrl) {
    return false;
  }

  await page.goto(accountUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(jitteredWait(settleMs * 2));

  const directPeopleLink = await extractAccountPagePeopleSearchUrl(page);

  if (directPeopleLink) {
    await page.goto(ensurePeopleSearchHasExpandedFilters(directPeopleLink), { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(jitteredWait(settleMs));
    return /\/sales\/search\/people/i.test(page.url());
  }

  const peopleControl = await findFirstVisible(page, DEFAULT_SELECTORS.accountPeopleLinks);
  if (!peopleControl) {
    return false;
  }

  await peopleControl.click().catch(() => {});
  await page.waitForTimeout(jitteredWait(settleMs * 2));
  if (!/\/sales\/search\/people/i.test(page.url())) {
    return false;
  }

  const currentUrl = ensurePeopleSearchHasExpandedFilters(page.url());
  await page.goto(currentUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(jitteredWait(settleMs));
  return true;
}

async function extractAccountPagePeopleSearchUrl(page) {
  return page.evaluate(() => {
    const candidates = [...document.querySelectorAll('a[href]')]
      .map((link) => ({
        text: (link.innerText || link.textContent || '').replace(/\s+/g, ' ').trim(),
        aria: (link.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(),
        href: link.href || null,
      }))
      .filter((link) => link.href && /\/sales\/search\/people/i.test(link.href));

    const rank = (entry) => {
      const combined = `${entry.text} ${entry.aria}`.toLowerCase();
      if (/all employees|alle mitarbeiter|see all \d|employees \(\d|employees \(\d+k/i.test(combined)) {
        return 100;
      }
      if (/view all employees/i.test(combined)) {
        return 90;
      }
      if (/decision makers|platform|devops|sre|infrastructure/i.test(combined)) {
        return 70;
      }
      if (/lead filters/i.test(combined)) {
        return 5;
      }
      return 10;
    };

    const scored = candidates
      .map((entry) => ({ ...entry, score: rank(entry) }))
      .sort((left, right) => right.score - left.score);

    return scored[0]?.href || null;
  }).catch(() => null);
}

async function selectCurrentCompanyFilterTarget(page, target, settleMs) {
  const input = await ensureCurrentCompanyFilterExpanded(page, settleMs);
  await input.click();
  await input.fill('');
  await input.fill(target);
  await page.waitForTimeout(jitteredWait(settleMs * 2));

  const match = await page.evaluate((payload) => {
    const normalize = (value) => (value || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const cleanSuggestionLabel = (value) => String(value || '')
      .replace(/\b(include|exclude|einschließen|ausschließen)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const stripLegal = (value) => normalize(value).replace(/\b(gmbh|mbh|ag|se|sa|spa|s\.a\.|s\.p\.a\.|ltd|limited|inc|corp|corporation|llc|plc|group|holdings?)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const tokenSet = (value) => new Set(stripLegal(value).split(' ').filter(Boolean));
    const targetValue = normalize(payload.target);
    const targetCore = stripLegal(payload.target);
    const targetTokens = tokenSet(payload.target);
    const rowSelectors = payload.rowSelectors.join(',');
    const actionSelectors = 'button,[role="button"],input,svg';

    const extractLabel = (row) => {
      const clone = row.cloneNode(true);
      clone.querySelectorAll(actionSelectors).forEach((node) => node.remove());
      return cleanSuggestionLabel(clone.textContent || row.textContent || '');
    };

    const rows = Array.from(document.querySelectorAll(rowSelectors))
      .filter((row) => {
        const rect = row.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

    const scored = rows.map((row, index) => {
      const label = extractLabel(row);
      const normalizedLabel = normalize(label);
      const normalizedCore = stripLegal(label);
      let score = 0;
      let matchType = 'none';
      if (normalizedLabel === targetValue) {
        score += 100;
        matchType = 'exact';
      } else if (normalizedCore === targetCore) {
        score += 95;
        matchType = 'legal_suffix_exact';
      } else if (normalizedLabel.startsWith(targetValue) || normalizedCore.startsWith(targetCore)) {
        score += 60;
        matchType = 'starts_with';
      } else if (normalizedLabel.includes(targetValue) || normalizedCore.includes(targetCore)) {
        score += 40;
        matchType = 'partial';
      }

      const rowTokens = tokenSet(label);
      let overlap = 0;
      for (const token of targetTokens) {
        if (rowTokens.has(token)) {
          overlap += 1;
        }
      }
      score += overlap * 12;

      const includeButton = row.querySelector(actionSelectors);
      if (includeButton && /einschließen|include/i.test(includeButton.textContent || '')) {
        score += 10;
      }

      return {
        index,
        score,
        confidence: Math.min(1, score / 120),
        label,
        matchType,
      };
    }).filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score);

    return scored[0] || null;
  }, {
    target,
    rowSelectors: DEFAULT_SELECTORS.currentCompanySuggestionRows,
  }).catch(() => null);

  if (!match) {
    return null;
  }
  if (Number(match.confidence || 0) < MIN_COMPANY_FILTER_CONFIDENCE) {
    return {
      ok: false,
      reason: 'low_confidence_company_filter_match',
      target,
      label: match.label,
      confidence: match.confidence,
      matchType: match.matchType,
    };
  }

  const rowLocator = page.locator(DEFAULT_SELECTORS.currentCompanySuggestionRows.join(',')).nth(match.index);
  const includeButton = await findFirstVisibleInScope(rowLocator, DEFAULT_SELECTORS.includeButtons);
  if (includeButton) {
    await includeButton.click();
    await page.waitForTimeout(jitteredWait(settleMs));
    return {
      ok: true,
      label: match.label,
    };
  }

  await rowLocator.click().catch(() => {});
  await page.waitForTimeout(jitteredWait(settleMs));
  const selected = await page.evaluate((label) => {
    const text = (document.body?.innerText || '').toLowerCase();
    return text.includes(String(label || '').toLowerCase());
  }, match.label).catch(() => false);

  return selected
    ? {
      ok: true,
      label: match.label,
    }
    : null;
}

async function progressiveScroll(page, settleMs) {
  const previousHeight = await page.evaluate(() => document.scrollingElement?.scrollHeight || document.body.scrollHeight);
  await page.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.9)));
  await page.waitForTimeout(jitteredWait(settleMs));
  const nextHeight = await page.evaluate(() => document.scrollingElement?.scrollHeight || document.body.scrollHeight);
  return nextHeight >= previousHeight;
}

async function waitForHydratedLeadResults(page, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ready = await page.evaluate(() => {
      const anchor = document.querySelector('a[href*="/sales/lead/"]');
      if (!anchor) {
        return false;
      }
      const card = anchor.closest('li') || anchor.parentElement;
      const text = (card?.innerText || '').trim();
      return text.split('\n').filter(Boolean).length >= 6 || text.length >= 180;
    }).catch(() => false);

    if (ready) {
      return true;
    }

    await page.waitForTimeout(300);
  }

  throw new Error('Lead results did not fully hydrate in time');
}

async function extractCandidatesFromListPage(page, account, template) {
  const fromLeadLinks = await page.locator(DEFAULT_SELECTORS.leadLinks[0]).evaluateAll((anchors, meta) => {
    const seen = new Set();
    const rows = [];

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href');
      if (!href || seen.has(href)) {
        continue;
      }

      const card = anchor.closest('li')
        || anchor.closest('[data-test-search-result]')
        || anchor.closest('[data-x-search-result]')
        || anchor.parentElement;
      const text = (card?.innerText || '').trim();
      if (!text) {
        continue;
      }

      const canonicalLeadAnchor = card.querySelector('.artdeco-entity-lockup__title a[href*="/sales/lead/"]')
        || card.querySelector('a[data-lead-search-result="profile-link-st171"]')
        || card.querySelector('a[href*="/sales/lead/"]');
      const canonicalHref = canonicalLeadAnchor?.getAttribute('href') || href;
      if (seen.has(canonicalHref)) {
        continue;
      }
      seen.add(canonicalHref);

      const lines = text.split('\\n').map((value) => value.trim()).filter(Boolean);
      const cleanedLines = lines.filter((value) => !/zur Auswahl hinzufügen/i.test(value));
      const nameNode = card.querySelector('.artdeco-entity-lockup__title a span')
        || card.querySelector('.artdeco-entity-lockup__title a');
      const titleNode = card.querySelector('span[data-anonymize="title"]');
      const companyNode = card.querySelector('a[data-anonymize="company-name"]');
      const locationNode = card.querySelector('span[data-anonymize="location"]');
      const summaryNode = card.querySelector('[data-anonymize="person-blurb"]');
      const fallbackName = cleanedLines.find((value) =>
        value
        && !/kontakt|crm-system|nachricht|speichern|über:|gemeinsame kontakte|teamlink|kaufinteresse/i.test(value)
      ) || `${meta.accountName || 'Search'} candidate`;
      const locationIndex = lines.findIndex((value) =>
        /vereinigte staaten|deutschland|kanada|irland|kalifornien|texas|remote|region|grafschaft|niederlande|spanien|polen|frankreich/i.test(value)
      );
      const titleCompanyLine = cleanedLines.find((value, index) =>
        index > 0 && /engineer|director|head|manager|platform|reliability|infrastructure|devops|sre/i.test(value)
      ) || '';
      const split = titleCompanyLine.split(/\\s{2,}/).map((value) => value.trim()).filter(Boolean);
      const title = (titleNode?.textContent || '').trim() || split[0] || lines[1] || meta.defaultTitle || 'Unknown title';
      const company = (companyNode?.textContent || '').trim() || split[1] || null;
      const headline = cleanedLines.slice(1, Math.min(cleanedLines.length, 5)).join(' | ');
      const outOfNetwork = /\bout of network\b|\boutside your network\b|außerhalb deines netzwerks|\b3rd\b|\bthird degree\b/i.test(text);
      const summaryIndex = cleanedLines.findIndex((value) => value.startsWith('Über:') || value.startsWith('About:'));
      const summary = (summaryNode?.textContent || '').trim() || (summaryIndex >= 0
        ? cleanedLines.slice(summaryIndex, Math.min(cleanedLines.length, summaryIndex + 3)).join(' ')
        : headline);
      const parsedName = ((nameNode?.textContent || '').trim() || fallbackName)
        .replace(/\s+ist erreichbar\.?$/i, '')
        .trim();

      rows.push({
        fullName: parsedName,
        title,
        company,
        headline,
        location: (locationNode?.textContent || '').trim() || (locationIndex >= 0 ? lines[locationIndex] : null),
        profileUrl: canonicalHref,
        salesNavigatorUrl: canonicalHref,
        summary,
        outOfNetwork,
        networkDistance: outOfNetwork ? 'out_of_network' : null,
        fromListPage: true,
      });
    }

    return rows;
  }, {
    accountName: account.name,
    defaultTitle: template.titleIncludes?.[0] || null,
  }).catch(() => []);

  if (fromLeadLinks.length > 0) {
    return fromLeadLinks.map((candidate) => ({
      ...candidate,
      profileUrl: absolutizeLinkedInUrl(candidate.profileUrl),
      salesNavigatorUrl: absolutizeLinkedInUrl(candidate.salesNavigatorUrl),
      sourceTemplateId: template.id,
    }));
  }

  for (const selector of DEFAULT_SELECTORS.candidateCards) {
    const results = await page.locator(selector).evaluateAll((nodes, meta) => {
      return nodes.map((node) => {
        const text = (node.innerText || node.textContent || '').trim();
        const lines = text.split('\n').map((value) => value.trim()).filter(Boolean);
        const anchor = node.querySelector('a[href]');
        const href = anchor?.getAttribute('href') || null;
        return {
          fullName: lines[0] || `${meta.accountName} candidate`,
          title: lines[1] || meta.defaultTitle || 'Unknown title',
          headline: lines.slice(1, 3).join(' | '),
          location: lines.find((value) => /germany|sweden|uk|france|poland|remote|spain|netherlands|italy/i.test(value)) || null,
          profileUrl: href,
          salesNavigatorUrl: href && href.includes('/sales/') ? href : null,
          summary: text.slice(0, 500),
          outOfNetwork: /\bout of network\b|\boutside your network\b|außerhalb deines netzwerks|\b3rd\b|\bthird degree\b/i.test(text),
          networkDistance: /\bout of network\b|\boutside your network\b|außerhalb deines netzwerks|\b3rd\b|\bthird degree\b/i.test(text) ? 'out_of_network' : null,
          fromListPage: true,
        };
      }).filter((candidate) => candidate.fullName && candidate.title);
    }, {
      accountName: account.name,
      defaultTitle: template.titleIncludes?.[0] || null,
    }).catch(() => []);

    if (results.length > 0) {
      return results.map((candidate) => ({
        ...candidate,
        profileUrl: absolutizeLinkedInUrl(candidate.profileUrl),
        salesNavigatorUrl: absolutizeLinkedInUrl(candidate.salesNavigatorUrl),
        sourceTemplateId: template.id,
      }));
    }
  }

  return [];
}

const CONNECT_ACTION_PATTERNS = [
  /^(connect|vernetzen|einladen)$/i,
  /^invite(?:\b|\s.+)$/i,
  /^connect\s*[—-]\s*pending$/i,
  /^vernetzen\s*[—-]\s*ausstehend$/i,
];

const SEND_INVITATION_PATTERNS = [
  /^send invitation$/i,
  /^send without a note$/i,
  /^send$/i,
  /^einladung senden$/i,
  /^ohne nachricht senden$/i,
];

function normalizeActionLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function matchesAnyActionPattern(action, patterns) {
  const variants = [action?.text, action?.aria].map(normalizeActionLabel).filter(Boolean);
  return variants.some((value) => patterns.some((pattern) => pattern.test(value)));
}

function classifyPostClickConnectLabel(value) {
  const normalized = normalizeActionLabel(value).toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  if (/\bpending\b|\bausstehend\b|\bsent\b|\bgesendet\b/.test(normalized)) {
    return 'pending';
  }
  if (/\balready connected\b|\bconnected\b|\bvernetzt\b/.test(normalized)) {
    return 'connected';
  }
  return 'unknown';
}

function classifyConnectSurfaceInspectionError(error) {
  if (!error) {
    return null;
  }

  const code = String(error.code || '').trim() || null;
  const message = String(error.message || '').trim() || 'unknown inspect-connect-surface error';
  if (code === 'LEAD_PAGE_SPINNER_STUCK') {
    return {
      code,
      classification: 'spinner_shell',
      message,
    };
  }

  return {
    code,
    classification: 'open_failed',
    message,
  };
}

function classifyNoButtonConnectState(overflowState, unavailableContext = {}) {
  if (overflowState?.hasPendingConnect) {
    return {
      status: 'already_sent',
      note: 'invitation already pending',
      driver: 'playwright',
    };
  }

  if (unavailableContext?.hasThirdDegree || unavailableContext?.hasRestrictedConnect) {
    return {
      status: 'connect_unavailable',
      reason: unavailableContext.hasThirdDegree ? 'structural_3rd_degree' : 'structural_restricted_profile',
      note: unavailableContext.hasThirdDegree
        ? 'connect unavailable because lead appears to be 3rd-degree or out of network'
        : 'connect unavailable because LinkedIn shows a restricted profile state',
      driver: 'playwright',
    };
  }

  return null;
}

function classifyConnectSurfaceDiagnostic({
  initialState = {},
  inspectionError = null,
  visibleActions = [],
  overflowClassification = {},
}) {
  if (inspectionError?.classification === 'spinner_shell') {
    return 'manual_review_spinner_shell';
  }

  if (initialState?.hasInvitationSent || overflowClassification?.hasPendingConnect) {
    return 'already_covered_pending';
  }

  if (initialState?.hasConnectedMessage) {
    return 'already_covered_connected';
  }

  const hasVisibleConnectAction = (visibleActions || [])
    .some((action) => matchesAnyActionPattern(action, CONNECT_ACTION_PATTERNS));
  if (hasVisibleConnectAction) {
    return 'visible_primary_connect';
  }

  if (overflowClassification?.hasConnectAction) {
    return 'overflow_only_connect';
  }

  if (!initialState?.hasRenderableLeadPage) {
    return 'unrendered_lead_page';
  }

  return 'connect_unavailable';
}

async function collectVisibleActionDescriptors(scope, options = {}) {
  const controls = scope.locator('button,[role="button"],[role="menuitem"],a');
  const count = await controls.count().catch(() => 0);
  const limit = Math.min(count, options.limit || 40);
  const descriptors = [];

  for (let index = 0; index < limit; index += 1) {
    const locator = controls.nth(index);
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    const text = normalizeActionLabel(await locator.innerText().catch(() => ''));
    const aria = normalizeActionLabel(await locator.getAttribute('aria-label').catch(() => ''));
    if (!text && !aria) {
      continue;
    }

    descriptors.push({ text, aria });
  }

  return descriptors;
}

async function findVisibleActionControl(scope, patterns) {
  const controls = scope.locator('button,[role="button"],[role="menuitem"],a');
  const count = await controls.count().catch(() => 0);
  const limit = Math.min(count, 40);

  for (let index = 0; index < limit; index += 1) {
    const locator = controls.nth(index);
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    const text = normalizeActionLabel(await locator.innerText().catch(() => ''));
    const aria = normalizeActionLabel(await locator.getAttribute('aria-label').catch(() => ''));
    if (!text && !aria) {
      continue;
    }

    if (patterns.some((pattern) => pattern.test(text) || pattern.test(aria))) {
      return locator;
    }
  }

  return null;
}

async function findSemanticConnectMenuControl(scope) {
  const controls = scope.locator('button,[role="button"],[role="menuitem"],a');
  const count = await controls.count().catch(() => 0);
  const limit = Math.min(count, 40);

  for (let index = 0; index < limit; index += 1) {
    const locator = controls.nth(index);
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    const text = normalizeActionLabel(await locator.innerText().catch(() => ''));
    const aria = normalizeActionLabel(await locator.getAttribute('aria-label').catch(() => ''));
    const matches = [text, aria]
      .filter(Boolean)
      .some((value) => classifyConnectMenuActionLabel(value).isConnectAction);
    if (matches) {
      return locator;
    }
  }

  return null;
}

async function findFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function findCandidateRowInVisibleResults(page, candidate) {
  const targetName = String(candidate?.fullName || '').trim().toLowerCase();
  const targetStem = String(candidate?.salesNavigatorUrl || candidate?.profileUrl || '')
    .split('?')[0]
    .trim()
    .toLowerCase();
  const leadLinks = page.locator('a[href*="/sales/lead/"]');
  const count = await leadLinks.count().catch(() => 0);
  const limit = Math.min(count, 80);

  for (let index = 0; index < limit; index += 1) {
    const link = leadLinks.nth(index);
    const text = await link.innerText().catch(() => '');
    const href = await link.getAttribute('href').catch(() => '');
    const normalizedText = String(text || '').trim().toLowerCase();
    const normalizedStem = String(absolutizeLinkedInUrl(href || '') || '')
      .split('?')[0]
      .trim()
      .toLowerCase();
    const matchesName = targetName && normalizedText === targetName;
    const matchesStem = targetStem && normalizedStem && normalizedStem === targetStem;
    if (!matchesName && !matchesStem) {
      continue;
    }

    const row = link.locator('xpath=ancestor::*[self::li or self::tr or self::article][1]');
    if (await row.count().catch(() => 0)) {
      return row.first();
    }
  }

  return null;
}

async function findSaveButtonInCandidateRow(row) {
  const exact = await findFirstVisibleInScope(row, [
    'button[aria-label*="Save to list"]',
    'button[aria-label*="Save"]',
    'button[aria-label*="speichern"]',
    'button:has-text("Save")',
    'button:has-text("Saved")',
    'button:has-text("Speichern")',
  ]);
  if (exact) {
    return exact;
  }

  const controls = row.locator('button,[role="button"]');
  const count = await controls.count().catch(() => 0);
  for (let index = 0; index < Math.min(count, 20); index += 1) {
    const locator = controls.nth(index);
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const text = await locator.innerText().catch(() => '');
    const aria = await locator.getAttribute('aria-label').catch(() => '');
    const combined = `${text || ''} ${aria || ''}`.toLowerCase();
    if (combined.includes('save')) {
      return locator;
    }
  }

  return null;
}

async function saveCandidateToListFromVisibleResults(page, candidate, listInfo, options = {}) {
  const {
    settleMs = 350,
    allowListCreate = false,
    maxScrollSteps = 4,
  } = options;

  for (let step = 0; step <= maxScrollSteps; step += 1) {
    const row = await findCandidateRowInVisibleResults(page, candidate);
    if (row) {
      await row.scrollIntoViewIfNeeded().catch(() => {});
      await page.waitForTimeout(Math.max(120, settleMs)).catch(() => {});
      const saveButton = await findSaveButtonInCandidateRow(row);
      if (!saveButton) {
        throw new Error(`Save button not found in results row for ${candidate.fullName}`);
      }

      await saveButton.click().catch(() => {});
      await page.waitForTimeout(Math.max(180, settleMs)).catch(() => {});
      await waitForAnySelector(page, DEFAULT_SELECTORS.savePanelMarkers, 12000).catch(() => {});

      const rowOutcome = await clickVisibleListRow(page, listInfo.listName);
      if (rowOutcome?.outcome === 'already_saved') {
        await page.waitForTimeout(Math.max(180, settleMs)).catch(() => {});
        return {
          status: 'already_saved',
          listName: listInfo.listName,
          selectionMode: 'results_row_fallback',
        };
      }
      if (rowOutcome?.outcome === 'clicked') {
        await page.waitForTimeout(Math.max(180, settleMs)).catch(() => {});
        return { status: 'saved', listName: listInfo.listName, selectionMode: 'results_row_fallback' };
      }

      if (!allowListCreate) {
        throw new Error(`List ${listInfo.listName} was not found from results-row fallback. Creation is disabled in safe mode.`);
      }

      return null;
    }

    const advanced = await progressiveScroll(page, settleMs).catch(() => false);
    if (!advanced) {
      break;
    }
  }

  return null;
}

async function findSaveToListButton(page) {
  const exactCandidates = [
    'button[data-x--lead-lists--dropdown-trigger-save]',
    'button[aria-label*="Save to list"]',
    'button[aria-label*="Add to a custom list"]',
    'button[class*="_save-to-list-button_"]',
  ];

  const exact = await findFirstVisible(page, exactCandidates);
  if (exact) {
    return exact;
  }

  const fallbackButtons = await page.locator('button').evaluateAll((els) => els
    .map((el, index) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const visible = style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
      return {
        index,
        text: (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim(),
        aria: el.getAttribute('aria-label') || '',
        cls: String(el.className || ''),
        visible,
      };
    })
    .filter((item) => item.visible)
    .filter((item) => {
      const combined = `${item.text} ${item.aria} ${item.cls}`.toLowerCase();
      return (
        (combined.includes('save to list') || combined.includes('custom list') || combined.includes('_save-to-list-button_'))
        && !combined.includes('saved searches')
      );
    }));

  if (!fallbackButtons.length) {
    return null;
  }

  return page.locator('button').nth(fallbackButtons[0].index);
}

async function findListNameInput(page) {
  const exact = await findFirstVisible(page, [
    'input[placeholder*="Q4 Leads"]',
    'input[id^="text-input-ember"]',
  ]);
  if (exact) {
    return exact;
  }

  const inputs = page.locator('input');
  const count = await inputs.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    const visible = await input.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }

    const placeholder = await input.getAttribute('placeholder').catch(() => '');
    const id = await input.getAttribute('id').catch(() => '');
    const combined = `${placeholder || ''} ${id || ''}`.toLowerCase();
    if (combined.includes('q4') || combined.includes('text-input')) {
      return input;
    }
  }

  return null;
}

async function findFirstVisibleInScope(scope, selectors) {
  for (const selector of selectors) {
    const locator = scope.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      return locator;
    }
  }
  return null;
}

async function tryClickVisibleText(page, textValue) {
  const escaped = escapeRegex(textValue);
  const candidates = [
    page.getByText(new RegExp(`^${escaped}$`, 'i')).first(),
    page.locator(`[aria-label*="${textValue}"]`).first(),
  ];

  for (const locator of candidates) {
    if (await locator.isVisible().catch(() => false)) {
      await locator.click().catch(() => {});
      return true;
    }
  }

  return false;
}

async function evaluateSalesNavListRowSelected(locator) {
  return locator.evaluate((element) => {
    const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const nodes = [element, ...element.querySelectorAll('*')];
    return nodes.some((node) => {
      if (!node || typeof node.getAttribute !== 'function') {
        return false;
      }
      const ariaChecked = String(node.getAttribute('aria-checked') || '').toLowerCase();
      const ariaSelected = String(node.getAttribute('aria-selected') || '').toLowerCase();
      const ariaPressed = String(node.getAttribute('aria-pressed') || '').toLowerCase();
      const ariaCurrent = String(node.getAttribute('aria-current') || '').toLowerCase();
      if (ariaChecked === 'true' || ariaSelected === 'true' || ariaPressed === 'true' || ariaCurrent === 'true') {
        return true;
      }
      if (node.tagName === 'INPUT' && node.checked) {
        return true;
      }
      const className = String(node.className || '').toLowerCase();
      if (/(selected|checked|is-selected)/.test(className) && !/(unselected|unchecked)/.test(className)) {
        return true;
      }
      const label = normalize(node.getAttribute('aria-label') || '');
      return label.includes('selected')
        || label.includes('ausgewählt')
        || label.includes('saved')
        || label.includes('gespeichert');
    });
  }).catch(() => false);
}

async function clickVisibleListRow(page, listName) {
  const escaped = escapeRegex(listName);
  const exactAria = page.locator(`button[aria-label*="${listName}"]`);
  const count = await exactAria.count().catch(() => 0);
  for (let index = 0; index < count; index += 1) {
    const locator = exactAria.nth(index);
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const aria = await locator.getAttribute('aria-label').catch(() => '');
    const text = await locator.innerText().catch(() => '');
    const combined = `${text || ''} ${aria || ''}`.toLowerCase();
    if (combined.includes('create new list') || combined.includes('saved searches')) {
      continue;
    }
    if (await evaluateSalesNavListRowSelected(locator)) {
      return { outcome: 'already_saved', listName, selectionMode: 'existing_list' };
    }
    await locator.click().catch(() => {});
    return { outcome: 'clicked', listName, selectionMode: 'existing_list' };
  }

  const buttonByText = page.getByRole('button', {
    name: new RegExp(escaped, 'i'),
  });
  const byTextCount = await buttonByText.count().catch(() => 0);
  for (let index = 0; index < byTextCount; index += 1) {
    const locator = buttonByText.nth(index);
    const visible = await locator.isVisible().catch(() => false);
    if (!visible) {
      continue;
    }
    const text = await locator.innerText().catch(() => '');
    if (!new RegExp(escaped, 'i').test(text || '')) {
      continue;
    }
    const ariaSecond = await locator.getAttribute('aria-label').catch(() => '');
    const combinedSecond = `${text || ''} ${ariaSecond || ''}`.toLowerCase();
    if (combinedSecond.includes('create new list') || combinedSecond.includes('saved searches')) {
      continue;
    }
    if (await evaluateSalesNavListRowSelected(locator)) {
      return { outcome: 'already_saved', listName, selectionMode: 'existing_list' };
    }
    await locator.click().catch(() => {});
    return { outcome: 'clicked', listName, selectionMode: 'existing_list' };
  }

  return null;
}

function jitteredWait(base) {
  return Math.round(Math.max(120, base) * (0.8 + (Math.random() * 0.5)));
}

function ensurePeopleSearchHasExpandedFilters(url) {
  const fallback = 'https://www.linkedin.com/sales/search/people?viewAllFilters=true';
  if (!url) {
    return fallback;
  }

  try {
    const parsed = new URL(url);
    if (/linkedin\.com$/i.test(parsed.hostname) && /\/sales\/search\/people/i.test(parsed.pathname)) {
      parsed.searchParams.set('viewAllFilters', 'true');
      return parsed.toString();
    }
  } catch {
    return url;
  }

  return url;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeCandidateCollectionKey(candidate) {
  const url = candidate?.salesNavigatorUrl || candidate?.profileUrl || '';
  if (url) {
    try {
      const parsed = new URL(url, 'https://www.linkedin.com');
      parsed.search = '';
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return String(url).split('?')[0].split('#')[0];
    }
  }

  return `${String(candidate?.fullName || '').toLowerCase().trim()}:${String(candidate?.title || '').toLowerCase().trim()}`;
}

function normalizeSeenCandidateKeys(value) {
  if (!value) {
    return new Set();
  }
  if (value instanceof Set) {
    return value;
  }
  if (Array.isArray(value)) {
    return new Set(value);
  }
  return new Set();
}

async function detectRateLimit(page) {
  if (!page) {
    return false;
  }
  const [title, bodyText] = await Promise.all([
    page.title().catch(() => ''),
    page.locator('body').innerText().catch(() => ''),
  ]);
  const text = `${title}\n${bodyText}`.toLowerCase();
  return /too many requests|zu viele anfragen|rate limit|rate-limit/.test(text);
}

function summarizeDuplicateSweepPage(candidates, seenCandidateKeys, threshold = 0.8) {
  const totalCount = Array.isArray(candidates) ? candidates.length : 0;
  if (totalCount === 0) {
    return {
      totalCount: 0,
      duplicateCount: 0,
      duplicateRatio: 0,
      shouldShortCircuit: false,
    };
  }

  const seen = normalizeSeenCandidateKeys(seenCandidateKeys);
  const duplicateCount = candidates
    .map((candidate) => normalizeCandidateCollectionKey(candidate))
    .filter((key) => seen.has(key))
    .length;
  const duplicateRatio = duplicateCount / totalCount;

  return {
    totalCount,
    duplicateCount,
    duplicateRatio,
    shouldShortCircuit: duplicateRatio >= threshold,
  };
}

function summarizeSweepPageProgress({
  candidates,
  seenCandidateKeys,
  threshold = 0.8,
  step = 0,
  templateId = 'sweep',
} = {}) {
  const duplicateSummary = summarizeDuplicateSweepPage(candidates, seenCandidateKeys, threshold);
  if (step === 0 && duplicateSummary.totalCount === 0) {
    return {
      ...duplicateSummary,
      shouldShortCircuit: true,
      exitReason: 'empty_first_page',
      logMessage: `[${templateId}] early exit: empty first page`,
    };
  }
  if (step === 0 && duplicateSummary.shouldShortCircuit) {
    return {
      ...duplicateSummary,
      exitReason: 'duplicate_overlap',
      logMessage: `[${templateId}] early exit: ${Math.round(duplicateSummary.duplicateRatio * 100)}% overlap`,
    };
  }

  return {
    ...duplicateSummary,
    shouldShortCircuit: false,
    exitReason: null,
    logMessage: null,
  };
}

function logSweepEarlyExit(logger, summary) {
  if (!summary?.logMessage || !logger) {
    return;
  }
  if (typeof logger.info === 'function') {
    logger.info(summary.logMessage);
    return;
  }
  if (typeof logger.debug === 'function') {
    logger.debug(summary.logMessage);
  }
}

function absolutizeLinkedInUrl(href) {
  if (!href) {
    return href;
  }
  return href.startsWith('http') ? href : `https://www.linkedin.com${href}`;
}

module.exports = {
  PlaywrightSalesNavigatorDriver,
  buildCompanyFilterTargets,
  buildCompanyTargetAliases,
  buildLinkedInCompanyUrlAliases,
  buildBrowserProcessEnv,
  classifyLeadDetailSnapshot,
  clickVisibleListRow,
  ensurePeopleSearchHasExpandedFilters,
  findListNameInput,
  findSaveToListButton,
  collectVisibleActionDescriptors,
  findVisibleActionControl,
  findSemanticConnectMenuControl,
  classifyConnectSurfaceDiagnostic,
  classifyConnectSurfaceInspectionError,
  classifyNoButtonConnectState,
  classifyPostClickConnectLabel,
  classifyOverflowConnectMenuItems,
  readConnectUnavailableContext,
  readConnectState,
  jitteredWait,
  normalizeActionLabel,
  detectRateLimit,
  cleanCompanyFilterSuggestionLabel,
  summarizeSweepPageProgress,
  summarizeDuplicateSweepPage,
  scoreCompanyFilterCandidate,
};
