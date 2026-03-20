/**
 * DOM-based transcript extraction fallback for Zoom recordings.
 *
 * Clicks Audio Transcript tab if not selected, triggers virtual scroll
 * to force vue-recycle-scroller to render all items, then extracts
 * .transcript-list innerText.
 *
 * Return shape: { ok: boolean, transcript?: string, reason?: string, length?: number }
 */
(async () => {
  // Step 1: Ensure Audio Transcript tab is selected
  const tabs = Array.from(document.querySelectorAll("[role='tab']"));
  const transcriptTab = tabs.find(
    (t) => t.textContent && t.textContent.includes("Audio Transcript")
  );

  if (!transcriptTab) {
    return { ok: false, reason: "no_transcript_tab" };
  }

  if (transcriptTab.getAttribute("aria-selected") !== "true") {
    transcriptTab.click();
    await new Promise((r) => setTimeout(r, 3000));
  }

  // Step 2: Trigger virtual scroll to render all items
  const container = document.querySelector(".transcript-container");
  if (container) {
    container.scrollTop = 1;
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Step 3: Extract transcript text
  const list = document.querySelector(".transcript-list");
  if (!list) {
    // Try broader selector
    const fallback = document.querySelector("[class*=transcript]");
    if (!fallback) {
      return { ok: false, reason: "no_transcript_list_element" };
    }
    const text = fallback.innerText || "";
    if (text.length < 200) {
      return { ok: false, reason: "transcript_too_short", length: text.length };
    }
    return { ok: true, transcript: text, length: text.length };
  }

  const text = list.innerText || "";
  if (text.length < 200) {
    // Attempt aggressive scroll
    if (container) {
      container.scrollTop = container.scrollHeight;
      await new Promise((r) => setTimeout(r, 1000));
      container.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 500));
      container.scrollTop = 1;
      await new Promise((r) => setTimeout(r, 2000));
    }

    const retryText = list.innerText || "";
    if (retryText.length < 200) {
      return { ok: false, reason: "transcript_too_short_after_scroll", length: retryText.length };
    }
    return { ok: true, transcript: retryText, length: retryText.length };
  }

  return { ok: true, transcript: text, length: text.length };
})();
