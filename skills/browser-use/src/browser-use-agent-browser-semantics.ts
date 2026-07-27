import {
	postconditionSelectorIssue,
	stripControlChars,
} from "./browser-use-core";

const SAFE_ACCESSIBLE_ROLE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

type JsonObject = Record<string, unknown>;

/**
 * Fresh task-local refs plus the accessible metadata used for semantic matching.
 *
 * @internal
 */
export type AgentBrowserSnapshotRefs = {
	refs: ReadonlySet<string>;
	metadata: ReadonlyMap<string, { role: string; name: string }>;
};

/**
 * Validate the bounded semantic target and visible-element proof shared by the
 * public compiler and native executor.
 *
 * @param input - Accessible role/name and selector to admit before mutation
 * @returns True only for one bounded, control-free semantic request
 * @internal
 */
export function semanticClickInputIsValid(input: {
	role: string;
	name: string;
	visibleSelector: string;
}): boolean {
	return (
		SAFE_ACCESSIBLE_ROLE.test(input.role) &&
		input.name.length > 0 &&
		input.name.length <= 256 &&
		stripControlChars(input.name) === input.name &&
		postconditionSelectorIssue(input.visibleSelector) === undefined
	);
}

/**
 * Project adapter snapshot refs into one normalized task-local lookup.
 *
 * @param value - Untrusted adapter refs payload
 * @returns Normalized ref membership and accessible metadata
 * @internal
 */
export function projectAgentBrowserSnapshotRefs(
	value: unknown,
): AgentBrowserSnapshotRefs {
	const refsObject =
		typeof value === "object" && value !== null && !Array.isArray(value)
			? (value as JsonObject)
			: {};
	const refs = new Set<string>();
	const metadata = new Map<string, { role: string; name: string }>();
	for (const [rawRef, rawMetadata] of Object.entries(refsObject)) {
		const ref = rawRef.startsWith("@") ? rawRef : `@${rawRef}`;
		refs.add(ref);
		if (
			typeof rawMetadata !== "object" ||
			rawMetadata === null ||
			Array.isArray(rawMetadata)
		) {
			continue;
		}
		const candidate = rawMetadata as JsonObject;
		if (
			typeof candidate.role === "string" &&
			typeof candidate.name === "string"
		) {
			metadata.set(ref, {
				role: candidate.role,
				name: candidate.name,
			});
		}
	}
	return { refs, metadata };
}

/**
 * Resolve a role/name pair only when exactly one current ref carries it.
 *
 * @param snapshot - Fresh normalized task-local snapshot
 * @param target - Accessible role/name requested by the task
 * @returns The unique ref, or undefined for zero or multiple matches
 * @internal
 */
export function resolveUniqueSemanticRef(
	snapshot: AgentBrowserSnapshotRefs,
	target: { role: string; name: string },
): string | undefined {
	const matches = [...snapshot.metadata.entries()]
		.filter(
			([ref, metadata]) =>
				snapshot.refs.has(ref) &&
				metadata.role === target.role &&
				metadata.name === target.name,
		)
		.map(([ref]) => ref);
	return matches.length === 1 ? matches[0] : undefined;
}
