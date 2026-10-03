const { defineConfig } = require('cypress')
const { BASE_CONFIG } = require('../../shared/config/base.config')

module.exports = defineConfig({
  ...BASE_CONFIG,
  e2e: {
    ...BASE_CONFIG.e2e,
    testIsolation: true,
    numTestsKeptInMemory: 5,
    setupNodeEvents(on, config) {
      // Cypress v16 node event listeners
    },
  },
})
