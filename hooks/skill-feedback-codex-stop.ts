#!/usr/bin/env bun

import {
	type HookRunResult,
	type RecordRequest,
	type SkillDetection,
	buildRecordRequest,
	resolveGitRoot,
	runSkillFeedbackRecord,
} from './skill-feedback-runtime'

export const CODEX_STOP_HOOK_COMMAND =
	'bun "$(git rev-parse --show-toplevel)/hooks/skill-feedback-codex-stop.ts"'

const UNKNOWN_SKILL = 'unknown-skill'

export interface CodexStopHookInput {
	cwd: string
	session_id?: string
	transcript_path?: string
	hook_event_name?: string
	model?: string
	turn_id?: string
	permission_mode?: string
	stop_hook_active?: boolean
	last_assistant_message?: string
}

export interface CodexStopRuntime {
	resolveGitRoot: (cwd: string) => Promise<string>
	nowIso: () => string
	runRecord: (request: RecordRequest) => Promise<HookRunResult>
}

export function isCodexStopHookInput(value: unknown): value is CodexStopHookInput {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false
	const input = value as Record<string, unknown>
	if (typeof input.cwd !== 'string' || input.cwd.trim() === '') return false
	for (const field of [
		'session_id',
		'transcript_path',
		'hook_event_name',
		'model',
		'turn_id',
		'permission_mode',
		'last_assistant_message',
	] as const) {
		if (field in input && input[field] !== undefined && typeof input[field] !== 'string') {
			return false
		}
	}
	if (
		'stop_hook_active' in input &&
		input.stop_hook_active !== undefined &&
		typeof input.stop_hook_active !== 'boolean'
	) {
		return false
	}
	return true
}

export function detectSkillFromCodexStopInput(
	input: CodexStopHookInput,
): SkillDetection {
	return {
		source: 'codex-stop',
		skill: UNKNOWN_SKILL,
		outcome: 'ambiguous',
		telemetry: {
			...(input.model ? { model: input.model } : {}),
			capture_runtime: 'codex_stop',
			skill_identity_provenance: {
				source: 'none',
				trusted: false,
				reason: 'codex_stop_payload_has_no_trusted_skill_identity',
			},
		},
	}
}

export async function handleSkillFeedbackCodexStop(
	input: CodexStopHookInput,
	runtime: CodexStopRuntime = createDefaultCodexStopRuntime(),
): Promise<{ captured: boolean; detection?: SkillDetection }> {
	if (input.stop_hook_active) return { captured: false }
	const detection = detectSkillFromCodexStopInput(input)
	const cwd = await runtime.resolveGitRoot(input.cwd)
	const result = await runtime.runRecord(
		buildRecordRequest(cwd, detection, runtime.nowIso()),
	)
	return {
		captured: result.exitCode === 0,
		detection,
	}
}

function createDefaultCodexStopRuntime(): CodexStopRuntime {
	return {
		resolveGitRoot,
		nowIso: () => new Date().toISOString(),
		runRecord: runSkillFeedbackRecord,
	}
}

function stopHookOutput(): string {
	return `${JSON.stringify({ continue: true, suppressOutput: true })}\n`
}

if (import.meta.main) {
	const selfDestruct = setTimeout(() => {
		process.stdout.write(stopHookOutput())
		process.exit(0)
	}, 8_000)
	selfDestruct.unref()

	try {
		const parsed = await Bun.stdin.json()
		if (isCodexStopHookInput(parsed)) {
			await handleSkillFeedbackCodexStop(parsed)
		}
	} catch {
		// Stop hook drift degrades to missed evidence, never a broken turn.
	} finally {
		clearTimeout(selfDestruct)
		process.stdout.write(stopHookOutput())
	}
	process.exit(0)
}
