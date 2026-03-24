# Real Examples from GMS

## Example 1: Bulk Print Order History (June's Pattern)

### Feature File
`test/cypress/e2e/features/BulkPrintOrder/PrintOrderHistoryScreen.feature`

```gherkin
Feature: Bulk Print Order History Screen
Ability to view a list of orders and their status

  Scenario: Verify the order history screen displays orders
    Given I mock the Bulk Print Order History API
    And I am logged into GMS and on the Bulk print orders page
    Then I verify the OrderNumber 1000000000 is displayed and country is AU

  Scenario: Verify multiple orders are displayed
    Given I mock the Bulk Print Order History API
    And I am logged into GMS and on the Bulk print orders page
    Then I verify the datagrid displays at least 20 rows
    Then I verify the OrderNumber 1000000000 is displayed and country is AU
    Then I verify the OrderNumber 1000000001 is displayed and country is NZ

  Scenario: Verify all order status types are displayed
    Given I mock the Bulk Print Order History API
    And I am logged into GMS and on the Bulk print orders page
    Then I verify all status types are displayed
```

### Step Definitions
`test/cypress/e2e/steps/bulk_print_order_history_steps.ts`

```typescript
import { Given, Then } from '@badeball/cypress-cucumber-preprocessor';
import GmsPageBulkPrintOrderHistory from '../pages/gms_page_bulk_print_order_history';
import homePage from '../pages/gms_page_home';

const gms_homePage = new homePage();
const historyPage = new GmsPageBulkPrintOrderHistory();

Given('I mock the Bulk Print Order History API', () => {
  historyPage.mockGetOrders();
});

Given('I am logged into GMS and on the Bulk print orders page', () => {
  gms_homePage.logIntoGMS('gms_api_order_auto_test_client');
  gms_homePage.goToPage('bulk print orders');
});

Then(/^I verify the OrderNumber (.*) is displayed and country is (.*)/, (orderId: string, country: string) => {
  historyPage.verifyOrderDisplayedWithCountry(orderId, country);
});

Then('I verify the datagrid displays at least {int} rows', (rowCount: number) => {
  historyPage.verifyDataGridHasMinimumRows(rowCount);
});

Then('I verify all status types are displayed', () => {
  historyPage.verifyAllStatusTypesDisplayed();
});
```

### Page Object
`test/cypress/e2e/pages/gms_page_bulk_print_order_history.ts`

```typescript
///<reference types="cypress" />
import { mockOrders } from '../../../../src/msw/test/mocks/data/cardOrders';

export default class GmsPageBulkPrintOrderHistory {
  mockGetOrders() {
    cy.intercept('GET', '**/api/v1/Orders', mockOrders);
  }

  verifyBulkPrintOrderScreen() {
    cy.contains('Bulk print orders');
  }

  verifyOrderDisplayedWithCountry(orderNumber: string, country: string) {
    cy.contains('.dx-data-row', orderNumber)
      .should('be.visible')
      .within(() => {
        cy.contains(country).should('exist');
      });
  }

  verifyDataGridHasMinimumRows(minimumCount: number) {
    cy.get('.dx-data-row').should('have.length.at.least', minimumCount);
  }

  verifyAllStatusTypesDisplayed() {
    const statuses = ['Processing', 'Completed', 'Created', 'Cancelled', 'Fulfilled'];
    statuses.forEach((status) => {
      cy.contains('[data-testid="status-chip"]', status).should('exist');
    });
  }
}
```

### Mock Data
`src/msw/test/mocks/data/cardOrders.ts`

```typescript
const ORDER_STATUSES = ['Processing', 'Completed', 'Created', 'Cancelled', 'Fulfilled'] as const;
const COUNTRIES = ['AU', 'NZ'] as const;

export const mockOrders = {
  orders: Array.from({ length: 100 }, (_, i) => ({
    countryCode: COUNTRIES[i % COUNTRIES.length],
    orderId: String(1_000_000_000 + i),
    orderStatus: ORDER_STATUSES[i % ORDER_STATUSES.length],
    // ... other fields
  })),
};
```

## Example 2: Barcode Entry with Examples Table

### Feature File
`test/cypress/e2e/features/online_order_features/order_details/Barcodes.feature`

```gherkin
Feature: Online Order Details - Barcodes
    Scenario: T677 Single Barcode Entry - Success
        Given I mock the Fulfilments Summary API
        Given I mock the Fulfilment API with Gift Card type Physical and status InProgressNoBarcodes and country AU
        Given I mock the Pick Fulfilment API with Success
        When I am on the Online Order Detail screen for order W111111111
        When I enter single barcode `<barcode>`
        Examples:
            | barcode                   |
            | 9318757890123456789012345 |

    Scenario: T677 Single Barcode Entry - Invalid Barcode
        Given I mock the Fulfilments Summary API
        Given I mock the Fulfilment API with Gift Card type Physical and status InProgressNoBarcodes and country AU
        Given I mock the Pick Fulfilment API with Success
        When I am on the Online Order Detail screen for order W111111111
        When I enter single barcode `<barcode>`
        Then I verify error messages `<errorMessage>` are displayed
        Examples:
            | barcode                   | errorMessage                    |
            | 931875789012345678901234  | Barcode must be 25 digits       |
            | 1234567890123456789012345 | Barcode must start with 9318757 |
```

## Example 3: Create Bulk Print Order

### Feature File
`test/cypress/e2e/features/BulkPrintOrder/CreateBulkPrintOrder.feature`

```gherkin
Feature: Create Bulk Print Order
As a GMS operator I want to create new bulk print orders

  Background:
    Given I mock the Bulk Print Designs API
    Given I mock the Bulk Print Hangsells API

  Scenario: Initial state shows disabled form elements
    When I am logged into GMS and on the Create bulk print order page
    Then I verify the design dropdown is disabled
    Then I verify the Add line button is disabled
    Then I verify General use order is selected

  Scenario: Selecting currency enables form
    When I am logged into GMS and on the Create bulk print order page
    When I select currency AUD
    Then I verify the design dropdown is enabled
    Then I verify the Add line button is enabled

  Scenario: Adding denominations updates totals
    When I am logged into GMS and on the Create bulk print order page
    When I select currency AUD
    When I select a design "Bunnings Classic"
    When I enter 5 boxes for denomination $10
    When I enter 3 boxes for denomination $20
    Then I verify line total boxes is 8
    Then I verify order total boxes is 8
    Then I verify order total cards is 200
```

### Page Object
`test/cypress/e2e/pages/gms_page_create_bulk_print_order.ts`

```typescript
///<reference types="cypress" />
import {
  mockAUDesignsResponse,
  mockNZDesignsResponse,
  mockAUHangSellsResponse,
  mockNZHangSellsResponse,
  generateDesignSvg,
} from '../../../../src/msw/test/mocks/data/bulkPrintDesigns';

export default class GmsPageCreateBulkPrintOrder {
  mockDesignsApi() {
    cy.intercept('GET', '**/api/v1/Designs*countryCode=AU*', mockAUDesignsResponse).as('getAUDesigns');
    cy.intercept('GET', '**/api/v1/Designs*countryCode=NZ*', mockNZDesignsResponse).as('getNZDesigns');
  }

  mockHangsellsApi() {
    cy.intercept('GET', '**/api/v1/Hangsells*countryCode=AU*', mockAUHangSellsResponse).as('getAUHangsells');
    cy.intercept('GET', '**/api/v1/Hangsells*countryCode=NZ*', mockNZHangSellsResponse).as('getNZHangsells');
  }

  mockDesignImageApi() {
    cy.intercept('GET', '**/api/v1/design/image/*', (req) => {
      const imageKey = req.url.split('/').pop() || 'default';
      req.reply({
        body: generateDesignSvg(imageKey),
        headers: { 'Content-Type': 'image/svg+xml' },
      });
    }).as('getDesignImage');
  }

  navigateToCreatePage() {
    cy.visit('/bulkprint/create');
  }

  selectCurrency(currency: 'AUD' | 'NZD') {
    cy.contains('.dx-selectbox', /currency/i)
      .find('input.dx-texteditor-input')
      .as('currencyInput');
    cy.get('@currencyInput').click();
    cy.get('@currencyInput').clear();
    cy.get('@currencyInput').type(currency);
    cy.get('body').find('.dx-list-item').contains(currency).click({ force: true });
  }

  selectDesign(designName: string, lineIndex = 1) {
    cy.get('tbody tr')
      .eq(lineIndex - 1)
      .find('.dx-selectbox')
      .first()
      .should('not.have.class', 'dx-state-disabled')
      .find('.dx-dropdowneditor-icon')
      .click({ force: true });
    cy.get('body')
      .find('.dx-list-item', { timeout: 10000 })
      .contains(designName)
      .click({ force: true });
  }

  enterDenomination(denomination: string, boxes: number, lineIndex = 1) {
    const denomMap: Record<string, number> = {
      $10: 0, $20: 1, $50: 2, $100: 3, $200: 4, $500: 5, Settable: 6,
    };
    const denomIndex = denomMap[denomination];
    if (denomIndex === undefined) throw new Error(`Unknown denomination: ${denomination}`);

    cy.get('tbody tr')
      .eq(lineIndex - 1)
      .find('.dx-numberbox')
      .eq(denomIndex)
      .find('input.dx-texteditor-input')
      .focus()
      .clear()
      .type(String(boxes))
      .blur();
  }

  verifyLineTotalBoxes(expectedTotal: number, lineIndex = 1) {
    cy.get('tbody tr')
      .eq(lineIndex - 1)
      .within(() => {
        cy.get('td').eq(-2).should('contain', String(expectedTotal));
      });
  }

  verifyOrderTotalBoxes(expectedTotal: number) {
    cy.contains('span', 'Total boxes:').find('strong').should('have.text', String(expectedTotal));
  }

  verifyDesignDropdownDisabled(lineIndex = 1) {
    cy.get('tbody tr')
      .eq(lineIndex - 1)
      .within(() => {
        cy.get('.dx-selectbox').first().should('have.class', 'dx-state-disabled');
      });
  }
}
```

## Mapping Jira ACs to Scenarios

Given this AC from Jira:
```
AC1: When the page loads, the design dropdown should be disabled until currency is selected
AC2: After selecting a currency, the design dropdown should be enabled
AC3: Selecting a design should show its thumbnail image
```

Map to scenarios:
```gherkin
Scenario: AC1 - Design dropdown disabled on load
  When I am logged into GMS and on the Create page
  Then I verify the design dropdown is disabled

Scenario: AC2 - Currency selection enables design dropdown
  When I am logged into GMS and on the Create page
  When I select currency AUD
  Then I verify the design dropdown is enabled

Scenario: AC3 - Selected design shows thumbnail
  When I am logged into GMS and on the Create page
  When I select currency AUD
  When I select a design "Bunnings Classic"
  Then I verify design thumbnail shows an image
```
