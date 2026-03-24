# Mock Data Conventions

## Location

All mock data lives in: `src/msw/test/mocks/data/`

This location is shared between:
1. **MSW handlers** (`src/msw/handlers/*.ts`) - for local dev with `yarn start:mock`
2. **Cypress page objects** (`test/cypress/e2e/pages/*.ts`) - for E2E tests

## Why Shared Location?

Tests run in real environments (SIT/STG) via Octopus Deploy where MSW is NOT available.
Cypress uses `cy.intercept()` which works with actual browser requests.

By sharing mock data:
- Consistent test data between local dev and E2E tests
- No duplication
- Easy to update in one place

## Mock Data File Structure

```typescript
// src/msw/test/mocks/data/featureData.ts

import { IFeatureType } from '../../../../types/feature';

// Helper to create mock items
const createMockItem = (code: string, name: string): IFeatureType => ({
  code,
  name,
  // ... other fields
});

// Export individual mock items
export const mockAUItems: IFeatureType[] = [
  createMockItem('AU001', 'Australian Item'),
  createMockItem('AU002', 'Another AU Item'),
];

export const mockNZItems: IFeatureType[] = [
  createMockItem('NZ001', 'New Zealand Item'),
];

// Export API response shapes (what cy.intercept returns)
export const mockAUItemsResponse = {
  items: mockAUItems,
  _Meta: { continuationToken: '' },
};

export const mockNZItemsResponse = {
  items: mockNZItems,
  _Meta: { continuationToken: '' },
};

// Helper functions for dynamic content (e.g., images)
export function generateSvg(key: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">
    <text x="10" y="50">${key}</text>
  </svg>`;
}
```

## Using in MSW Handler

```typescript
// src/msw/handlers/featureHandlers.ts
import { http, HttpResponse } from 'msw';
import {
  mockAUItems,
  mockNZItems,
  generateSvg,
} from '../test/mocks/data/featureData';

const BASE_URL = '*/api/v1';

export const featureHandlers = [
  http.get(`${BASE_URL}/Feature`, ({ request }) => {
    const url = new URL(request.url);
    const countryCode = url.searchParams.get('countryCode');

    const items = countryCode === 'NZ' ? mockNZItems : mockAUItems;

    return HttpResponse.json({
      items,
      _Meta: { continuationToken: '' },
    });
  }),
];
```

## Using in Cypress Page Object

```typescript
// test/cypress/e2e/pages/gms_page_feature.ts
import {
  mockAUItemsResponse,
  mockNZItemsResponse,
  generateSvg,
} from '../../../../src/msw/test/mocks/data/featureData';

export default class GmsPageFeature {
  mockFeatureApi() {
    cy.intercept('GET', '**/api/v1/Feature*countryCode=AU*', mockAUItemsResponse).as('getAUFeature');
    cy.intercept('GET', '**/api/v1/Feature*countryCode=NZ*', mockNZItemsResponse).as('getNZFeature');
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
}
```

## Deterministic Data Generation

For lists (like orders), use deterministic generation:

```typescript
const STATUSES = ['Processing', 'Completed', 'Created', 'Cancelled'] as const;
const COUNTRIES = ['AU', 'NZ'] as const;

export const mockOrders = {
  orders: Array.from({ length: 100 }, (_, i) => ({
    orderId: String(1_000_000_000 + i),
    status: STATUSES[i % STATUSES.length],
    countryCode: COUNTRIES[i % COUNTRIES.length],
    // ... other fields derived from index
  })),
};
```

Benefits:
- Predictable data for assertions
- Tests can reference specific items (e.g., "order 1000000000 is AU")
- Consistent across test runs

## Test Data Patterns

### Card numbers by status
Based on last 2 digits:
- `01` = Active
- `02` = Cancelled
- `03` = Purchased
- `04` = Redeemed

### Order numbers
- Use `W` prefix for online orders: `W111111111`
- Use sequential numbers for bulk orders: `1000000000`, `1000000001`

### Country-specific data
Always provide AU and NZ variants:
- `mockAUItems` / `mockNZItems`
- `mockAUItemsResponse` / `mockNZItemsResponse`
