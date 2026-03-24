#!/usr/bin/env bun

/**
 * Git Context Loader Hook
 *
 * SessionStart hook that injects git repository context into Claude's
 * conversation. Fires on startup, resume, compact, and clear to ensure
 * Claude always has current branch/status awareness.
 *
 * Output: Plain stdout text with git repository state (branch, status,
 * recent commits). Safety rules and workflow routing are handled by
 * AGENTS.md (git-policy fragment) and rules/git-workflow.md.
 */

import { postEvent } from './event-bus-client'
import { parsePorcelainStatus } from './git-status-parser'
import { isGitRepo, runGit } from './git-utils'

type SessionSource = 'startup' | 'resume' | 'compact' | 'clear'

interface SessionStartHookInput {
	session_id: string
	hook_event_name: string
	cwd: string
	source: SessionSource
	model: string
	permission_mode: string
	transcript_path?: string
	agent_type?: string
}

function isSessionStartHookInput(
	value: unknown,
): value is SessionStartHookInput {
	if (!value || typeof value !== 'object') return false
	return (
		'cwd' in value &&
		typeof value.cwd === 'string' &&
		'source' in value &&
		typeof value.source === 'string' &&
		'session_id' in value &&
		typeof value.session_id === 'string'
	)
}

interface GitContext {
	branch: string
	status: {
		staged: number
		modified: number
		untracked: number
	}
	recentCommits: string[]
}

function sanitizeContextLine(value: string): string {
	// Strip ASCII control characters (0x00-0x1F and 0x7F) using charCodeAt to
	// avoid Biome noControlCharactersInRegex lint rule on regex literals.
	let out = ''
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i)
		out += c <= 0x1f || c === 0x7f ? ' ' : value[i]
	}
	return out.replace(/```/g, "'''").replace(/\s+/g, ' ').trim()
}

/** Gathers git state. Uses fewer commits on compact/clear to save context budget. */
export async function getGitContext(
	cwd: string,
	commitCount: number = 5,
): Promise<GitContext | null> {
	if (!(await isGitRepo(cwd))) {
		return null
	}

	const [statusResult, commitsResult] = await Promise.all([
		runGit(['status', '--porcelain', '-b'], { cwd }),
		runGit(['log', '--oneline', `-${commitCount}`, '--format=%h %s (%ar)'], {
			cwd,
		}),
	])

	if (statusResult.exitCode !== 0) {
		return null
	}

	const { branch, counts } = parsePorcelainStatus(statusResult.stdout)

	const recentCommits =
		commitsResult.exitCode === 0
			? commitsResult.stdout
					.split('\n')
					.map((line) => line.trim())
					.filter(Boolean)
			: []

	return {
		branch: branch || '(detached)',
		status: counts,
		recentCommits,
	}
}

/** Formats the additionalContext payload with git repository state. */
export function formatAdditionalContext(
	context: GitContext,
	source: SessionSource,
): string {
	const { branch, status, recentCommits } = context

	const restoredNote =
		source === 'compact' ? ' (restored after compaction)' : ''
	const safeBranch = sanitizeContextLine(branch)
	let state = `## Git Repository Context${restoredNote}\n\n`
	state += `Branch: ${safeBranch}\n`
	state += `Status: ${status.modified} modified, ${status.untracked} untracked, ${status.staged} staged\n`

	if (recentCommits.length > 0) {
		state += `\nRecent commits:\n`
		for (const commit of recentCommits) {
			state += `- ${sanitizeContextLine(commit)}\n`
		}
	} else {
		state += '\nNo commits yet.\n'
	}

	return state
}

if (import.meta.main) {
	// Self-destruct timer: first executable line when run as entry point.
	// Set to 80% of hooks.json timeout (15s). .unref() lets the process
	// exit naturally when work completes.
	const selfDestruct = setTimeout(() => {
		process.stderr.write('git-context-loader: timed out\n')
		process.exit(1)
	}, 12_000)
	selfDestruct.unref()

	try {
		let input: SessionStartHookInput
		try {
			const parsed = await Bun.stdin.json()
			if (!isSessionStartHookInput(parsed)) {
				process.exit(0)
			}
			input = parsed
		} catch {
			process.exit(0)
		}

		const commitCount =
			input.source === 'compact' || input.source === 'clear' ? 3 : 5
		const context = await getGitContext(input.cwd, commitCount)
		if (context) {
			// Plain stdout is reliably injected as context for SessionStart hooks.
			console.log(
				formatAdditionalContext(context, input.source as SessionSource),
			)

			try {
				await postEvent(input.cwd, 'session.started', {
					source: input.source,
					branch: context.branch,
					status: context.status,
					session_id: input.session_id,
				})
			} catch {
				// event emission is best-effort
			}
		}
	} catch {
		// never crash the hook
	}

	process.exit(0)
}
