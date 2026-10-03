/// <reference types="cypress" />

declare namespace Cypress {
  interface Chainable<Subject = any> {
    /**
     * Custom command to visit a page with custom timeout
     */
    visitPage(url: string): Chainable<Subject>;

    /**
     * Custom command to type value into an element
     */
    textInput(element: { id: string; value: string }): Chainable<Subject>;

    /**
     * Custom command to click an element by selector id
     */
    clickButton(btnId: { id: string; value?: string }): Chainable<Subject>;

    /**
     * Custom command to assert element has exact text
     */
    haveText(element: { id: string; value: string }): Chainable<Subject>;

    /**
     * Custom command to assert element contains text
     */
    containText(element: { id: string; value: string }): Chainable<Subject>;

    /**
     * Custom command to check element existence
     */
    checkExist(element: { id: string; value?: string }): Chainable<Subject>;

    /**
     * Custom command to select dropdown option
     */
    selectOption(element: { id: string; value: string }): Chainable<Subject>;
  }
}