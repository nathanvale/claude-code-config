import {
	createDefaultSkillFeedbackRuntime,
	finalizeSkillFeedbackCorrelationWitness,
	recordSkillFeedbackReceipt,
	type CorrelationCloseoutCandidate,
	type FinalizeCorrelationWitnessResult,
} from '../skills/skill-feedback/src/skill-feedback-runner'

export type SkillFeedbackOutcome = 'confirmed' | 'failed' | 'ambiguous'
export type SkillFeedbackSource = 'claude-stop' | 'codex-stop' | 'codex-notify'
export type CaptureRuntime = 'claude_stop' | 'codex_stop' | 'codex_notify'
/**
 * Capture-source provenance. `trusted` means the adapter trusts the named
 * source field; it is not Trusted skill identity or Trusted run proof.
 */
export type SkillIdentityProvenance = {
	source:
		| 'claude_transcript_skill_tool_result'
		| 'codex_notify_payload'
		| 'codex_stop_payload'
		| 'none'
	trusted: boolean
	field?: string
	reason?:
		| 'claude_transcript_detection'
		| 'legacy_notify_not_ready'
		| 'codex_stop_payload_has_no_trusted_skill_identity'
		| 'trusted_codex_stop_payload_identity'
}

/**
 * Hook-owned telemetry lifted alongside skill detection. `model` is
 * engine-read; trust-bearing capture fields are passed through the direct
 * runner seam, not public `record` stdin. `usage` is intentionally absent:
 * the Stop hook sees whole-session counts, not skill-scoped token totals.
 */
export interface DetectionTelemetry {
	model?: string
	detection_id?: string
	capture_runtime?: CaptureRuntime
	skill_identity_provenance?: SkillIdentityProvenance
}

export interface SkillDetection {
	source: SkillFeedbackSource
	skill: string
	outcome: SkillFeedbackOutcome
	telemetry?: DetectionTelemetry
}

export interface RecordRequest {
	cwd: string
	skill: string
	outcome: SkillFeedbackOutcome
	goal: string
	friction: string
	generatedTs: string
	explanation?: string
	telemetry?: DetectionTelemetry
}

export interface HookRunResult {
	exitCode: number
	stdout: string
	stderr: string
}

export interface CorrelationWitnessRequest {
	cwd: string
	skill: string
	hookReportId: string
	skillRunId: string
	generatedTs: string
	candidates: readonly CorrelationCloseoutCandidate[]
}

const DEFAULT_HOOK_PROCESS_TIMEOUT_MS = 6_000

export function buildRecordRequest(
	cwd: string,
	detection: SkillDetection,
	generatedTs: string,
): RecordRequest {
	const sourceTelemetry = captureTelemetryForSource(detection.source)
	const telemetry: DetectionTelemetry = {
		...detection.telemetry,
		capture_runtime: sourceTelemetry.capture_runtime,
		skill_identity_provenance: sourceTelemetry.skill_identity_provenance,
	}
	return {
		cwd,
		skill: detection.skill,
		outcome: detection.outcome,
		goal: 'Harness hook observed a completed skill run.',
		friction: 'Hook captured no transcript payload.',
		generatedTs,
		explanation: `Captured by ${detection.source}.`,
		telemetry,
	}
}

function captureTelemetryForSource(
	source: SkillFeedbackSource,
): Required<Pick<DetectionTelemetry, 'capture_runtime' | 'skill_identity_provenance'>> {
	switch (source) {
		case 'claude-stop':
			return {
				capture_runtime: 'claude_stop',
				skill_identity_provenance: {
					source: 'claude_transcript_skill_tool_result',
					trusted: true,
					field: 'toolUseResult.commandName',
					reason: 'claude_transcript_detection',
				},
			}
		case 'codex-notify':
			return {
				capture_runtime: 'codex_notify',
				skill_identity_provenance: {
					source: 'codex_notify_payload',
					trusted: false,
					field: 'skill',
					reason: 'legacy_notify_not_ready',
				},
			}
		case 'codex-stop':
			return {
				capture_runtime: 'codex_stop',
				skill_identity_provenance: {
					source: 'none',
					trusted: false,
					reason: 'codex_stop_payload_has_no_trusted_skill_identity',
				},
			}
	}
}

export async function resolveGitRoot(cwd: string): Promise<string> {
	const result = await runBufferedProcess([
		'git',
		'-C',
		cwd,
		'rev-parse',
		'--show-toplevel',
	])
	if (result.exitCode !== 0) return cwd
	return result.stdout.trim() || cwd
}

export async function runSkillFeedbackRecord(
	request: RecordRequest,
): Promise<HookRunResult> {
	const telemetry = request.telemetry ?? {}
	const result = await recordSkillFeedbackReceipt(
		{
			skill: request.skill,
			outcome: request.outcome,
			goal: request.goal,
			friction: request.friction,
			generated_ts: request.generatedTs,
			...(request.explanation ? { explanation: request.explanation } : {}),
		},
		{
			runtime: createDefaultSkillFeedbackRuntime({
				repoRoot: () => request.cwd,
				readStdinTelemetry: async () => ({}),
			}),
			internalTelemetry: {
				...(telemetry.model ? { model: telemetry.model } : {}),
				captureMetadata: {
					...(telemetry.capture_runtime
						? { capture_runtime: telemetry.capture_runtime }
						: {}),
					...(telemetry.skill_identity_provenance
						? { skill_identity_provenance: telemetry.skill_identity_provenance }
						: {}),
				},
				...(telemetry.detection_id
					? { detectionId: telemetry.detection_id }
					: {}),
			},
		},
	)
	return {
		exitCode: result.exitCode,
		stdout: result.stdout,
		stderr: result.stderr,
	}
}

export async function runSkillFeedbackCorrelationWitness(
	request: CorrelationWitnessRequest,
): Promise<FinalizeCorrelationWitnessResult> {
	return finalizeSkillFeedbackCorrelationWitness(
		{
			skill: request.skill,
			hookReportId: request.hookReportId,
			skillRunId: request.skillRunId,
			createdTs: request.generatedTs,
			candidates: request.candidates,
		},
		{
			runtime: createDefaultSkillFeedbackRuntime({
				repoRoot: () => request.cwd,
				readStdinTelemetry: async () => ({}),
			}),
		},
	)
}

export async function runBufferedProcess(
	command: readonly string[],
	options: { cwd?: string; stdin?: string; timeoutMs?: number } = {},
): Promise<HookRunResult> {
	const proc = Bun.spawn([...command], {
		cwd: options.cwd,
		stdin: options.stdin === undefined ? undefined : 'pipe',
		stdout: 'pipe',
		stderr: 'pipe',
	})
	const timeoutMs = options.timeoutMs ?? DEFAULT_HOOK_PROCESS_TIMEOUT_MS
	let timedOut = false
	const timeout =
		timeoutMs > 0
			? setTimeout(() => {
					timedOut = true
					proc.kill()
				}, timeoutMs)
			: null
	if (options.stdin !== undefined && proc.stdin) {
		proc.stdin.write(options.stdin)
		proc.stdin.end()
	}
	try {
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		])
		return {
			exitCode: timedOut ? 124 : exitCode,
			stdout,
			stderr: timedOut ? appendTimeoutMessage(stderr, timeoutMs) : stderr,
		}
	} finally {
		if (timeout) clearTimeout(timeout)
	}
}

function appendTimeoutMessage(stderr: string, timeoutMs: number): string {
	const separator = stderr === '' || stderr.endsWith('\n') ? '' : '\n'
	return `${stderr}${separator}skill-feedback hook subprocess timed out after ${timeoutMs}ms.\n`
}
