# Browser Adapter Pattern Atlas Prototype

PROTOTYPE. Delete or absorb after the question is answered.

## Question

- What patterns are actually shared between `chrome-devtools` and `agent-browser`?
- Which shared patterns deserve machinery?
- Which facts stay adapter-local?
- Where does recoverability drift come from?

## Run

```bash
bun skills/browser-use/scripts/prototype-browser-adapter-pattern-atlas/prototype.ts
```

Auto-drive every scenario:

```bash
bun skills/browser-use/scripts/prototype-browser-adapter-pattern-atlas/prototype.ts --auto
```

## Controls

- `1`: healthy shared pattern.
- `2`: prose drift in one map.
- `3`: over-DRY adapter command.
- `4`: missing second-adapter fact.
- `a`: analyze current scenario.
- `n`: next scenario.
- `q`: quit.

