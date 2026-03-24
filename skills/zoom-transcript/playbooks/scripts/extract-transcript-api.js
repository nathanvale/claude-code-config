/**
 * API-based transcript extraction for Zoom recordings.
 *
 * Finds the play/info API URL from performance entries, fetches the response,
 * and formats transcriptList into speaker/timestamp/text blocks.
 *
 * Returns a raw string (NOT JSON.stringify) to avoid double-encoding
 * via agent-browser eval. The caller should JSON.parse the agent-browser
 * output once to get the transcript text.
 *
 * Return shape: { ok: boolean, transcript?: string, reason?: string, speakers?: number, entries?: number }
 */
(async () => {
  // Find the play/info URL from performance entries
  const entries = performance.getEntriesByType("resource");
  const playInfoEntry = entries.find(
    (e) => e.name && e.name.includes("/nws/recording/1.0/play/info/")
  );

  if (!playInfoEntry) {
    return { ok: false, reason: "no_play_info_url" };
  }

  const playInfoUrl = playInfoEntry.name;

  try {
    const resp = await fetch(playInfoUrl);
    if (!resp.ok) {
      return { ok: false, reason: "play_info_fetch_failed", status: resp.status };
    }

    const data = await resp.json();
    const result = data.result || data;

    if (!result.hasTranscript) {
      return { ok: false, reason: "no_transcript" };
    }

    const transcriptList = result.transcriptList;
    if (!Array.isArray(transcriptList) || transcriptList.length === 0) {
      return { ok: false, reason: "empty_transcript_list" };
    }

    // Format transcript blocks: speaker\nHH:MM:SS\ntext\n\n
    const blocks = transcriptList.map((e) => {
      const speaker = e.username || "Unknown Speaker";
      // ts is a string like "00:02:19.610" — strip sub-second part
      const ts = typeof e.ts === "string" ? e.ts.split(".")[0] : String(e.ts);
      const text = (e.text || "").trim();
      return speaker + "\n" + ts + "\n" + text;
    });

    const transcript = blocks.join("\n\n");

    // Collect unique speakers
    const speakers = new Set(transcriptList.map((e) => e.username || "Unknown Speaker"));

    return {
      ok: true,
      transcript: transcript,
      speakers: speakers.size,
      entries: transcriptList.length,
    };
  } catch (err) {
    return { ok: false, reason: "play_info_error", error: String(err) };
  }
})();
