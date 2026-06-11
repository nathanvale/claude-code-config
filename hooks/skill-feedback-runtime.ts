import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type SkillFeedbackOutcome = 'confirmed' | 'failed' | 'ambiguous'
export type SkillFeedbackSource = 'claude-stop' | 'codex-notify'

/**
 * Engine-read telemetry lifted from the transcript alongside the skill
 * detection. v0 carries only `model` (the id from the skill-launch entry).
 * `usage` is intentionally absent: the Stop hook fires after the skill runs
 * inline, so the transcript holds no skill-scoped token total — only
 * whole-session counts. v0 leaves usage an explicit record gap; v1 sources a
 * real per-skill cost from OTel counters, not transcript summing.
 *
 * `model` is engine-read (KTD2a) — passed to the runner over stdin, never a CLI
 * flag, so an agent cannot author it.
 */
export interface DetectionTelemetry {
	model?: string
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

const DEFAULT_HOOK_PROCESS_TIMEOUT_MS = 6_000

const HOOK_DIR = dirname(fileURLToPath(import.meta.url))
const CONFIG_ROOT = dirname(HOOK_DIR)
const SKILL_FEEDBACK_RUNNER = join(
	CONFIG_ROOT,
	'skills',
	'skill-feedback',
	'src',
	'skill-feedback-runner.ts',
)

export function buildRecordRequest(
	cwd: string,
	detection: SkillDetection,
	generatedTs: string,
): RecordRequest {
	return {
		cwd,
		skill: detection.skill,
		outcome: detection.outcome,
		goal: 'Harness hook observed a completed skill run.',
		friction: 'Hook captured no transcript payload.',
		generatedTs,
		explanation: `Captured by ${detection.source}.`,
		telemetry: detection.telemetry,
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
	const args = [
		'bun',
		'run',
		SKILL_FEEDBACK_RUNNER,
		'record',
		'--skill',
		request.skill,
		'--goal',
		request.goal,
		'--outcome',
		request.outcome,
		'--friction',
		request.friction,
		'--generated-ts',
		request.generatedTs,
	]
	if (request.explanation) {
		args.push('--explanation', request.explanation)
	}
	// Engine-read telemetry (model/usage) flows over stdin, never as a flag
	// (KTD2a): there is deliberately no --model/--usage flag for an agent to
	// smuggle a secret through the redactor's trusted side. An empty stdin is a
	// valid "no telemetry" signal that degrades the record rather than blocking.
	const stdin = request.telemetry
		? JSON.stringify(request.telemetry)
		: ''
	return runBufferedProcess(args, { cwd: request.cwd, stdin })
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
