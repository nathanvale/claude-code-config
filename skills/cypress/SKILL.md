---
name: cypress
description: Write Cypress E2E tests from Jira ticket ACs. Use when implementing Cypress tests for GMS features - handles feature files, step definitions, page objects, and mock data.
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Skill
context: fork
---

# Cypress E2E Testing for GMS

**MANDATORY: START DEV SERVER FIRST**

Before running ANY Cypress tests, you MUST:
1. Check if server is running: `lsof -i :44389`
2. If not running, start it: `yarn start` (default) or `yarn start:mock` (if user specifies)
3. Wait for compilation to complete before running tests

Tests WILL FAIL without a running dev server. Do NOT skip this step.

---

Write Cypress E2E tests using Cucumber/Gherkin following GMS conventions.

## Quick Reference

| Component | Location |
|-----------|----------|
| Feature files | `test/cypress/e2e/features/**/*.feature` |
| Step definitions | `test/cypress/e2e/steps/*_steps.ts` |
| Page objects | `test/cypress/e2e/pages/gms_page_*.ts` |
| Mock data (shared) | `src/msw/test/mocks/data/*.ts` |
| Fixtures | `test/cypress/fixtures/testdata/` |
| **Run all tests** | `cd test && yarn test-local-osx` (default - bakes in Edge browser, baseUrl, excludes voucher_API) |
| Run subset | `cd test && yarn test-local-osx -- --spec "cypress/e2e/features/BulkPrintOrder/*.feature"` |
| Run single spec | `cd test && yarn test-local-osx -- --spec "cypress/e2e/features/path/to/File.feature"` |

## Architecture Pattern

```
Jira AC → Feature File → Step Definitions → Page Object → Mock Data
                                                  ↓
                                            cy.intercept()
```

**Critical:** Cypress uses `cy.intercept()`, NOT MSW. This means:
- Tests work against ANY running app (local, SIT, STG)
- Tests run in Octopus Deploy where MSW doesn't exist
- Mock data in `src/msw/test/mocks/data/` is shared for consistency only

Mock data is imported by BOTH:
1. MSW handlers (for local dev convenience)
2. Cypress page objects (via `cy.intercept()` for E2E tests)

## Pre-flight Checks (Automated)

Before running Cypress tests, **always** verify the dev server is running:

```bash
# Check if server is running on port 44389
lsof -i :44389 2>/dev/null || echo "Server not running"
```

If the server is not running:
1. Start the server in background: `yarn start &`
3. Wait for server to be ready: `curl -s -o /dev/null -w "%{http_code}" http://localhost:44389`
4. Proceed with Cypress tests only after server responds

**Default to `yarn start`** (real auth mode) unless user specifies mock mode.

**IMPORTANT:** Always use `--config baseUrl=http://127.0.0.1:44389/` when running Cypress. Node.js v24 resolves `localhost` to `::1` (IPv6) but the dev server listens on `127.0.0.1` (IPv4). Without this override, Cypress will fail to connect.

## Workflow

1. **Pre-flight check** - Verify dev server is running (see above)
2. **Read Jira ticket** - Use `/jira-read POS-XXXX` to get ACs
3. **Map ACs to scenarios** - Each AC becomes a `Scenario` in feature file
4. **Create/update files** - Feature, steps, page object, mock data
5. **Use June's pattern** - Shared mock data between MSW and Cypress

See supporting files for detailed patterns:
- [DEVELOPER_EXPERIENCE.md](DEVELOPER_EXPERIENCE.md) - Running Cypress locally, debugging
- [PATTERNS.md](PATTERNS.md) - Code patterns and selectors
- [MOCK_DATA.md](MOCK_DATA.md) - Mock data conventions
- [EXAMPLES.md](EXAMPLES.md) - Real examples from GMS
- [LEARNINGS.md](LEARNINGS.md) - Lessons from merged PRs (flaky test fixes, etc.)
