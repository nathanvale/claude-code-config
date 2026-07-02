#!/usr/bin/env bun

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import {
	type HookRunResult,
	type CorrelationCloseoutCandidate,
	type CorrelationWitnessRequest,
	type FinalizeCorrelationWitnessResult,
	type RecordRequest,
	type SkillDetection,
	buildRecordRequest,
	resolveGitRoot,
	runSkillFeedbackCorrelationWitness,
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
	finalizeCorrelationWitness?: (
		request: CorrelationWitnessRequest,
	) => Promise<FinalizeCorrelationWitnessResult>
}

export interface ClaudeSkillDetection extends SkillDetection {
	detectionId: string
}

export interface ClaudeTranscriptSkillFeedbackAnalysis {
	detection: ClaudeSkillDetection | null
	closeoutCandidates: readonly CorrelationCloseoutCandidate[]
	diagnostics: readonly string[]
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
	return analyzeSkillFeedbackClaudeTranscriptText(text).detection
}

export function analyzeSkillFeedbackClaudeTranscriptText(
	text: string,
): ClaudeTranscriptSkillFeedbackAnalysis {
	let latest: ClaudeSkillDetection | null = null
	let closeoutCandidates: CorrelationCloseoutCandidate[] = []
	let diagnostics: string[] = []
	const modelByToolUseId = new Map<string, string>()
	let closeoutCommandToolUseIds = new Set<string>()
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
			closeoutCandidates = []
			diagnostics = []
			closeoutCommandToolUseIds = new Set<string>()
		}
		if (latest) {
			for (const toolUseId of readCloseoutCommandToolUseIds(parsed)) {
				closeoutCommandToolUseIds.add(toolUseId)
			}
			for (const result of readCloseoutCandidates(
				parsed,
				closeoutCommandToolUseIds,
			)) {
				if (result.kind === 'candidate') closeoutCandidates.push(result.candidate)
				else diagnostics.push(result.diagnostic)
			}
		}
	}
	return { detection: latest, closeoutCandidates, diagnostics }
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
		const text = textFromToolResultContent(object.content)
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

type CloseoutParseResult =
	| { kind: 'candidate'; candidate: CorrelationCloseoutCandidate }
	| { kind: 'diagnostic'; diagnostic: string }

function readCloseoutCommandToolUseIds(entry: unknown): string[] {
	const message = objectFrom(objectFrom(entry)?.message)
	if (!message || message.role !== 'assistant') return []
	const content = Array.isArray(message.content) ? message.content : []
	const ids: string[] = []
	for (const item of content) {
		const object = objectFrom(item)
		if (object?.type !== 'tool_use') continue
		const id = stringFrom(object.id)
		if (id && isSkillFeedbackCloseoutCommand(object)) ids.push(id)
	}
	return ids
}

function isSkillFeedbackCloseoutCommand(
	toolUse: Record<string, unknown>,
): boolean {
	const input = objectFrom(toolUse.input)
	const command = stringFrom(input?.command)?.trim()
	if (!command) return false
	if (/[;\n\r`]|&&|\|\||\||\$\(/.test(command)) return false
	const tokens = command.split(/\s+/)
	const [runtime, run, script, subcommand, ...rest] = tokens
	const runnerPaths = new Set([
		'skills/skill-feedback/src/skill-feedback-runner.ts',
		'./skills/skill-feedback/src/skill-feedback-runner.ts',
	])
	if (runtime !== 'bun' || run !== 'run' || !script || !runnerPaths.has(script)) {
		return false
	}
	if (subcommand !== 'closeout') return false
	if (rest.length === 0) return true
	if (rest.length === 2 && rest[0] === '<') return rest[1].trim() !== ''
	return false
}

function readCloseoutCandidates(
	entry: unknown,
	closeoutCommandToolUseIds: ReadonlySet<string>,
): CloseoutParseResult[] {
	const message = objectFrom(objectFrom(entry)?.message)
	if (!message) return []
	const content = Array.isArray(message.content) ? message.content : []
	const results: CloseoutParseResult[] = []
	for (const item of content) {
		const object = objectFrom(item)
		if (object?.type !== 'tool_result') continue
		const toolUseId = stringFrom(object.tool_use_id)
		if (!toolUseId || !closeoutCommandToolUseIds.has(toolUseId)) continue
		const text = textFromToolResultContent(object.content)
		if (!text) continue
		for (const payload of jsonObjectsFromToolResultText(text)) {
			const candidate = closeoutCandidateFromEnvelope(payload)
			if (candidate) results.push(candidate)
		}
	}
	return results
}

function jsonObjectsFromToolResultText(text: string): unknown[] {
	const trimmed = text.trim()
	if (!trimmed.startsWith('{')) return []
	try {
		return [JSON.parse(trimmed)]
	} catch {
		return trimmed.includes('skill-feedback.closeout')
			? [{ malformedCloseoutEnvelope: true }]
			: []
	}
}

function closeoutCandidateFromEnvelope(payload: unknown): CloseoutParseResult | null {
	const envelope = objectFrom(payload)
	if (!envelope) return null
	if (envelope.malformedCloseoutEnvelope === true) {
		return { kind: 'diagnostic', diagnostic: 'closeout_envelope_malformed_json' }
	}
	if (envelope.status !== 'ok') return null
	const data = objectFrom(envelope.data)
	if (!data || data.contract !== 'skill-feedback.closeout') return null
	const reportId = stringFrom(data.report_id)
	const writtenPath = stringFrom(data.written_path)
	const proofStatus = stringFrom(data.proof_status)
	if (!reportId || !writtenPath || !proofStatus) return null
	return {
		kind: 'candidate',
		candidate: { reportId, writtenPath, proofStatus },
	}
}

export async function handleSkillFeedbackStop(
	input: StopHookInput,
	runtime: SkillFeedbackStopRuntime = createDefaultStopRuntime(),
): Promise<{
	captured: boolean
	detection?: SkillDetection
	correlation?: FinalizeCorrelationWitnessResult
}> {
	if (input.stop_hook_active) return { captured: false }
	let transcript = ''
	try {
		transcript = await runtime.readText(input.transcript_path)
	} catch {
		return { captured: false }
	}
	const analysis = analyzeSkillFeedbackClaudeTranscriptText(transcript)
	const detection = analysis.detection
	if (!detection) return { captured: false }
	if (
		(await runtime.readLastDetectionId(input.transcript_path)) ===
		detection.detectionId
	) {
		return { captured: false, detection }
	}
	const cwd = await runtime.resolveGitRoot(input.cwd)
	const generatedTs = runtime.nowIso()
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
			generatedTs,
		),
	)
	if (result.exitCode !== 0) {
		return { captured: false, detection }
	}
	const recordData = hookRecordDataFromStdout(result.stdout)
	let correlation: FinalizeCorrelationWitnessResult | undefined
	if (!recordData) {
		await runtime.writeLastDetectionId(
			input.transcript_path,
			detection.detectionId,
		)
		return { captured: true, detection }
	}
	if (recordData?.skillRunId) {
		correlation = await finalizeCorrelationWitnessSafe(runtime, {
			cwd,
			skill: detection.skill,
			hookReportId: recordData.reportId,
			...(result.reportPath
				? { hookWrittenPath: relative(cwd, result.reportPath) }
				: {}),
			skillRunId: recordData.skillRunId,
			generatedTs,
			candidates: analysis.closeoutCandidates,
			closeoutDiagnostics: analysis.diagnostics,
		})
	}
	await runtime.writeLastDetectionId(
		input.transcript_path,
		detection.detectionId,
	)
	return { captured: true, detection, ...(correlation ? { correlation } : {}) }
}

function createDefaultStopRuntime(): SkillFeedbackStopRuntime {
	return {
		readText: async (path) => Bun.file(path).text(),
		readLastDetectionId,
		writeLastDetectionId,
		resolveGitRoot,
		nowIso: () => new Date().toISOString(),
		runRecord: runSkillFeedbackRecord,
		finalizeCorrelationWitness: runSkillFeedbackCorrelationWitness,
	}
}

async function finalizeCorrelationWitnessSafe(
	runtime: SkillFeedbackStopRuntime,
	request: CorrelationWitnessRequest,
): Promise<FinalizeCorrelationWitnessResult> {
	try {
		const finalize =
			runtime.finalizeCorrelationWitness ?? runSkillFeedbackCorrelationWitness
		return await finalize(request)
	} catch {
		return {
			status: 'blocked',
			diagnostics: ['correlation_witness_finalization_failed'],
		}
	}
}

function hookRecordDataFromStdout(
	stdout: string,
): { reportId: string; skillRunId?: string } | null {
	try {
		const envelope = objectFrom(JSON.parse(stdout))
		const data = objectFrom(envelope?.data)
		const reportId = stringFrom(data?.report_id)
		if (!reportId) return null
		const skillRunId = stringFrom(data?.skill_run_id)
		return {
			reportId,
			...(skillRunId ? { skillRunId } : {}),
		}
	} catch {
		return null
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

function textFromToolResultContent(value: unknown): string | null {
	const direct = stringFrom(value)
	if (direct) return direct
	if (!Array.isArray(value)) return null
	const text = value
		.map((item) => {
			const object = objectFrom(item)
			return object?.type === 'text' ? stringFrom(object.text) : null
		})
		.filter((part): part is string => part !== null)
		.join('\n')
	return text.trim() === '' ? null : text
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
