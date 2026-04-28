class DriverAdapter {
  async openSession() {}
  async checkSessionHealth() {
    return { ok: false, mode: 'unknown', authenticated: false };
  }
  async openAccountSearch() {}
  async enumerateAccounts(accounts) {
    return accounts;
  }
  async openAccount() {}
  async openPeopleSearch() {}
  async applySearchTemplate() {}
  async scrollAndCollectCandidates() {
    return [];
  }
  async resolveCompanyAlias() {
    return null;
  }
  async openCandidate() {}
  async ensureList(listName) {
    return { listName, externalRef: null };
  }
  async saveCandidateToList(candidate, listInfo) {
    return { status: 'simulated', candidate, listInfo };
  }
  async sendConnect(candidate) {
    return { status: 'simulated', candidate };
  }
  async captureEvidence(candidate) {
    return { snippet: candidate.headline || candidate.title || '' };
  }
  async recoverFromInterruption(event) {
    return { status: 'recorded', event };
  }
  async saveSession() {
    return null;
  }
  async exportStorageState() {
    return null;
  }
  async close() {}
}

module.exports = {
  DriverAdapter,
};
