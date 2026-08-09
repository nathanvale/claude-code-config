import { type Dirent, existsSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { homedir } from "node:os"
import { resolve } from "node:path"
import type {
	SessionFile,
	SessionRoots,
	SessionSource,
	SourceScanState,
} from "./model.ts"

async function listJsonl(root: string): Promise<{
	paths: string[]
	unreadableDirectories: number
}> {
	if (!existsSync(root)) return { paths: [], unreadableDirectories: 0 }
	const results: string[] = []
	let unreadableDirectories = 0
	const pending = [root]
	while (pending.length > 0) {
		const current = pending.pop()
		if (!current) continue
		let entries: Dirent[]
		try {
			entries = await readdir(current, { withFileTypes: true })
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code
			if (code === "EACCES" || code === "EPERM") {
				unreadableDirectories += 1
				continue
			}
			throw error
		}
		for (const entry of entries) {
			const path = resolve(current, entry.name)
			if (entry.isDirectory()) pending.push(path)
			else if (entry.isFile() && entry.name.endsWith(".jsonl")) results.push(path)
		}
	}
	return { paths: results.sort(), unreadableDirectories }
}

/**
 * Resolve standard private session roots with test-only environment overrides.
 *
 * @param home - User home used for standard runtime locations
 * @returns Claude Code, active Codex, and archived Codex roots
 *
 * @example
 * ```ts
 * const roots = defaultSessionRoots()
 * ```
 */
export function defaultSessionRoots(home = homedir()): SessionRoots {
	return {
		claude: process.env.SESSION_CORPUS_CLAUDE_ROOT ?? resolve(home, ".claude", "projects"),
		codexActive: process.env.SESSION_CORPUS_CODEX_ROOT ?? resolve(home, ".codex", "sessions"),
		codexArchived: process.env.SESSION_CORPUS_CODEX_ARCHIVE_ROOT ?? resolve(home, ".codex", "archived_sessions"),
	}
}

/**
 * Discover source files while retaining explicit missing-root evidence.
 *
 * @param roots - Private roots to inspect
 * @returns Private file locators plus path-free availability states
 *
 * @example
 * ```ts
 * const { files, states } = await listSessionFiles(defaultSessionRoots())
 * ```
 */
export async function listSessionFiles(roots: SessionRoots): Promise<{
	files: SessionFile[]
	states: SourceScanState[]
}> {
	const groups: Array<{
		source: SessionSource
		location: SourceScanState["location"]
		root: string
	}> = [
		{ source: "claude", location: "active", root: roots.claude },
		{ source: "codex", location: "active", root: roots.codexActive },
		{ source: "codex", location: "archive", root: roots.codexArchived },
	]
	const files: SessionFile[] = []
	const states: SourceScanState[] = []
	for (const group of groups) {
		const found = await listJsonl(group.root)
		states.push({
			source: group.source,
			location: group.location,
			state: existsSync(group.root) ? "available" : "missing",
			files: found.paths.length,
			unreadable_directories: found.unreadableDirectories,
		})
		for (const path of found.paths) files.push({ source: group.source, path })
	}
	return { files, states }
}
