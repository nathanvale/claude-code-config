# Kickoff Skill Examples

## Basic Usage

```
/kickoff POS-3044
```

## What Happened (POS-3044 Real Example)

### Phase 0: Pre-flight
- Found existing Obsidian note: `01 Projects/🎯 POS-3044 Bulk Print - Distributor Specific Handling.md`
- Read existing context (links, scope, stakeholders already captured)

### Phase 1: Read the Ticket
- Read POS-3044 — Story: "Create Bulk Print Order - Distributor Specific Handling"
- Followed linked tickets:
  - POS-2903 (parent, general use page redesign — In Test)
  - POS-3036 (Voucher API /sellers — In Progress, Prasanth)
  - POS-3037 (GMS API /sellers proxy — Ready, unassigned)
  - POS-3118 (Link bulk print pages — Done)
- Extracted: ISeller type shape, filtering rules, denomination permissions, API contract

### Phase 2: Visual Context
- Found Figma link in ticket description
- Captured screenshots of distributor selection UI

### Phase 3: Affected Repos
- **Primary:** gms.app (frontend implementation)
- **Dependency:** gms.api (no /sellers proxy yet), voucher (no /sellers endpoint yet)

### Phase 4: Codebase Exploration

**gms.app (primary — full exploration):**
- Kit semantic search found: `CreateBulkPrintOrderPage.tsx`, `SellerFilterHelpers.ts`, `seller.ts`, `bulkPrintApi.ts`
- Deep dives on 8 key files (162-line page, 53-line helpers, 22-line types, 31-line API, 5 components)
- Discovered: sellers query only fires for `orderType === 'general'`, distributor orders bypass all filtering
- Discovered: `canSellPhysical` in types but JIRA says `canSellFixed`
- Mock data exists but only Bunnings sellers, no Reseller mocks

**gms.api (dependency — API discovery):**
- No SellersController found
- Found pattern: DesignsController → GetDesignsQuery → VoucherApiClient.GetDesigns()
- Documented: MediatR CQRS pattern, auth policy, pagination approach

**voucher (dependency — API discovery):**
- No /sellers endpoint in OpenAPI specs yet
- Found: Cosmos DB container `seller` exists in Terraform config
- Documented: API will exist but isn't implemented yet

### Phase 5: Gap Analysis
- 10 ACs mapped, all "Not Started" or "Partially Exists"
- Key gap: seller filtering logic exists but only wired for general orders
- API dependencies: both Not Started, but contract is locked (safe to mock)

### Phase 6: Technical Plan
- 4-phase plan generated (Types & Mocks → Seller Logic → UI → Tests)
- Complexity: M (single primary repo, clear patterns, locked contract)
- No kickoff meeting needed (scope clear, patterns established)

### Phase 7: User Input
- Nathan confirmed plan, no corrections
- No additional meeting notes

### Phase 8: Project Note
- Updated existing Obsidian note with technical plan
- Proposed branch: `feat/POS-3044-distributor-specific-handling`
- Published to Confluence via `/confluence POS-3044`

## Output Quality Benchmarks

A good kickoff output should:
- Map every AC to code (not just summarize the ticket)
- Include absolute file paths (clickable in terminal)
- Show existing patterns to follow (code snippets)
- Flag pre-existing issues in files we'll modify
- Be specific enough that June could implement from the plan alone
- Be concise enough to read in < 5 minutes
