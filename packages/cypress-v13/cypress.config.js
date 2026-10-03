const { defineConfig } = require('cypress')
const { BASE_CONFIG } = require('../../shared/config/base.config')

module.exports = defineConfig({
  ...BASE_CONFIG,
  e2e: {
    ...BASE_CONFIG.e2e,
    testIsolation: true,
    
    setupNodeEvents(on, config) {
      // Cypress v13 node event listeners
    },
  },
})
