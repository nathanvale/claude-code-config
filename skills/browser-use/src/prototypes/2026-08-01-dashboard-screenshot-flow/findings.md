# Dashboard screenshot flow spike

Status: PASS

Prototype only. The adapter-specific scripts are falsification fixtures, not a
production Browser Use interface.

## Question

Can one LLM-level outcome, "open this dashboard and capture a screenshot", run
through every registered adapter without adding capabilities to those adapters?

## Outcome contract

- Use one verified Warm Chrome endpoint.
- Reach the requested origin.
- Prove the dashboard marker exists and is visible.
- Refuse a login wall that lacks the marker.
- Refuse an off-origin redirect before screenshot capture.
- Produce a non-empty PNG only after the proofs pass.

## Results

| Adapter | Dashboard | Login wall | Off-origin redirect | Same endpoint |
| --- | --- | --- | --- | --- |
| `agent-browser` | PASS | REFUSED | REFUSED | PASS |
| `playwright-cdp` | PASS | REFUSED | REFUSED | PASS |
| `chrome-devtools-mcp` | PASS | REFUSED | REFUSED | PASS |

Run:

```sh
./accept-spike.sh
```

Final output:

```text
PASS all adapters used the same verified Warm Chrome endpoint
VERDICT PASS
```

## Native call shape

The reusable workflow is adapter-neutral:

1. Interpret the requested outcome and safety bounds.
2. Ask browser-connect for a verified handoff.
3. Read the selected adapter's native help or tool schema.
4. Let the LLM invoke that native surface to reach and prove the outcome.
5. Return the bounded outcome and artifact reference.

The acceptance fixture expands step 4 separately for each adapter so the claim
is falsifiable. Those mappings must not become production Browser Use code.

## Finding

The original off-origin fixture redirected to an unreachable host, so the
refusal it observed was a network failure, not an origin refusal. The fixture
now binds `127.0.0.1` explicitly and redirects to a reachable off-origin page
that carries the dashboard marker. This exposed and fixed an ordering flaw in
the Chrome DevTools MCP lane: origin verification now precedes marker
evaluation and screenshot capture, so a marker-bearing off-origin page can
never produce an artifact.

Separate Chrome DevTools MCP process calls did not preserve selected-page
state. One native MCP process successfully performed page creation, proof, and
screenshot capture. Session continuity therefore belongs to the adapter-native
interaction. Browser Use must not learn page IDs, selection rules, or MCP tool
names to compensate.

## Decision forced

Do not build a universal Browser Facade. Keep Browser Use at intent, authority,
routing, verified attachment, and outcome. Let the LLM drive the selected
adapter's existing tools.

