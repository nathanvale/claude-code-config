// PROTOTYPE — throwaway. Pure builder (no I/O — caller writes the file).
//
// build-scratch: redacted handoff -> Recorder-shaped JSON, with Gate 2 in front.
// Chrome DevTools Recorder format is the target shape, but typed values are
// replaced by shape placeholders (we never had the real value, and Gate 2
// refuses the batch if a raw one slipped through).

import { type RedactedHandoff } from "./handoff.ts";
import { gate2, type DenyHit } from "./redaction.ts";

/** A Chrome DevTools Recorder step (the subset we emit). */
export interface RecorderStep {
  type: "navigate" | "click" | "change" | "waitForElement";
  /** CSS/text selector array, Recorder-style. Synthetic in the prototype. */
  selectors?: string[][];
  url?: string;
  /** For `change` steps: the SHAPE placeholder, never a typed value. */
  value?: string;
  /** Prototype-only annotation carrying the redacted observation for review. */
  _observed?: string;
}

/** The Recorder-shaped document build-scratch writes to disk. */
export interface RecorderFlow {
  title: string;
  steps: RecorderStep[];
  /** Prototype-only sidecar: provenance + forks + auth pointer + stuck-point. */
  _scratch: {
    domain: string;
    flowSlug: string;
    forks: { label: string; taken: string }[];
    authPointer: string;
    authLocatedAt: string;
    stuckPoint: string | null;
  };
}

export type BuildResult =
  | { ok: true; flow: RecorderFlow }
  | { ok: false; refusedBatch: true; hit: DenyHit };

/**
 * Build the Recorder-shaped flow from a redacted handoff.
 *
 * Gate 2 runs FIRST over every field's observed value. On any hit the WHOLE
 * batch is refused (nothing is built, nothing is written) and the offending
 * entry is named. Otherwise every field becomes a `change` step whose value is
 * a shape placeholder.
 */
export function buildScratch(handoff: RedactedHandoff): BuildResult {
  const gate = gate2(handoff.fields.map((f) => ({ name: f.name, value: f.observed })));
  if (!gate.ok) {
    return { ok: false, refusedBatch: true, hit: gate.hit };
  }

  const steps: RecorderStep[] = [
    { type: "navigate", url: `https://${handoff.domain}/` },
  ];

  for (const field of handoff.fields) {
    // Gate 2 already passed, so every observed value here is safe: either a
    // `redacted:*` placeholder from Gate 1, or a genuinely non-sensitive
    // free-text shape note (e.g. "free-text, email shape"). Pass it through as
    // the step value — don't over-redact non-sensitive fields.
    steps.push({
      type: "change",
      selectors: [[`[name="${field.name}"]`]],
      value: field.observed,
    });
  }

  steps.push({ type: "click", selectors: [['[type="submit"]']] });

  return {
    ok: true,
    flow: {
      title: `${handoff.domain} — ${handoff.flowSlug}`,
      steps,
      _scratch: {
        domain: handoff.domain,
        flowSlug: handoff.flowSlug,
        forks: handoff.forks,
        authPointer: handoff.auth.reference,
        authLocatedAt: handoff.auth.locatedAt,
        stuckPoint: handoff.stuckPoint,
      },
    },
  };
}

/** Build the on-disk path: <memory-root>/<domain>/scratch/<ts>-<slug>/flow.json */
export function scratchPath(memoryRoot: string, handoff: RedactedHandoff, timestamp: string): string {
  return `${memoryRoot}/${handoff.domain}/scratch/${timestamp}-${handoff.flowSlug}/flow.json`;
}
