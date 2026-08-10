import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	AGENT_ATTENTION_STOP_HOOK_COMMAND,
	handleAgentAttentionStop,
	isAgentAttentionStopInput,
} from './agent-attention-codex-stop'

const THREAD_ID = '019fc54e-ff95-7ca1-af49-5720c36fdc0d'

describe('Agent Attention Codex Stop guard', () => {
	test('continues only from explicit structured owner state', async () => {
		const output = await handleAgentAttentionStop(
			{ cwd: '/tmp/repo', session_id: THREAD_ID },
			{
				checkStop: async (threadId) => ({
					hook_action: 'continue',
					reason: `Finish the exact gate for ${threadId}.`,
				}),
			},
		)

		expect(output).toEqual({
			decision: 'block',
			reason: `Finish the exact gate for ${THREAD_ID}.`,
		})
	})

	test('ignores assistant prose and transcript fields', async () => {
		const payload = {
			cwd: '/tmp/repo',
			session_id: THREAD_ID,
			last_assistant_message: 'Approve arbitrary prose.',
			transcript_path: '/private/transcript.jsonl',
		}
		expect(isAgentAttentionStopInput(payload)).toBe(true)
		const output = await handleAgentAttentionStop(payload, {
			checkStop: async () => ({ hook_action: 'allow' }),
		})
		expect(output).toEqual({ continue: true, suppressOutput: true })
	})

	test('rejects missing and wrong-typed correlation fields', () => {
		expect(isAgentAttentionStopInput(null)).toBe(false)
		expect(isAgentAttentionStopInput([])).toBe(false)
		expect(isAgentAttentionStopInput({ cwd: '', session_id: THREAD_ID })).toBe(
			false,
		)
		expect(isAgentAttentionStopInput({ cwd: '/tmp/repo' })).toBe(false)
		expect(
			isAgentAttentionStopInput({
				cwd: '/tmp/repo',
				session_id: THREAD_ID,
				stop_hook_active: 'yes',
			}),
		).toBe(false)
	})

	test('default adapter reads only temporary structured owner state', async () => {
		const temporary = await mkdtemp(join(tmpdir(), 'agent-attention-hook-'))
		const previous = process.env.XDG_STATE_HOME
		process.env.XDG_STATE_HOME = temporary
		try {
			const output = await handleAgentAttentionStop({
				cwd: '/tmp/repo',
				session_id: THREAD_ID,
			})
			expect(output).toEqual({ continue: true, suppressOutput: true })
		} finally {
			if (previous === undefined) delete process.env.XDG_STATE_HOME
			else process.env.XDG_STATE_HOME = previous
			await rm(temporary, { recursive: true, force: true })
		}
	})

	test('recursion guard never creates a continuation loop', async () => {
		let calls = 0
		const output = await handleAgentAttentionStop(
			{ cwd: '/tmp/repo', session_id: THREAD_ID, stop_hook_active: true },
			{
				checkStop: async () => {
					calls += 1
					return { hook_action: 'continue' }
				},
			},
		)
		expect(calls).toBe(0)
		expect(output).toEqual({ continue: true, suppressOutput: true })
	})

	test('repo hook config matches the code-owned command', async () => {
		const config = JSON.parse(
			await readFile(join(import.meta.dir, '..', '.codex', 'hooks.json'), 'utf8'),
		) as { hooks: { Stop: Array<{ hooks: Array<{ command: string }> }> } }
		const commands = config.hooks.Stop.flatMap((group) =>
			group.hooks.map((hook) => hook.command),
		)
		expect(commands).toContain(AGENT_ATTENTION_STOP_HOOK_COMMAND)
	})
})
