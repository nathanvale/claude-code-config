// signature — stable dedupe key for a finding (plan U1, R7).
//
// A finding's identity is its SEMANTIC intent: the clause it violates plus the
// canonical invocation that surfaced it — never code coordinates (line numbers,
// file paths), which drift on every refactor. Two runs that surface the same
// clause violation on the same invocation produce the same signature, so the
// ledger dedupes them instead of accumulating duplicate rows.

/**
 * A station finding's semantic anchor. Station findings key by declared station
 * identity, never invocation text or local paths.
 */
export interface StationFindingSignatureInput {
	stationId: string;
	command: string;
	findingKind: string;
}

/**
 * A finding's semantic anchor. Clause findings key by clause + invocation.
 * Station findings key by station id + command + finding kind.
 */
export interface FindingSignatureInput {
	clauseId: string;
	/** The invocation argv, or [] for a static (zero-invocation) clause. */
	argv?: readonly string[];
	/** Optional CLI Front Door owner for clause findings. */
	frontDoor?: string;
	station?: StationFindingSignatureInput;
}

/**
 * Canonicalize an invocation so equivalent invocations hash identically:
 * trim each token and drop empties. Argv ORDER is significant (it is the actual
 * call), so it is preserved — only whitespace noise is normalized.
 */
function canonicalizeArgv(argv: readonly string[]): string[] {
	return argv.map((token) => token.trim()).filter((token) => token.length > 0);
}

/**
 * Stable signature for a finding: a short hex hash of
 * `clauseId\0token\0token...`. Deterministic across runs and processes (Bun's
 * non-cryptographic hash is stable for identical input), so the ledger can
 * dedupe by string equality.
 */
export function signature(input: FindingSignatureInput): string {
	const canonical = input.station
		? [
				"station",
				input.station.command,
				input.station.stationId,
				input.station.findingKind,
			]
		: [
				"clause",
				input.clauseId,
				"frontDoor",
				input.frontDoor === undefined ? "0" : "1",
				...(input.frontDoor === undefined ? [] : [input.frontDoor]),
				"argv",
				...canonicalizeArgv(input.argv ?? []),
			];
	// NUL separator: cannot appear in a clause id or argv token, so the join is
	// unambiguous (["a","b"] never collides with ["ab"]).
	const material = canonical.join("\0");
	const hash = Bun.hash(material).toString(16).padStart(16, "0");
	return `sig_${hash}`;
}

/** Human-readable invocation label for ledger rows (not the signature). */
export function renderInvocation(argv: readonly string[]): string {
	const canonical = canonicalizeArgv(argv);
	return canonical.length === 0 ? "(static — no invocation)" : canonical.join(" ");
}
