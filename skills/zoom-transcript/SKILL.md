---
name: zoom-transcript
description: Zoom recording page patterns, transcript extraction recipes, and page state detection. Covers API-based extraction (primary) and DOM fallback. Domain knowledge for browser agents working with Zoom recordings.
user-invocable: false
---

# Zoom Transcript Extraction

Domain knowledge for extracting transcripts from Zoom recording pages. No browser commands here -- just patterns, selectors, and recipes. The agent using this skill decides how to execute them.

Works with any Zoom instance (e.g. `*.zoom.us`, `us02web.zoom.us`, org-specific subdomains).

## Registry Cross-References

This skill provides workflow logic. Selectors and fingerprints live in the registry:

- **Selector registry:** `~/.claude/browser-configs/selectors.zoom-recording.yaml`
- **Playbooks:** `~/.claude/browser-configs/playbooks/zoom-recording/`
- **Gotchas:** `~/.claude/browser-configs/gotchas.zoom-recording.md`

When a specific selector is needed, consult the registry first. This skill covers the *workflow* (URL resolution strategy, page state detection table, extraction strategy ordering), not the selector values.

## Share URL Resolution

Share URLs (`/rec/share/...`) redirect through Zoom's SPA which sets `continueMode=true`, causing the page to load a *different* recording from the session playlist.

### Resolution Strategy

1. Navigate to the share URL once
2. Wait for the page to redirect to `/rec/play/...`
3. Capture the current URL -- this is the play URL with the recording's unique ID
4. If the page title doesn't match the expected meeting name, the `continueMode` redirect occurred
5. Re-navigate using the play URL WITHOUT `continueMode`: `https://{zoom-host}/rec/play/{ID}?accessLevel=meeting&canPlayFromShare=true&from=share_recording_detail&componentName=rec-play&originRequestUrl={encoded-share-url}`

### Hub Share URLs (unresolvable)

Some share URLs from Zoom Hub represent a shared folder/collection, not a single recording. These rotate through recently-viewed recordings and cannot be resolved via direct navigation. If a share URL consistently loads the wrong recording after 2 attempts, report `FAILED: Hub share URL cannot be resolved`.

See `~/.claude/browser-configs/gotchas.zoom-recording.md` for detailed Hub resolution patterns.

## Page State Detection

After navigating to a recording URL and waiting 5s, classify the page using the fingerprints in the selector registry:

| State | Detection | Result |
|-------|-----------|--------|
| **Recording loaded** | `recording_play` fingerprint matches | Proceed to extraction |
| **Passcode gate** | `recording_passcode_gate` fingerprint matches | Fill passcode (if provided) or SKIPPED |
| **No transcript** | Recording loaded but API confirms `hasTranscript: false` | SKIPPED: No transcript |
| **Auth redirect** | `zoom_signin` fingerprint matches or SSO/Okta domain | Authenticate, then retry |
| **Expired/invalid** | `recording_expired` fingerprint matches | SKIPPED: Expired/invalid link |
| **Error page** | HTTP error or blank page after 10s | SKIPPED: Page load error |

## Extraction Strategy (ordered by preference)

### 1. API Extraction (primary -- fastest, most reliable)

The Zoom play/info API returns the full transcript as structured JSON. No DOM interaction needed.

**Playbook:** `~/.claude/browser-configs/playbooks/zoom-recording/extract-transcript.yaml` (step: `api_extraction`)
**Script:** `~/.claude/browser-configs/playbooks/zoom-recording/scripts/extract-transcript-api.js`

**How to get the API URL:**
1. After the recording page loads, check browser performance entries for a URL matching `/nws/recording/1.0/play/info/`
2. Alternatively, construct it from the play URL's recording ID

**Check transcript availability:**
```javascript
// Fetch the play/info response
var resp = await fetch(playInfoUrl);
var data = await resp.json();
// data.result.hasTranscript -- boolean, authoritative
// data.result.transcriptList -- array of transcript entries (if hasTranscript is true)
```

If `hasTranscript` is `false`, skip immediately -- no transcript exists.

**Extract from API response:**
The `transcriptList` array contains objects with:
- `username` -- speaker name
- `ts` -- start timestamp (string `HH:MM:SS.mmm` -- see gotchas for format)
- `end_ts` -- end timestamp
- `text` -- dialogue text

Format as standard transcript blocks:
```
Speaker Name
HH:MM:SS
Dialogue text here.

Another Speaker
HH:MM:SS
More dialogue.
```

Convert `ts` to HH:MM:SS using `e.ts.split('.')[0]`. Write directly to temp file.

### 2. DOM Extraction (fallback -- if API unavailable)

**Script:** `~/.claude/browser-configs/playbooks/zoom-recording/scripts/extract-transcript-dom.js`

Use only if the play/info API is unreachable or returns no `transcriptList`.

#### Audio Transcript Tab

The transcript lives behind a tab that may not be selected by default:

1. Snapshot the page
2. Look for `tab "Audio Transcript"` in the accessibility tree
3. If the tab exists but lacks `[selected]`, click it and wait 3s
4. If the tab doesn't exist AND API confirms `hasTranscript: false`, skip

#### DOM Selectors

See the `transcript_panel` region in `selectors.zoom-recording.yaml` for current validated selectors.

**Important:** Do NOT use `[role=tabpanel]` -- Zoom uses class-based selectors, not ARIA roles, for the transcript panel (see gotchas).

#### Attempt 1: Scroll-Trigger

Zoom uses `vue-recycle-scroller` -- it only renders visible items. A tiny scroll triggers the full render:

1. Ensure Audio Transcript tab is selected
2. Trigger virtual scroll: `document.querySelector('.transcript-container').scrollTop = 1`
3. Wait 2s for rendering
4. Check length: `document.querySelector('.transcript-list')?.innerText?.length || 0`
5. If length > 200, extract: `document.querySelector('.transcript-list')?.innerText`
6. Write to temp file

**Total wait:** ~10s. If < 200 chars, proceed to Attempt 2.

#### Attempt 2: Full Reload + Aggressive Scroll

1. Full page reload, wait 8s
2. Snapshot to verify page state, re-click Audio Transcript tab if needed, wait 3s
3. Aggressive scroll sequence (see DOM extraction script)
4. Wait 5s
5. Check length again
6. If still < 200, try broader selector: `document.querySelector('[class*=transcript]')?.innerText`

**Total wait:** ~16s additional. If both DOM attempts fail, report FAILED.

## Transcript Format

The extracted text (from either API or DOM) follows this pattern:

```
Speaker Name
HH:MM:SS
Dialogue text here.

Another Speaker
HH:MM:SS
More dialogue.
```

Each block is: speaker name, timestamp, then one or more lines of dialogue, separated by blank lines.

## Validation

**Script:** `~/.claude/browser-configs/playbooks/zoom-recording/scripts/verify-extract-transcript.js`

Checks:
- Transcript must be > 200 characters of actual content
- At least 1 unique speaker detected
- Valid HH:MM:SS timestamp format present

## URL Patterns

| Pattern | Meaning |
|---------|---------|
| `{host}/rec/share/...` | Share link (may trigger continueMode redirect) |
| `{host}/rec/play/...` | Direct play link (stable once resolved) |
| `zoom.us/signin` | Auth required -- Zoom login page |
| `/nws/recording/1.0/play/info/...` | Play info API (transcript data + metadata) |
