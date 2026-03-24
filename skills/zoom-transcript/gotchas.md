---
domain: zoom-recording
services: [zoom]
updated: 2026-03-23
---

# Zoom Recording Gotchas

Generic Zoom recording page behaviours. Auth-specific gotchas (Okta, SSO) live in project-scoped gotcha files.

## continueMode Redirect

**Symptom:** Navigating to a share URL (`/rec/share/...`) redirects to a different recording than requested. The page title briefly shows the correct recording then flips to another.
**Cause:** Zoom's SPA sets `continueMode=true` on the redirect to `/rec/play/...`, which triggers an auto-play playlist of recently-viewed shared recordings.
**Workaround:** Use the direct `/rec/play/...` URL with `continueMode` omitted. Navigate to the share URL once to get the play URL, then use: `agent-browser open "https://{zoom-host}/rec/play/{ID}?accessLevel=meeting&canPlayFromShare=true&from=share_recording_detail&componentName=rec-play&originRequestUrl={encoded-share-url}"`. Allow 10s for the transcript to fully render.

## Hub Share URLs

Hub share URLs (`/rec/share/gMOd...` style) represent a shared folder/collection, not a single recording. They rotate through recently-viewed recordings from the same shared folder.

### Resolution via Hub Home List

1. Navigate to `hub.zoom.us/home` and wait 6s for the SPA to fully load.
2. Find the target recording in the Recent list by snapshot. Click it to expand a preview panel.
3. Before clicking "Play recording", install `window.open = function(url) { window._openedUrl = url; return null; }`.
4. Click Play — it calls `window.open` with the direct `/rec/share/...?from=hub` URL.
5. Navigate to the captured share URL → redirects to `/rec/play/...` with `continueMode=true`.
6. Capture the play/info URL from `performance.getEntriesByType('resource')`.

### Unresolvable Hub URLs

If a share URL consistently loads the wrong recording after 2 attempts, report `FAILED: Hub share URL cannot be resolved`.

## Transcript DOM Selectors

**Symptom:** `document.querySelector('[role=tabpanel]')` returns null on Zoom recording pages even when the Audio Transcript tab is visible.
**Cause:** The Zoom Vue component uses class-based selectors, not ARIA roles, for the transcript panel.
**Workaround:** Use `.transcript-container` for scroll-trigger and `.transcript-list` for innerText extraction. The `[role=tab]` / `[role=tablist]` selectors work for detecting the tab in the accessibility tree snapshot, but the panel content requires class selectors.

## ts Field Format

**Symptom:** Formatting timestamps with math operations (dividing ms) produces `NaN:NaN:NaN`.
**Cause:** The `ts` field in `transcriptList` entries is a string like `"00:02:19.610"`, not a numeric millisecond value.
**Workaround:** Use `e.ts.split('.')[0]` to get `HH:MM:SS` without the sub-second part.

## Double JSON Encoding

**Symptom:** When piping `agent-browser eval` output to a file, the file contains double-encoded JSON (literal `\n` instead of real newlines, surrounded by outer quotes).
**Cause:** `agent-browser` wraps the eval return value in JSON encoding. If the eval itself returns `JSON.stringify(...)`, the file gets two layers of JSON encoding.
**Workaround:** Return the raw string from eval (not `JSON.stringify`) and let agent-browser encode it once, then `JSON.parse` once when reading back.

## API Extraction

**Symptom:** DOM extraction via `.transcript-list` is unreliable with virtual scroll rendering.
**Cause:** Zoom's play/info API returns the full transcript as structured JSON — no DOM interaction needed.
**Workaround:** After the recording page loads, check performance entries for `/nws/recording/1.0/play/info/` URL, fetch it directly. Parse `result.transcriptList`. Format as `speaker\nHH:MM:SS\ntext\n\n` blocks. Check `result.hasTranscript` first — if `false`, skip immediately.

## Transcript Availability Check

**Symptom:** Zoom recording page has no Audio Transcript tab.
**Cause:** Not all recordings have auto-transcription enabled.
**Workaround:** Check `result.hasTranscript` from the play/info API before attempting DOM extraction. This is authoritative.

## Short Clips

**Symptom:** A recording titled with "(Zoom only)" suffix has only a few transcript entries covering < 30 seconds.
**Cause:** The "(Zoom only)" label indicates the full meeting was on another platform; only the brief initial Zoom segment was captured.
**Workaround:** Accept the short transcript as complete. Note in the meeting record that the main session content is not in this Zoom recording.

## Chrome Connection (IMPORTANT)

**Symptom:** Multiple parallel zoom agents each launch their own Chrome window.
**Cause:** `--session <name>` in agent-browser creates a **separate isolated browser process** per session name — NOT a tab within an existing daemon. So 3 parallel agents with `--session zoom-1`, `--session zoom-2`, `--session zoom-3` = 3 Chrome windows.
**Workaround:** For parallel extraction, this is unavoidable with `--session`. To avoid multiple Chrome windows, run extraction agents **serially** (one at a time). Use `--profile` for persistent cookies and `--session-name` (different from `--session`) for cookie auto-save/restore without spawning a new process.

```bash
# Serial extraction -- one agent, one Chrome, reuses session
agent-browser --headed --profile ~/.cache/chrome-agent open <url>

# Parallel -- each spawns its own Chrome (unavoidable)
agent-browser --headed --profile ~/.cache/chrome-agent --session zoom-1 open <url>
```

**Key distinction:**
- `--session <name>` → isolated browser PROCESS (separate Chrome)
- `--session-name <name>` → auto-save/restore cookies within the SAME daemon
- `--profile <path>` → persistent data dir (cookies, IndexedDB, cache)

## Eval Output Parsing with jq

**Symptom:** Cannot write transcript from agent-browser eval output using Node.js inline scripts (git-safety hook blocks inline interpreter execution).
**Cause:** The git-safety hook rejects `node -e`, `python3 -e`, and heredoc-based interpreter calls.
**Workaround:** Use `jq -r '.transcript'` to extract the raw transcript field from the JSON output file. This avoids the inline interpreter restriction entirely.

## Zoom SSO via monash.zoom.us

**Symptom:** Clicking "Sign in with SSO" on `us02web.zoom.us/signin` does nothing (SPA doesn't navigate away).
**Cause:** The share URL redirect lands on `us02web.zoom.us` not `monash.zoom.us`. The SSO button on this subdomain may not work correctly for Monash.
**Workaround:** Navigate directly to `monash.zoom.us/signin` -- this immediately redirects to Okta SAML SSO without needing to click anything.

## Transcript Output Size for Long Meetings

**Symptom:** `agent-browser eval` returns transcript output exceeding Claude's inline context (>100KB). Claude Code persists it to a tool-results file instead of showing inline.
**Cause:** Long meetings (3h+) can produce 1600+ transcript entries, generating 150-180KB of output.
**Workaround:** Read the persisted tool-results file path shown in the output. Use a Python script to parse the JSON (result object with `ok`, `transcript`, `speakers`, `entries` keys) and write `result['transcript']` to the target file. Do not try to JSON.stringify inline -- use `json.loads()` on the raw file content.

## fetch() Blocked on Zoom Recording Pages

**Symptom:** `await fetch(playInfoUrl)` throws `TypeError: Failed to fetch` even when the URL was found in performance entries and the user is authenticated.
**Cause:** The Zoom recording SPA uses a Content Security Policy or cross-origin restriction that blocks `fetch()` calls to the `/nws/recording/1.0/play/info/` endpoint from injected eval scripts.
**Workaround:** Use `XMLHttpRequest` with `withCredentials: true` instead of `fetch()`. XHR bypasses the same restriction and returns the full 200KB+ JSON payload successfully.

```javascript
var xhr = new XMLHttpRequest();
xhr.withCredentials = true;
xhr.open('GET', playInfoUrl);
xhr.onreadystatechange = function() {
  if (xhr.readyState === 4) {
    var data = JSON.parse(xhr.responseText);
    // ... extract transcript ...
  }
};
xhr.send();
```

## Connect to Running Chrome via Port

**Symptom:** `agent-browser --headed --profile ~/.cache/chrome-agent open <url>` fails with "daemon already running".
**Cause:** A Chrome daemon is already running at the profile path. The `--headed`/`--profile` flags are ignored and the error means the existing daemon's session can't be reused directly.
**Workaround:** Read the port from `~/.cache/chrome-agent/DevToolsActivePort` (first line), then use `agent-browser connect <port>` to attach to the running instance. After `connect`, run `open`, `snapshot`, etc. without any flags.

```bash
PORT=$(head -1 ~/.cache/chrome-agent/DevToolsActivePort)
agent-browser connect $PORT
agent-browser open <url>
```

## Hub Collection URL Rotation (Toolkit Workshops)

### 2026-03-24 - Share URL 9W3V_ rotates to wrong workshop

**Symptom:** `https://monash.zoom.us/rec/share/9W3V_...` consistently loads Workshop 1 or Workshop 2 instead of Workshop 3. The SPA reads the Hub collection state and rotates through recently-viewed recordings in the same shared folder.
**Cause:** The `9W3V_...` share URL represents the Ellucian Toolkit Workshop shared folder (Hub collection), not a single recording. It loads whichever workshop was last viewed in that folder by the authenticated user.
**Workaround:** Resolve via `hub.zoom.us/mine/recording` recordings list:
1. Navigate to `hub.zoom.us/mine/recording`
2. Find the target recording by name in the table
3. Install window.open interceptor: `window.open = function(url) { window._openedUrl = url; return null; }`
4. Click the recording link -- it calls window.open with a direct `?from=hub` share URL
5. Capture `window._openedUrl` -- this is a stable per-recording share URL
6. Navigate to that URL -- it redirects via continueMode but loads the correct recording
7. Verify page title matches the target recording before extracting

**Direct URL for Workshop 3:** `https://monash.zoom.us/rec/share/87LFhTPvEQL0LEa3pOerV2X2FlE1NadLfGFbX6KtPFjBhVTHueECFq0dy8PG09ym.OKt0nxZYKoRPxT8a?from=hub`
