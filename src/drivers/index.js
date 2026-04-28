const { MockDriver } = require('./mock-driver');
const { BrowserHarnessSalesNavigatorDriver } = require('./browser-harness-sales-nav');
const { HybridSalesNavigatorDriver } = require('./hybrid-sales-nav');
const { PlaywrightSalesNavigatorDriver } = require('./playwright-sales-nav');

function createDriver(name, options = {}) {
  switch (name) {
    case 'browser-harness':
      return new BrowserHarnessSalesNavigatorDriver(options);
    case 'hybrid':
      return new HybridSalesNavigatorDriver(options);
    case 'playwright':
      return new PlaywrightSalesNavigatorDriver(options);
    case 'mock':
    default:
      return new MockDriver(options);
  }
}

module.exports = {
  createDriver,
  BrowserHarnessSalesNavigatorDriver,
  HybridSalesNavigatorDriver,
  MockDriver,
  PlaywrightSalesNavigatorDriver,
};
