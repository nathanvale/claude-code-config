import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type SkillFeedbackOutcome = 'confirmed' | 'failed' | 'ambiguous'
export type SkillFeedbackSource = 'claude-stop' | 'codex-notify'

export interface SkillDetection {
	source: SkillFeedbackSource
	skill: string
	outcome: SkillFeedbackOutcome
}

export interface RecordRequest {
	cwd: string
	skill: string
	outcome: SkillFeedbackOutcome
	goal: string
	friction: string
	generatedTs: string
	explanation?: string
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
	return runBufferedProcess(args, { cwd: request.cwd })
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
