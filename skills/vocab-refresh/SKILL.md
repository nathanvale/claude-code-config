---
name: vocab-refresh
description: "Mine superwhisper recording history for misrecognition pairs, show candidates, and patch settings.json. Use when voice transcription mangles domain terms, after onboarding a new project, or periodically to catch new manglings."
role: tool-workflow
---

# Vocab Refresh

Mine the superwhisper recording database for domain-term misrecognitions using
fuzzy edit-distance matching, present candidates for approval, and patch
`settings.json` with new vocabulary terms and replacement pairs.

## Trigger

- "refresh my vocab", "vocab refresh", "update superwhisper vocabulary"
- "voice is mangling X", "superwhisper keeps getting X wrong"
- After onboarding a new project with unfamiliar jargon

## Paths

- Settings: `~/Documents/Superwhisper/settings/settings.json`
- Recording DB: `~/Library/Application Support/superwhisper/database/superwhisper.sqlite`
- FTS table: `recording_fts_content` — c0 (recordingId), c1 (llmResult), c2 (rawResult), c3 (result)

## Workflow

### 1. Read current state

```bash
cat ~/Documents/Superwhisper/settings/settings.json
```

Note existing replacement count and vocabulary terms.

### 2. Build target word list

Collect domain terms to search for misrecognitions. Sources:

- Existing vocabulary array from settings.json
- Existing replacement `with` values (the correct forms)
- Any new terms the user provides in the invocation

If the user names a specific repo, also scan:
- `CONCEPTS.md` and `CONTEXT.md` at repo root for bolded terms
- Package names from `package.json` files (short name after last `/`)

### 3. Extract all unique words from recording DB

```bash
sqlite3 ~/Library/Application\ Support/superwhisper/database/superwhisper.sqlite \
  "SELECT c2 FROM recording_fts_content WHERE c2 != ''" \
  | grep -oiE '\b\w+\b' | sort -u > /tmp/sw-all-words.txt
```

### 4. Fuzzy match (edit distance 1-2)

For each target term, find words in the corpus within edit distance 1-2.
Use this Python snippet:

```bash
python3 -c "
import sys

targets = sys.argv[1:]
words = set(open('/tmp/sw-all-words.txt').read().strip().split('\n'))

def edit_distance(s1, s2):
    if abs(len(s1) - len(s2)) > 3:
        return 99
    m, n = len(s1), len(s2)
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev = dp[0]
        dp[0] = i
        for j in range(1, n + 1):
            temp = dp[j]
            if s1[i-1].lower() == s2[j-1].lower():
                dp[j] = prev
            else:
                dp[j] = 1 + min(dp[j], dp[j-1], prev)
            prev = temp
    return dp[n]

for target in targets:
    near = []
    tl = target.lower()
    for w in words:
        wl = w.lower()
        if wl == tl or len(wl) < 3:
            continue
        d = edit_distance(tl, wl)
        if 0 < d <= 2:
            near.append((d, w))
    if near:
        near.sort()
        print(f'{target} => {", ".join(f\"{w}(d={d})\" for d, w in near[:10])}')
" TERM1 TERM2 TERM3
```

### 5. Count occurrences of candidates

For each fuzzy match, count how often it appears in the recording DB:

```bash
sqlite3 ~/Library/Application\ Support/superwhisper/database/superwhisper.sqlite \
  "SELECT c2 FROM recording_fts_content WHERE c2 != ''" \
  | grep -oiE '\b(CANDIDATE1|CANDIDATE2|...)\b' | sort | uniq -c | sort -rn
```

### 6. Also search for compound splits

Common pattern: model splits one word into two. Search for:

```bash
sqlite3 ~/Library/Application\ Support/superwhisper/database/superwhisper.sqlite \
  "SELECT c2 FROM recording_fts_content WHERE c2 != ''" \
  | grep -oiE '\b(cloud code|Cloud Code|work tree|change set|fire crawl|bit bucket|mono repo|play right|...)\b' \
  | sort | uniq -c | sort -rn
```

Build the compound list from target terms that are single words but could be
heard as two (worktree, changeset, firecrawl, Bitbucket, monorepo, Playwright).

### 7. Present candidates

Show the user a table of candidates with:
- Misrecognition → Correct term
- Occurrence count
- Safety assessment (safe / risky if it's a real English word)

Ask the user to approve, reject, or edit each candidate. Skip candidates that
are already in the replacements array.

### 8. Patch settings.json

For approved candidates:
- Add to `replacements` array with `{id: UUID, original: "misrecognition", with: "correct"}`
- Generate UUIDs (any format, superwhisper accepts them)
- Preserve all existing entries — never remove or modify hand-entered replacements

For new vocabulary terms the user wants to add:
- Append strings to the `vocabulary` array
- Only proper nouns and acronyms — skip common English words

Read-modify-write: preserve all other fields (favoriteModelIDs, modeKeys, etc.).

### 9. Restart superwhisper

```bash
killall superwhisper 2>/dev/null; sleep 1; open -a superwhisper
```

Superwhisper requires restart to pick up external settings.json changes.

### 10. Report

Print summary: N new replacements added, N new vocabulary terms, total counts.

## Safety

- Never remove existing replacements or vocabulary terms.
- Flag candidates that are common English words (cloud, clause, health, latest, berry, ferry, okra) as risky.
- Match on `original` field to avoid duplicates — if an existing replacement already covers a candidate, skip it.
- Preserve settings.json formatting (2-space indent, Apple-style JSON).

## Superwhisper docs guidance

- Vocabulary should be sparse (~20-50 terms). Too many words confuse the model.
- Replacements are the primary lever — deterministic, zero-latency, uncapped.
- Vocabulary items are plain strings: `"vocabulary": ["term1", "term2"]`
- Replacement items are objects: `{"id": "UUID", "original": "misheard", "with": "correct"}`
