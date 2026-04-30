const { DriverAdapter } = require('./driver-adapter');
const { PlaywrightSalesNavigatorDriver } = require('./playwright-sales-nav');

class HybridSalesNavigatorDriver extends DriverAdapter {
  constructor(options = {}) {
    super();
    this.options = { ...options };
    this.discoveryDriver = options.discoveryDriver || new PlaywrightSalesNavigatorDriver({
      ...options,
      allowMutations: options.allowMutations,
    });
    this.mutationDriver = options.mutationDriver || this.discoveryDriver;
    this.runContext = null;
    this.mutationOpenError = null;
  }

  async openSession(context) {
    this.runContext = context;
    this.mutationOpenError = null;
    await this.discoveryDriver.openSession(context);
    if (this.mutationDriver !== this.discoveryDriver) {
      try {
        await this.mutationDriver.openSession(context);
      } catch (error) {
        this.mutationOpenError = error;
      }
    }
  }

  async checkSessionHealth() {
    const discovery = await this.discoveryDriver.checkSessionHealth();
    let mutation = null;

    if (this.mutationDriver === this.discoveryDriver) {
      mutation = discovery;
    } else if (this.mutationOpenError) {
      mutation = {
        ok: false,
        authenticated: false,
        state: 'mutation_driver_not_ready',
        mode: this.mutationDriver?.options?.mode || 'custom',
        error: this.mutationOpenError.message,
      };
    } else {
      try {
        mutation = await this.mutationDriver.checkSessionHealth();
      } catch (error) {
        mutation = {
          ok: false,
          authenticated: false,
          state: 'mutation_driver_failed',
          mode: 'browser-harness',
          error: error.message,
        };
      }
    }

    const requiresMutationReady = Boolean(this.options.allowMutations) && !this.runContext?.dryRun;
    const ok = discovery.ok && (!requiresMutationReady || Boolean(mutation?.ok));
    const state = !discovery.ok
      ? discovery.state
      : (requiresMutationReady && !mutation?.ok ? mutation.state : discovery.state);

    return {
      ok,
      authenticated: ok,
      state,
      mode: 'hybrid',
      url: discovery.url || mutation?.url || null,
      discovery,
      mutation,
    };
  }

  async openAccountSearch(context) {
    return this.discoveryDriver.openAccountSearch(context);
  }

  async enumerateAccounts(accounts, context) {
    return this.discoveryDriver.enumerateAccounts(accounts, context);
  }

  async enumerateAccounts(accounts, context) {
    return this.discoveryDriver.enumerateAccounts(accounts, context);
  }

  async openAccount(account, context) {
    return this.discoveryDriver.openAccount(account, context);
  }

  async openPeopleSearch(account, context) {
    return this.discoveryDriver.openPeopleSearch(account, context);
  }

  async applySearchTemplate(template, context) {
    return this.discoveryDriver.applySearchTemplate(template, context);
  }

  async scrollAndCollectCandidates(account, template, context) {
    return this.discoveryDriver.scrollAndCollectCandidates(account, template, context);
  }

  async resolveCompanyAlias(accountName, context) {
    if (typeof this.discoveryDriver.resolveCompanyAlias !== 'function') {
      return null;
    }
    return this.discoveryDriver.resolveCompanyAlias(accountName, context);
  }

  async openCandidate(candidate, context) {
    return this.mutationDriver.openCandidate(candidate, context);
  }

  async ensureList(listName, context) {
    return this.mutationDriver.ensureList(listName, context);
  }

  async saveCandidateToList(candidate, listInfo, context) {
    return this.mutationDriver.saveCandidateToList(candidate, listInfo, context);
  }

  async sendConnect(candidate, context) {
    return this.mutationDriver.sendConnect(candidate, context);
  }

  async captureEvidence(candidate, context) {
    return this.discoveryDriver.captureEvidence(candidate, context);
  }

  async recoverFromInterruption(event, context) {
    if (this.mutationDriver === this.discoveryDriver) {
      const recovery = await this.discoveryDriver.recoverFromInterruption(event, context);
      return {
        status: recovery?.status || 'recorded',
        screenshotPath: recovery?.screenshotPath || null,
        htmlPath: recovery?.htmlPath || null,
        textPath: recovery?.textPath || null,
        discovery: recovery,
        mutation: recovery,
      };
    }

    let mutation = null;
    let discovery = null;

    try {
      mutation = await this.mutationDriver.recoverFromInterruption(event, context);
    } catch {
      mutation = null;
    }

    try {
      discovery = await this.discoveryDriver.recoverFromInterruption(event, context);
    } catch {
      discovery = null;
    }

    return {
      status: mutation?.status || discovery?.status || 'recorded',
      screenshotPath: mutation?.screenshotPath || discovery?.screenshotPath || null,
      htmlPath: discovery?.htmlPath || null,
      textPath: discovery?.textPath || null,
      mutation,
      discovery,
    };
  }

  async saveSession() {
    return this.discoveryDriver.saveSession();
  }

  async exportStorageState(targetPath) {
    return this.discoveryDriver.exportStorageState(targetPath);
  }

  async close() {
    const drivers = this.mutationDriver === this.discoveryDriver
      ? [this.discoveryDriver]
      : [this.discoveryDriver, this.mutationDriver];
    await Promise.allSettled(drivers.map((driver) => driver.close()));
  }
}

module.exports = {
  HybridSalesNavigatorDriver,
};
