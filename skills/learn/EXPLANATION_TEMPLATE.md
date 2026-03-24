# Explanation Template

Use this structure for the Phase 5 synthesis output.

## Template

```markdown
## <Topic>

### Overview
One paragraph: what this feature/module does, why it exists, who uses it.

### Architecture
How the pieces fit together. Use a simple text diagram if helpful:

```
User Action → Component → Hook → RTK Query → API → Response → State Update → Re-render
```

### Key Files

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src/types/...` | Type definitions | `IFoo`, `IBar` |
| `src/api/...` | API layer | `useGetFooQuery` |
| `src/pages/...` | Page component | `FooPage` |

### How It Works

Step-by-step trace through the primary flow:

1. **Entry point** — user navigates to / clicks / triggers...
2. **Data fetch** — component calls `useGetFooQuery()` which hits...
3. **State management** — response is stored in RTK Query cache / Redux slice...
4. **Rendering** — component reads from cache and renders...
5. **User interaction** — on click, dispatches action / calls mutation...

### Data Flow

Trace data from source to display:

```
API Response (IFooResponse)
  → RTK Query cache (fulfilmentsApi)
    → Hook (useFoo)
      → Component props/state
        → UI render
```

### Patterns Used
- **Pattern 1** — how and where it's applied
- **Pattern 2** — how and where it's applied

### Test Coverage
- What's tested: ...
- What's not tested: ...
- Test file locations: ...

### Related Areas
- **Area 1** — how it connects, where to look
- **Area 2** — how it connects, where to look
```
