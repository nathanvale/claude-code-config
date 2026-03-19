---
name: zoom-transcript
description: Zoom recording page patterns, transcript extraction recipes, and page state detection. Covers API-based extraction (primary) and DOM fallback. Domain knowledge for browser agents working with Zoom recordings.
user-invocable: false
---

# Zoom Transcript Extraction

Domain knowledge for extracting transcripts from Zoom recording pages. No browser commands here -- just patterns, selectors, and recipes. The agent using this skill decides how to execute them.

Works with any Zoom instance (e.g. `*.zoom.us`, `us02web.zoom.us`, org-specific subdomains).

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

## Page State Detection

After navigating to a recording URL and waiting 5s, classify the page:

| State | Detection | Result |
|-------|-----------|--------|
| **Recording loaded** | URL contains `/rec/play` or `/rec/share/` AND snapshot shows video player | Proceed to extraction |
| **No transcript** | Recording loaded but NO `tab "Audio Transcript"` in snapshot | Check API `hasTranscript` before skipping |
| **Auth redirect** | URL contains `zoom.us/signin` or an SSO/Okta domain | Authenticate, then retry |
| **Passcode gate** | Snapshot shows `textbox "Passcode"` or text "Enter the passcode" | SKIPPED: Passcode-gated |
| **Expired/invalid** | Page shows "This recording has expired" or "Recording does not exist" | SKIPPED: Expired/invalid link |
| **Error page** | HTTP error or blank page after 10s | SKIPPED: Page load error |

## Extraction Strategy (ordered by preference)

### 1. API Extraction (primary -- fastest, most reliable)

The Zoom play/info API returns the full transcript as structured JSON. No DOM interaction needed.

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
- `ts` -- start timestamp (milliseconds or `HH:MM:SS.mmm` string depending on Zoom version)
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

Convert `ts` to HH:MM:SS (if numeric, divide by 1000; if string, substring to 8 chars). Write directly to temp file.

### 2. DOM Extraction (fallback -- if API unavailable)

Use only if the play/info API is unreachable or returns no `transcriptList`.

#### Audio Transcript Tab

The transcript lives behind a tab that may not be selected by default:

1. Snapshot the page
2. Look for `tab "Audio Transcript"` in the accessibility tree
3. If the tab exists but lacks `[selected]`, click it and wait 3s
4. If the tab doesn't exist AND API confirms `hasTranscript: false`, skip

#### DOM Selectors

| Selector | What it targets |
|----------|----------------|
| `.transcript-container` | Outer scroll container (vue-recycle-scroller) |
| `.transcript-list` | Inner list with all transcript entries |
| `[class*=transcript]` | Broader fallback -- catches variant class names |

**Important:** Do NOT use `[role=tabpanel]` -- Zoom uses class-based selectors, not ARIA roles, for the transcript panel.

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
3. Aggressive scroll sequence:
   ```javascript
   var el = document.querySelector('.transcript-container');
   if(el) {
     el.scrollTop = el.scrollHeight;
     setTimeout(() => {
       el.scrollTop = 0;
       setTimeout(() => { el.scrollTop = 1; }, 500);
     }, 1000);
   }
   ```
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

- Transcript must be > 200 characters of actual content
- If shorter, it's likely a rendering failure or a recording with no speech

## URL Patterns

| Pattern | Meaning |
|---------|---------|
| `{host}/rec/share/...` | Share link (may trigger continueMode redirect) |
| `{host}/rec/play/...` | Direct play link (stable once resolved) |
| `zoom.us/signin` | Auth required -- Zoom login page |
| `/nws/recording/1.0/play/info/...` | Play info API (transcript data + metadata) |
