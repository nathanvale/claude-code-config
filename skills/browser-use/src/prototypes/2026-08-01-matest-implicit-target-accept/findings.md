# MATest implicit-target post-build acceptance

Date: 2026-08-01
Lane: post-build accept
Adapter: Agent Browser through Browser Connect
Fixture: secret-free HTTP page on `http://localhost:41873`

## Verdicts

### PASS: zero eligible tabs fail closed

- Invoked the built worktree CLI with omitted `--tab` and allowed origin
  `http://127.0.0.1:41873` while the sole fixture tab used the distinct exact
  origin `http://localhost:41873`.
- Observed exit 20 and `agent_browser_target_unavailable`.
- Fixture state stayed `clicks=0;committed=false`.
- No snapshot, click, or postcondition command reached the fixture tab.

### PASS: one eligible tab resolves and proves the mutation

- Invoked the built worktree CLI with omitted `--tab`, exact allowed origin
  `http://localhost:41873`, role `button`, and name `Commit marker`.
- Observed shared-run state `confirmed` with `mutation_dispatched: true`.
- Fresh structural proof found visible selector `#committed`.
- Fixture state became exactly `clicks=1;committed=true`.

### PASS: multiple eligible tabs fail closed

- Opened a second fixture tab at the same exact origin.
- Invoked the same built CLI command with omitted `--tab`.
- Observed exit 20 and `agent_browser_target_ambiguous`.
- Primary state stayed `clicks=1;committed=true`.
- Secondary state stayed `clicks=0;committed=false`.
- No extra click reached either tab.

## Exact call sequence

The executable receipt is `accept-spike.sh`. It ran this sequence:

```text
bun serve.mjs 41873
browser-connect run agent-browser --json -- agent-browser tab new http://localhost:41873/fixture.html?case=primary --json
browser-connect run agent-browser --json -- agent-browser get text #state --json
bun ../../../dist/browser-use.js task run --intent routine-automation --allowed-origin http://127.0.0.1:41873 --click-role button --click-name "Commit marker" --postcondition-id committed --expect-visible "#committed" --caller matest-implicit-target-accept --json
browser-connect run agent-browser --json -- agent-browser get text #state --json
bun ../../../dist/browser-use.js task run --intent routine-automation --allowed-origin http://localhost:41873 --click-role button --click-name "Commit marker" --postcondition-id committed --expect-visible "#committed" --caller matest-implicit-target-accept --json
browser-connect run agent-browser --json -- agent-browser get text #state --json
browser-connect run agent-browser --json -- agent-browser tab new http://localhost:41873/fixture.html?case=secondary --json
bun ../../../dist/browser-use.js task run --intent routine-automation --allowed-origin http://localhost:41873 --click-role button --click-name "Commit marker" --postcondition-id committed --expect-visible "#committed" --caller matest-implicit-target-accept --json
browser-connect run agent-browser --json -- agent-browser get text #state --json
browser-connect run agent-browser --json -- agent-browser tab close --json
```

All Browser Connect envelopes stayed private. The script retained raw adapter
tab ids only in process-local variables and closed only the tabs it created.

## Implementation consequence

Accept the minimal fix. `task run` now delegates omitted Agent Browser target
selection to the existing exact-origin target owner. Explicit `--tab` behavior
is unchanged. Zero and multiple admissible targets remain mutation-free typed
failures.
