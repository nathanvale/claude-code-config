import type { SessionMetadata } from "./model.ts"
import { parseNormalizedMessage, readJsonLines } from "./parser.ts"
import { redactSessionText } from "./redaction.ts"

function startedAtSortValue(value: string | undefined): number {
	if (!value) return Number.POSITIVE_INFINITY
	const timestamp = Date.parse(value)
	return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp
}

/** One bounded redacted message returned from private history. */
export interface ExtractedSessionMessage {
	/** Zero-based normalized message index. */
	index: number
	/** Conversation role retained by the parser. */
	role: "user" | "assistant"
	/** Original message timestamp when available. */
	timestamp?: string
	/** Redacted bounded text. */
	text: string
	/** Whether the caller's text budget clipped this message. */
	truncated: boolean
}

/** Bounded source-neutral page used by higher-level session workflows. */
export interface ExtractedSessionPage {
	/** First normalized message index requested. */
	offset: number
	/** Requested page size. */
	limit: number
	/** Total normalized messages in the native session. */
	totalMessages: number
	/** Next page offset, or null at the end. */
	nextOffset: number | null
	/** Redaction substitutions applied to returned messages. */
	redactions: number
	/** Redacted message page. */
	messages: ExtractedSessionMessage[]
}

/**
 * Read one bounded redacted page from resolved private session metadata.
 *
 * @param metadata - Runtime-native source locator retained inside trusted code
 * @param options - Pagination and per-message text budget
 * @returns Source-neutral page without private filesystem paths
 *
 * @example
 * ```ts
 * const page = await extractSessionPage(metadata, { offset: 0, limit: 20, maxMessageChars: 2000 })
 * ```
 */
export async function extractSessionPage(
	metadata: SessionMetadata,
	options: { offset: number; limit: number; maxMessageChars: number },
): Promise<ExtractedSessionPage> {
	return extractSessionFragmentsPageUnsafe([metadata], options, false)
}

/**
 * Read one logical session across all native fragments in deterministic order.
 *
 * @param fragments - Every runtime-native locator for one source-qualified session
 * @param options - Pagination and per-message text budget
 * @returns One combined source-neutral page without private filesystem paths
 * @throws {Error} When pagination is invalid or any selected fragment is malformed or unreadable
 *
 * @example
 * ```ts
 * const page = await extractSessionFragmentsPage(fragments, { offset: 0, limit: 20, maxMessageChars: 2000 })
 * ```
 */
export async function extractSessionFragmentsPage(
	fragments: SessionMetadata[],
	options: { offset: number; limit: number; maxMessageChars: number },
): Promise<ExtractedSessionPage> {
	return extractSessionFragmentsPageUnsafe(fragments, options, true)
}

async function extractSessionFragmentsPageUnsafe(
	fragments: SessionMetadata[],
	options: { offset: number; limit: number; maxMessageChars: number },
	strict: boolean,
): Promise<ExtractedSessionPage> {
	if (!Number.isSafeInteger(options.offset) || options.offset < 0) {
		throw new Error("offset must be a non-negative integer")
	}
	if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
		throw new Error("limit must be a positive integer")
	}
	if (!Number.isSafeInteger(options.maxMessageChars) || options.maxMessageChars < 0) {
		throw new Error("maxMessageChars must be a non-negative integer")
	}
	let totalMessages = 0
	let redactions = 0
	const messages: ExtractedSessionMessage[] = []
	const ordered = [...fragments].sort((left, right) => {
		const leftStarted = startedAtSortValue(left.startedAt)
		const rightStarted = startedAtSortValue(right.startedAt)
		return leftStarted - rightStarted || left.path.localeCompare(right.path)
	})
	for (const metadata of ordered) {
		for await (const value of readJsonLines(metadata.path, { strict })) {
			const message = parseNormalizedMessage(value, metadata.source)
			if (!message) continue
			const index = totalMessages
			totalMessages += 1
			if (index < options.offset || messages.length >= options.limit) continue
			const redacted = redactSessionText(message.text)
			redactions += redacted.redactions
			const truncated = redacted.text.length > options.maxMessageChars
			messages.push({
				index,
				role: message.role,
				timestamp: message.timestamp,
				text: truncated
					? `${redacted.text.slice(0, options.maxMessageChars)}…`
					: redacted.text,
				truncated,
			})
		}
	}
	return {
		offset: options.offset,
		limit: options.limit,
		totalMessages,
		nextOffset: options.offset + messages.length < totalMessages
			? options.offset + messages.length
			: null,
		redactions,
		messages,
	}
}
