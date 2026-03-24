# Learnings from Merged PRs

Patterns and fixes extracted from GMS Cypress PR history.

---

## PR #404: Intermittent Test Failures

**Problem:** Tests were flaky due to animations and modal timing.

**Solution:** Added strategic `cy.wait()` for animations:

```typescript
const DELAY_500 = 500; // milliseconds

// Before clicking modal close, wait for animation
cy.wait(DELAY_500);
cy.get('.dx-popup-content:visible', { timeout: 10000 })
  .first()
  .within(() => {
    cy.contains('Close').should('be.visible').click();
  });
```

**Key patterns:**
- Wait before clicking in modals
- Wait before selecting from dropdowns
- Use `.within()` for scoped clicks in modals
- Use `:visible` selector for elements that may be hidden

---

## PR #400: Case Sensitivity in SIT

**Problem:** Tests failing in SIT due to case sensitivity of file names.

**Solution:** Use consistent naming:
- Feature files: `PascalCase.feature`
- Step files: `snake_case_steps.ts`
- Page objects: `gms_page_snake_case.ts`

**Lesson:** Linux servers (SIT/STG) are case-sensitive; macOS is not.

---

## Centralized Selectors (commit 1ec0f489)

**Problem:** Popup selectors were inconsistent across tests.

**Solution:** Created `test/cypress/support/selectors.ts`:

```typescript
export const POPUP_SELECTOR = '.dx-popup-content:visible, .dx-overlay-content:visible';

export function getPopup(options?: Cypress.Timeoutable) {
  return cy.get(POPUP_SELECTOR, options);
}
```

**Usage:**
```typescript
import { getPopup } from '../support/selectors';

getPopup({ timeout: 10000 }).within(() => {
  cy.contains('Submit').click();
});
```

---

## June's Pattern (PR #424): Shared Mock Data

**Problem:** Duplicate mock data between MSW and Cypress fixtures.

**Solution:** Single source of truth in `src/msw/test/mocks/data/`:

```typescript
// src/msw/test/mocks/data/cardOrders.ts
export const mockOrders = {
  orders: Array.from({ length: 100 }, (_, i) => ({
    orderId: String(1_000_000_000 + i),
    status: ORDER_STATUSES[i % ORDER_STATUSES.length],
    countryCode: COUNTRIES[i % COUNTRIES.length],
  })),
};
```

**Benefits:**
- Same data for MSW (local dev) and Cypress (E2E)
- No duplication
- Tests work in SIT/STG where MSW isn't available

---

## Modal Close Patterns

**Bad (flaky):**
```typescript
cy.get('.dx-button-content').contains('Close').click();
```

**Good (stable):**
```typescript
cy.wait(500);
cy.get('.dx-popup-content:visible', { timeout: 10000 })
  .first()
  .within(() => {
    cy.contains('Close').should('be.visible').click();
  });
```

---

## Dropdown Selection Patterns

**Bad (flaky):**
```typescript
cy.get('#reason-select').click();
cy.get('.dx-list-item').contains(reasonCode).click();
```

**Good (stable):**
```typescript
cy.wait(500); // Wait for previous animation
cy.get('#reason-select', { timeout: 10000 }).should('be.visible').click();
cy.get('.dx-list-item', { timeout: 5000 }).contains(reasonCode).should('be.visible').click({ force: true });
```

---

## Data Table Pattern for Multiple Assertions

**Feature file:**
```gherkin
Scenario: Verify barcodes in confirmation
  Given I mock the APIs
  When I replace card with barcode
  Then I verify the following barcodes are displayed:
    | barcode1 |
    | barcode2 |
    | barcode3 |
```

**Step definition:**
```typescript
Then('I verify the following barcodes are displayed:', (dataTable: DataTable) => {
  const barcodes = dataTable.raw().flat();
  barcodes.forEach((barcode) => {
    cy.contains(barcode).should('be.visible');
  });
});
```

---

## Timeout Recommendations

| Scenario | Timeout |
|----------|---------|
| Standard element | 4000ms (default) |
| Dropdown list items | 10000ms |
| Modal appearance | 10000ms |
| API response | 30000ms |
| Complex animations | 500ms wait |

---

## Test Order Number: W111111111

Standard test order used across GMS Cypress tests:
- Order number: `W111111111`
- Used for order details tests
- Mocked in fulfilments handlers

**Ensure mock data includes this order:**
```typescript
// src/msw/test/mocks/data/fulfilmentSummaries.ts
export const mockFulfilmentSummaries = [
  {
    enquiryNumber: 'W111111111',
    orderDate: '2024-06-15T10:00:00.000Z',
    status: 'InProgress',
    // ...
  },
  // ...
];
```

---

## Regex for Dynamic Step Parameters

**Matching order numbers:**
```typescript
Then(/^I verify the OrderNumber (.*) is displayed and country is (.*)/,
  (orderId: string, country: string) => {
    historyPage.verifyOrderDisplayedWithCountry(orderId, country);
  }
);
```

**Matching currency codes:**
```typescript
When('I select currency {word}', (currency: 'AUD' | 'NZD') => {
  createPage.selectCurrency(currency);
});
```

**Matching quoted strings:**
```typescript
When('I select a design {string}', (designName: string) => {
  createPage.selectDesign(designName);
});
```

---

---

## PR: URL Pattern Must Include Wildcard for Query Params

**Problem:** `cy.intercept()` not matching requests.

**Bad:**
```typescript
cy.intercept('GET', '**/Orders', { fixture: 'orders.json' });
```

**Good:**
```typescript
cy.intercept('GET', '**/Orders*', { fixture: 'orders.json' });
//                          ^ wildcard for query params
```

APIs often have query params (`?countryCode=AU`). The wildcard ensures matching.

---

## PR: HTTP Method Must Match API

**Problem:** Tests failing because intercept used wrong HTTP method.

**Bad:**
```typescript
cy.intercept('PUT', '**/cards/*/operatorReplace', { ... });
```

**Good:**
```typescript
cy.intercept('POST', '**/cards/*/operatorReplace', { ... });
```

**Lesson:** Always verify the actual HTTP method in the RTK Query API definition or Network tab.

---

## PR: Split Large Feature Files

**Problem:** One feature file with 100+ lines is hard to maintain.

**Solution:** Split `ReplaceDigitalCardModal.feature` into:
- `ReplaceDigitalCardModal1.feature` (basic validation)
- `ReplaceDigitalCardModal2.feature` (email scenarios)
- `ReplaceDigitalCardModal3.feature` (confirmation flows)

**Rule of thumb:** If a feature file exceeds ~50 lines, consider splitting by scenario group.

---

## PR: Separate Page Objects for Popups/Modals

**Problem:** Page objects getting too large with modal logic.

**Solution:** Create dedicated popup page objects:
- `gms_page_online_order_details.ts` — main page
- `gms_popup_replace_digital_card.ts` — modal interactions

**Pattern:**
```typescript
// gms_popup_replace_digital_card.ts
import { getPopup } from '../../support/selectors';

export default class GmsPopupReplaceDigitalCard {
  popUpVisible() {
    getPopup({ timeout: 10000 }).should('exist').and('be.visible');
  }

  selectReason(reason: string) {
    getPopup().first().within(() => {
      cy.get('#reason-select').click({ force: true });
      cy.get('.dx-list-item').contains(reason).click({ force: true });
    });
  }
}
```

---

## PR: Verify Multiple Barcodes

**Problem:** Single barcode verification method didn't work for multiple.

**Solution:** Add dedicated method with loop:
```typescript
verifyFulfilmentMultipleBarcodes(barcodes: Array<string>) {
  for (let i = 0; i < barcodes.length; i++) {
    cy.get(`:nth-child(${i + 1}) > .relative > .dx-textbox input`)
      .should('have.value', barcodes[i]);
  }
}
```

**Step definition:**
```typescript
Then(/I verify the Giftcard Barcodes are `(.*)`/, (barcodes: string) => {
  const barcodeList = barcodes.split(',').map((b) => b.trim());
  detailsPage.verifyFulfilmentMultipleBarcodes(barcodeList);
});
```

---

## PR: randomString Helper for Input Testing

**Pattern:** Test input validation with random strings:

```typescript
// test/random.ts
export function randomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () =>
    chars.charAt(Math.floor(Math.random() * chars.length))
  ).join('');
}
```

**Usage:**
```typescript
import { randomString } from '../../../random';

enterInternalCommentsOfLength(count: number) {
  const text = randomString(count);
  cy.get('#comments-textarea textarea').clear().type(text, { force: true });
}
```

---

## PR: Fixture Naming Convention

**Pattern:** Fixtures follow `{METHOD}-{Resource}{Variant}.json`:
```
GET-FulfilmentsSummary.json
GET-FulfilmentsSummary-Filtered.json
PUT-OperatorReplaceSuccess.json
PUT-OperatorReplaceErrorPartial.json
PUT-OperatorReplaceErrorZeroBalance.json
```

**Organized by domain:**
```
fixtures/testdata/
├── online_orders/
│   ├── GET-Fulfilments/
│   │   ├── Digital/
│   │   │   ├── GET-FulfilmentsActivatedOne.json
│   │   │   └── GET-FulfilmentsReplacedTwo.json
│   │   └── Physical/
│   │       └── GET-FulfilmentsInProgressAU.json
│   ├── GET-FulfilmentsSummary.json
│   └── PUT-OperatorReplaceSuccess.json
└── GET-designs.json
```

---

## PR #427: DOM Detachment and API Timing

**Problem:** Tests failing with "element detached from DOM" or dropdown items not found.

### DOM Detachment with Aliases

**Bad (alias gets stale):**
```typescript
cy.get('tbody tr').eq(0).find('.dx-selectbox').as('designSelect');
cy.get('@designSelect').find('input').click();
cy.get('@designSelect').find('input').clear();  // FAILS - element detached
```

**Good (fresh query each time):**
```typescript
const getDesignInput = () =>
  cy.get('tbody tr').eq(0).find('.dx-selectbox').find('input');

getDesignInput().click();
getDesignInput().clear();
getDesignInput().type(designName);
```

**Why:** When React re-renders (e.g., after API response), the aliased element reference becomes stale. Using a function creates a fresh query each time.

### Wait for API After Triggering Actions

**Bad (race condition):**
```typescript
selectCurrency(currency: 'AUD' | 'NZD') {
  cy.get('input').type(currency);
  cy.get('.dx-list-item').contains(currency).click();
  // API call triggered but not awaited
}

selectDesign(designName: string) {
  // FAILS - designs haven't loaded yet
  cy.get('.dx-selectbox').click();
  cy.get('.dx-list-item').contains(designName).click();
}
```

**Good (wait for API):**
```typescript
selectCurrency(currency: 'AUD' | 'NZD') {
  cy.get('input').type(currency);
  cy.get('.dx-list-item').contains(currency).click();

  // Wait for API responses before proceeding
  const alias = currency === 'AUD' ? '@getAUDesigns' : '@getNZDesigns';
  cy.wait(alias);
}
```

**Why:** Selecting currency triggers API calls. If next step tries to use that data before response arrives, test fails.

### Custom-Rendered Dropdowns

**Problem:** DevExtreme SelectBox with `itemRender` doesn't use `.dx-list-item`.

**Bad:**
```typescript
cy.get('.dx-dropdowneditor-icon').click();
cy.get('.dx-list-item').contains(designName).click();  // FAILS - no .dx-list-item
```

**Good (use search input):**
```typescript
// SelectBox has searchEnabled, so type to filter
cy.get('input.dx-texteditor-input').click().type(designName);
cy.get('.dx-popup-wrapper .dx-item').contains(designName).click();
```

**Why:** Custom `itemRender` creates `.dx-item` elements, not `.dx-list-item`. Using search avoids needing exact selector.

---

## Local Environment Setup (Feb 2025)

### How to run Cypress tests locally on macOS

**Always use `test-local-osx` on macOS:**
```bash
cd test && yarn test-local-osx
```

This script bakes in `--browser edge`, `baseUrl=http://127.0.0.1:44389/`, and excludes voucher_API specs.

**Available scripts in `test/package.json`:**
| Script | Use when |
|--------|----------|
| `yarn test-local-osx` | Running locally on macOS (Edge, 127.0.0.1 baseUrl) |
| `yarn test-local` | Running locally on Windows (uses localhost, Electron) |
| `yarn test-sit` | Running against SIT environment |
| `yarn test-local-osx -- --spec "cypress/e2e/features/BulkPrintOrder/*.feature"` | Running a subset |

**Why `test-local-osx` exists:** Node.js v24 resolves `localhost` to `::1` (IPv6) first, but the dev server binds to `127.0.0.1` (IPv4). Without the override, Cypress fails to connect. The baseUrl can't be changed in the config file because Windows CI needs `localhost`.

All `test-local*` scripts exclude `voucher_API/*.feature` specs (external API integration tests that fail locally).

---

### TypeScript skipLibCheck

**Problem:** TypeScript errors in `@badeball/cypress-cucumber-preprocessor` node_modules:
```
error TS1259: Module '"@cucumber/messages"' can only be default-imported using the 'allowSyntheticDefaultImports' flag
```

**Solution:** Add `skipLibCheck: true` to `test/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es5",
    "lib": ["es5", "dom"],
    "types": ["cypress", "node"],
    "skipLibCheck": true
  }
}
```

**Why:** Third-party type definitions have incompatibilities. `skipLibCheck` skips type checking in `node_modules`.

---

## PR #XXX: DevExtreme Portal Pattern (Feb 2025)

**Problem:** Tests failing with "Expected to find element `.dialogue-card-popup .dx-popup-content:visible`" but element never found.

**Root Cause:** DevExtreme renders popups as **portals at document.body level**, NOT as children of their wrapper elements.

```typescript
// WRONG - popup content is NOT a descendant of the wrapper!
cy.get('.dialogue-card-popup .dx-popup-content')

// CORRECT - scope to visible popup directly
cy.get('.dx-popup-content:visible').first().within(() => {
  cy.contains('Add tracking').click();
});
```

**Why:** The `.dialogue-card-popup` div is an empty placeholder. DevExtreme creates the actual popup content as a sibling element directly under `<body>`.

**Affected components:** Any DevExtreme Popup, including DialogueCard wrappers.

---

## PR #XXX: DevExtreme valueChangeEvent (Feb 2025)

**Problem:** Button remains disabled after Cypress types into TextBox/NumberBox.

**Root Cause:** DevExtreme `valueChangeEvent="keyup"` doesn't fire properly with Cypress `type()`.

**Solution:** Use `valueChangeEvent="input"` in component code:
```tsx
<TextBox
  valueChangeEvent="input"  // NOT "keyup"
  onValueChange={handleChange}
/>
```

**Alternative (test-side):** Add typing delay:
```typescript
cy.get('input').type(value, { delay: 50 });
```

---

## PR #XXX: DevExtreme Button Selector (Feb 2025)

**Problem:** `cy.contains('button', 'Add tracking')` not finding DevExtreme buttons.

**Root Cause:** DevExtreme Button renders as `<div class="dx-button">` not `<button>`.

```typescript
// WRONG
cy.contains('button', 'Add tracking')

// CORRECT
cy.get('.dx-button').contains('Add tracking')
```

---

## PR #XXX: API Mock Response Structures (Feb 2025)

**Problem:** API mocks returning flat arrays cause "Unable to load" errors.

**Root Cause:** GMS APIs return wrapped responses, not flat arrays.

```typescript
// WRONG
export const mockDesignsResponse = mockDesigns;  // Just the array

// CORRECT
export const mockDesignsResponse = {
  designs: mockDesigns,
  _Meta: { continuationToken: '' }
};

export const mockHangSellsResponse = {
  hangsells: mockHangSells,
  _Meta: { continuationToken: '' }
};

export const mockSellersResponse = {
  sellers: mockSellers,
  _Meta: { continuationToken: '' }
};
```

---

## PR #XXX: Sellers API for Total Cards (Feb 2025)

**Problem:** CreateBulkPrintOrder "Total cards" shows 0 instead of calculated value.

**Root Cause:** Total cards calculation uses `seller.printing.numberOfCardsPerBox` from Sellers API.

**Solution:** Mock the Sellers API in test Background:
```gherkin
Background:
  Given I mock the Bulk Print Designs API
  And I mock the Bulk Print Hangsells API
  And I mock the Bulk Print Sellers API  # Required for total cards!
```

---

## PR #XXX: Electron Memory Crashes (Feb 2025)

**Problem:** Electron Renderer process crashes during large test runs.

**Solution:** Add to `cypress.config.ts`:
```typescript
export default defineConfig({
  experimentalMemoryManagement: true,
  numTestsKeptInMemory: 0,
  // ... rest of config
});
```

---

## PR #452: Hardcoded Dates and Mock Data Pattern Tracing (Feb 2025)

**Problem 1:** All 4 `BulkPrintOrderIndividual` scenarios failed because dates like `08/02/2026` were hardcoded, but `buildOrderDate()` computes dates relative to `new Date()`.

**Solution:** Derive expected dates from the mock order data at runtime:
```typescript
const allOrders = [...mockOrdersPage1.orders, ...mockOrdersPage2.orders, ...mockOrdersPage3.orders];

function formatOrderDate(orderId: string): string {
  const order = allOrders.find(o => o.orderId === orderId);
  if (!order) throw new Error(`Order ${orderId} not found in mock data`);
  const date = new Date(order.dateOrdered);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${date.getFullYear()}`;
}

// In verification method:
cy.contains(`Create date: ${formatOrderDate(orderId)}`).should('be.visible');
```

**Problem 2:** AU General scenario used order `1000000001`, but `COUNTRY_PATTERN[1] = 1 = NZ`. The assertions for AUD currency and testUserAU would always fail.

**Solution:** Trace through the mock data generator's pattern arrays to verify the order actually matches the expected country/type/status before writing assertions:
```typescript
// cardOrders.ts uses index-based patterns:
const COUNTRY_PATTERN = [0, 1, 1, 0, 1, 1, 0, 1, 0, 0, ...]; // 0=AU, 1=NZ
const ORDER_TYPE_PATTERN = [0, 1, 1, 0, 1, 0, 0, 1, 0, 1, ...]; // 0=Distributor, 1=General

// Order 1000000001 (index 1): COUNTRY_PATTERN[1]=1 -> NZ, not AU!
// Order 1000000009 (index 9): COUNTRY_PATTERN[9]=0 -> AU, ORDER_TYPE_PATTERN[9]=1 -> General use
```

**Lesson:** When mock data uses pattern arrays or formulas, always trace the actual output for a given index before writing assertions. Don't assume an order ID maps to a particular country/type.

---

## PR #446: DevExtreme Dropdown Content Verification is Fragile (Feb 2025)

**Problem:** Tests failing when verifying dropdown contents by opening the overlay, counting `.dx-list-item` elements, and closing with Escape.

**Root Cause:** DevExtreme SelectBox overlay popups are unreliable to open/inspect/close programmatically. The overlay may not render all items synchronously, `.dx-list-item` count can be stale, and `cy.get('body').type('{esc}')` doesn't reliably close the overlay - leaving it open for subsequent interactions.

**Bad (fragile - opens overlay, inspects, closes):**
```typescript
verifyDistributorDropdownOptions(expectedNames: string[]) {
  cy.contains('.dx-selectbox', /distributor/i)
    .find('.dx-dropdowneditor-icon')
    .click({ force: true });
  cy.get('.dx-overlay-content:visible .dx-list-item', { timeout: 10000 })
    .should('have.length', expectedNames.length);
  expectedNames.forEach((name) => {
    cy.get('.dx-overlay-content:visible .dx-list-item').contains(name).should('exist');
  });
  cy.get('body').type('{esc}', { force: true }); // Unreliable close
}
```

**Good (behavioral - select expected item, verify outcome):**
```typescript
// Instead of verifying dropdown CONTENTS, verify dropdown BEHAVIOR
// Select the expected item and verify the form reacts correctly
selectDistributor(name: string) {
  cy.contains('.dx-selectbox', /distributor/i)
    .find('input.dx-texteditor-input')
    .click()
    .clear()
    .type(name);
  cy.get('.dx-list-item').contains(name).click({ force: true });
}

// Then assert the outcome (designs filtered, denominations enabled, etc.)
```

**Why:** Behavioral testing ("select Blackhawk AU, verify only $50/$100 denominations are enabled") is both more reliable AND more valuable than content inspection ("open dropdown, verify 2 items exist"). The behavioral approach tests that the system works end-to-end, while content inspection only tests that a list rendered.

**Scenarios to avoid:**
- "I verify the distributor dropdown options are X,Y,Z" (opens overlay, counts items)
- "I verify the hangsell dropdown options are X,Y,Z" (same fragile pattern)
- "I verify the design dropdown options are X,Y,Z" (same fragile pattern)

**Scenarios to prefer:**
- "I select distributor X" then "I verify denomination $50 is enabled" (behavioral)
- "I select distributor X" then "I verify the design dropdown is enabled" (state check)
- "I enter 2 boxes for denomination $50" then "I verify order total cards is 50" (calculation)

**PR #446 (proven)** uses this behavioral approach exclusively and has zero dropdown content verification. **PR #451 (DistributorHandling.feature)** had 3 failures from dropdown inspection scenarios.

---

## Summary: Golden Rules

1. **Always wait 500ms before modal interactions**
2. **Use `:visible` selector for overlay elements**
3. **Use `.within()` for scoped element selection**
4. **Use `{ force: true }` for overlapped elements**
5. **Use `{ timeout: 10000 }` for async content**
6. **Share mock data between MSW and Cypress**
7. **Derive expected values from mock data - never hardcode dates or computed fields**
8. **Use consistent file naming (case-sensitive)**
9. **URL patterns need `*` wildcard for query params**
10. **Verify HTTP method matches API (GET/POST/PUT)**
11. **Split large feature files (>50 lines)**
12. **Separate page objects for popups/modals**
13. **Use fresh queries instead of aliases for dynamic content**
14. **Wait for API responses after triggering actions (`cy.wait('@alias')`)**
15. **Use `.dx-item` for custom-rendered SelectBox, `.dx-list-item` for standard**
16. **Always use `--config baseUrl=http://127.0.0.1:44389/` when running Cypress from CLI (Node v24 IPv6 issue)**
17. **Always run Cypress against `yarn start` (real app) - Cypress uses `cy.intercept()`, not MSW**
18. **Add `skipLibCheck: true` to test/tsconfig.json for third-party type issues**
19. **DevExtreme popups render as portals at body level - use `.dx-popup-content:visible` directly**
20. **DevExtreme buttons are `<div>` not `<button>` - use `.dx-button` selector**
21. **Use `valueChangeEvent="input"` for DevExtreme inputs (not "keyup")**
22. **API mocks for Designs, HangSells, and Sellers return flat arrays (not wrapped objects)**
23. **Mock Sellers API for total cards calculation in BulkPrint tests**
24. **Enable `experimentalMemoryManagement: true` to prevent Electron crashes**
25. **Trace mock data pattern arrays to verify order IDs map to expected country/type/status before writing assertions**
26. **Never verify DevExtreme dropdown contents by opening/counting/closing overlays - use behavioral testing instead (select item, verify outcome)**
27. **No section comments in .feature files** - scenario names should be self-documenting; `# --- Section ---` comments add noise
28. **Never import from `src/` in Cypress page objects** - Octopus CI deploys only `test/`, so `../../../../src/...` imports break. Inline helpers or duplicate data within `test/`
