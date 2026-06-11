#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
	type HookRunResult,
	type RecordRequest,
	type SkillDetection,
	buildRecordRequest,
	resolveGitRoot,
	runSkillFeedbackRecord,
} from './skill-feedback-runtime'

export interface StopHookInput {
	cwd: string
	transcript_path: string
	stop_hook_active?: boolean
}

export interface SkillFeedbackStopRuntime {
	readText: (path: string) => Promise<string>
	readLastDetectionId: (transcriptPath: string) => Promise<string | null>
	writeLastDetectionId: (
		transcriptPath: string,
		detectionId: string,
	) => Promise<void>
	resolveGitRoot: (cwd: string) => Promise<string>
	nowIso: () => string
	runRecord: (request: RecordRequest) => Promise<HookRunResult>
}

export interface ClaudeSkillDetection extends SkillDetection {
	detectionId: string
}

function isStopHookInput(value: unknown): value is StopHookInput {
	if (!value || typeof value !== 'object') return false
	const input = value as Record<string, unknown>
	if (typeof input.cwd !== 'string') return false
	if (typeof input.transcript_path !== 'string') return false
	if (
		'stop_hook_active' in input &&
		input.stop_hook_active !== undefined &&
		typeof input.stop_hook_active !== 'boolean'
	) {
		return false
	}
	return true
}

export function detectSkillFromClaudeTranscriptText(
	text: string,
): ClaudeSkillDetection | null {
	let latest: ClaudeSkillDetection | null = null
	for (const line of text.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed) continue
		let parsed: unknown
		try {
			parsed = JSON.parse(trimmed)
		} catch {
			continue
		}
		const detection = detectSkillFromClaudeTranscriptEntry(parsed)
		if (detection) latest = detection
	}
	return latest
}

function detectSkillFromClaudeTranscriptEntry(
	entry: unknown,
): ClaudeSkillDetection | null {
	if (!entry || typeof entry !== 'object') return null
	const record = entry as Record<string, unknown>
	const toolUseResult = objectFrom(record.toolUseResult)
	const commandName = stringFrom(toolUseResult?.commandName)
	if (!commandName) return null
	if (!hasSkillToolResult(record)) return null
	return {
		source: 'claude-stop',
		skill: commandName,
		outcome: toolUseResult?.success === false ? 'failed' : 'ambiguous',
		detectionId: buildDetectionId(record, commandName),
	}
}

function hasSkillToolResult(entry: Record<string, unknown>): boolean {
	const message = objectFrom(entry.message)
	const content = Array.isArray(message?.content) ? message.content : []
	return content.some((item) => {
		const object = objectFrom(item)
		if (!object || object.type !== 'tool_result') return false
		const text = stringFrom(object.content)
		return text?.startsWith('Launching skill: ') ?? false
	})
}

export async function handleSkillFeedbackStop(
	input: StopHookInput,
	runtime: SkillFeedbackStopRuntime = createDefaultStopRuntime(),
): Promise<{ captured: boolean; detection?: SkillDetection }> {
	if (input.stop_hook_active) return { captured: false }
	let transcript = ''
	try {
		transcript = await runtime.readText(input.transcript_path)
	} catch {
		return { captured: false }
	}
	const detection = detectSkillFromClaudeTranscriptText(transcript)
	if (!detection) return { captured: false }
	if (
		(await runtime.readLastDetectionId(input.transcript_path)) ===
		detection.detectionId
	) {
		return { captured: false, detection }
	}
	const cwd = await runtime.resolveGitRoot(input.cwd)
	const result = await runtime.runRecord(
		buildRecordRequest(cwd, detection, runtime.nowIso()),
	)
	if (result.exitCode !== 0) {
		return { captured: false, detection }
	}
	await runtime.writeLastDetectionId(
		input.transcript_path,
		detection.detectionId,
	)
	return { captured: true, detection }
}

function createDefaultStopRuntime(): SkillFeedbackStopRuntime {
	return {
		readText: async (path) => Bun.file(path).text(),
		readLastDetectionId,
		writeLastDetectionId,
		resolveGitRoot,
		nowIso: () => new Date().toISOString(),
		runRecord: runSkillFeedbackRecord,
	}
}

async function readLastDetectionId(
	transcriptPath: string,
): Promise<string | null> {
	try {
		const marker = await readFile(stopDedupePath(transcriptPath), 'utf8')
		return marker.trim() || null
	} catch {
		return null
	}
}

async function writeLastDetectionId(
	transcriptPath: string,
	detectionId: string,
): Promise<void> {
	const markerPath = stopDedupePath(transcriptPath)
	await mkdir(dirname(markerPath), { recursive: true, mode: 0o700 })
	await writeFile(markerPath, `${detectionId}\n`, { mode: 0o600 })
}

function stopDedupePath(transcriptPath: string): string {
	const key = createHash('sha256').update(transcriptPath).digest('hex')
	return join(tmpdir(), 'skill-feedback-stop-dedupe', `${key}.txt`)
}

function buildDetectionId(
	record: Record<string, unknown>,
	commandName: string,
): string {
	const stableId =
		stringFrom(record.sourceToolUseID) ??
		stringFrom(record.uuid) ??
		stringFrom(record.timestamp) ??
		commandName
	const sessionId = stringFrom(record.sessionId)
	return sessionId ? `${sessionId}:${stableId}` : stableId
}

function objectFrom(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function stringFrom(value: unknown): string | null {
	return typeof value === 'string' && value.trim() !== '' ? value : null
}

if (import.meta.main) {
	const selfDestruct = setTimeout(() => {
		process.exit(0)
	}, 8_000)
	selfDestruct.unref()

	try {
		const parsed = await Bun.stdin.json()
		if (isStopHookInput(parsed)) {
			await handleSkillFeedbackStop(parsed)
		}
	} catch {
		// Stop hook drift degrades to missed capture, never a broken turn.
	}
	process.exit(0)
}
