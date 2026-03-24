# Explore Agent Prompt Template

Use this template when launching Explore agents in Phase 2. Substitute `{FILE_PATH}` and `{FOCUS_TOPIC}`.

## Template

```
Thoroughly explore {FILE_PATH} and its test file.

Use kit_index_overview to see symbols first, then Read the source.
If a test file exists (adjacent .test.tsx / .test.ts / .spec.ts), read that too.

Report:
1. All exports (components, hooks, functions, types)
2. State management (useState, useSelector, RTK Query hooks)
3. Data flow (props in, API calls, state updates)
4. How this component/module interacts with others
5. Existing patterns relevant to {FOCUS_TOPIC}
6. Test coverage — what's tested, what's missing
7. Any issues or code smells

Use response_format: "json" on all MCP tool calls.
This is research only — do not modify any files.
```
