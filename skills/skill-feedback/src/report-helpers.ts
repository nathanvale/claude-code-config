import { createHash } from "node:crypto";
import type { EvidenceGap, EvidenceGapCode } from "./command-contract";

/**
 * Build an evidence gap with the package-owned code vocabulary.
 *
 * @internal Shared by the contract parser and runner so generated reports use
 * one shape without making this helper part of the public CLI contract.
 *
 * @param code - Stable evidence-gap code.
 * @param path - Report path that the gap describes.
 * @param message - Human-readable repair context.
 * @returns Normalized evidence gap.
 */
export function evidenceGap(
	code: EvidenceGapCode,
	path: string,
	message: string,
): EvidenceGap {
	return { code, path, message };
}

/**
 * Preserve first-seen evidence gaps while collapsing repeated code/path pairs.
 *
 * @internal Review treats duplicate gaps as noise, but keeps distinct messages
 * stable by retaining the first instance.
 *
 * @param gaps - Evidence gaps collected during normalization or closeout.
 * @returns First-seen unique gaps.
 */
export function uniqueEvidenceGaps(
	gaps: readonly EvidenceGap[],
): readonly EvidenceGap[] {
	const seen = new Set<string>();
	const unique: EvidenceGap[] = [];
	for (const gap of gaps) {
		const key = `${gap.code}\0${gap.path}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unique.push(gap);
	}
	return unique;
}

/**
 * Derive a deterministic report id from a prefix and report seed.
 *
 * @internal IDs need stable hashing across contract normalization and closeout
 * records without exposing hashing details as a command contract.
 *
 * @param prefix - Caller-owned report lane prefix.
 * @param value - JSON-serializable seed value.
 * @returns Stable report identifier.
 */
export function stableReportId<const Prefix extends string>(
	prefix: Prefix,
	value: unknown,
): `${Prefix}_${string}` {
	const hash = createHash("sha256")
		.update(JSON.stringify(value))
		.digest("hex")
		.slice(0, 16);
	return `${prefix}_${hash}`;
}
