import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
	listSessionFiles,
	parseNormalizedMessage,
	parseSessionMetadata,
	redactSessionText,
} from "./index.ts"

describe("shared session corpus", () => {
	test("parses native identifiers and helper ancestry without exposing source paths", () => {
		const metadata = parseSessionMetadata({
			type: "session_meta",
			payload: {
				id: "codex-one",
				cwd: "/private/repo",
				parent_thread_id: "parent-one",
				thread_source: "subagent",
			},
		}, "codex", "/private/session.jsonl")

		expect(metadata).toMatchObject({
			opaqueId: "codex:codex-one",
			parentSessionId: "parent-one",
			kind: "helper",
		})
		expect(JSON.stringify({ ...metadata, path: undefined })).not.toContain("session.jsonl")
	})

	test("normalizes prose and redacts common credential shapes", () => {
		const message = parseNormalizedMessage({
			type: "response_item",
			payload: {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "Use ghp_abcdefghijklmnopqrstuvwxyz123456." }],
			},
		}, "codex")
		const redacted = redactSessionText(message?.text ?? "")

		expect(redacted.text).toBe("Use [REDACTED].")
		expect(redacted.redactions).toBe(1)
	})

	test("reports every configured root and preserves missing-source evidence", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "session-corpus-test-"))
		try {
			const claude = resolve(root, "claude")
			const codex = resolve(root, "codex")
			const archive = resolve(root, "missing-archive")
			await Promise.all([mkdir(claude), mkdir(codex)])
			await Bun.write(resolve(claude, "one.jsonl"), "{}\n")

			const result = await listSessionFiles({ claude, codexActive: codex, codexArchived: archive })

			expect(result.files).toHaveLength(1)
			expect(result.states).toEqual([
				{ source: "claude", location: "active", state: "available", files: 1 },
				{ source: "codex", location: "active", state: "available", files: 0 },
				{ source: "codex", location: "archive", state: "missing", files: 0 },
			])
		} finally {
			await rm(root, { recursive: true, force: true })
		}
	})
})
