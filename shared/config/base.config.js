const path = require('path');
const { BASE_URL } = require('../constants/routes');
const { TIMEOUTS, VIEWPORT } = require('../constants/timeouts');

const BASE_CONFIG = {
  fixturesFolder: path.resolve(__dirname, '../fixtures'),
  watchForFileChanges: false,
  waitForAnimations: true,
  chromeWebSecurity: false,
  blockHosts: [],
  pageLoadTimeout: TIMEOUTS.PAGE_LOAD,
  retries: 2,
  viewportHeight: VIEWPORT.HEIGHT,
  viewportWidth: VIEWPORT.WIDTH,
  video: false,
  e2e: {
    baseUrl: BASE_URL,
    fixturesFolder: path.resolve(__dirname, '../fixtures'),
  },
};

module.exports = { BASE_CONFIG };