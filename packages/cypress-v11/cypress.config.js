const { defineConfig } = require('cypress')
const { BASE_CONFIG } = require('../../shared/config/base.config')

module.exports = defineConfig({
  ...BASE_CONFIG,
  e2e: {
    ...BASE_CONFIG.e2e,
    
    
    setupNodeEvents(on, config) {
      // Cypress v11 node event listeners
    },
  },
})
