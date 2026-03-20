/**
 * Verification script for Zoom transcript extraction.
 *
 * Checks:
 * 1. Transcript length > 200 characters
 * 2. At least 1 speaker detected
 * 3. Timestamp format is valid (HH:MM:SS pattern present)
 *
 * Expected global: window.__ZOOM_TRANSCRIPT_VERIFY__ = { transcript: string }
 *
 * Return shape: { ok: boolean, checks: object, reason?: string }
 */
(() => {
  const payload = window.__ZOOM_TRANSCRIPT_VERIFY__;

  if (!payload || !payload.transcript) {
    return { ok: false, reason: "missing_payload", checks: {} };
  }

  const transcript = payload.transcript;
  const checks = {};

  // Check 1: Length > 200
  checks.length = {
    value: transcript.length,
    pass: transcript.length > 200,
  };

  // Check 2: At least 1 speaker
  // Transcript format is: "Speaker\nHH:MM:SS\nText\n\nSpeaker\n..."
  // Split by double newline to get blocks, first line of each block is speaker
  const blocks = transcript.split("\n\n").filter((b) => b.trim().length > 0);
  const speakers = new Set();
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length >= 2) {
      // First line is speaker, second should be timestamp
      const maybeSpeaker = lines[0].trim();
      const maybeTs = lines[1].trim();
      if (/^\d{2}:\d{2}:\d{2}/.test(maybeTs) && maybeSpeaker.length > 0) {
        speakers.add(maybeSpeaker);
      }
    }
  }
  checks.speakers = {
    value: speakers.size,
    names: Array.from(speakers),
    pass: speakers.size >= 1,
  };

  // Check 3: Timestamp format valid (at least one HH:MM:SS pattern)
  const tsPattern = /\d{2}:\d{2}:\d{2}/;
  checks.timestamp_format = {
    pass: tsPattern.test(transcript),
  };

  const allPass = checks.length.pass && checks.speakers.pass && checks.timestamp_format.pass;

  return {
    ok: allPass,
    checks: checks,
    reason: allPass ? undefined : "verification_failed",
  };
})();
