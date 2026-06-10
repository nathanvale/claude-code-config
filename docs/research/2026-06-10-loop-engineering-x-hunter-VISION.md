# Vision: Loop Engineering X Hunter

## Product Bet

A discovery loop that hunts X.com for genuine agentic loop / loop engineering examples,
verifies each candidate, and builds a structured ledger — stopping only when searches
go dry. The ledger becomes raw material for a prompt pack and training data.

## Loop

```text
HUNT     → run N query variations via X API MCP
DEDUPE   → filter tweet_ids already in ledger
VERIFY   → classify each candidate: LOOP_EXAMPLE | MENTION | HYPE | IRRELEVANT
APPEND   → write LOOP_EXAMPLE rows to ledger with signals + metadata
ROTATE   → swap in new query variations, run HUNT again
STOP     → 3 consecutive passes add 0 new LOOP_EXAMPLE rows
           OR ledger reaches 25 verified examples
HANDOFF  → final ledger + prompt-pack excerpt
```

## Search Query Bank

Rotate across these variations to maximise coverage without repeating the same results:

1. `"loop engineering" -is:retweet lang:en`
2. `"agentic loop" example -is:retweet lang:en`
3. `"designing loops" agent prompt -is:retweet lang:en`
4. `"you don't prompt" agents loop -is:retweet lang:en`
5. `"loop engineering" how -is:retweet lang:en`
6. `"agentic loop" build -is:retweet lang:en`
7. `"feedback loop" agent "stop condition" -is:retweet lang:en`
8. `"plan act observe" agent -is:retweet lang:en`

## Verification Signals (any one qualifies)

- **CYCLE** — post describes or diagrams Plan → Act → Check → Repeat (or equivalent feedback arc)
- **STOP** — post names when/why the loop terminates (tests pass, no new findings, user approves, etc.)
- **EVIDENCE** — post includes screenshot, code, output trace, or before/after showing the loop ran
- **MECHANISM** — post describes *how* the loop is designed (harness, checks, retry policy, handoff)

Disqualifiers:
- References "loop engineering" or "agentic loop" without describing any loop mechanics
- Pure hype / sentiment ("this replaces engineers!")
- Off-topic (metaverse, gaming, unrelated "loop")

## Ledger Row Shape

```markdown
| tweet_id | url | author | loop_type | loop_signals | engagement | quote |
```

- `loop_type`: code-review | test-fix | ui-screenshot | content-gen | multi-agent | generic
- `loop_signals`: pipe-separated list of qualifying signals (CYCLE | STOP | EVIDENCE | MECHANISM)
- `engagement`: likes + bookmarks (quality proxy for prompt pack ranking)
- `quote`: most reusable 1-2 sentence excerpt

## Stop Rule

- Dry pass = a full query-bank rotation that adds 0 new LOOP_EXAMPLE rows
- Stop after 3 consecutive dry passes OR 25 verified examples, whichever is first
- Log dry pass count explicitly so the stop is auditable

## Output

- Ledger: `docs/research/2026-06-10-loop-engineering-ledger.md`
- Prompt pack excerpt: bottom section of the ledger, top 10 rows by engagement

## Constraints

- X API MCP only (WOTS CLI unavailable)
- 7-day window — time-sensitive, run promptly
- Dedupe by tweet_id across all passes
- Never count a MENTION or HYPE row as a loop example
