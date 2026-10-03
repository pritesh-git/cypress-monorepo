# Cypress Automation Monorepo (v9 - v16)

A unified enterprise-grade monorepo containing complete Cypress test suites across **Cypress 9, 10, 11, 12, 13, 14, 15, and 16**.

Each package implements identical application test patterns for [Automation Testing Demo Site](https://demo.automationtesting.in) while strictly incorporating the architectural features and configuration requirements specific to each Cypress major release.

---

## ?? Packages & Cypress Version Matrix

| Workspace Package | Cypress Version | Config Format | Test Directory | Support File | Key Architectural Features & Upgrades |
|:---|:---|:---|:---|:---|:---|
| [`packages/cypress-v9`](packages/cypress-v9) | **9.7.0** | `cypress.json` | `cypress/integration` | `support/index.js` | Legacy configuration format, `cypress/plugins/index.js`, single-session runner |
| [`packages/cypress-v10`](packages/cypress-v10) | **10.11.0** | `cypress.config.js` | `cypress/e2e` | `support/e2e.js` | Introduction of `defineConfig`, native Component Testing, plugin unification in `setupNodeEvents` |
| [`packages/cypress-v11`](packages/cypress-v11) | **11.2.0** | `cypress.config.js` | `cypress/e2e` | `support/e2e.js` | Component testing GA, enhanced `cy.origin()` multi-domain testing |
| [`packages/cypress-v12`](packages/cypress-v12) | **12.17.4** | `cypress.config.js` | `cypress/e2e` | `support/e2e.js` | **Test Isolation** by default (`testIsolation: true`), `beforeEach` lifecycle, `cy.session()` GA |
| [`packages/cypress-v13`](packages/cypress-v13) | **13.17.0** | `cypress.config.js` | `cypress/e2e` | `support/e2e.js` | **Test Replay** support in Cypress Cloud, Node 16+ baseline, updated browser bundle |
| [`packages/cypress-v14`](packages/cypress-v14) | **14.5.4** | `cypress.config.js` | `cypress/e2e` | `support/e2e.js` | Node 18+ required, Chromium 120+, stricter same-site cookies and origin security |
| [`packages/cypress-v15`](packages/cypress-v15) | **15.21.1** | `cypress.config.js` | `cypress/e2e` | `support/e2e.js` | Node 20/22 LTS compatibility, memory optimization with `numTestsKeptInMemory: 5` |
| [`packages/cypress-v16`](packages/cypress-v16) | **16.1.1** | `cypress.config.js` | `cypress/e2e` | `support/e2e.js` | Latest Cypress release, modernized ESM/CJS engine, modern browser engines |

---

## ?? Shared Test Suites & Components Tested

All packages test the following application components on `https://demo.automationtesting.in`:

1. **Accordion Tab** (`/Accordion.html`):
   - Menu navigation elements existence.
   - Accordion section headers and expandable body panels (Readability, Single Line Coding, Method Chaining, Cross Browser Testing).
2. **Alerts Page** (`/Alerts.html`):
   - Simple browser alert (`window:alert`).
   - Confirmation dialog with OK and Cancel (`window:confirm`).
   - Prompt dialog with dynamic text input using `cy.stub(win, 'prompt')`.
3. **Frames Page** (`/Frames.html`):
   - Single nested iframe handling.
   - Multiple / nested iframes within an iframe.
4. **Login Flow** (`/`):
   - Sign-in modal opening, inputting email & password, submit validation.
   - Error verification when invalid credentials are provided.
   - Test Isolation resilience across test blocks.
5. **Registration Form** (`/`):
   - Form inputs: First Name, Last Name, Address, Email, Phone, Passwords.
   - Dropdown selections: Skills, Date of Birth (Year, Month, Day), Countries with Select2.
   - Multi-select language options.
   - Radio buttons (Gender) and Checkboxes (Hobbies).
6. **Web Table Page** (`/WebTable.html`):
   - Dynamic UI Grid menu column headers (Email, First Name, Gender, Last Name, Phone).
   - Column sorting in ascending and descending orders via dynamic grid menu dropdowns.
7. **Session Login** (`sessionLogin.cy.js`, Cypress 12+):
   - Showcases `cy.session()` to cache authentication and maintain fast execution in isolated test environments.

---

## ??? Custom Commands & Typings

The test suites share a unified custom commands library:
- `cy.visitPage(url)`: Visits URL with custom 10-second timeout.
- `cy.textInput(element)`: Types into element given `{ id, value }`.
- `cy.clickButton(btnId)`: Clicks button given `{ id }`.
- `cy.haveText(element)`: Asserts element has exact text.
- `cy.containText(element)`: Asserts element contains text.
- `cy.checkExist(element)`: Checks element existence.
- `cy.selectOption(element)`: Selects dropdown option given `{ id, value }`.

Full TypeScript definitions are included in each package under `cypress/support/index.d.ts` to provide auto-completion in VS Code / IDE.

---

## ?? Getting Started

### 1. Installation

Install all workspace dependencies or navigate into any specific version:

```bash
# From monorepo root:
npm install

# Or install for a specific package:
cd packages/cypress-v16
npm install
```

### 2. Running Tests by Version

From the root directory, you can run Cypress via npm workspaces:

#### Cypress 16 (Latest)
```bash
npm run cy:v16:open    # Interactive Test Runner
npm run cy:v16:run     # Headless Execution
```

#### Cypress 13
```bash
npm run cy:v13:open
npm run cy:v13:run
```

#### Cypress 9 (Legacy)
```bash
npm run cy:v9:open
npm run cy:v9:run
```

### 2. Running Tests Across All Versions (Structured & Summed Up)

The monorepo includes an intelligent, non-bulky test runner (scripts/run-all.js) that captures verbose Cypress noise, stores full logs into individual files, and displays a clean live status line followed by a structured summary dashboard table:

`ash
# Run all packages with clean progress tracking & summary table:
npm run cy:all:run

# Run a specific version subset:
npm run cy:all:run -- --filter=v16
npm run cy:all:run -- --filter=v12

# Stop immediately on the first failure:
npm run cy:all:run -- --bail

# Stream raw output if needed for deep debugging:
npm run cy:all:run -- --verbose

# Fallback to standard raw npm workspaces streaming:
npm run cy:all:raw
`

All detailed run outputs are automatically saved to:
`
cypress-monorepo/logs/
├── cypress-v9.log
├── cypress-v10.log
├── cypress-v11.log
├── cypress-v12.log
├── cypress-v13.log
├── cypress-v14.log
├── cypress-v15.log
└── cypress-v16.log
`
