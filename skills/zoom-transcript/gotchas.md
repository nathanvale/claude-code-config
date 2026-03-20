---
domain: zoom-recording
services: [zoom]
updated: 2026-03-20
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
