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
	const modelByToolUseId = new Map<string, string>()
	for (const line of text.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed) continue
		let parsed: unknown
		try {
			parsed = JSON.parse(trimmed)
		} catch {
			continue
		}
		// Engine-read telemetry (KTD2a): only the model id from the assistant
		// entry that launched the detected skill. Usage is deliberately NOT read
		// here — the Stop hook fires after the skill runs inline, so the
		// transcript carries no skill-scoped token total, only whole-session
		// counts. v0 leaves usage an explicit gap; v1 sources it from OTel.
		// Reading only the model id keeps transcript prose out of the record.
		for (const launch of readSkillLaunchModels(parsed)) {
			modelByToolUseId.set(launch.toolUseId, launch.model)
		}
		const detection = detectSkillFromClaudeTranscriptEntry(parsed)
		if (detection) {
			const record = objectFrom(parsed)
			const toolUseId = record
				? readMatchedSkillToolResultId(record, detection.skill)
				: null
			const model = toolUseId ? modelByToolUseId.get(toolUseId) : undefined
			latest = model
				? { ...detection, telemetry: { ...detection.telemetry, model } }
				: detection
		}
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
	if (!hasSkillToolResult(record, commandName)) return null
	return {
		source: 'claude-stop',
		skill: commandName,
		outcome: toolUseResult?.success === false ? 'failed' : 'ambiguous',
		detectionId: buildDetectionId(record, commandName),
	}
}

function hasSkillToolResult(
	entry: Record<string, unknown>,
	commandName: string,
): boolean {
	return readMatchedSkillToolResultId(entry, commandName) !== null
}

function readMatchedSkillToolResultId(
	entry: Record<string, unknown>,
	commandName: string,
): string | null {
	const message = objectFrom(entry.message)
	const content = Array.isArray(message?.content) ? message.content : []
	for (const item of content) {
		const object = objectFrom(item)
		if (!object || object.type !== 'tool_result') continue
		const text = stringFrom(object.content)
		const expected = `Launching skill: ${commandName}`
		const matches =
			text === expected || (text?.startsWith(`${expected}\n`) ?? false)
		if (matches) {
			return stringFrom(object.tool_use_id) ?? stringFrom(entry.sourceToolUseID)
		}
	}
	return null
}

/**
 * Read the model id from an assistant entry that launched a Skill tool call.
 *
 * Returns the model only when the entry both is an assistant message and
 * carries a `Skill` tool_use, so the captured model is the one that ran the
 * detected skill — never a model id from an unrelated turn. Reads only the
 * model id; no message content is touched.
 */
function readSkillLaunchModels(
	entry: unknown,
): Array<{ toolUseId: string; model: string }> {
	const message = objectFrom(objectFrom(entry)?.message)
	if (!message || message.role !== 'assistant') return []
	const model = stringFrom(message.model)
	if (!model) return []
	const content = Array.isArray(message.content) ? message.content : []
	const launches: Array<{ toolUseId: string; model: string }> = []
	for (const item of content) {
		const object = objectFrom(item)
		if (object?.type !== 'tool_use' || object.name !== 'Skill') continue
		const toolUseId = stringFrom(object.id)
		if (toolUseId) launches.push({ toolUseId, model })
	}
	return launches
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
		buildRecordRequest(
			cwd,
			{
				...detection,
				telemetry: {
					...detection.telemetry,
					detection_id: detection.detectionId,
				},
			},
			runtime.nowIso(),
		),
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
