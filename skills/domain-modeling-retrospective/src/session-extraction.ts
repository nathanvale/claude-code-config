import { CONTRACT_ID, SCHEMA_VERSION } from "./command-contract.ts"
import { resolveRepositorySession } from "./session-discovery.ts"
import { parseNormalizedMessage, readJsonLines } from "./session-parser.ts"
import type { ExtractResult, SessionRoots } from "./session-model.ts"

const SECRET_PATTERNS: RegExp[] = [
	/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
	/\bsk-[A-Za-z0-9_-]{20,}\b/g,
	/\bAKIA[A-Z0-9]{16}\b/g,
	/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
	/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi,
	/https?:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/g,
]

/**
 * Replace common credential shapes before historical prose reaches stdout.
 *
 * @param text - Normalized historical message text
 * @returns Redacted text and the number of substitutions
 * @internal
 */
export function redactSessionText(text: string): {
	text: string
	redactions: number
} {
	let value = text
	let redactions = 0
	for (const pattern of SECRET_PATTERNS) {
		pattern.lastIndex = 0
		value = value.replace(pattern, () => {
			redactions += 1
			return "[REDACTED]"
		})
	}
	return { text: value, redactions }
}

/**
 * Return one redacted page from a repository-owned session.
 *
 * @param options - Repository selector, pagination, text budget, and optional test roots
 * @returns Bounded message page plus continuation metadata
 * @throws {SessionDiscoveryError} When the session is missing or belongs elsewhere
 * @internal
 */
export async function extractRepositorySession(options: {
	repoPath: string
	opaqueId: string
	offset?: number
	limit?: number
	maxMessageChars?: number
	roots?: SessionRoots
}): Promise<ExtractResult> {
	const { metadata, repoRoot } = await resolveRepositorySession({
		repoPath: options.repoPath,
		opaqueId: options.opaqueId,
		roots: options.roots,
	})
	const offset = options.offset ?? 0
	const limit = options.limit ?? 40
	const maxMessageChars = options.maxMessageChars ?? 2000
	let totalMessages = 0
	let redactions = 0
	const messages: ExtractResult["messages"] = []

	for await (const line of readJsonLines(metadata.path)) {
		const message = parseNormalizedMessage(line, metadata.source)
		if (!message) continue
		const index = totalMessages
		totalMessages += 1
		if (index < offset || messages.length >= limit) continue
		const redacted = redactSessionText(message.text)
		redactions += redacted.redactions
		const truncated = redacted.text.length > maxMessageChars
		messages.push({
			index,
			role: message.role,
			timestamp: message.timestamp,
			text: truncated
				? `${redacted.text.slice(0, maxMessageChars)}…`
				: redacted.text,
			truncated,
		})
	}

	const nextOffset = offset + messages.length < totalMessages
		? offset + messages.length
		: null
	return {
		action: "extract",
		repo_root: repoRoot,
		side_effect: "none",
		session: metadata.opaqueId,
		source: metadata.source,
		offset,
		limit,
		total_messages: totalMessages,
		next_offset: nextOffset,
		redactions,
		messages,
		next_safe_action:
			nextOffset === null
				? "Reconcile explicit domain evidence against the current repository."
				: `Continue with --offset ${nextOffset} only when more evidence is needed.`,
		contract_id: CONTRACT_ID,
		schema_version: SCHEMA_VERSION,
	}
}
