/// <reference types="cypress" />
const { TIMEOUTS } = require('../constants/timeouts');

Cypress.Commands.add('visitPage', (url) => {
  cy.visit(url, { timeout: TIMEOUTS.PAGE_VISIT });
});

Cypress.Commands.add('textInput', (element) => {
  cy.get(element.id).type(element.value, { timeout: TIMEOUTS.ELEMENT_ACTION });
});

Cypress.Commands.add('clickButton', (btnId) => {
  cy.get(btnId.id).click({ timeout: TIMEOUTS.ELEMENT_ACTION });
});

Cypress.Commands.add('haveText', (element) => {
  cy.get(element.id).should('have.text', element.value);
});

Cypress.Commands.add('containText', (element) => {
  cy.get(element.id).should('contain', element.value);
});

Cypress.Commands.add('checkExist', (element) => {
  expect(element.id).to.exist;
});

Cypress.Commands.add('selectOption', (element) => {
  cy.get(element.id).select(element.value);
});