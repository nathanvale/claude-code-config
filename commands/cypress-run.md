---
description: Run Cypress E2E tests against the local dev server
argument-hint: "[spec-pattern]"
---

# Cypress Test Runner

Run Cypress E2E tests for GMS. Handles dev server startup and test execution.

**Cypress uses `cy.intercept()` for API mocking (network-level), NOT MSW.** Always run against `yarn start`, not `yarn start:mock`.

## Steps

1. **Check dev server** - verify port 44389 is listening: `lsof -i :44389`
2. **Start if needed** - run `yarn start` in background, wait for compilation
3. **Run tests** from the `test/` directory using `yarn test-local-osx`

## Commands

```bash
# Check server
lsof -i :44389 2>/dev/null || echo "NOT RUNNING"

# Start server (if needed)
yarn start &

# Run all Cypress tests
cd test && yarn test-local-osx

# Run specific spec (pass as $ARGUMENTS)
cd test && yarn test-local-osx -- --spec "$ARGUMENTS"
```

## Arguments

- No arguments: runs ALL feature files (excluding voucher_API)
- Spec pattern: e.g. `cypress/e2e/features/BulkPrintOrder/DistributorHandling.feature`
- Glob pattern: e.g. `cypress/e2e/features/BulkPrintOrder/*.feature`

## Related

- `/cypress` skill - for WRITING Cypress tests (feature files, step defs, page objects)
- This command is for RUNNING existing tests

## Notes

- `yarn test-local-osx` bakes in Edge browser, `baseUrl=http://127.0.0.1:44389/`, and excludes voucher_API specs
- Node.js v24 resolves `localhost` to `::1` (IPv6) but dev server listens on `127.0.0.1` (IPv4) - the test-local-osx script handles this
