# N5 warm-vs-isolated — RESOLVED (chrome-devtools-CLI drives warm Chrome)

The open correctness question flagged across the session: the chrome-devtools-CLI (N5)
daemon starts with CONTRADICTORY args —

    --browser-url http://127.0.0.1:9222   (connect to warm Chrome)
    --headless --isolated                  (launch own throwaway profile)

Which wins? If N5 was driving its own isolated context, every N5 number in the docs
(304ms cost, matrix position, "auto-recover" staleness verdict) would be measuring the
WRONG browser.

## Test — three-way page-list comparison

| source | tabs seen |
|---|---|
| ground truth (raw CDP `/json/list` on :9222) | iana.org + `file://.../architecture-review-...html` |
| N5 chrome-devtools-CLI `list_pages` | **same 2 tabs, identical** |
| N1 chrome-devtools-MCP `list_pages` (no --isolated) | **same 2 tabs, identical** |

N5, N1, and raw CDP return byte-identical page lists.

## Verdict — N5 drives WARM Chrome. The --isolated flag is inert.

When a CDP endpoint is supplied via `--browser-url`, chrome-devtools-mcp connects to it;
the `--headless --isolated` flags only apply when it must LAUNCH its own Chrome, which it
does not because the endpoint already exists. So the contradictory args resolve in favor
of the warm connection.

## Implication — clears the asterisk

Every N5 measurement in the session docs is valid (it was driving real warm Chrome):
- N5's 304ms cost in the cost-routing table — real
- N5's place in the 5-adapter matrix — real
- N5's "auto-recover" staleness verdict — real

No prior finding needs correction. The foundation is sound.

Retires the "N5 connection model UNRESOLVED" caveat in the multi-engine-facade
requirements (Dependencies / Assumptions) and the N5-MATRIX-NOTES flag.

## Status

Throwaway check (raw curl + two list_pages calls). The verdict is the keeper. No harness
file — the test is three commands; re-verify any time with:

    curl -s http://127.0.0.1:9222/json/list   # ground truth
    chrome-devtools list_pages                 # N5
    mcporter call chrome-devtools.list_pages   # N1
