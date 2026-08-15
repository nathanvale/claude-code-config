import type { GmailIdentity } from "./config";
import type { GogSearchResponse, GogSearchThread } from "./model";

const DEFAULT_GOG_TIMEOUT_MS = 30_000;

/** Runtime error safe to show without forwarding private subprocess output. */
export class GogAuditError extends Error {}

interface GogSearchRuntime {
	executable?: string;
	timeoutMs?: number;
}

/**
 * Build the only external command allowed by the prototype.
 *
 * @param identity - Exact account and client from `.productivity.yml`
 * @param query - Caller-supplied bounded Gmail query
 * @param max - Explicit result cap
 * @returns Shell-free argv beginning with the `gog` executable
 *
 * @example
 * ```typescript
 * const argv = buildGogSearchArgv({ account: "me@example.test", client: "personal" }, "newer_than:7d", 20)
 * ```
 */
function buildGogSearchArgv(identity: GmailIdentity, query: string, max: number, executable = "gog"): string[] {
	return [
		executable,
		"--account",
		identity.account,
		"--client",
		identity.client,
		"--enable-commands-exact",
		"gmail.search",
		"--readonly",
		"--gmail-no-send",
		"--no-input",
		"--wrap-untrusted",
		"--json",
		"gmail",
		"search",
		query,
		"--max",
		String(max),
	];
}

/**
 * Run the allowlisted Gmail metadata search and discard unknown response data.
 *
 * @param identity - Exact config-derived Google identity
 * @param query - Validated bounded Gmail query
 * @param max - Validated result cap
 * @returns Narrow metadata-only response used by classification
 * @throws {GogAuditError} When gog fails or returns an unexpected shape
 *
 * @example
 * ```typescript
 * const response = await runGogSearch(identity, "newer_than:7d", 20)
 * ```
 */
export async function runGogSearch(
	identity: GmailIdentity,
	query: string,
	max: number,
	runtime: GogSearchRuntime = {},
): Promise<GogSearchResponse> {
	const timeoutMs = runtime.timeoutMs ?? DEFAULT_GOG_TIMEOUT_MS;
	const stdout = await runGogProcess(buildGogSearchArgv(identity, query, max, runtime.executable), timeoutMs);
	const response = normalizeSearchResponse(parseGogJson(stdout));
	if (response.threads.length > max) {
		throw new GogAuditError("gog Gmail search exceeded the requested result cap");
	}
	return response;
}

async function runGogProcess(argv: string[], timeoutMs: number): Promise<string> {
	const child = Bun.spawn(argv, {
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timeout = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, timeoutMs);
	let stdout: string;
	let exitCode: number;
	try {
		[stdout, , exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
	} finally {
		clearTimeout(timeout);
	}
	if (timedOut) throw new GogAuditError(`gog Gmail search timed out after ${timeoutMs}ms`);
	if (exitCode !== 0) throw new GogAuditError(`gog Gmail search failed with exit ${exitCode}`);
	return stdout;
}

function parseGogJson(stdout: string): unknown {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		throw new GogAuditError("gog Gmail search did not return valid JSON");
	}
	return parsed;
}

function normalizeSearchResponse(value: unknown): GogSearchResponse {
	if (!isRecord(value) || !Array.isArray(value.threads)) {
		throw new GogAuditError("gog Gmail search JSON is missing a threads array");
	}
	const threads = value.threads.map(normalizeThread);
	const nextPageToken = typeof value.nextPageToken === "string" && value.nextPageToken !== "" ? value.nextPageToken : undefined;
	return nextPageToken ? { threads, nextPageToken } : { threads };
}

function normalizeThread(value: unknown): GogSearchThread {
	if (!isRecord(value)) throw new GogAuditError("gog Gmail search returned an invalid thread row");
	return {
		id: requireString(value.id),
		from: requireString(value.from),
		subject: requireString(value.subject),
		date: requireString(value.date),
		labels: requireStringArray(value.labels),
		messageCount: requireNumber(value.messageCount),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown): string {
	if (typeof value !== "string") throw new GogAuditError("gog Gmail search returned an invalid thread row");
	return value;
}

function requireStringArray(value: unknown): string[] {
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
		throw new GogAuditError("gog Gmail search returned an invalid thread row");
	}
	return value;
}

function requireNumber(value: unknown): number {
	if (typeof value !== "number") throw new GogAuditError("gog Gmail search returned an invalid thread row");
	return value;
}
