import { createReadStream } from "node:fs"
import { createInterface } from "node:readline"
import type {
	NormalizedMessage,
	SessionMetadata,
	SessionSource,
} from "./session-model.ts"

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
		if (!["text", "input_text", "output_text"].includes(String(block.type))) {
			return []
		}
		return typeof block.text === "string" ? [block.text] : []
	})
}

/**
 * Parse the minimum repository locator from one runtime-native JSONL record.
 *
 * @param value - Parsed JSONL value
 * @param source - Runtime format to interpret
 * @param path - Private source path retained only for later extraction
 * @returns Session metadata when the record carries the runtime header
 * @internal
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
		const sessionId = typeof payload.id === "string" ? payload.id : undefined
		if (!sessionId) return undefined
		return {
			source,
			opaqueId: `${source}:${sessionId}`,
			sessionId,
			path,
			cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
			branch: typeof git?.branch === "string" ? git.branch : undefined,
			startedAt:
				typeof payload.timestamp === "string" ? payload.timestamp : undefined,
			repositoryUrl:
				typeof git?.repository_url === "string"
					? git.repository_url
					: undefined,
		}
	}

	if (source === "claude") {
		const sessionId =
			typeof line.sessionId === "string" ? line.sessionId : undefined
		const cwd = typeof line.cwd === "string" ? line.cwd : undefined
		if (!sessionId || !cwd) return undefined
		return {
			source,
			opaqueId: `${source}:${sessionId}`,
			sessionId,
			path,
			cwd,
			branch:
				typeof line.gitBranch === "string" ? line.gitBranch : undefined,
			startedAt:
				typeof line.timestamp === "string" ? line.timestamp : undefined,
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
 * @internal
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
 * Stream parse valid JSON values while tolerating partial or malformed lines.
 *
 * @param path - Session JSONL path
 * @returns Async sequence of successfully parsed values
 * @internal
 */
export async function* readJsonLines(path: string): AsyncGenerator<unknown> {
	const input = createReadStream(path, { encoding: "utf8" })
	const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })
	for await (const line of lines) {
		if (!line.trim()) continue
		try {
			yield JSON.parse(line)
		} catch {
			continue
		}
	}
}

/**
 * Read a bounded file prefix to locate session metadata without scanning prose.
 *
 * @param path - Session JSONL path
 * @param source - Runtime format to interpret
 * @returns Session locator metadata when a supported header is present
 * @internal
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
		} catch {
			continue
		}
	}
	return undefined
}
