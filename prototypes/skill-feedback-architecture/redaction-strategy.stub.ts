// skill-feedback — Redaction Strategy seam (STUB / architecture marker)
// =============================================================================
// Status: NOT WIRED. This is a design stub from the 2026-06-11 grill-with-docs
// session. It exists to MARK the seam where redaction policy becomes swappable
// per-harness, so the next session picks up the decision instead of re-deriving
// it. No behaviour here is reachable; nothing imports this yet.
//
// Decision recorded: redaction is a GoF *Strategy*, but we DEFER building the
// swap. Rationale (from ce-architecture-strategist + repo survey):
//   - v0 ships ONE redaction policy (the shared always-redact set owned by
//     skills/agent-reliability-guardrails/references/logging-redaction-rules.md).
//   - The facade ALREADY exposes the Strategy hook for free:
//       runtime/cli-command-facade/src/cli-diagnostics.ts:55  CliDiagnosticRedactor
//       runtime/cli-command-facade/src/cli-diagnostics.ts:63  redact?: <hook>
//     So building a bespoke RedactionPolicy object now = ceremony (YAGNI).
//   - PROMOTION TRIGGER: a second harness needs a genuinely STRICTER scrub than
//     the shared set (e.g. Codex transcripts carry a secret shape Claude's don't).
//     At that trigger, implement the Strategy against the facade hook below.
//
// "Does that make sense?" — yes: the seam is named and typed; the swap is not
// built. Three similar lines over premature abstraction (AGENTS.md).
// =============================================================================

// The real target interface this Strategy plugs into. Do NOT invent a parallel
// type — the facade owns it. Re-declared here ONLY because this stub is outside
// the workspace; the real code imports it from "@side-quest/cli-command-facade".
//   export type CliDiagnosticRedactor =
//     (record: CliDiagnosticSerializableRecord) => CliDiagnosticSerializableRecord;

/** Harness whose telemetry feeds the Receipt. Mirrors the CaptureAdapter seam. */
export type HarnessId = "claude-otel" | "codex-json";

/**
 * STRATEGY (deferred). A redaction policy is a pure record->record transform —
 * the exact shape of the facade's CliDiagnosticRedactor. v0 uses exactly one
 * policy (`sharedAlwaysRedact`); this type is the promotion target, not v0 code.
 *
 * When the trigger fires, a policy is selected per harness and handed to the
 * facade via its `redact?:` option. The facade runs it inside the pipeline:
 *   validate -> [redact: RedactionStrategy] -> gitignoreGate -> write
 */
export type RedactionStrategy = (record: unknown) => unknown;
//                                       ^^^^^^^      ^^^^^^^
// `unknown` is a placeholder for CliDiagnosticSerializableRecord. Tightened to
// the real facade type when this leaves the prototype and enters the workspace.

/**
 * Deferred selector. v0 has ONE policy, so there is no selection — the facade's
 * default redactor (redactGenericCliDiagnosticRecord) plus the always-redact set
 * is the whole story. This signature is the shape the swap will take IF promoted.
 *
 * Intentionally throws: reaching this in v0 is a bug (means someone wired the
 * deferred seam without doing the promotion work + the fixture suite it needs).
 */
export function selectRedactionStrategy(_harness: HarnessId): RedactionStrategy {
	throw new Error(
		"RedactionStrategy is a deferred seam (skill-feedback v0 ships one policy). " +
			"Promote only at the trigger: a harness needs a stricter scrub than the " +
			"shared logging-redaction-rules.md set. See redaction-strategy.stub.ts header.",
	);
}

// ---------------------------------------------------------------------------
// Sibling seam, recorded for continuity (NOT this file's job to build):
//   - CaptureAdapter: { harness: HarnessId; capture(raw): Promise<CaptureResult> }
//   - CaptureResult : discriminated union — the Null-Object-as-union for degraded
//       | { kind: "receipt";  receipt: SoftwareLearningReport }
//       | { kind: "degraded"; receipt: PartialReport; degraded: DegradedReason[] }
//     Modeled on browser-use's Failure<A> union (browser-use-core.ts:42), NOT a
//     polymorphic Null Object class. R21 (degraded capture must be VISIBLE).
//   - selectAdapter(harness): one switch, not a Factory (promote at adapter #3).
// ---------------------------------------------------------------------------
