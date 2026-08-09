import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import type {
	NormalizedMessage,
	SessionMetadata,
	SessionSource,
} from "./model.ts"

/** Controls whether JSONL corruption is skipped or surfaced to a fail-closed caller. */
export interface ReadJsonLinesOptions {
	/** Throw a path-free parse error instead of skipping a malformed non-empty line. */
	strict?: boolean
	/** Observe exact source bytes, for example to bind a digest to the parsed stream. */
	onChunk?: (chunk: Uint8Array) => void
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined
}

function textBlocks(content: unknown): string[] {
	if (typeof content === "string") return [content]
	if (!Array.isArray(content)) return []
	return content.flatMap((item) => {
		const block = asRecord(item)
		if (!block) return []
		if (!["text", "input_text", "output_text"].includes(String(block.type))) return []
		return typeof block.text === "string" ? [block.text] : []
	})
}

/**
 * Parse the minimum private locator from one runtime-native JSONL record.
 *
 * @param value - Parsed JSONL value
 * @param source - Runtime format to interpret
 * @param path - Private source path retained only inside runtime code
 * @returns Session metadata when the record carries a supported runtime header
 *
 * @example
 * ```ts
 * parseSessionMetadata(record, "codex", sessionPath)
 * ```
 */
export function parseSessionMetadata(
	value: unknown,
	source: SessionSource,
	path: string,
): SessionMetadata | undefined {
	const line = asRecord(value)
	if (!line) return undefined

	if (source === "codex" && line.type === "session_meta") {
		const payload = asRecord(line.payload)
		if (!payload) return undefined
		const git = asRecord(payload.git)
		const sourceMetadata = asRecord(payload.source)
		const sessionId = typeof payload.id === "string" ? payload.id : undefined
		if (!sessionId) return undefined
		const helper = payload.thread_source === "subagent" || sourceMetadata?.subagent === true
		const parentSessionId = [payload.parent_thread_id, payload.forked_from_id]
			.find((candidate): candidate is string => typeof candidate === "string")
		return {
			source,
			opaqueId: `${source}:${sessionId}`,
			sessionId,
			path,
			cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
			branch: typeof git?.branch === "string" ? git.branch : undefined,
			startedAt: typeof payload.timestamp === "string" ? payload.timestamp : undefined,
			repositoryUrl: typeof git?.repository_url === "string" ? git.repository_url : undefined,
			parentSessionId,
			kind: helper || parentSessionId ? "helper" : "primary",
		}
	}

	if (source === "claude") {
		const sessionId = typeof line.sessionId === "string" ? line.sessionId : undefined
		const cwd = typeof line.cwd === "string" ? line.cwd : undefined
		if (!sessionId || !cwd) return undefined
		return {
			source,
			opaqueId: `${source}:${sessionId}`,
			sessionId,
			path,
			cwd,
			branch: typeof line.gitBranch === "string" ? line.gitBranch : undefined,
			startedAt: typeof line.timestamp === "string" ? line.timestamp : undefined,
			parentSessionId: typeof line.parentSessionId === "string" ? line.parentSessionId : undefined,
			kind: line.isSidechain === true || typeof line.agentId === "string" ? "helper" : "primary",
		}
	}

	return undefined
}

/**
 * Normalize only user and assistant prose while excluding tools and reasoning.
 *
 * @param value - Parsed runtime-native JSONL value
 * @param source - Runtime format to interpret
 * @returns Safe message shape or undefined for non-conversation records
 *
 * @example
 * ```ts
 * const message = parseNormalizedMessage(record, "claude")
 * ```
 */
export function parseNormalizedMessage(
	value: unknown,
	source: SessionSource,
): NormalizedMessage | undefined {
	const line = asRecord(value)
	if (!line) return undefined

	if (source === "codex") {
		if (line.type !== "response_item") return undefined
		const payload = asRecord(line.payload)
		if (payload?.type !== "message") return undefined
		const role = payload.role
		if (role !== "user" && role !== "assistant") return undefined
		const text = textBlocks(payload.content).join("\n").trim()
		if (!text) return undefined
		return {
			role,
			timestamp: typeof line.timestamp === "string" ? line.timestamp : undefined,
			text,
		}
	}

	if (line.type !== "user" && line.type !== "assistant") return undefined
	const message = asRecord(line.message)
	const role = message?.role
	if (role !== "user" && role !== "assistant") return undefined
	const text = textBlocks(message?.content).join("\n").trim()
	if (!text) return undefined
	return {
		role,
		timestamp: typeof line.timestamp === "string" ? line.timestamp : undefined,
		text,
	}
}

/**
 * Stream JSON values with caller-selected corruption handling.
 *
 * @param path - Private session JSONL path
 * @param options - Strictness and optional raw-byte observer
 * @returns Async sequence of successfully parsed values
 * @throws {Error} When strict mode encounters malformed JSON or the file cannot be read
 *
 * @example
 * ```ts
 * for await (const record of readJsonLines(sessionPath)) inspect(record)
 * ```
 */
export async function* readJsonLines(
	path: string,
	options: ReadJsonLinesOptions = {},
): AsyncGenerator<unknown> {
	const input = createReadStream(path)
	if (options.onChunk) input.on("data", options.onChunk)
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
	for await (const line of lines) {
		if (!line.trim()) continue
		let parsed: unknown
		try {
			parsed = JSON.parse(line)
		} catch {
			if (options.strict) throw new Error("Malformed JSONL record")
			continue
		}
		yield parsed
	}
}

/**
 * Read a bounded file prefix to locate one supported session header.
 *
 * @param path - Private session JSONL path
 * @param source - Runtime format to interpret
 * @returns Session locator metadata when a supported header is present
 *
 * @example
 * ```ts
 * const metadata = await readMetadata(sessionPath, "codex")
 * ```
 */
export async function readMetadata(
	path: string,
	source: SessionSource,
): Promise<SessionMetadata | undefined> {
	const prefix = await Bun.file(path).slice(0, 256 * 1024).text()
	for (const line of prefix.split("\n").slice(0, 32)) {
		if (!line.trim()) continue
		try {
			const metadata = parseSessionMetadata(JSON.parse(line), source, path)
			if (metadata) return metadata
		} catch {}
	}
	return undefined
}
