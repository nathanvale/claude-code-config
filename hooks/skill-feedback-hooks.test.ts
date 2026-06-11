import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
	type RecordRequest,
	detectSkillFromClaudeTranscriptText,
	handleSkillFeedbackStop,
} from './skill-feedback-stop'
import {
	createDefaultCodexRuntime,
	detectSkillFromCodexNotify,
	dispatchCodexNotify,
	parseNextCommand,
} from './codex-notify-dispatcher'

const GENERATED_TS = '2026-06-11T10:00:00.000Z'
const FIXTURE_PATH = join(
	import.meta.dir,
	'fixtures',
	'skill-feedback',
	'fallow-close.jsonl',
)

async function fixtureText(): Promise<string> {
	return Bun.file(FIXTURE_PATH).text()
}

describe('skill-feedback hooks', () => {
	test('Claude Stop fixture detects a completed skill run', async () => {
		const detection = detectSkillFromClaudeTranscriptText(await fixtureText())

		expect(detection).toEqual({
			source: 'claude-stop',
			skill: 'fallow',
			outcome: 'ambiguous',
		})
	})

	test('Claude Stop handler invokes record without transcript payload', async () => {
		const calls: RecordRequest[] = []
		const result = await handleSkillFeedbackStop(
			{ cwd: '/tmp/repo', transcript_path: FIXTURE_PATH },
			{
				readText: fixtureText,
				resolveGitRoot: async (cwd) => cwd,
				nowIso: () => GENERATED_TS,
				runRecord: async (request) => {
					calls.push(request)
					return { exitCode: 0, stdout: '', stderr: '' }
				},
			},
		)

		expect(result.captured).toBe(true)
		expect(calls).toHaveLength(1)
		expect(calls[0]).toMatchObject({
			cwd: '/tmp/repo',
			skill: 'fallow',
			generatedTs: GENERATED_TS,
		})
		expect(JSON.stringify(calls)).not.toContain('SECRET_TOKEN_SHOULD_NOT_APPEAR')
	})

	test('Claude Stop malformed transcript skips capture without throwing', async () => {
		const calls: RecordRequest[] = []
		const result = await handleSkillFeedbackStop(
			{ cwd: '/tmp/repo', transcript_path: 'bad.jsonl' },
			{
				readText: async () => '{not json}\n{"type":"assistant"}\n',
				resolveGitRoot: async (cwd) => cwd,
				nowIso: () => GENERATED_TS,
				runRecord: async (request) => {
					calls.push(request)
					return { exitCode: 0, stdout: '', stderr: '' }
				},
			},
		)

		expect(result.captured).toBe(false)
		expect(calls).toEqual([])
	})

	test('Codex notify parser detects skill completion events', () => {
		const detection = detectSkillFromCodexNotify(
			JSON.stringify({
				type: 'turn.completed',
				cwd: '/tmp/repo',
				skill: 'cli-execution-auditor',
			}),
			'/fallback',
		)

		expect(detection).toEqual({
			source: 'codex-notify',
			skill: 'cli-execution-auditor',
			outcome: 'confirmed',
			cwd: '/tmp/repo',
		})
	})

	test('Codex dispatcher forwards existing notify handler and records skill feedback', async () => {
		const forwarded: Array<{ command: readonly string[]; stdin: string }> = []
		const records: RecordRequest[] = []
		const stdin = JSON.stringify({
			type: 'turn.completed',
			cwd: '/tmp/repo',
			skill: 'cli-execution-auditor',
		})

		const result = await dispatchCodexNotify(
			stdin,
			['existing-handler', 'turn-ended'],
			{
				cwd: () => '/fallback',
				nowIso: () => GENERATED_TS,
				resolveGitRoot: async (cwd) => cwd,
				runNext: async (command, input) => {
					forwarded.push({ command, stdin: input })
					return { exitCode: 0, stdout: '', stderr: '' }
				},
				runRecord: async (request) => {
					records.push(request)
					return { exitCode: 0, stdout: '', stderr: '' }
				},
			},
		)

		expect(result).toEqual({ forwarded: true, captured: true })
		expect(forwarded).toEqual([
			{ command: ['existing-handler', 'turn-ended'], stdin },
		])
		expect(records[0]).toMatchObject({
			cwd: '/tmp/repo',
			skill: 'cli-execution-auditor',
			outcome: 'confirmed',
		})
	})

	test('Codex dispatcher parses --next command boundaries', () => {
		expect(parseNextCommand(['--next', 'handler', 'turn-ended'])).toEqual([
			'handler',
			'turn-ended',
		])
		expect(parseNextCommand(['--other'])).toEqual([])
	})

	test('Codex default runtime forwards stdin to the existing handler', async () => {
		const result = await createDefaultCodexRuntime().runNext(
			['/bin/cat'],
			'notify payload\n',
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toBe('notify payload\n')
	})
})
