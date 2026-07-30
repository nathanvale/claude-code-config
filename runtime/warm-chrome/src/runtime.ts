import Database from "bun:sqlite";
import { request } from "node:http";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	open,
	readlink,
	realpath,
	stat,
	writeFile,
} from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import { basename, dirname, join } from "node:path";

import {
	WARM_CHROME_BROWSER_ENTRY_EXIT_CODE,
	type WarmChromeRuntimeActionId,
} from "./model.ts";
import type { WarmChromeEffectiveCredentialPosture } from "./effective-posture.ts";

/**
 * Numeric browser-entry exit code (plan U2 R3).
 *
 * @defaultValue 20
 */
export const WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER = Number(
	WARM_CHROME_BROWSER_ENTRY_EXIT_CODE,
);

/**
 * Backstop abort for the default fetchJson.
 *
 * Deliberately ABOVE proof.ts's `WARM_CHROME_ATTACH_TIMEOUT_MS` (3000ms) so the
 * proof chain's own attach-budget sentinel decides a hang, not this fetch. A
 * value at or below the attach budget makes a hang reject here first and
 * classify as `no_listener` — the one reason that licenses a launch spawn.
 * Pinned by an ordering assertion in the runtime tests.
 *
 * @defaultValue 5000
 */
export const DEFAULT_FETCH_ABORT_MS = 5000;

/**
 * Backstop for system identity probes.
 *
 * lsof/ps are part of the browser-entry proof chain; a blocked probe is a
 * verdict, not permission to wait forever.
 *
 * @defaultValue 3000
 */
export const DEFAULT_SYSTEM_PROBE_TIMEOUT_MS = 3000;

/**
 * The one binary the real-Chrome identity check accepts (plan R6 vocabulary).
 */
export const REAL_GOOGLE_CHROME_BINARY =
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" as const;

// The real Google Chrome app-bundle tail, anchored at end of string. macOS's
// hardened runtime maps Chrome's executable as a code-sign clone under a
// private per-launch dir, so `lsof -d txt` reports a path like
// `/private/.../code_sign_clone.../Google Chrome.app.bundle/Contents/MacOS/Google Chrome`
// rather than `/Applications/...` — but the app-bundle tail is preserved
// verbatim inside the clone. Matching the tail recognizes the real binary
// through both the canonical and clone paths (issue #252) while the end anchor
// still rejects the `Google Chrome Helper` superstring, `Chromium`, and
// `Google Chrome for Testing` (whose `.app` name differs).
const REAL_GOOGLE_CHROME_BINARY_TAIL =
	/Google Chrome\.app(?:\.bundle)?\/Contents\/MacOS\/Google Chrome$/;

/**
 * True when the observed listener executable is the real Google Chrome app
 * binary, recognized by its app-bundle tail so the macOS code-sign clone path
 * is accepted alongside the canonical `/Applications` path (issue #252).
 *
 * Identity only: callers that decide which binary to *launch* keep matching
 * `REAL_GOOGLE_CHROME_BINARY` exactly — warm-chrome spawns the canonical
 * binary, never a clone path.
 */
export function isRealGoogleChromeBinary(path: string): boolean {
	return REAL_GOOGLE_CHROME_BINARY_TAIL.test(path);
}

/**
 * Failure domains the warm-chrome envelopes report (plan U4 R12).
 */
export type WarmChromeFailureDomain =
	| "browser_entry_handoff"
	| "input"
	| "runtime_diagnostics";

/**
 * Envelope-shaping options a thrown runtime error carries to the emitter.
 */
export type WarmChromeRuntimeErrorOptions = {
	exitCode?: number;
	recoverability?: "none" | "change_input" | "repair_state";
	hintSummary?: string;
	hintAction?: "change_input" | "repair_state";
	hintDocsUrl?: string;
	severity?: "warning" | "error" | "fatal";
	failureDomain?: WarmChromeFailureDomain;
	// Override the per-run primary runtime action when the error code alone is
	// ambiguous. `endpoint_unreachable` means "launch" when nothing answers but
	// "inspect" when a real Chrome already occupies the port without CDP.
		primaryActionId?: WarmChromeRuntimeActionId;
	/**
	 * Runtime actions appended after the primary. A post-spawn failure whose
	 * reason is a check-failure reason carries that check station's primary
	 * action here so the agent keeps a known-good repair action at the
	 * deepest point in the launch flow.
	 */
	secondaryActionIds?: readonly WarmChromeRuntimeActionId[];
	/**
	 * Structured payload for the error envelope `data` field. Listener detail
	 * must pass through {@link redactListenerDetail} before it lands here —
	 * the emitter trusts this payload as already redacted.
	 */
	data?: Record<string, unknown>;
};

/**
 * Runtime error every warm-chrome command handler throws (plan U4 R12).
 *
 * Defaults to the exit-20 browser-entry handoff; the CLI emitter maps it to a
 * structured error envelope with Runtime Continuation Guidance.
 */
export class WarmChromeRuntimeError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly options: WarmChromeRuntimeErrorOptions = {},
	) {
		super(message);
		this.name = "WarmChromeRuntimeError";
	}

	get exitCode(): number {
		return this.options.exitCode ?? WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER;
	}
}

/**
 * Local process listening on a CDP port, as observed by the system probe.
 */
export type ListenerProcess = {
	pid: number;
	command: string;
};

/**
 * Resolved profile directory identity used by the proof chain.
 */
export type ProfileStat = {
	realPath: string;
	mode: string;
	owner: string;
};

/**
 * Redacted credential-clean posture proof. Only bounded states cross this
 * seam; raw Preferences, account metadata, and Login Data rows stay inside
 * the Warm Chrome runtime owner.
 */
export type WarmChromeCredentialPosture = {
	disk: {
		saveSetting: "disabled" | "enabled" | "unproven";
		autoSignInSetting: "disabled" | "enabled" | "unproven";
		syncSetting: "disabled" | "enabled" | "unproven";
		storedLogin:
			| "absent"
			| "present"
			| "unproven"
			| "live-observed-absent";
	};
	process: {
		disableSyncSwitch: "present" | "absent" | "unproven";
		disableExtensionsSwitch: "present" | "absent" | "unproven";
	};
	effective: WarmChromeEffectiveCredentialPosture;
};

/**
 * Inputs needed to prove credential posture without exposing profile data.
 */
export type WarmChromeCredentialPostureInput = {
	/** Resolved active Chrome profile directory, for example `<root>/Default`. */
	activeProfileDir: string;
	/** True only when the observed Chrome process carries `--disable-sync`. */
	syncDisabledByLaunch: boolean;
	/** True only when the observed Chrome process carries `--disable-extensions`. */
	extensionsDisabledByLaunch: boolean;
};

/**
 * External human-continuation result for fresh profile creation.
 */
export type WarmChromeProfileCreationApproval =
	| { readonly decision: "approved" }
	| "cancelled"
	| "unavailable";

/**
 * Exact operation facts an external approval owner must bind before allowing
 * one fresh profile creation.
 */
export type WarmChromeProfileCreationApprovalRequest = {
	command: "launch" | "repair";
	port: string;
	profileDir: string;
};

/**
 * Trusted coordinator callback for one fresh profile-creation request.
 */
export type WarmChromeProfileCreationApprovalOwner = (
	request: WarmChromeProfileCreationApprovalRequest,
) => Promise<WarmChromeProfileCreationApproval>;

const pendingProfileCreationApprovals = new WeakMap<
	object,
	WarmChromeProfileCreationApprovalRequest
>();

/**
 * Build one process-local approval owner after a trusted coordinator observes
 * the human decision. Mismatched requests do not consume the capability; the
 * first exact request issues one opaque approval object.
 *
 * @param expected - Exact command, port, and canonical profile approved
 * @returns Single-use approval owner for the runtime seam
 */
export function createOneUseProfileCreationApprovalOwner(
	expected: WarmChromeProfileCreationApprovalRequest,
): WarmChromeProfileCreationApprovalOwner {
	let issued = false;
	return async (request) => {
		if (issued || !sameProfileCreationRequest(request, expected)) {
			return "unavailable";
		}
		issued = true;
		const approval = Object.freeze({ decision: "approved" as const });
		pendingProfileCreationApprovals.set(approval, { ...expected });
		return approval;
	};
}

/**
 * Consume one opaque approval for the exact request that minted it.
 *
 * @param approval - Result returned by the trusted approval owner
 * @param request - Current command, port, and profile facts
 * @returns True exactly once for a matching package-minted approval
 */
export function consumeProfileCreationApproval(
	approval: WarmChromeProfileCreationApproval,
	request: WarmChromeProfileCreationApprovalRequest,
): boolean {
	if (typeof approval !== "object" || approval === null) return false;
	const expected = pendingProfileCreationApprovals.get(approval);
	if (expected === undefined || !sameProfileCreationRequest(request, expected)) {
		return false;
	}
	pendingProfileCreationApprovals.delete(approval);
	return true;
}

function sameProfileCreationRequest(
	left: WarmChromeProfileCreationApprovalRequest,
	right: WarmChromeProfileCreationApprovalRequest,
): boolean {
	return (
		left.command === right.command &&
		left.port === right.port &&
		left.profileDir === right.profileDir
	);
}

/**
 * Handle for a Chrome the runtime spawned (plan U4 seam extension).
 */
export type SpawnedChrome = {
	pid: number;
	kill: () => Promise<boolean>;
};

/**
 * Parsed Chrome `SingletonLock` symlink content (`hostname-pid`), used by the
 * U6 launch pre-bind refusal.
 */
export type SingletonLock = {
	raw: string;
	hostname: string | null;
	pid: number | null;
	/**
	 * True only when the lock's hostname matches this machine, so `pid` names a
	 * process the local kernel can probe. A foreign-host lock (synced/NFS home
	 * shared across a fleet) carries a pid that is meaningless locally; callers
	 * must never feed it to `isProcessAlive`, which would alias it onto whatever
	 * local process happens to share that number. Mirrors Chrome's own
	 * ProcessSingleton, which compares the lock hostname before trusting the pid.
	 */
	local: boolean;
};

/**
 * Launch input the spawn seam receives.
 */
export type LaunchChromeInput = {
	chromeBin: string;
	port: string;
	profileDir: string;
	startupUrl: string;
	disableSync: true;
	disableExtensions: true;
};

/**
 * Injectable runtime seam every warm-chrome station drives through (plan U4).
 *
 * Ported from the browser-use preflight `PreflightRuntime` with two deliberate
 * extensions: `spawnChrome` returns a {@link SpawnedChrome} handle instead of
 * `Promise<void>`, and `readSingletonLock` probes the profile lock for the U6
 * launch pre-bind refusal.
 */
export type WarmChromeRuntime = {
	env: Record<string, string | undefined>;
	platform: NodeJS.Platform;
	now: () => number;
	fetchJson: (url: string) => Promise<unknown>;
	findListener: (port: string) => Promise<ListenerProcess | null>;
	currentUser: () => Promise<string>;
	statProfile: (path: string) => Promise<ProfileStat>;
	inspectCredentialPosture: (
		input: WarmChromeCredentialPostureInput,
	) => Promise<WarmChromeCredentialPosture>;
	initializeCredentialCleanProfile: (profileDir: string) => Promise<void>;
	requestCredentialCleanProfileCreationApproval: (
		request: WarmChromeProfileCreationApprovalRequest,
	) => Promise<WarmChromeProfileCreationApproval>;
	ensureProfileDir: (path: string) => Promise<string>;
	chmod: (path: string, mode: number) => Promise<void>;
	writeTextFile: (path: string, content: string) => Promise<void>;
		spawnChrome: (input: LaunchChromeInput) => Promise<SpawnedChrome>;
		readSingletonLock: (profileDir: string) => Promise<SingletonLock | null>;
		isProcessAlive: (pid: number) => Promise<boolean>;
		sleep: (ms: number) => Promise<void>;
		isTemporaryPath: (path: string) => boolean;
	};

/**
 * Build the default macOS runtime adapter.
 *
 * @param overrides - Seam hooks tests replace for deterministic execution
 * @returns Runtime seam bound to real system tools
 *
 * @example
 * ```typescript
 * const runtime = createDefaultRuntime({ now: () => 0 })
 * ```
 */
export function createDefaultRuntime(
	overrides: Partial<WarmChromeRuntime> = {},
): WarmChromeRuntime {
	const env = overrides.env ?? process.env;
	return {
		env,
		platform: process.platform,
		now: () => Date.now(),
			fetchJson: async (url: string) => fetchLoopbackJson(url),
		findListener: async (port: string) => findListenerWithSystemTools(port),
		currentUser: async () => String(userInfo().uid),
		statProfile: async (path: string) => statProfile(path),
		inspectCredentialPosture: async (input) =>
			inspectCredentialPosture(input),
		initializeCredentialCleanProfile: async (profileDir: string) =>
			initializeCredentialCleanProfile(profileDir, env),
		// The public CLI has no self-attested approval route. A trusted
		// coordinator may replace this process-local seam with one exact,
		// single-use human continuation.
		requestCredentialCleanProfileCreationApproval: async () => "unavailable",
		ensureProfileDir: async (path: string) => ensureProfileDir(path),
		chmod: async (path: string, mode: number) => {
			await chmod(path, mode);
		},
		writeTextFile: async (path: string, content: string) => {
			await writeFile(path, content, "utf-8");
		},
		spawnChrome: async (input: LaunchChromeInput) => {
			const child = spawn(
				input.chromeBin,
				chromeLaunchArgs(input),
				{ detached: true, stdio: "ignore" },
			);
			await awaitChromeSpawn(child);
			const pid = child.pid;
			if (typeof pid !== "number") {
				throw new Error("Chrome spawn reported no pid.");
			}
			return {
				pid,
				// The boolean means "the child is gone", not "a signal was sent":
				// the race policy lands already_verified only when the loser child
				// is actually dead, so a SIGTERM-ignoring Chrome must be escalated
				// to SIGKILL rather than reported as terminated.
				kill: () => terminateChild(child),
			};
		},
			readSingletonLock: async (profileDir: string) =>
				readSingletonLock(profileDir),
			isProcessAlive: async (pid: number) => isProcessAlive(pid),
			sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
		isTemporaryPath: (path: string) =>
			path.startsWith("/tmp/") ||
			path.startsWith("/private/tmp/") ||
			path.startsWith("/var/folders/") ||
			path.startsWith("/private/var/folders/"),
		...overrides,
	};
}

/**
 * Exact Chrome argv for the dedicated profile launch.
 */
export function chromeLaunchArgs(input: LaunchChromeInput): string[] {
	return [
		`--remote-debugging-port=${input.port}`,
		`--user-data-dir=${input.profileDir}`,
		"--profile-directory=Default",
		"--no-first-run",
		"--no-default-browser-check",
		...(input.disableSync ? ["--disable-sync"] : []),
		...(input.disableExtensions ? ["--disable-extensions"] : []),
		input.startupUrl,
	];
}

/**
 * Expand a leading `~` against the runtime env HOME.
 */
export function expandHome(
	path: string,
	env: Record<string, string | undefined>,
): string {
	if (path === "~" || path.startsWith("~/")) {
		const home = env.HOME;
		if (!home) {
			throw new WarmChromeRuntimeError(
				"invalid_usage",
				"HOME is required to expand a ~ profile or binary path.",
				{
					exitCode: 2,
					failureDomain: "input",
					recoverability: "change_input",
					hintAction: "change_input",
					hintSummary: "Set HOME or pass an absolute path.",
				},
			);
		}
		if (path === "~") return home;
		return `${home}/${path.slice(2)}`;
	}
	return path;
}

/**
 * Detect the everyday Chrome profile path.
 *
 * With HOME present this is exact. With HOME absent, fail closed for explicit
 * absolute Chrome profile paths instead of disabling the guard.
 */
export function isDefaultChromeProfilePath(
	path: string,
	env: Record<string, string | undefined>,
): boolean {
	// Strip trailing slashes: a HOME like "/Users/x/" would otherwise build a
	// "//Library/..." root that never matches the real "/Users/x/Library/..."
	// path, silently failing the guard open on a default-profile path.
	const home = env.HOME?.replace(/\/+$/, "");
	if (home) {
		const root = `${home}/Library/Application Support/Google/Chrome`;
		return path === root || path.startsWith(`${root}/`);
	}
	return /\/Library\/Application Support\/Google\/Chrome(?:\/|$)/.test(path);
}

async function statProfile(path: string): Promise<ProfileStat> {
	const realPath = await realpath(path);
	const info = await stat(realPath);
	if (!info.isDirectory()) {
		throw new Error("profile is not a directory");
	}
	return {
		realPath,
		mode: (info.mode & 0o777).toString(8),
		owner: String(info.uid),
	};
}

async function ensureProfileDir(path: string): Promise<string> {
	await assertNoProfileSymlinkComponents(path);
	await mkdir(path, { recursive: true, mode: 0o700 });
	const realPath = await realpath(path);
	await chmod(realPath, 0o700);
	return realPath;
}

const MAX_CHROME_PREFERENCES_BYTES = 8 * 1024 * 1024;

type ChromeCredentialPreferences = {
	credentials_enable_service?: unknown;
	credentials_enable_autosignin?: unknown;
	profile?: { password_manager_enabled?: unknown };
	sync?: {
		requested?: unknown;
		has_setup_completed?: unknown;
	};
};

async function inspectCredentialPosture(
	input: WarmChromeCredentialPostureInput,
): Promise<WarmChromeCredentialPosture> {
	const preferences = await readChromeCredentialPreferences(
		join(input.activeProfileDir, "Preferences"),
	);
	const storedLogin = aggregateSavedCredentialStates(
		await Promise.all([
			inspectSavedCredentials(join(input.activeProfileDir, "Login Data")),
			inspectSavedCredentials(
				join(input.activeProfileDir, "Login Data For Account"),
			),
		]),
	);

	const legacySavingEnabled = preferences?.profile?.password_manager_enabled;
	const savingValue = preferences?.credentials_enable_service;
	const saveSetting =
		savingValue === false && legacySavingEnabled !== true
			? "disabled"
			: savingValue === true || legacySavingEnabled === true
				? "enabled"
				: "unproven";

	const autoSignInValue = preferences?.credentials_enable_autosignin;
	const autoSignInSetting =
		autoSignInValue === false
			? "disabled"
			: autoSignInValue === true
				? "enabled"
				: "unproven";
	const syncSetting =
		preferences?.sync?.requested === true ||
		preferences?.sync?.has_setup_completed === true
			? "enabled"
			: preferences?.sync?.requested === false &&
					preferences?.sync?.has_setup_completed === false
				? "disabled"
				: "unproven";
	const disableSyncSwitch = input.syncDisabledByLaunch ? "present" : "absent";
	const disableExtensionsSwitch = input.extensionsDisabledByLaunch
		? "present"
		: "absent";

	return {
		disk: {
			saveSetting,
			autoSignInSetting,
			syncSetting,
			storedLogin,
		},
		process: {
			disableSyncSwitch,
			disableExtensionsSwitch,
		},
		// Disk preferences and argv prove configuration only. Effective
		// running-Chrome behavior needs a separate observer at the live gate.
		effective: {
			observation: "not-observed",
		},
	};
}

async function readChromeCredentialPreferences(
	path: string,
): Promise<ChromeCredentialPreferences | null> {
	let handle: Awaited<ReturnType<typeof open>> | undefined;
	try {
		handle = await open(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
		const before = await handle.stat();
		const pathBefore = await lstat(path);
		const parentBefore = await lstat(dirname(path));
		if (
			!before.isFile() ||
			before.nlink !== 1 ||
			before.size > MAX_CHROME_PREFERENCES_BYTES ||
			!pathBefore.isFile() ||
			pathBefore.isSymbolicLink() ||
			pathBefore.nlink !== 1 ||
			pathBefore.dev !== before.dev ||
			pathBefore.ino !== before.ino ||
			!parentBefore.isDirectory() ||
			parentBefore.isSymbolicLink()
		) {
			return null;
		}
		const text = await readBoundedUtf8(
			handle,
			MAX_CHROME_PREFERENCES_BYTES,
		);
		if (text === null) return null;
		const after = await handle.stat();
		const pathAfter = await lstat(path);
		const parentAfter = await lstat(dirname(path));
		if (
			!after.isFile() ||
			after.nlink !== 1 ||
			after.size !== Buffer.byteLength(text) ||
			after.size > MAX_CHROME_PREFERENCES_BYTES ||
			after.mtimeMs !== before.mtimeMs ||
			after.ctimeMs !== before.ctimeMs ||
			!pathAfter.isFile() ||
			pathAfter.isSymbolicLink() ||
			pathAfter.nlink !== 1 ||
			pathAfter.dev !== after.dev ||
			pathAfter.ino !== after.ino ||
			!sameDirectorySnapshot(parentBefore, parentAfter)
		) {
			return null;
		}
		const parsed: unknown = JSON.parse(text);
		return isPlainRecord(parsed)
			? (parsed as ChromeCredentialPreferences)
			: null;
	} catch {
		return null;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

async function readBoundedUtf8(
	handle: Awaited<ReturnType<typeof open>>,
	maxBytes: number,
): Promise<string | null> {
	const chunks: Buffer[] = [];
	let total = 0;
	while (total <= maxBytes) {
		const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - total));
		const { bytesRead } = await handle.read(
			chunk,
			0,
			chunk.length,
			total,
		);
		if (bytesRead === 0) break;
		chunks.push(chunk.subarray(0, bytesRead));
		total += bytesRead;
	}
	if (total > maxBytes) return null;
	return Buffer.concat(chunks, total).toString("utf8");
}

async function inspectSavedCredentials(
	path: string,
): Promise<WarmChromeCredentialPosture["disk"]["storedLogin"]> {
	let before: Awaited<ReturnType<typeof lstat>>;
	try {
		before = await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return "absent";
		return "unproven";
	}
	if (!before.isFile() || before.isSymbolicLink()) return "unproven";
	if (before.nlink !== 1) return "unproven";

	try {
		const parentBefore = await lstat(dirname(path));
		if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) {
			return "unproven";
		}
		const db = new Database(path, { readonly: true, strict: true });
		let state: WarmChromeCredentialPosture["disk"]["storedLogin"];
		try {
			const row = db
				.query<{ present: number }, []>(
					"SELECT 1 AS present FROM logins LIMIT 1",
				)
				.get();
			state = row === null ? "absent" : "present";
		} finally {
			db.close();
		}
		const after = await lstat(path);
		const parentAfter = await lstat(dirname(path));
		if (
			!after.isFile() ||
			after.isSymbolicLink() ||
			after.nlink !== 1 ||
			!sameFileSnapshot(before, after) ||
			!sameDirectorySnapshot(parentBefore, parentAfter)
		) {
			return "unproven";
		}
		return state;
	} catch {
		return "unproven";
	}
}

function sameFileSnapshot(
	before: Awaited<ReturnType<typeof lstat>>,
	after: Awaited<ReturnType<typeof lstat>>,
): boolean {
	return (
		after.dev === before.dev &&
		after.ino === before.ino &&
		after.size === before.size &&
		after.mtimeMs === before.mtimeMs &&
		after.ctimeMs === before.ctimeMs
	);
}

function sameDirectorySnapshot(
	before: Awaited<ReturnType<typeof lstat>>,
	after: Awaited<ReturnType<typeof lstat>>,
): boolean {
	return (
		after.isDirectory() &&
		!after.isSymbolicLink() &&
		after.dev === before.dev &&
		after.ino === before.ino &&
		after.mtimeMs === before.mtimeMs &&
		after.ctimeMs === before.ctimeMs
	);
}

function aggregateSavedCredentialStates(
	states: WarmChromeCredentialPosture["disk"]["storedLogin"][],
): WarmChromeCredentialPosture["disk"]["storedLogin"] {
	if (states.includes("present")) return "present";
	if (states.includes("unproven")) return "unproven";
	return "absent";
}

async function initializeCredentialCleanProfile(
	profileDir: string,
	env: Record<string, string | undefined>,
): Promise<void> {
	if (isDefaultChromeProfilePath(profileDir, env)) {
		throw new Error("refusing to initialize the everyday Chrome profile");
	}
	await assertNoProfileSymlinkComponents(dirname(profileDir));
	await mkdir(profileDir, { mode: 0o700 });
	const resolvedProfileDir = await realpath(profileDir);
	if (isDefaultChromeProfilePath(resolvedProfileDir, env)) {
		throw new Error("refusing to initialize the everyday Chrome profile");
	}
	await chmod(resolvedProfileDir, 0o700);
	const activeProfileDir = await ensureProfileDir(
		join(resolvedProfileDir, "Default"),
	);
	const preferencesPath = join(activeProfileDir, "Preferences");
	const preferences = JSON.stringify(
		{
			credentials_enable_autosignin: false,
			credentials_enable_service: false,
			profile: { password_manager_enabled: false },
			signin: { allowed: false },
			sync: { has_setup_completed: false, requested: false },
		},
		null,
		2,
	);
	const handle = await open(
		preferencesPath,
		fsConstants.O_WRONLY |
			fsConstants.O_CREAT |
			fsConstants.O_EXCL |
			fsConstants.O_NOFOLLOW,
		0o600,
	);
	try {
		const opened = await handle.stat();
		if (!opened.isFile() || opened.nlink !== 1) {
			throw new Error("Preferences is not a private regular file");
		}
		await handle.writeFile(`${preferences}\n`, "utf8");
		await handle.sync();
		const finalHandle = await handle.stat();
		const finalPath = await lstat(preferencesPath);
		if (
			!finalHandle.isFile() ||
			finalHandle.nlink !== 1 ||
			!finalPath.isFile() ||
			finalPath.isSymbolicLink() ||
			finalPath.dev !== finalHandle.dev ||
			finalPath.ino !== finalHandle.ino
		) {
			throw new Error("Preferences path changed during initialization");
		}
	} finally {
		await handle.close();
	}
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function assertNoProfileSymlinkComponents(path: string): Promise<void> {
	for (const component of profilePathComponents(path)) {
		let info: Awaited<ReturnType<typeof lstat>>;
		try {
			info = await lstat(component);
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code === "ENOENT") continue;
			throw error;
		}
		if (info.isSymbolicLink()) {
			throw new Error("profile path contains a symbolic-link component");
		}
		if (!info.isDirectory()) {
			throw new Error("profile path component is not a directory");
		}
	}
}

function profilePathComponents(path: string): string[] {
	const components: string[] = [];
	let current = path;
	for (;;) {
		components.push(current);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return components.reverse();
}

async function readSingletonLock(
	profileDir: string,
): Promise<SingletonLock | null> {
	let raw: string;
	try {
		raw = await readlink(`${profileDir}/SingletonLock`);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code;
		if (code === "ENOENT") return null;
		throw new WarmChromeRuntimeError(
			"listener_uninspectable",
			"Could not inspect the profile SingletonLock.",
		);
	}
	if (raw.trim() === "") {
		return null;
	}
	const separator = raw.lastIndexOf("-");
	if (separator <= 0 || separator === raw.length - 1) {
		return { raw, hostname: null, pid: null, local: false };
	}
	const pidText = raw.slice(separator + 1);
	const pid = /^[0-9]+$/.test(pidText) ? Number(pidText) : null;
	const lockHostname = raw.slice(0, separator);
	return {
		raw,
		hostname: lockHostname,
		pid,
		local: lockHostname === hostname(),
	};
}

// Minimal slice of ChildProcess we depend on, so a plain EventEmitter can drive
// the lifecycle under test without spawning a real process.
type SpawnableChild = {
	once(event: string, listener: (...args: unknown[]) => void): unknown;
	unref?(): void;
};

// The slice terminateChild drives. `exitCode` is non-null once the process has
// exited; `kill` returns false when signal delivery fails (ESRCH: already gone).
export type KillableChild = SpawnableChild & {
	kill(signal?: NodeJS.Signals): boolean;
	readonly exitCode: number | null;
	readonly signalCode?: NodeJS.Signals | null;
};

// Grace window for a SIGTERM before escalating to SIGKILL.
export const TERMINATE_GRACE_MS = 2000;

// Resolve true only once the child is confirmed gone. SIGTERM first (let Chrome
// close cleanly), then SIGKILL if it outlives the grace window. A kill() that
// returns false means ESRCH — the pid is already gone, which is success.
export async function terminateChild(
	child: KillableChild,
	graceMs: number = TERMINATE_GRACE_MS,
): Promise<boolean> {
	if (isChildGone(child)) return true;
	const exited = new Promise<void>((resolve) => {
		child.once("exit", () => resolve());
	});
	if (!child.kill("SIGTERM")) {
		return isChildGone(child);
	}
	if (await raceExit(exited, graceMs)) return true;
	// SIGTERM ignored: escalate. A false here is ESRCH (it exited in the gap).
	child.kill("SIGKILL");
	if (await raceExit(exited, graceMs)) return true;
	return isChildGone(child);
}

function isChildGone(child: KillableChild): boolean {
	return child.exitCode !== null || child.signalCode != null;
}

// Resolve true if `exited` settles within the grace window, false on timeout.
function raceExit(exited: Promise<void>, graceMs: number): Promise<boolean> {
	return Promise.race([
		exited.then(() => true),
		new Promise<boolean>((resolve) => {
			setTimeout(() => resolve(false), graceMs).unref?.();
		}),
	]);
}

// `child.once("error")` only fires for spawn *failure* (ENOENT, EACCES). A Chrome
// that spawns then dies milliseconds later emits "exit", not "error" — without an
// exit listener that death is silent and the caller polls a dead endpoint for the
// full timeout. Reject on a pre-spawn exit so post-launch death surfaces now.
export function awaitChromeSpawn(child: SpawnableChild): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let settled = false;
		child.once("error", (...args: unknown[]) => {
			if (settled) return;
			settled = true;
			reject(
				args[0] instanceof Error ? args[0] : new Error("Chrome spawn failed."),
			);
		});
		child.once("exit", (...args: unknown[]) => {
			if (settled) return;
			settled = true;
			const code = args[0];
			reject(
				new Error(
					`Chrome exited before its DevTools endpoint came up (exit code ${
						typeof code === "number" ? code : "unknown"
					}).`,
				),
			);
		});
		child.once("spawn", () => {
			if (settled) return;
			settled = true;
			child.unref?.();
			resolve();
		});
	});
}

type ExecText = (command: string, args: string[]) => Promise<string>;

// An lsof/ps that cannot even run (binary missing, permission denied) is an
// environmental fault, not the operational "nothing is listening" answer.
// Collapsing both into null would let a missing lsof masquerade as a free port
// and poison every downstream decision, so probe failures branch on err.code.
function isProbeUnavailableError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException)?.code;
	return code === "ENOENT" || code === "EACCES" || code === "EPERM";
}

/**
 * Default listener probe: lsof for the pid, ps for the command line.
 */
export async function findListenerWithSystemTools(
	port: string,
	exec: ExecText = execText,
): Promise<ListenerProcess | null> {
	let pidOutput = "";
	try {
		pidOutput = await exec("lsof", [
			"-nP",
			"-a",
			`-iTCP@127.0.0.1:${port}`,
			"-sTCP:LISTEN",
			"-t",
		]);
	} catch (error) {
		// lsof exits non-zero with no error code when nothing is listening — the
		// expected negative result. A real ENOENT/EACCES means we never inspected.
		if (isExpectedNoListenerLsofError(error)) return null;
		if (isProbeUnavailableError(error) || error instanceof ExecTextError) {
			throw new WarmChromeRuntimeError(
				"listener_uninspectable",
				"Could not run the CDP listener probe.",
			);
		}
		throw error;
	}
	const pidTexts = [
		...new Set(
			pidOutput
			.split("\n")
			.map((line) => line.trim())
				.filter(Boolean),
		),
	];
	if (pidTexts.length === 0) return null;
	if (pidTexts.length > 1) {
		throw new WarmChromeRuntimeError(
			"listener_uninspectable",
			"More than one process is listening on the CDP loopback port.",
		);
	}
	const [pidText] = pidTexts;
	const executable = await readProcessExecutable(pidText, exec);
	let argvCommand = "";
	try {
		argvCommand = await exec("ps", ["-p", pidText, "-o", "command="]);
	} catch {
		throw new WarmChromeRuntimeError(
			"listener_uninspectable",
			"Could not inspect the CDP listener process.",
		);
	}
	const argvArgs = parseProcessCommand(argvCommand.trim()).args;
	return {
		pid: Number(pidText),
		command: argvArgs === "" ? executable : `${executable} ${argvArgs}`,
	};
}

async function execText(command: string, args: string[]): Promise<string> {
	const proc = Bun.spawn([command, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill("SIGKILL");
	}, DEFAULT_SYSTEM_PROBE_TIMEOUT_MS);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]).finally(() => clearTimeout(timer));
	if (timedOut) {
		throw new ExecTextError(`${command} timed out`, {
			stdout,
			stderr,
			timedOut,
		});
	}
	if (exitCode !== 0) {
		throw new ExecTextError(stderr || `${command} exited ${exitCode}`, {
			exitCode,
			stdout,
			stderr,
		});
	}
	return stdout;
}

class ExecTextError extends Error {
	readonly exitCode?: number;
	readonly stdout: string;
	readonly stderr: string;
	readonly timedOut: boolean;

	constructor(
		message: string,
		options: {
			exitCode?: number;
			stdout?: string;
			stderr?: string;
			timedOut?: boolean;
		} = {},
	) {
		super(message);
		this.name = "ExecTextError";
		this.exitCode = options.exitCode;
		this.stdout = options.stdout ?? "";
		this.stderr = options.stderr ?? "";
		this.timedOut = options.timedOut ?? false;
	}
}

function isExpectedNoListenerLsofError(error: unknown): boolean {
	return (
		error instanceof ExecTextError &&
		!error.timedOut &&
		error.exitCode === 1 &&
		error.stdout.trim() === "" &&
		error.stderr.trim() === ""
	);
}

async function readProcessExecutable(
	pidText: string,
	exec: ExecText,
): Promise<string> {
	let output = "";
	try {
		output = await exec("lsof", ["-nP", "-a", "-p", pidText, "-d", "txt", "-Fn"]);
	} catch {
		throw new WarmChromeRuntimeError(
			"listener_uninspectable",
			"Could not inspect the CDP listener executable.",
		);
	}
	const executable = output
		.split("\n")
		.map((line) => line.trim())
		.find((line) => line.startsWith("n/"))
		?.slice(1);
	if (!executable) {
		throw new WarmChromeRuntimeError(
			"listener_uninspectable",
			"Could not resolve the CDP listener executable path.",
		);
	}
	return executable;
}

function fetchLoopbackJson(url: string): Promise<unknown> {
	const parsed = new URL(url);
	return new Promise((resolve, reject) => {
		// Single-fire settle. Every terminal event — success `end`, stream/request
		// `error`, socket `close`, and the wall-clock `timeout` — routes through
		// here, and only the first wins. This is the invariant the prior two
		// implementations kept breaking: under Bun, `req.destroy(error)` on a
		// connected-but-silent request emits `close`, NOT `error`, so a deadline
		// abort with no `close` handler never rejected and `repair` hung forever.
		// Single-fire alone does NOT stop a post-destroy `end` from resolving a
		// truncated body as success — that flushed `end` is the FIRST event, so
		// it wins the settle; the completeness guard on the `end` handler below
		// owns that case.
		let settled = false;
		const settle = (finish: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(deadline);
			finish();
		};
		// Hard wall-clock cap, ARMED ONLY AFTER request() RETURNS (below). The
		// request `timeout` option is idle-only: a peer dribbling bytes under
		// the threshold never trips it. Because settle is single-fire, the
		// `close` that `req.destroy` emits converts this into a guaranteed
		// rejection even when no `error` event follows. Arming before request()
		// left a live timer when request() threw synchronously (non-http:
		// protocol): the promise had already rejected, and 5s later the callback
		// touched `req` in its temporal dead zone — an uncaught ReferenceError
		// that crashed the process (live-reproduced).
		let deadline: ReturnType<typeof setTimeout> | undefined;
		let timedOut = false;
		const rejectClosed = () =>
			settle(() =>
				reject(
					timedOut
						? Object.assign(new Error("request timed out"), {
								name: "TimeoutError",
							})
						: new Error("request socket closed before response"),
				),
			);
		// Settle from RESPONSE-LIFECYCLE state, never from event timing. Bun's
		// order for any request — healthy or not — is: request `close` FIRST,
		// then (if a response arrived) response `end`/`close`. Earlier attempts to
		// let `end` win a timing race against the request `close` (sync reject,
		// then microtask defer) all rejected healthy multi-chunk bodies, because
		// `end` lands a full macrotask after the request `close`. So the request
		// `close` must NOT reject while a response is in flight: if a response was
		// received, its own `end` (success) or `close`-with-`complete:false`
		// (truncation) settles; the request `close` only rejects when NO response
		// ever arrived — the connected-but-silent hang the deadline aborts.
		let responseSeen = false;
		const req = request(
			{
				protocol: parsed.protocol,
				hostname: parsed.hostname,
				port: parsed.port,
				path: `${parsed.pathname}${parsed.search}`,
				method: "GET",
				agent: false,
			},
			(response) => {
				responseSeen = true;
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => {
					body += chunk;
				});
				response.on("error", (error) => settle(() => reject(error)));
				response.on("end", () => {
					// A response that stalls after headers never ends on its own; the
					// deadline's `req.destroy` tears the socket, and Bun flushes the
					// buffered partial body as this `end` with `complete` still false.
					// Trusting that flush would let a truncated-but-parseable body
					// masquerade as a healthy answer, so resolution requires message
					// completeness — response state, not event order. `rejectClosed`
					// names the deadline (TimeoutError) when it fired, the truncated
					// read otherwise.
					if (!response.complete) {
						rejectClosed();
						return;
					}
					settle(() => {
						const status = response.statusCode ?? 0;
						if (status < 200 || status >= 300) {
							reject(new Error(`request failed: ${status}`));
							return;
						}
						try {
							resolve(JSON.parse(body));
						} catch (error) {
							reject(error);
						}
					});
				});
				// A socket reset after headers but before the full body closes the
				// response without `end`; `complete` stays false. Reject that as a
				// truncated read rather than leaving the promise pending.
				response.on("close", () => {
					if (!response.complete) rejectClosed();
				});
			},
		);
		req.on("error", (error) => settle(() => reject(error)));
		// Only reaches a reject when no response was ever delivered (the Bun
		// destroy-emits-close silent-hang case). A delivered response owns its own
		// settlement above, so this is a no-op once `responseSeen` is true.
		req.on("close", () => {
			if (!responseSeen) rejectClosed();
		});
		// Arm the deadline only now that `req` exists: if request() threw
		// synchronously above the promise already rejected and no timer leaked.
		deadline = setTimeout(() => {
			const error = new Error("request timed out");
			error.name = "TimeoutError";
			timedOut = true;
			req.destroy(error);
		}, DEFAULT_FETCH_ABORT_MS);
		req.end();
	});
}

function isProcessAlive(pid: number): boolean {
	// `process.kill(pid, 0)` with pid <= 0 does not probe a single process:
	// 0 signals the caller's own process group (always "alive"), and negatives
	// signal a group. A SingletonLock pid is always a real positive pid, so any
	// value <= 0 is malformed and must not be reported alive.
	if (pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		const code = (error as NodeJS.ErrnoException)?.code;
		return code === "EPERM";
	}
}

/**
 * Parse a `ps -o command=` line into executable and argument text.
 */
export function parseProcessCommand(command: string): {
	executable: string;
	args: string;
} {
	const trimmed = command.trim();
	// Fast-path only on an exact match, or when the Chrome path is followed by
	// flag arguments (whitespace then a "--" token). Without this, a superstring
	// executable like `.../Google Chrome Helper` starts with the real binary and
	// would be pinned to it, certifying a non-stable binary as real Chrome. A
	// trailing bare word (`Helper`) means a different executable, so fall through
	// to the generic parse where the identity check fires.
	if (trimmed === REAL_GOOGLE_CHROME_BINARY) {
		return { executable: REAL_GOOGLE_CHROME_BINARY, args: "" };
	}
	if (trimmed.startsWith(REAL_GOOGLE_CHROME_BINARY)) {
		const rest = trimmed.slice(REAL_GOOGLE_CHROME_BINARY.length);
		if (/^\s+--/.test(rest)) {
			return { executable: REAL_GOOGLE_CHROME_BINARY, args: rest.trim() };
		}
	}
	const quoted = parseQuotedCommandExecutable(trimmed);
	if (quoted) return quoted;
	const firstOptionIndex = trimmed.search(/\s--/);
	if (firstOptionIndex >= 0) {
		return {
			executable: trimmed.slice(0, firstOptionIndex).trim(),
			args: trimmed.slice(firstOptionIndex).trim(),
		};
	}
	const [firstToken = ""] = tokenizeCommandArgs(trimmed);
	return {
		executable: firstToken,
		args: trimmed.slice(firstToken.length).trim(),
	};
}

function parseQuotedCommandExecutable(
	command: string,
): { executable: string; args: string } | null {
	const quote = command[0];
	if (quote !== '"' && quote !== "'") return null;
	let executable = "";
	for (let index = 1; index < command.length; index += 1) {
		const char = command[index];
		if (char === quote) {
			return {
				executable,
				args: command.slice(index + 1).trim(),
			};
		}
		executable += char;
	}
	return null;
}

/**
 * Tokenize argument text with shell-style quoting and escapes.
 */
export function tokenizeCommandArgs(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	let escaping = false;
	const pushCurrent = () => {
		if (current !== "") {
			tokens.push(current);
			current = "";
		}
	};

	for (const char of input) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (/\s/.test(char)) {
			pushCurrent();
			continue;
		}
		current += char;
	}
	if (escaping) current += "\\";
	pushCurrent();
	return tokens;
}

/**
 * Read the last non-empty value of a repeated `--flag` in argument text
 * (Chrome resolves repeated switches last-wins).
 */
export function readCommandFlagValue(args: string, flag: string): string | null {
	let searchFrom = 0;
	let resolved: string | null = null;
	while (searchFrom < args.length) {
		const flagIndex = args.indexOf(flag, searchFrom);
		if (flagIndex === -1) break;
		const before = args[flagIndex - 1];
		const after = args[flagIndex + flag.length];
		const startsToken = flagIndex === 0 || /\s/.test(before);
		if (startsToken && (after === "=" || (after && /\s/.test(after)))) {
			if (after === "=") {
				// Equals form: the bytes after = are the value verbatim, even if
				// they begin with "--" (a profile path may legitimately do so).
				const value = readCommandValue(args, flagIndex + flag.length + 1);
				if (value !== "") resolved = value;
			} else {
				// Space-separated form: if the next token is itself a "--" flag,
				// the flag had no value (e.g. `--user-data-dir --no-first-run`).
				// Do not consume the following flag as the value.
				const valueStart = skipWhitespace(args, flagIndex + flag.length);
				if (!args.slice(valueStart).startsWith("--")) {
					const value = readCommandValue(args, valueStart);
					if (value !== "") resolved = value;
				}
			}
		}
		searchFrom = flagIndex + flag.length;
	}
	return resolved;
}

function skipWhitespace(input: string, index: number): number {
	let current = index;
	while (current < input.length && /\s/.test(input[current])) {
		current += 1;
	}
	return current;
}

function readCommandValue(input: string, start: number): string {
	const quote = input[start];
	if (quote === '"' || quote === "'") {
		let value = "";
		let escaping = false;
		for (let index = start + 1; index < input.length; index += 1) {
			const char = input[index];
			if (escaping) {
				value += char;
				escaping = false;
				continue;
			}
			if (char === "\\") {
				escaping = true;
				continue;
			}
			if (char === quote) return value;
			value += char;
		}
		return value;
	}
	const nextFlagIndex = findNextCommandFlag(input, start);
	return input.slice(start, nextFlagIndex ?? input.length).trim();
}

function findNextCommandFlag(input: string, start: number): number | null {
	let quote: '"' | "'" | null = null;
	let escaping = false;
	for (let index = start; index < input.length; index += 1) {
		const char = input[index];
		if (escaping) {
			escaping = false;
			continue;
		}
		if (char === "\\") {
			escaping = true;
			continue;
		}
		if (quote) {
			if (char === quote) quote = null;
			continue;
		}
		if (char === '"' || char === "'") {
			quote = char;
			continue;
		}
		if (
			/\s/.test(char) &&
			input.slice(skipWhitespace(input, index)).startsWith("--")
		) {
			return index;
		}
	}
	return null;
}

/**
 * Extract the observed `--user-data-dir` from a listener command line.
 */
export function extractUserDataDir(command: string): string | null {
	return readCommandFlagValue(
		parseProcessCommand(command).args,
		"--user-data-dir",
	);
}

/**
 * Redacted listener identity that is safe for envelopes and diagnostics.
 */
export type RedactedListenerDetail = {
	/** Listener process id. */
	pid: number;
	/** Executable basename only — never a path, never arguments. */
	process: string;
	/** True when the process identity fails the real-Chrome check. */
	foreign: boolean;
	/**
	 * Observed profile directory. Present only for non-foreign real-Chrome
	 * listeners, because the agent needs it to act on `inspect_listener`.
	 */
	user_data_dir?: string;
};

/**
 * Single redaction chokepoint for listener diagnostics (plan U4 R13).
 *
 * Foreign listeners (process identity fails the real-Chrome check) reduce to
 * pid + executable basename: no cmdline arguments, no foreign filesystem
 * paths. A real-Chrome listener with a mismatched profile or port stays
 * non-foreign, so its observed `--user-data-dir` may pass through — the agent
 * needs it to act on `inspect_listener`. All other argument text is dropped
 * for real Chrome too.
 */
export function redactListenerDetail(
	listener: ListenerProcess,
	options?: { forceForeign?: boolean; env?: NodeJS.ProcessEnv },
): RedactedListenerDetail {
	const parsed = parseProcessCommand(listener.command);
	// `forceForeign` is instance identity, distinct from binary identity: a real
	// Google Chrome running the operator's everyday DEFAULT profile is declared a
	// FOREIGN INSTANCE (port_occupied_foreign / json_answers_on_default_profile),
	// so it must obey the foreign-listener rule — pid + basename, no filesystem
	// paths — rather than leaking the default-profile user_data_dir just because
	// the binary matches.
	if (options?.forceForeign || !isRealGoogleChromeBinary(parsed.executable)) {
		return {
			pid: listener.pid,
			process: safeProcessBasename(parsed.executable),
			foreign: true,
		};
	}
	const userDataDir = extractUserDataDir(listener.command);
	// Self-guard the doctrine at every call site: even a non-forced real-Chrome
	// listener must never emit the operator's DEFAULT-profile path (it discloses
	// the OS account and HOME layout). Guard UNCONDITIONALLY — callers that omit
	// env (proof.ts/repair.ts failed-probe branches) must not skip the check and
	// leak the path; without env, isDefaultChromeProfilePath falls back to its
	// HOME-absent regex, which fails closed on the default-profile shape.
	const leaksDefaultProfile =
		userDataDir !== null &&
		isDefaultChromeProfilePath(userDataDir, options?.env ?? {});
	return {
		pid: listener.pid,
		process: safeProcessBasename(REAL_GOOGLE_CHROME_BINARY),
		foreign: false,
		...(userDataDir === null || leaksDefaultProfile
			? {}
			: { user_data_dir: userDataDir }),
	};
}

function safeProcessBasename(executable: string): string {
	const name = basename(executable);
	return name === "" ? "unknown" : name;
}

const WS_URL_PATTERN = /wss?:\/\/[^\s"'\\)\]}]+/gi;

/**
 * Reduce a CDP `webSocketDebuggerUrl` to its path prefix (plan U4 R13).
 *
 * The trailing path segment is the browser capability token; diagnostic sinks
 * have weaker access control than the primary JSON output channel, so only
 * the prefix (e.g. `/devtools/browser/`) may enter a diagnostic event.
 */
export function redactWsUrl(url: string): string {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return "[redacted-ws-url]";
	}
	const pathname = parsed.pathname;
	const lastSlash = pathname.lastIndexOf("/");
	return pathname.slice(0, lastSlash + 1);
}

/**
 * Replace every websocket URL in free text with its redacted path prefix.
 */
export function redactWsUrlsInText(text: string): string {
	return text.replace(WS_URL_PATTERN, (match) => redactWsUrl(match));
}

/**
 * Deep-walk a diagnostic payload and redact every websocket URL string.
 *
 * Wired into the CLI diagnostic redactor so LogTape emits and post-mortem
 * buffer flushes can never carry a full `webSocketDebuggerUrl`, even when a
 * call site forgets to redact before emitting.
 */
export function redactWsUrlsDeep(value: unknown): unknown {
	if (typeof value === "string") return redactWsUrlsInText(value);
	if (Array.isArray(value)) {
		return value.map((entry) => redactWsUrlsDeep(entry));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([key, entry]) => [
				key,
				redactWsUrlsDeep(entry),
			]),
		);
	}
	return value;
}
