# Comparison Template

Use this structure for the Phase 7 report output.

## Template

```markdown
## Implementation Review: <TICKET_ID>

### Summary
One paragraph: what was planned vs what was implemented. Overall assessment.

### Plan vs Implementation

| Phase | Planned | Status | Notes |
|-------|---------|--------|-------|
| 1. Types | Add `IFoo` to `src/types/` | Done | Matches plan |
| 2. API | Add RTK Query endpoint | Done | Extra field added (scope creep?) |
| 3. Page | Create `FooPage` component | Partial | Missing error state handling |
| 4. Tests | Unit tests for hook + page | Not Started | No test files found |

### AC Coverage

| AC | Status | Implementation Location | Notes |
|----|--------|------------------------|-------|
| Given X, when Y, then Z | Implemented | `src/pages/Foo.tsx:45` | - |
| Given A, when B, then C | Partial | `src/hooks/useFoo.ts:12` | Missing edge case for empty list |
| Given D, when E, then F | Not Implemented | - | No code found for this AC |

### Code Quality Findings

| Severity | File | Finding | Recommendation |
|----------|------|---------|----------------|
| High | `src/pages/Foo.tsx` | Missing null check on API response | Add optional chaining |
| Medium | `src/hooks/useFoo.ts` | Stale closure in useEffect | Add dependency to array |

### Regression Risk

- **High risk:** <description of any changes that could break existing functionality>
- **Medium risk:** <changes in shared utilities or types>
- **Low risk:** <isolated new code>

### Scope Assessment

**In scope (planned):**
- File 1 — expected changes
- File 2 — expected changes

**Out of scope (unplanned changes):**
- File 3 — why was this changed?

**Missing (planned but not done):**
- File 4 — planned changes not found

### Remaining Work
Ordered by priority:

1. <highest priority gap>
2. <next priority gap>
3. ...

### Test Coverage
- New code coverage: X files tested / Y files total
- Missing test files: ...
- Missing test cases: ...
```
