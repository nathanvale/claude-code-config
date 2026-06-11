#!/usr/bin/env bun

import {
	type HookRunResult,
	type RecordRequest,
	type SkillFeedbackOutcome,
	buildRecordRequest,
	resolveGitRoot,
	runBufferedProcess,
	runSkillFeedbackRecord,
} from './skill-feedback-runtime'

export interface CodexSkillDetection {
	source: 'codex-notify'
	skill: string
	outcome: SkillFeedbackOutcome
	cwd: string
}

export interface CodexNotifyRuntime {
	cwd: () => string
	nowIso: () => string
	resolveGitRoot: (cwd: string) => Promise<string>
	runNext: (command: readonly string[], stdin: string) => Promise<HookRunResult>
	runRecord: (request: RecordRequest) => Promise<HookRunResult>
}

export function parseNextCommand(argv: readonly string[]): string[] {
	const marker = argv.indexOf('--next')
	return marker === -1 ? [] : argv.slice(marker + 1)
}

export function detectSkillFromCodexNotify(
	text: string,
	fallbackCwd: string,
): CodexSkillDetection | null {
	const parsed = parseJsonObject(text)
	if (!parsed) return null
	const skill =
		stringAt(parsed, ['skill']) ??
		stringAt(parsed, ['data', 'skill']) ??
		stringAt(parsed, ['payload', 'skill']) ??
		stringAt(parsed, ['turn', 'skill'])
	if (!skill) return null
	const outcome = normalizeOutcome(
		stringAt(parsed, ['outcome']) ??
			stringAt(parsed, ['data', 'outcome']) ??
			stringAt(parsed, ['payload', 'outcome']) ??
			stringAt(parsed, ['type']),
	)
	return {
		source: 'codex-notify',
		skill,
		outcome,
		cwd:
			stringAt(parsed, ['cwd']) ??
			stringAt(parsed, ['data', 'cwd']) ??
			stringAt(parsed, ['payload', 'cwd']) ??
			fallbackCwd,
	}
}

export async function dispatchCodexNotify(
	stdin: string,
	nextCommand: readonly string[],
	runtime: CodexNotifyRuntime = createDefaultCodexRuntime(),
): Promise<{ forwarded: boolean; captured: boolean }> {
	const detection = detectSkillFromCodexNotify(stdin, runtime.cwd())
	const forward =
		nextCommand.length > 0
			? runtime.runNext(nextCommand, stdin)
			: Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
	const capture = detection
		? runtime
				.resolveGitRoot(detection.cwd)
				.then((cwd) =>
					runtime.runRecord(
						buildRecordRequest(
							cwd,
							{
								source: detection.source,
								skill: detection.skill,
								outcome: detection.outcome,
							},
							runtime.nowIso(),
						),
					),
				)
		: Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
	await Promise.allSettled([forward, capture])
	return {
		forwarded: nextCommand.length > 0,
		captured: Boolean(detection),
	}
}

export function createDefaultCodexRuntime(): CodexNotifyRuntime {
	return {
		cwd: () => process.cwd(),
		nowIso: () => new Date().toISOString(),
		resolveGitRoot,
		runNext,
		runRecord: runSkillFeedbackRecord,
	}
}

async function runNext(
	command: readonly string[],
	stdin: string,
): Promise<HookRunResult> {
	return runBufferedProcess(command, { stdin })
}

function parseJsonObject(text: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(text) as unknown
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null
	} catch {
		return null
	}
}

function stringAt(
	value: Record<string, unknown>,
	path: readonly string[],
): string | null {
	let current: unknown = value
	for (const part of path) {
		if (!current || typeof current !== 'object' || Array.isArray(current)) {
			return null
		}
		current = (current as Record<string, unknown>)[part]
	}
	return typeof current === 'string' && current.trim() !== ''
		? current
		: null
}

function normalizeOutcome(value: string | null): SkillFeedbackOutcome {
	if (value === 'failed' || value === 'turn.failed') return 'failed'
	if (value === 'confirmed' || value === 'turn.completed') return 'confirmed'
	return 'ambiguous'
}

if (import.meta.main) {
	const selfDestruct = setTimeout(() => {
		process.exit(0)
	}, 8_000)
	selfDestruct.unref()

	try {
		const stdin = await Bun.stdin.text()
		await dispatchCodexNotify(stdin, parseNextCommand(Bun.argv.slice(2)))
	} catch {
		// Notify dispatcher is best-effort; never break the Codex turn.
	}
	process.exit(0)
}
