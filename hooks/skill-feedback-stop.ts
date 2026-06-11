#!/usr/bin/env bun

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
	resolveGitRoot: (cwd: string) => Promise<string>
	nowIso: () => string
	runRecord: (request: RecordRequest) => Promise<HookRunResult>
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
): SkillDetection | null {
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
		if (detection) return detection
	}
	return null
}

function detectSkillFromClaudeTranscriptEntry(
	entry: unknown,
): SkillDetection | null {
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
	const cwd = await runtime.resolveGitRoot(input.cwd)
	await runtime.runRecord(
		buildRecordRequest(cwd, detection, runtime.nowIso()),
	)
	return { captured: true, detection }
}

function createDefaultStopRuntime(): SkillFeedbackStopRuntime {
	return {
		readText: async (path) => Bun.file(path).text(),
		resolveGitRoot,
		nowIso: () => new Date().toISOString(),
		runRecord: runSkillFeedbackRecord,
	}
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
