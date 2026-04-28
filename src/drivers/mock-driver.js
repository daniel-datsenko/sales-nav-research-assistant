const { DriverAdapter } = require('./driver-adapter');
const { stableId } = require('../lib/id');

const TITLE_POOL = [
  'Senior Site Reliability Engineer',
  'Director of Platform Engineering',
  'Staff Infrastructure Engineer',
  'Head of Observability',
  'Engineering Manager, Cloud Platform',
  'Principal DevOps Engineer',
];

class MockDriver extends DriverAdapter {
  async openSession(context) {
    this.context = context;
  }

  async checkSessionHealth() {
    return {
      ok: true,
      authenticated: true,
      state: 'authenticated',
      mode: 'mock',
      url: 'mock://sales/home',
    };
  }

  async scrollAndCollectCandidates(account, template) {
    const max = template.maxCandidates || 6;
    const base = stableId('seed', account.accountId, template.id);
    const candidates = [];

    for (let index = 0; index < Math.min(max, 4); index += 1) {
      const title = TITLE_POOL[index % TITLE_POOL.length];
      candidates.push({
        fullName: `${account.name.split(' ')[0]} Candidate ${index + 1}`,
        title,
        headline: `${title} building observability and production systems at ${account.name}`,
        location: account.country || account.region || 'Unknown',
        profileUrl: `https://www.linkedin.com/in/${base}-${index + 1}`,
        salesNavigatorUrl: `https://www.linkedin.com/sales/lead/${base}-${index + 1}`,
        summary: `Owns platform reliability, monitoring, tracing and on-call tooling for ${account.name}.`,
        sourceTemplateId: template.id,
      });
    }

    return candidates;
  }

  async saveCandidateToList(candidate, listInfo, context) {
    return {
      status: context.dryRun ? 'simulated' : 'saved',
      listName: listInfo.list_name || listInfo.listName || listInfo.name || candidate.listName,
    };
  }

  async sendConnect(candidate, context) {
    return {
      status: context.dryRun ? 'simulated' : 'sent',
      note: context.dryRun ? 'dry-run only' : null,
    };
  }
}

module.exports = {
  MockDriver,
};
