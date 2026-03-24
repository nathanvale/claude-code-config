# Cypress Code Patterns

## Feature File Structure

```gherkin
Feature: [Page/Feature Name]
[Brief description of feature purpose]

  Scenario: [AC or test case title]
    Given I mock the [API Name] API
    And I am logged into GMS and on the [Page Name] page
    When I [action]
    Then I verify [expected result]

  Scenario: [Another scenario with Examples table]
    Given I mock the [API] API
    When I am on the [Page] screen for order <orderNumber>
    When I enter <input>
    Then I verify <expected> is displayed
    Examples:
      | orderNumber | input | expected |
      | W111111111  | foo   | bar      |
```

## Step Definition Structure

```typescript
import { Given, When, Then } from '@badeball/cypress-cucumber-preprocessor';
import GmsPageFeatureName from '../pages/gms_page_feature_name';
import homePage from '../pages/gms_page_home';

const featurePage = new GmsPageFeatureName();
const gmsHomePage = new homePage();

// Background - API mocking
Given('I mock the Feature API', () => {
  featurePage.mockFeatureApi();
});

// Navigation
When('I am logged into GMS and on the Feature page', () => {
  gmsHomePage.logIntoGMS('gms_api_order_auto_test_client');
  featurePage.navigateToPage();
});

// Actions
When('I select {word}', (value: string) => {
  featurePage.selectOption(value);
});

When('I enter {string}', (value: string) => {
  featurePage.enterValue(value);
});

// Assertions
Then('I verify {string} is displayed', (expected: string) => {
  featurePage.verifyDisplayed(expected);
});

Then('I verify the total is {int}', (expected: number) => {
  featurePage.verifyTotal(expected);
});
```

## Page Object Structure

```typescript
///<reference types="cypress" />
import {
  mockDataResponse,
  generateSvg,
} from '../../../../src/msw/test/mocks/data/featureData';

export default class GmsPageFeatureName {
  // API Mocking - uses cy.intercept() with shared mock data
  mockFeatureApi() {
    cy.intercept('GET', '**/api/v1/Endpoint*param=value*', mockDataResponse).as('getFeature');
  }

  mockImageApi() {
    cy.intercept('GET', '**/api/v1/image/*', (req) => {
      const key = req.url.split('/').pop() || 'default';
      req.reply({
        body: generateSvg(key),
        headers: { 'Content-Type': 'image/svg+xml' },
      });
    }).as('getImage');
  }

  // Navigation
  navigateToPage() {
    cy.visit('/feature/path');
  }

  // Actions
  selectOption(value: string) {
    cy.contains('.dx-selectbox', /label/i)
      .find('input.dx-texteditor-input')
      .click()
      .clear()
      .type(value);
    cy.get('body').find('.dx-list-item').contains(value).click({ force: true });
  }

  enterValue(value: string, inputIndex = 0) {
    cy.get('input.dx-texteditor-input')
      .eq(inputIndex)
      .focus()
      .clear()
      .type(value)
      .blur();
  }

  clickButton(label: string) {
    cy.contains('button', label).click();
  }

  // Assertions
  verifyDisplayed(text: string) {
    cy.contains(text).should('be.visible');
  }

  verifyTotal(expected: number) {
    cy.contains('span', 'Total:').find('strong').should('have.text', String(expected));
  }

  verifyRowCount(expected: number) {
    cy.get('tbody tr').should('have.length', expected);
  }

  verifyDropdownDisabled() {
    cy.get('.dx-selectbox').first().should('have.class', 'dx-state-disabled');
  }

  verifyDropdownEnabled() {
    cy.get('.dx-selectbox').first().should('not.have.class', 'dx-state-disabled');
  }
}
```

## Centralized Selectors

Use `test/cypress/support/selectors.ts` for shared selectors:

```typescript
// test/cypress/support/selectors.ts
export const POPUP_SELECTOR = '.dx-popup-content:visible, .dx-overlay-content:visible';

export function getPopup(options?: Cypress.Timeoutable) {
  return cy.get(POPUP_SELECTOR, options);
}
```

**Usage:**
```typescript
import { getPopup } from '../../support/selectors';

getPopup({ timeout: 10000 }).within(() => {
  cy.contains('Submit').click();
});
```

## DevExtreme Selectors

GMS uses DevExtreme components. Common selectors:

| Component | Selector |
|-----------|----------|
| SelectBox | `.dx-selectbox` |
| SelectBox input | `.dx-selectbox input.dx-texteditor-input` |
| SelectBox dropdown | `.dx-dropdowneditor-icon` |
| List item | `.dx-list-item` |
| Popup list item | `.dx-popup-wrapper .dx-list-item` |
| NumberBox | `.dx-numberbox` |
| NumberBox input | `.dx-numberbox input.dx-texteditor-input` |
| Button | `.dx-button` |
| DataGrid row | `.dx-data-row` |
| RadioButton | `.dx-radiobutton` |
| RadioButton checked | `.dx-radiobutton-icon-checked` |
| Accordion item | `.dx-accordion-item` |
| Accordion opened | `.dx-accordion-item-opened` |
| Disabled state | `.dx-state-disabled` |

## MUI Selectors

| Component | Selector |
|-----------|----------|
| Status chip | `[data-testid="status-chip"]` |
| Button | `[data-testid="buttonName"]` |
| Input | `#inputId` or `[data-testid="inputName"]` |

## Popup/Modal Page Objects

For complex modals, create a dedicated page object:

```typescript
// gms_popup_replace_digital_card.ts
import { getPopup } from '../../support/selectors';

export default class GmsPopupReplaceDigitalCard {
  popUpVisible() {
    getPopup({ timeout: 10000 }).should('exist').and('be.visible');
  }

  verifyTitle(title: string) {
    getPopup().contains(title).should('be.visible');
  }

  selectReason(reason: string) {
    getPopup().first().within(() => {
      cy.get('#reason-select').should('be.visible').click({ force: true });
      cy.get('.dx-list-item', { timeout: 5000 })
        .contains(new RegExp('^' + reason + '$'))
        .click({ force: true });
    });
  }

  verifyButtonDisabled(buttonText: string) {
    getPopup().first().within(() => {
      cy.contains('.dx-button', buttonText)
        .should('have.class', 'dx-state-disabled');
    });
  }

  verifyButtonEnabled(buttonText: string) {
    getPopup().first().within(() => {
      cy.contains('.dx-button', buttonText)
        .should('not.have.class', 'dx-state-disabled');
    });
  }

  enterEmail(email: string) {
    getPopup().first().within(() => {
      cy.get('#email-input input').clear().type(email, { force: true });
    });
    cy.get('#email-input input').blur({ force: true });
  }

  clickClose() {
    cy.wait(500); // Wait for animation
    getPopup().first().within(() => {
      cy.contains('Close').should('be.visible').click();
    });
  }
}
```

**Usage in steps:**
```typescript
import GmsPopupReplaceDigitalCard from '../pages/gms_popup_replace_digital_card';

const popup = new GmsPopupReplaceDigitalCard();

Then('I verify the Replace modal is displayed', () => {
  popup.popUpVisible();
  popup.verifyTitle('Replace Gift Card');
});

When('I select reason {string}', (reason: string) => {
  popup.selectReason(reason);
});
```

## Common Patterns

### Working with table rows

```typescript
// Get specific row by index (1-based)
cy.get('tbody tr')
  .eq(lineIndex - 1)
  .within(() => {
    cy.get('.dx-selectbox').first().click();
  });

// Find row by content
cy.contains('.dx-data-row', orderNumber)
  .within(() => {
    cy.contains(country).should('exist');
  });
```

### Waiting for elements

```typescript
// Wait with timeout
cy.get('.dx-list-item', { timeout: 10000 }).contains(text).click();

// Wait for element not to have class
cy.get('.dx-selectbox').should('not.have.class', 'dx-state-disabled');
```

### Force click for hidden/overlapped elements

```typescript
cy.get('.dx-dropdowneditor-icon').click({ force: true });
```

## Authentication

Always use the shared login method:

```typescript
gmsHomePage.logIntoGMS('gms_api_order_auto_test_client');
```

Robot client IDs:
- `gms_api_order_auto_test_client` - Standard user with order access
- `gms_api_bulk_activation_auto_test_client` - Bulk activation access
- `gms_api_super_admin_auto_test_client` - Super admin access

## Navigation

Use home page's `goToPage()` for menu navigation:

```typescript
gmsHomePage.goToPage('online orders');
gmsHomePage.goToPage('bulk print orders');
gmsHomePage.goToPage('bulk_activation');
```

Or direct URL for specific pages:

```typescript
cy.visit('/bulkprint/create');
cy.visit('/orders/W111111111');
```

## Avoiding DOM Detachment

React re-renders can detach elements. Use fresh queries instead of aliases for dynamic content.

### Bad: Alias gets stale

```typescript
cy.get('tbody tr').eq(0).find('.dx-selectbox').as('select');
cy.get('@select').find('input').click();
cy.get('@select').find('input').clear();  // FAILS - element detached after re-render
```

### Good: Fresh query function

```typescript
const getInput = () =>
  cy.get('tbody tr').eq(0).find('.dx-selectbox').find('input');

getInput().click();
getInput().clear();  // Works - fresh query each time
getInput().type(value);
```

### For numberbox inputs (multiple operations)

```typescript
enterDenomination(denomination: string, boxes: number, lineIndex = 1) {
  cy.get('tbody tr').eq(lineIndex - 1).find('.dx-numberbox').eq(denomIndex).as('denomInput');

  cy.get('@denomInput').find('input').focus();
  cy.get('@denomInput').find('input').clear();
  cy.get('@denomInput').find('input').type(String(boxes));
  cy.get('@denomInput').find('input').blur();
}
```

## Waiting for API Responses

When an action triggers API calls, wait before using the data.

```typescript
selectCurrency(currency: 'AUD' | 'NZD') {
  // Select currency
  cy.get('input').type(currency);
  cy.get('.dx-list-item').contains(currency).click();

  // Wait for APIs triggered by this selection
  const designsAlias = currency === 'AUD' ? '@getAUDesigns' : '@getNZDesigns';
  const hangsellsAlias = currency === 'AUD' ? '@getAUHangsells' : '@getNZHangsells';
  cy.wait(designsAlias);
  cy.wait(hangsellsAlias);
}
```
