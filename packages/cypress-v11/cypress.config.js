const { defineConfig } = require('cypress')

module.exports = defineConfig({
  e2e: {
    baseUrl: 'https://demo.automationtesting.in',
    
    
    setupNodeEvents(on, config) {
      // Cypress v11 node event listeners
    },
    watchForFileChanges: false,
    waitForAnimations: true,
    chromeWebSecurity: false,
    blockHosts: [],
    pageLoadTimeout: 60000,
    retries: 2,
    viewportHeight: 600,
    viewportWidth: 1000,
    video: false,
  },
})
