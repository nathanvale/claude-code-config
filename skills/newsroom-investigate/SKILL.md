---
name: newsroom-investigate
description: "Research community signal across Reddit, X, YouTube, and the web with @side-quest/word-on-the-street, then fact-check claims against official sources. Use for community sentiment, recommendations, buzz, X vs Y, has anyone tried X, or what people are saying. Not for codebase exploration, generic web lookup, summarization, code review, or implementation research."
role: tool-workflow
argument-hint: '"[topic(s)] [--topic "..."] [--quick|--deep] [--days N] [--sources reddit|x|both] [--no-fact-check]"'
allowed-tools: Read, Agent, Bash, WebSearch, WebFetch
---

# Newsroom Investigate

Research orchestrator that dispatches parallel agents to gather community intelligence and verify claims against official sources.

## Preflight

Before dispatching any agents, verify the toolchain. Run these checks and stop with a clear error if any fail:

1. **wots CLI**: `bunx --bun @side-quest/word-on-the-street --version`
   - Fail: "The @side-quest/word-on-the-street CLI is not installed. Install with: `bun add -g @side-quest/word-on-the-street`"

2. **yt-dlp**: `which yt-dlp`
   - Fail: "yt-dlp is not installed (required for YouTube results). Install with: `brew install yt-dlp`"

3. **API keys**: Check key presence without printing values. Check environment variables first (`test -n "${OPENAI_API_KEY:-}"` and `test -n "${XAI_API_KEY:-}"`), then fall back to key names in `~/.config/wots/.env`. At least one key must be available from either source.
   - Never echo, print, log, or paste API key values.
   - Fail: "No API keys found in environment or `~/.config/wots/.env`. Set `OPENAI_API_KEY` and/or `XAI_API_KEY` in your shell exports or create `~/.config/wots/.env`"

4. **Context7 MCP** (for fact-checking): Verify `resolve-library-id` tool is available by checking your available MCP tools
   - Fail (soft): "Context7 MCP not available — fact-checking will use WebSearch only (no library doc verification)"

## Parse Arguments

Parse `$ARGUMENTS` to extract:

- **TOPICS**: Positional arguments (comma-split) or `--topic "..."` flags (repeatable). `--topic` takes precedence.
- **DEPTH**: `--quick` or `--deep`. Default: standard.
- **SOURCES**: `--sources reddit|x|both`. Default: auto (CLI decides based on available keys).
- **DAYS**: `--days N` (1-365). Default: 30.
- **FACT_CHECK**: Enabled by default. Disable with `--no-fact-check`.
- **QUERY_TYPE** per topic: Auto-detect from the topic text:
  - RECOMMENDATIONS: "best X", "top X", "recommended X" (wants a list of specific things)
  - NEWS: "what's happening with X", "X news", "latest on X"
  - GENERAL: everything else

If no topic is provided, ask the user for one. Once you have topic(s), print a brief summary and dispatch immediately:

> Researching **{topics}** — {depth}, {sources}, {days} days{", no fact-check" if disabled}

No confirmation gate. Just go.

**Broad topic detection:** If a topic is a single generic word (e.g., "AI", "cloud", "programming", "security"), warn the user before dispatching: "That's a very broad topic — '{topic}' could return thousands of results. Want to narrow it down, or go as-is?" If they say go, proceed.

**Security topic auto-detection:** If any topic contains "security", "CVE", "vulnerability", or "advisory", auto-escalate the fact-check claim count from 3 to 5 and prioritize CVE/advisory claims.

Reject more than 5 topics: "Too many topics — cap at 5 or combine related ones."

## Normalize Topics

Before dispatching, normalize each topic to improve CLI search precision. The CLI's topic string drives Reddit/X search prompts, YouTube queries, and web search — small phrasing changes have outsized impact on result quality.

**Rules (check query type first, then trim):**

1. **Check query-type exceptions FIRST** — these override filler removal in step 2:
   - RECOMMENDATIONS: preserve "best/top" if the user explicitly included them (e.g., "best React frameworks" stays)
   - NEWS: will append "release" or "announcement" in step 3
   - GENERAL: no exceptions
2. **Trim to 3-6 core tokens** — remove filler words NOT protected by step 1: "latest", "new", "guide", "tips", "what's", "what are the", "tell me about". Keep proper nouns and product/version identifiers.
3. **Preserve disambiguators** — keep tokens like: v2, 2.1.49, 2026, security, release, CVE
4. **Apply query-type additions:**
   - NEWS: append "release" or "announcement" only if the topic doesn't already contain a news-intent word (updates, news, changes, announcement, release, launch). If it does, the topic already signals recency — don't double up.
5. **Shorten if > 8 tokens** — keep: first 2 proper nouns, 1 version/date token, 1 intent token (release/security) if present

**Examples:**

| Raw Topic | Query Type | Normalized |
|---|---|---|
| "what's new in Claude Code 2.1.49" | NEWS | "Claude Code 2.1.49 release" |
| "best TypeScript frameworks 2026" | RECOMMENDATIONS | "best TypeScript frameworks 2026" |
| "tips for prompt engineering with Claude" | GENERAL | "prompt engineering Claude" |
| "Rust memory safety discussion" | GENERAL | "Rust memory safety" |

Pass the **normalized** topic to the Beat Reporter. If normalized, keep the original as `raw_topic` in the assignment for transparency.

## Dispatch Beat Reporters

Read [references/beat-reporter.md](references/beat-reporter.md) for the agent instructions.

For each topic, dispatch ONE beat-reporter Agent in the same message (parallel execution). Use `model: "sonnet"` for cost efficiency.

Build a structured JSON assignment for each reporter:

```
Agent({
  description: "Beat Reporter: [topic]",
  model: "sonnet",
  prompt: `Read skills/newsroom-investigate/references/beat-reporter.md and follow its instructions to execute this assignment.

{
  "topic": "[normalized topic]",
  "raw_topic": "[original topic, only if normalized]",
  "query_type": "RECOMMENDATIONS|NEWS|GENERAL",
  "cli_flags": "[--quick|--deep] [--sources=X] [--days=N]",
  "depth": "quick|standard|deep"
}`
})
```

Map flags to CLI flags:
- `--quick` → `--quick`
- `--deep` → `--deep --strategy=two-phase --phase2-budget=5`
- `--sources reddit` → `--sources=reddit`
- `--sources x` → `--sources=x`
- `--sources both` → `--sources=both`
- `--days N` → `--days=N`

Always include: `--json --quiet --include-web --include-youtube`

## Collect Results

Wait for all reporter agents to return. Handle partial failures gracefully:

| Scenario | Action |
|----------|--------|
| All reporters succeed | Full synthesis |
| Some reporters succeed | Synthesize available results, note which topics had gaps |
| CLI failed but web results exist | Report web findings, note "engagement data unavailable" |
| Reporter times out | Note gap, continue with others |
| All reporters fail | Report failure honestly, suggest checking API keys or retrying |

## Fact-Check Pass

**Skip this step if `--no-fact-check` was passed.**

Scan all reporter results for verifiable factual claims — bug reports, version/release claims, feature announcements, deprecation notices, performance claims, security issues.

**Claim extraction rules:**
- Default: extract top 3 claims
- NEWS query type: extract top 5 claims
- Security-related topic (detected earlier): extract top 5 claims, prioritize CVEs and advisories
- Prioritize claims that appear in multiple sources or have high engagement
- Focus on: version-specific claims, "official" statements, benchmark numbers, bug reports with no linked issue

Read [references/fact-checker.md](references/fact-checker.md) for the agent instructions.

Dispatch a single fact-checker Agent:

```
Agent({
  description: "Fact Checker",
  model: "sonnet",
  prompt: `Read skills/newsroom-investigate/references/fact-checker.md and follow its instructions.

{
  "claims": [
    {
      "id": 1,
      "assertion": "the specific claim",
      "source": "where it came from (e.g., r/ClaudeAI, 342 upvotes)",
      "category": "bug|release|security|pricing|performance|feature"
    }
  ],
  "topic": "[research topic for context]"
}`
})
```

## Synthesize Output

Ground the synthesis in actual research data, not pre-trained knowledge.

**Synthesis priority:**
1. **Engagement-ranked CLI data (Reddit, X, YouTube) is the strongest signal** — these have verified upvotes, likes, comments
2. **Web results are supplementary** — no engagement verification, useful for official sources and articles
3. **Cross-source patterns are gold** — if something appears in both CLI and web results, it's a strong signal
4. **Deduplicate** — same story across sources? Merge and keep highest engagement numbers
5. **Extract top 3-5 actionable findings per topic**

### For RECOMMENDATIONS queries:

```
# Research: [topic]

## What the community recommends

1. **[Specific name]** — mentioned {n}x ({sources with engagement})
2. **[Specific name]** — mentioned {n}x ({sources})
3. **[Specific name]** — mentioned {n}x ({sources})

Notable mentions: [others with 1-2 mentions]

## Key patterns
- [Pattern from research]
- [Pattern from research]
```

### For NEWS queries:

```
# Research: [topic]

## Latest developments

1. **[Headline]** ({date}) — [1-2 sentence summary with attribution]
2. **[Headline]** ({date}) — [1-2 sentence summary]

## Emerging trends
- [Trend from research]
```

### For GENERAL queries:

```
# Research: [topic]

## Key findings
- [Finding grounded in actual data]
- [Finding with source attribution]

## Community consensus
[What most sources agree on]

## Points of debate
[Where opinions split, with engagement numbers]
```

### All queries get these sections:

```
---
**Sources** ({n} links)

Reddit:
- [title](url) ({score} pts, {comments} comments) — r/{subreddit}

X:
- [text](url) ({likes} likes) — @{handle}

YouTube:
- [title](url) ({views} views, {likes} likes) — {channel}

Web:
- [title](url) — {domain}
---

**Stats**
- Reddit: {n} posts | {total_upvotes} upvotes
- X: {n} posts | {total_likes} likes
- YouTube: {n} videos | {total_views} views
- Web: {n} pages
```

### Verification section (only if fact-check ran):

```
## Verification ({n} claims checked)
- {verdict_emoji} **{claim}** — {evidence} ({source_url})
```

Verdict emojis: verified, contradicted, unverified

## After Publishing

You are an expert on the topics covered for the rest of the conversation. Answer follow-ups from your research — do not re-search unless the user asks about a different topic.

Offer follow-up options:
- "Dig deeper" — re-run with `--deep` on a specific angle
- "New topic" — start fresh
- "Compare" — head-to-head on two items from the results (if RECOMMENDATIONS)
