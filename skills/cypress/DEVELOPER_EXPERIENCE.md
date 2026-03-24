# Cypress Developer Experience

## Running Cypress Locally

Cypress runs from the `test/` directory, not the root.

### Quick Start

```bash
# Terminal 1: Start the app
yarn start

# Terminal 2: Open Cypress UI
cd test && npm run open-local
```

**Important:** Cypress uses `cy.intercept()` for API mocking, NOT MSW. Tests work regardless of which app mode you use. The app just needs to be running.

### All Commands

| Command | Description |
|---------|-------------|
| **`yarn test-local-osx`** | **Default for macOS - headless run with Edge, correct baseUrl, excludes voucher_API** |
| `npm run open-local` | Interactive UI mode (local dev) |
| `npm run open-sit` | Interactive UI mode (SIT environment) |
| `npm run open-stg` | Interactive UI mode (STG environment) |
| `npm run test-local` | Headless run (local) |
| `npm run test-sit` | Headless run (SIT) |
| `npm run test-stg` | Headless run (STG) |

### Running Tests on macOS (Preferred)

**Always use `yarn test-local-osx`** as the default for running Cypress tests on macOS. It bakes in Edge browser, `baseUrl=http://127.0.0.1:44389/`, and excludes voucher_API specs - handling all the IPv6 and config quirks automatically.

```bash
# Run ALL tests (default command when user says "run all tests")
cd test && yarn test-local-osx

# Run a subset of tests
cd test && yarn test-local-osx -- --spec "cypress/e2e/features/BulkPrintOrder/*.feature"

# Run a single feature file
cd test && yarn test-local-osx -- --spec "cypress/e2e/features/BulkPrintOrder/CreateBulkPrintOrder.feature"
```

### Manual Commands (Fallback)

Only use these if `yarn test-local-osx` is unavailable. **Always** use `--config baseUrl=http://127.0.0.1:44389/` to avoid IPv6 resolution issues (Node.js v24 resolves `localhost` to `::1` but the dev server listens on `127.0.0.1`):

```bash
# Full UI suite - Edge browser
cd test && npx cypress run --config-file cypress-local.config.ts \
  --config baseUrl=http://127.0.0.1:44389/ \
  --spec "cypress/e2e/features/**/*.feature,!cypress/e2e/features/voucher_API/*.feature" \
  --browser edge

# Single feature file
cd test && npx cypress run --config-file cypress-local.config.ts \
  --config baseUrl=http://127.0.0.1:44389/ \
  --spec "cypress/e2e/features/BulkPrintOrder/CreateBulkPrintOrder.feature"
```

### Running with Different Browsers

By default, Cypress runs in Electron (headless). To use a different browser:

```bash
# Run all UI tests with Edge (Mac - with baseUrl override)
cd test && npx cypress run --config-file cypress-local.config.ts \
  --config baseUrl=http://127.0.0.1:44389/ \
  --spec "cypress/e2e/features/**/*.feature,!cypress/e2e/features/voucher_API/*.feature" \
  --browser edge

# Run all UI tests with Chrome
cd test && npx cypress run --config-file cypress-local.config.ts \
  --config baseUrl=http://127.0.0.1:44389/ \
  --browser chrome \
  --spec "cypress/e2e/features/**/*.feature,!cypress/e2e/features/voucher_API/*.feature"
```

**Available browsers:** `edge`, `chrome`, `firefox`, `electron` (default)

**Tip:** To see which browsers Cypress detects:
```bash
npx cypress info
```

### Config Files

| File | Base URL | Purpose |
|------|----------|---------|
| `cypress-local.config.ts` | `http://localhost:44389` | Tests against local app |
| `cypress-sit.config.ts` | SIT URL | Tests against SIT |
| `cypress-stg.config.ts` | STG URL | Tests against STG |

**Note:** Config uses `localhost` (works on Windows). On Mac with Node.js v24, `localhost` resolves to `::1` (IPv6) causing connection failures. Always use `--config baseUrl=http://127.0.0.1:44389/` when running from CLI.

### Running Specific Tests

```bash
# Run single feature file
npm run open-local -- --spec "**/BulkPrintOrder/CreateBulkPrintOrder.feature"

# Run all tests except voucher API
npm run test-local
```

## How Cypress Mocking Works

**Cypress uses `cy.intercept()`, NOT MSW.** This is critical because:
- Tests run in SIT/STG via Octopus Deploy (where MSW doesn't exist)
- `cy.intercept()` works at the browser level against ANY running app
- Mock data is shared in `src/msw/test/mocks/data/` for consistency

### Local Development

```bash
# Terminal 1: Start app
yarn start

# Terminal 2: Run Cypress
cd test
npm run open-local
```

Cypress will intercept API calls regardless of app mode.

### Against Deployed Environments

```bash
# No local app needed
cd test
npm run open-sit   # Tests against SIT
npm run open-stg   # Tests against STG
```

- Cypress `cy.intercept()` still mocks API responses
- This is how Octopus Deploy runs tests

## Project Structure

```
test/
├── cypress-local.config.ts      # Local config
├── cypress-sit.config.ts        # SIT config
├── cypress-stg.config.ts        # STG config
├── package.json                 # Scripts (npm run open-local, etc.)
└── cypress/
    ├── e2e/
    │   ├── features/            # .feature files (Gherkin)
    │   │   ├── BulkPrintOrder/
    │   │   ├── online_order_features/
    │   │   └── ...
    │   ├── steps/               # Step definitions (TypeScript)
    │   │   ├── bulk_print_order_history_steps.ts
    │   │   └── ...
    │   └── pages/               # Page objects (TypeScript)
    │       ├── gms_page_home.js
    │       ├── gms_page_bulk_print_order_history.ts
    │       └── ...
    ├── fixtures/
    │   ├── testdata/            # JSON fixtures for API responses
    │   ├── session/             # Session/auth fixtures
    │   └── templates/           # Template fixtures
    ├── support/
    │   ├── selectors.ts         # Centralized selector helpers
    │   └── commands.js          # Custom Cypress commands
    ├── plugins/
    │   └── index.js             # Cypress plugins
    ├── reports/                 # Generated test reports
    └── videos/                  # Test run recordings
```

## Debugging Tips

### Cypress UI (Interactive Mode)

1. Run `npm run open-local`
2. Click on a `.feature` file to run it
3. Use time-travel debugging - click any step to see DOM state
4. Check Network tab in DevTools for intercepted requests

### Console Logs

```typescript
// In page object or step definition
cy.log('Debug message here');

// See intercepted requests
cy.intercept('GET', '**/api/v1/Orders', (req) => {
  console.log('[Cypress] Intercepted:', req.url);
  req.reply(mockOrders);
}).as('getOrders');
```

### Screenshots and Videos

- Screenshots saved to `cypress/snapshots/actual/`
- Videos saved to `cypress/videos/`
- Auto-captured on failures in headless mode

### View Test Reports

After running `npm run test-local`:
- HTML report: `cypress/reports/AUTOMATION_REPORT.html`
- JSON log: `cypress/reports/log.json`

## Common Issues

### "Cannot find step definition"

Step definitions must be in `cypress/e2e/steps/` or `cypress/e2e/**/*.ts`.

Check the pattern in `package.json`:
```json
"cypress-cucumber-preprocessor": {
  "stepDefinitions": [
    "[filepath].{js,ts}",
    "cypress/e2e/**/*.{js,ts}"
  ]
}
```

### Test Times Out

Default timeout is 60 seconds. For slow operations:
```typescript
cy.get('.dx-list-item', { timeout: 10000 }).should('exist');
```

### Element Not Clickable

Use `{ force: true }` for overlapped or hidden elements:
```typescript
cy.get('.dx-dropdowneditor-icon').click({ force: true });
```

### "Session storage" / Auth Issues

Clear browser state:
1. DevTools → Application → Session Storage → Clear All
2. DevTools → Application → Service Workers → Unregister

Or in test:
```typescript
cy.clearLocalStorage();
cy.clearCookies();
```

## Testing Against Deployed Environments

### True E2E (No Mocking)

To test against **real API responses** (what Octopus does in SIT):

```bash
# Run against deployed SIT
cd test && npm run open-sit

# Or disable cy.intercept() in specific tests
# Comment out intercept calls to let requests hit real API
```

### Confidence Levels

| Test Mode | Auth | API | Confidence |
|-----------|------|-----|------------|
| `yarn start` + Cypress | Real | Mocked (cy.intercept) | High |
| `npm run open-sit` | Real | Real | Highest |
