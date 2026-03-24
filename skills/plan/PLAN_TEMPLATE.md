# Technical Plan Template

The plan skill produces a technical plan in this structured format. Present it clearly with markdown formatting.

Plan files are saved to `~/.claude/plans/<KEY>-plan.md`.

## Template

---

### Current State

Summarize what exists today relevant to this ticket:
- Relevant code (types, API endpoints, UI components, hooks)
- Recent related commits (from git history search)
- Related Obsidian notes found
- Any prior work on this ticket or related tickets

### Acceptance Criteria Gap Analysis

For each AC from the ticket:

| # | Acceptance Criterion | Status | What Exists | What's Needed |
|---|---|---|---|---|
| 1 | [AC text] | Not Started / Partially Exists / Exists | [description of existing code] | [what needs to change] |
| 2 | ... | ... | ... | ... |

### Pre-existing Issues

Issues found by code quality and bug hunt agents in files we're about to modify. Include only if agents found issues.

| # | Issue | File | Severity | Timing |
|---|---|---|---|---|
| 1 | [description] | `[path:line]` | Critical / High / Medium | Fix before / Fix during / Fix after |

**Timing guide:**
- **Fix before** — bugs that will compound if we build on top (e.g., wrong query skip condition)
- **Fix during** — issues in files we're already modifying (e.g., naming inconsistency, missing null check)
- **Fix after** — tech debt to track but not block on (e.g., test mocking wrong layer)

### API Dependency Status

For each external API this work depends on:

| API | Repo | Ticket | Status | Owner | Mock Strategy |
|---|---|---|---|---|---|
| `GET /sellers` | voucher | POS-3036 | In Progress | Prasanth | MSW handler with mock seller data |
| `/sellers` proxy | gms.api | POS-3037 | Not Started | TBD | Same MSW handler (GMS proxies transparently) |

If API does **not** exist yet, include:
- **Documented contract:** [from Jira ticket — paste the response shape]
- **Pattern to follow:** [from existing similar endpoint — e.g., "follows same pattern as GET /Designs"]
- **Response shape for MSW mock:** [TypeScript interface]

### Implementation Phases

#### Phase 1: [Title — usually types + data layer]
**Files:**
| File | Action | Changes |
|---|---|---|
| `src/types/foo.ts` | Modify | Add new field, rename property |
| `src/api/fooApi.ts` | Modify | Add new endpoint |

**Details:**
- [Key change 1]
- [Key change 2]

#### Phase 2: [Title — usually UI + state]
**Files:**
| File | Action | Changes |
|---|---|---|
| `src/pages/Foo/FooPage.tsx` | Modify | Add dropdown, wire state |

**Details:**
- [Key change 1]

#### Phase 3: [Title — usually mocks + tests]
**Files:**
| File | Action | Changes |
|---|---|---|
| `src/msw/handlers/fooHandlers.ts` | Modify | Add mock data |
| `src/pages/Foo/FooPage.test.tsx` | Modify | Add distributor tests |

**Details:**
- [Key change 1]

### Dependencies & Blockers

**External:**
- [API work needed? Backend changes required first?]

**Internal:**
- [Other tickets that must land first?]
- [Feature flags needed?]

**Mitigations:**
- [How are we handling blockers? e.g., "MSW mocking until API ready"]

### Open Questions

1. [Thing that needs clarification from PO/BA/Tech Lead]
2. [Ambiguity in AC that needs resolution]
3. [Technical decision that needs team input]

### Key Files

| Purpose | File | Action |
|---|---|---|
| [description] | `[absolute path]` | Create / Modify / Delete |

### Complexity Assessment

| Dimension | Rating |
|---|---|
| **Scope** | S / M / L / XL |
| **Cross-repo** | Yes / No |
| **API dependency** | Exists / In Progress / Not Started |
| **Suggest kickoff meeting** | Yes / No |

**Kickoff meeting criteria:**
- Yes if scope is L or XL
- Yes if cross-repo changes needed
- Yes if API dependency is Not Started
- Yes if > 2 open questions

**If suggesting kickoff, recommend attendees:**
- Always: Nathan, June (pairing partner)
- If API: MJ or Prasanth
- If design questions: Sonny or Tanya (BA)
- If scope questions: Suzy (PO)

---

## Formatting Rules

- Use absolute file paths: `/Users/s1010081/code/gms.app/src/types/seller.ts`
- Use `code` formatting for all types, functions, file paths, and values
- Link all JIRA tickets: `[POS-3044](https://bunnings.atlassian.net/browse/POS-3044)`
- Include code snippets of existing patterns to follow (fenced with language)
- Keep phase descriptions actionable — "what to do", not "what to think about"
- Number phases sequentially — typically 3-4 phases for M scope, 5+ for L/XL
