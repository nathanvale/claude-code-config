import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	CODEX_STOP_HOOK_COMMAND,
	detectSkillFromCodexStopInput,
	handleSkillFeedbackCodexStop,
	isCodexStopHookInput,
} from './skill-feedback-codex-stop'
import {
	detectSkillFromClaudeTranscriptText,
	handleSkillFeedbackStop,
} from './skill-feedback-stop'
import {
	createDefaultCodexRuntime,
	detectSkillFromCodexNotify,
	dispatchCodexNotify,
	parseNextCommand,
	parseNotifyInvocation,
} from './codex-notify-dispatcher'
import type { RecordRequest } from './skill-feedback-runtime'
import { runBufferedProcess } from './skill-feedback-runtime'

const GENERATED_TS = '2026-06-11T10:00:00.000Z'
const FIXTURE_PATH = join(
	import.meta.dir,
	'fixtures',
	'skill-feedback',
	'fallow-close.jsonl',
)
const CODEX_HOOKS_PATH = join(import.meta.dir, '..', '.codex', 'hooks.json')
async function fixtureText(): Promise<string> {
	return Bun.file(FIXTURE_PATH).text()
}

function createMemoryDedupe() {
	let lastDetectionId: string | null = null
	return {
		readLastDetectionId: async () => lastDetectionId,
		writeLastDetectionId: async (
			_transcriptPath: string,
			detectionId: string,
		) => {
			lastDetectionId = detectionId
		},
	}
}

describe('skill-feedback hooks', () => {
	test('Claude Stop fixture detects a completed skill run', async () => {
		const detection = detectSkillFromClaudeTranscriptText(await fixtureText())

		expect(detection).toMatchObject({
			source: 'claude-stop',
			skill: 'fallow',
			outcome: 'ambiguous',
			detectionId:
				'44772d83-5da8-4091-908b-9d093059265b:784c9d1b-7773-4480-a5fd-f37b26a47589',
		})
	})

	test('verbatim close fixture reads the skill-launch model, no usage in v0', async () => {
		// The real skill-launch entry carries message.model — model populates.
		// usage is deliberately not read in v0 (the transcript holds no
		// skill-scoped token total), so telemetry carries model only.
		const detection = detectSkillFromClaudeTranscriptText(await fixtureText())

		expect(detection?.telemetry).toEqual({ model: 'claude-opus-4-8' })
	})

	test('Claude Stop handler writes record request without transcript payload', async () => {
		// Synthetic transcript: the sentinel proves transcript text never leaks
		// into the record request. Kept inline so the real fixture stays verbatim.
		const transcriptWithSecret = [
			JSON.stringify({
				type: 'assistant',
				message: {
					model: 'claude-opus-4-8',
					role: 'assistant',
					content: [
						{ type: 'text', text: 'SECRET_TOKEN_SHOULD_NOT_APPEAR' },
						{
							type: 'tool_use',
							id: 'toolu_inline_fallow',
							name: 'Skill',
							input: { skill: 'fallow' },
						},
					],
				},
				uuid: 'assistant-inline',
			}),
			JSON.stringify({
				type: 'user',
				message: {
					role: 'user',
					content: [
						{
							type: 'tool_result',
							tool_use_id: 'toolu_inline_fallow',
							content: 'Launching skill: fallow',
						},
					],
				},
				toolUseResult: { success: true, commandName: 'fallow' },
				sourceToolUseID: 'toolu_inline_fallow',
				sessionId: 'inline-session',
				uuid: 'tool-result-inline',
			}),
		].join('\n')

		const calls: RecordRequest[] = []
		const tempDir = await mkdtemp(join(tmpdir(), 'skill-feedback-hook-'))
		const recordPath = join(tempDir, 'record-request.json')
		try {
			const result = await handleSkillFeedbackStop(
				{ cwd: '/tmp/repo', transcript_path: 'inline.jsonl' },
				{
					readText: async () => transcriptWithSecret,
					...createMemoryDedupe(),
					resolveGitRoot: async (cwd) => cwd,
					nowIso: () => GENERATED_TS,
					runRecord: async (request) => {
						calls.push(request)
						await writeFile(recordPath, `${JSON.stringify(request)}\n`)
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
				// Engine-read model rides along; usage is absent in v0.
				telemetry: { model: 'claude-opus-4-8' },
			})
			expect(await readFile(recordPath, 'utf8')).not.toContain(
				'SECRET_TOKEN_SHOULD_NOT_APPEAR',
			)
		} finally {
			await rm(tempDir, { recursive: true, force: true })
		}
	})

	test('Claude Stop malformed transcript skips capture without throwing', async () => {
		const calls: RecordRequest[] = []
		const result = await handleSkillFeedbackStop(
			{ cwd: '/tmp/repo', transcript_path: 'bad.jsonl' },
			{
				readText: async () => '{not json}\n{"type":"assistant"}\n',
				...createMemoryDedupe(),
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

	test('Claude Stop handler records each transcript detection only once', async () => {
		const calls: RecordRequest[] = []
		const dedupe = createMemoryDedupe()
		const runtime = {
			readText: fixtureText,
			...dedupe,
			resolveGitRoot: async (cwd: string) => cwd,
			nowIso: () => GENERATED_TS,
			runRecord: async (request: RecordRequest) => {
				calls.push(request)
				return { exitCode: 0, stdout: '', stderr: '' }
			},
		}

		const first = await handleSkillFeedbackStop(
			{ cwd: '/tmp/repo', transcript_path: FIXTURE_PATH },
			runtime,
		)
		const second = await handleSkillFeedbackStop(
			{ cwd: '/tmp/repo', transcript_path: FIXTURE_PATH },
			runtime,
		)

		expect(first.captured).toBe(true)
		expect(second.captured).toBe(false)
		expect(calls).toHaveLength(1)
	})

	test('Claude Stop handler reports uncaptured when record subprocess fails', async () => {
		const calls: RecordRequest[] = []
		const dedupe = createMemoryDedupe()
		const result = await handleSkillFeedbackStop(
			{ cwd: '/tmp/repo', transcript_path: FIXTURE_PATH },
			{
				readText: fixtureText,
				...dedupe,
				resolveGitRoot: async (cwd) => cwd,
				nowIso: () => GENERATED_TS,
				runRecord: async (request) => {
					calls.push(request)
					return { exitCode: 1, stdout: '', stderr: 'nope' }
				},
			},
		)

		expect(result.captured).toBe(false)
		expect(calls).toHaveLength(1)
		expect(await dedupe.readLastDetectionId(FIXTURE_PATH)).toBeNull()
	})

	test('Codex Stop payload records evidence-only capture without transcript reads', async () => {
		const calls: RecordRequest[] = []
		const result = await handleSkillFeedbackCodexStop(
			{
				cwd: '/tmp/repo',
				transcript_path: '/tmp/hostile-transcript.jsonl',
				hook_event_name: 'Stop',
				model: 'gpt-5-codex',
				turn_id: 'turn-fixture',
				last_assistant_message: 'Launching skill: fallow',
			},
			{
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
			skill: 'unknown-skill',
			generatedTs: GENERATED_TS,
			telemetry: {
				model: 'gpt-5-codex',
				capture_runtime: 'codex_stop',
				skill_identity_provenance: {
					source: 'none',
					trusted: false,
					reason: 'codex_stop_payload_has_no_trusted_skill_identity',
				},
			},
		})
	})

	test('Codex Stop payload does not infer skill identity from assistant text', () => {
		const detection = detectSkillFromCodexStopInput({
			cwd: '/tmp/repo',
			model: 'gpt-5-codex',
			last_assistant_message: 'Launching skill: fallow',
		})

		expect(detection.skill).toBe('unknown-skill')
		expect(detection.telemetry?.skill_identity_provenance).toMatchObject({
			source: 'none',
			trusted: false,
		})
	})

	test('Codex Stop recursion guard skips capture', async () => {
		const calls: RecordRequest[] = []
		const result = await handleSkillFeedbackCodexStop(
			{ cwd: '/tmp/repo', stop_hook_active: true },
			{
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

	test('repo Codex Stop hook config matches code-owned command', async () => {
		const raw = JSON.parse(await readFile(CODEX_HOOKS_PATH, 'utf8')) as {
			hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> }
		}

		expect(raw.hooks.Stop[0]?.hooks[0]?.command).toBe(CODEX_STOP_HOOK_COMMAND)
	})

	test('isCodexStopHookInput accepts a minimal valid payload', () => {
		expect(isCodexStopHookInput({ cwd: '/tmp/repo' })).toBe(true)
		expect(
			isCodexStopHookInput({
				cwd: '/tmp/repo',
				model: 'gpt-5-codex',
				stop_hook_active: false,
				last_assistant_message: 'done',
			}),
		).toBe(true)
	})

	test('isCodexStopHookInput rejects payloads with missing or wrong-typed fields', () => {
		expect(isCodexStopHookInput(null)).toBe(false)
		expect(isCodexStopHookInput('codex')).toBe(false)
		expect(isCodexStopHookInput([{ cwd: '/tmp/repo' }])).toBe(false)
		expect(isCodexStopHookInput({})).toBe(false)
		expect(isCodexStopHookInput({ cwd: '   ' })).toBe(false)
		expect(isCodexStopHookInput({ cwd: '/tmp/repo', model: 7 })).toBe(false)
		expect(
			isCodexStopHookInput({ cwd: '/tmp/repo', stop_hook_active: 'yes' }),
		).toBe(false)
	})

	test('Codex notify parser skips payloads without skill identity', () => {
		const detection = detectSkillFromCodexNotify(
			JSON.stringify({
				type: 'agent-turn-complete',
				'turn-id': 'turn-fixture',
				cwd: '/tmp/repo',
				'last-assistant-message': 'Done.',
				'input-messages': [],
			}),
			'/fallback',
		)

		expect(detection).toBeNull()
	})

	test('Codex dispatcher forwards existing notify handler without false capture', async () => {
		const forwarded: Array<{ command: readonly string[]; payload: string }> = []
		const records: RecordRequest[] = []
		const payload = JSON.stringify({
			type: 'agent-turn-complete',
			cwd: '/tmp/repo',
			'last-assistant-message': 'Done.',
			'input-messages': [],
		})

		const result = await dispatchCodexNotify(
			payload,
			['existing-handler', 'turn-ended'],
			{
				cwd: () => '/fallback',
				nowIso: () => GENERATED_TS,
				resolveGitRoot: async (cwd) => cwd,
				runNext: async (command, inputPayload) => {
					forwarded.push({ command, payload: inputPayload })
					return { exitCode: 0, stdout: '', stderr: '' }
				},
				runRecord: async (request) => {
					records.push(request)
					return { exitCode: 0, stdout: '', stderr: '' }
				},
			},
		)

		expect(result).toEqual({ forwarded: true, captured: false })
		expect(forwarded).toEqual([
			{ command: ['existing-handler', 'turn-ended'], payload },
		])
		expect(records).toEqual([])
	})

	test('Codex dispatcher reports failed forwarding and failed capture by exit code', async () => {
		const payload = JSON.stringify({
			type: 'agent-turn-complete',
			cwd: '/tmp/repo',
			skill: 'cli-execution-auditor',
		})

		const result = await dispatchCodexNotify(
			payload,
			['existing-handler', 'turn-ended'],
			{
				cwd: () => '/fallback',
				nowIso: () => GENERATED_TS,
				resolveGitRoot: async (cwd) => cwd,
				runNext: async () => ({ exitCode: 1, stdout: '', stderr: 'forward failed' }),
				runRecord: async () => ({ exitCode: 1, stdout: '', stderr: 'record failed' }),
			},
		)

		expect(result).toEqual({ forwarded: false, captured: false })
	})

	test('Codex dispatcher parses --next command boundaries', () => {
		expect(parseNextCommand(['--next', 'handler', 'turn-ended'])).toEqual([
			'handler',
			'turn-ended',
		])
		expect(parseNextCommand(['--other'])).toEqual([])
	})

	test('Codex dispatcher parses documented JSON-argument notify shape', () => {
		const payload = JSON.stringify({
			type: 'agent-turn-complete',
			cwd: '/tmp/repo',
		})

		expect(
			parseNotifyInvocation(
				['--next', 'handler', 'turn-ended', payload],
				'',
			),
		).toEqual({
			payload,
			nextCommand: ['handler', 'turn-ended'],
		})
	})

	test('Codex default runtime forwards payload as an argument', async () => {
		const result = await createDefaultCodexRuntime().runNext(
			['/bin/sh', '-c', 'printf "%s" "$1"', 'payload-printer'],
			'notify payload\n',
		)

		expect(result.exitCode).toBe(0)
		expect(result.stdout).toBe('notify payload\n')
	})

	test('hook subprocesses return after their configured timeout', async () => {
		const start = Date.now()
		const result = await runBufferedProcess(['/bin/sleep', '1'], {
			timeoutMs: 50,
		})

		expect(result.exitCode).toBe(124)
		expect(result.stderr).toContain('timed out after 50ms')
		expect(Date.now() - start).toBeLessThan(900)
	})
})
