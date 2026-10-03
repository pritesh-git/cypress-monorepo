describe('Session Authentication (Modern Cypress Feature)', () => {
  let loginJson
  beforeEach(() => {
    cy.fixture('login.json').then(data => {
      loginJson = data
    })
  })

  it('Maintains authenticated session with cy.session', () => {
    cy.session('cached-user-session', () => {
      cy.visitPage('/')
      cy.clickButton(loginJson.openForm)
      cy.textInput(loginJson.email)
      cy.textInput(loginJson.password)
      cy.clickButton(loginJson.loginBtn)
    })

    // Validate page access post session restore
    cy.visitPage('/')
    cy.title().should('exist')
  })
})
