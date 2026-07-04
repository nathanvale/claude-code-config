// U7: the `repair` lifecycle. Ports the browser-use preflight profile repair
// (chmod 0o700, DevToolsActivePort hygiene, profile dir creation) onto the U4
// seam, then re-proves through the U5 check proof chain — a repaired profile
// only lands `repair.repaired` with a verified endpoint (plan R8).
//
// R11 invariant: repair NEVER terminates a listener it did not verify as Warm
// Chrome. The seam has no kill primitive besides a spawn handle, repair never
// spawns, and a foreign port owner is refused (`unrepairable`) before any
// mutation — refusal, never termination, is the only response to unverified
// state.

import { lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import {
	type WarmChromeCommandHandler,
	warmChromeRuntimeAction,
} from "./cli.ts";
import {
	createDefaultProofDeps,
	runWarmChromeCheckProof,
	type WarmChromeCheckProofInput,
	type WarmChromeProofDeps,
	type WarmChromeVerifiedProof,
} from "./proof.ts";
import {
	WARM_CHROME_DEFAULT_PROFILE_DIR,
} from "./model.ts";
import {
	expandHome,
	extractUserDataDir,
	isDefaultChromeProfilePath,
	type ListenerProcess,
	parseProcessCommand,
	type ProfileStat,
	REAL_GOOGLE_CHROME_BINARY,
	redactListenerDetail,
	WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER,
	type WarmChromeRuntime,
	WarmChromeRuntimeError,
} from "./runtime.ts";

/**
 * Closed repair-owned reason union for the `unrepairable` station (plan U7).
 *
 * Owned locally: these reasons never overlap the check reason union, and the
 * catalog's `repair.unrepairable` station is the only consumer. A new reason
 * lands here first and a station test pins it before the runtime may emit it.
 */
export const WARM_CHROME_REPAIR_REASONS = {
	unrepairable: [
		"foreign_listener_on_port",
		"profile_not_owned",
		"profile_mismatch",
		"profile_dir_uncreatable",
		"profile_permissions_unrepairable",
		"devtools_active_port_symlink",
		"devtools_active_port_unwritable",
	],
} as const;

/**
 * Repair-owned reason-detail union.
 */
export type WarmChromeRepairReason =
	(typeof WARM_CHROME_REPAIR_REASONS.unrepairable)[number];

/**
 * Cross-tool-visible repair mutation ids (the mutation-pin vocabulary).
 */
export const WARM_CHROME_REPAIR_ACTION_IDS = [
	"profile_dir_created",
	"profile_permissions",
	"devtools_active_port",
] as const;

/**
 * Repair mutation id union.
 */
export type WarmChromeRepairActionId =
	(typeof WARM_CHROME_REPAIR_ACTION_IDS)[number];

/**
 * One enumerated cross-tool-visible mutation: what changed and exactly where,
 * so `repair_profile`'s effect is inspectable by an agent (plan U7).
 */
export type WarmChromeRepairMutation = {
	id: WarmChromeRepairActionId;
	path: string;
};

/**
 * No-follow file-kind probe result for the DevToolsActivePort write guard.
 */
export type WarmChromeRepairFileKind = "symlink" | "missing" | "other";

/**
 * Repair dependencies: the U5 proof deps plus a repair-owned lstat probe.
 *
 * The U4 seam carries no lstat primitive and this unit must not extend
 * runtime.ts, so the never-follow-symlink guard is injected here — the same
 * pattern proof.ts uses for its websocket and DevToolsActivePort probes.
 */
export type WarmChromeRepairDeps = WarmChromeProofDeps & {
	/** lstat-based no-follow probe; a symlink answer refuses the write. */
	lstatFileKind: (path: string) => Promise<WarmChromeRepairFileKind>;
};

/**
 * Build the default repair deps bound to the real filesystem and websocket.
 */
export function createDefaultRepairDeps(): WarmChromeRepairDeps {
	return { ...createDefaultProofDeps(), lstatFileKind: defaultLstatFileKind };
}

async function defaultLstatFileKind(
	path: string,
): Promise<WarmChromeRepairFileKind> {
	try {
		const info = await lstat(path);
		return info.isSymbolicLink() ? "symlink" : "other";
	} catch {
		return "missing";
	}
}

type RepairErrorContext = {
	command: string;
	endpoint: string;
	port: string;
};

// Every unrepairable verdict fails closed on exit 20 with plain diagnostics.
// The runtime_diagnostics failure domain routes the chassis primary action to
// inspect_diagnostics (the repair.unrepairable catalog pin); the chassis
// primaryActionId override union only carries inspect_listener.
function unrepairableError(
	reason: WarmChromeRepairReason,
	message: string,
	context: RepairErrorContext,
	data: Record<string, unknown> = {},
): WarmChromeRuntimeError {
	return new WarmChromeRuntimeError("unrepairable", message, {
		exitCode: WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER,
		severity: "error",
		recoverability: "none",
		failureDomain: "runtime_diagnostics",
		hintSummary:
			"Repair refused to mutate unverified state; inspect diagnostics, then resolve the cause by hand.",
		data: { reason, ...context, ...data },
	});
}

/**
 * Build the `repair` command handler (plan U7).
 *
 * Repairs profile state (dir creation, chmod 0o700, DevToolsActivePort
 * hygiene), then re-proves via {@link runWarmChromeCheckProof}. Proof failures
 * reached through repair re-emit the check-owned stations by reference; only
 * refusal verdicts are repair-owned (`unrepairable`).
 *
 * @param overrides - Repair-dep overrides; tests inject canned probes
 * @returns Handler for the cli.ts dispatch registry
 */
export function createRepairCommandHandler(
	overrides: Partial<WarmChromeRepairDeps> = {},
): WarmChromeCommandHandler {
	const deps: WarmChromeRepairDeps = {
		...createDefaultRepairDeps(),
		...overrides,
	};
	return async (invocation, runtime) => {
		const context: RepairErrorContext = {
			command: invocation.displayCommand,
			endpoint: invocation.endpoint,
			port: invocation.port,
		};

		// 1. R11 gate before ANY action: inspect the port owner. A listener whose
		// binary path is not real Google Chrome is unverified — refuse to repair
		// around it and never touch it. An uninspectable probe attributes nothing;
		// the proof chain classifies it (port_occupied_foreign) after the safe
		// profile-state repairs.
		const listener = await inspectListener(runtime, invocation.port);
		if (listener !== null && !isRealGoogleChrome(listener)) {
			throw unrepairableError(
				"foreign_listener_on_port",
				"A foreign process owns the requested CDP port; repair refuses to terminate or repair around an unverified listener.",
				context,
				{ listener: redactListenerDetail(listener) },
			);
		}

		// 2. Resolve the repair target: the verified-binary listener's profile
		// wins (that is the state a re-prove will inspect), then the provided
		// --profile, then the dedicated default.
		const listenerDir =
			listener === null ? null : extractUserDataDir(listener.command);
		const listenerTarget =
			listenerDir === null ? null : expandHome(listenerDir, runtime.env);
		if (listenerTarget !== null && !isAbsolute(listenerTarget)) {
			throw unrepairableError(
				"profile_mismatch",
				"Listener profile path is relative and cannot be repaired safely.",
				context,
				{
					listener_profile_dir: redactListenerProfileDir(
						runtime,
						listenerTarget,
					),
				},
			);
		}
		const explicitTarget =
			invocation.profileInput === undefined
				? null
				: expandHome(invocation.profileInput, runtime.env);
		if (
			listenerTarget !== null &&
			explicitTarget !== null &&
			!(await sameProfileTarget(runtime, listenerTarget, explicitTarget))
		) {
			throw unrepairableError(
				"profile_mismatch",
				"Explicit --profile does not match the listener profile repair would mutate.",
				context,
				{
					listener_profile_dir: redactListenerProfileDir(
						runtime,
						listenerTarget,
					),
					profile_dir: explicitTarget,
				},
			);
		}
		const target =
			listenerTarget ??
			explicitTarget ??
			expandHome(WARM_CHROME_DEFAULT_PROFILE_DIR, runtime.env);

		// Never mutate the everyday default profile or a throwaway temp path —
		// the proof chain owns those verdicts and repair re-emits them untouched.
		const targetSafeToMutate = (path: string): boolean =>
			!isDefaultChromeProfilePath(path, runtime.env) &&
			!runtime.isTemporaryPath(path);

		const mutations: WarmChromeRepairMutation[] = [];
		let profile: ProfileStat | null = null;
		try {
			profile = await runtime.statProfile(target);
		} catch {
			profile = null;
		}

		// Gate on the RESOLVED path too: statProfile returns the realpath, so a
		// --profile symlink pointing into the default Chrome tree passes the
		// textual `target` check but resolves into a profile repair must never
		// chmod or write inside. All mutations below land on profile.realPath.
		const mutationsAllowed =
			targetSafeToMutate(target) &&
			(profile === null || targetSafeToMutate(profile.realPath));

		if (mutationsAllowed) {
			// 3. Profile dir creation (ported: preflight launch ensureProfileDir).
			if (profile === null) {
				try {
					const realPath = await runtime.ensureProfileDir(target);
					profile = await runtime.statProfile(realPath);
				} catch {
					throw unrepairableError(
						"profile_dir_uncreatable",
						"Warm Chrome profile directory does not exist and could not be created.",
						context,
						{ profile_dir: target },
					);
				}
				// ensureProfileDir resolves symlinks: re-check the created path
				// before recording the mutation, in case the target symlinked into
				// a profile repair must not own.
				if (!targetSafeToMutate(profile.realPath)) {
					throw unrepairableError(
						"profile_not_owned",
						"Repair target resolves into a profile Warm Chrome must not mutate.",
						context,
						{ profile_dir: profile.realPath },
					);
				}
				mutations.push({ id: "profile_dir_created", path: profile.realPath });
			}
			// 4. Owner-only permissions (ported: preflight repair chmod 0o700).
			// Ownership gate ported from assertCurrentUserOwnsProfile: chmodding a
			// profile owned by another user is repairing state we do not own.
			if (profile.mode !== "700") {
				const currentUser = await runtime.currentUser();
				if (profile.owner !== currentUser) {
					throw unrepairableError(
						"profile_not_owned",
						"Profile repair requires a profile owned by the current user.",
						context,
						{ profile_dir: profile.realPath },
					);
				}
				try {
					await runtime.chmod(profile.realPath, 0o700);
					profile = await runtime.statProfile(profile.realPath);
				} catch {
					throw unrepairableError(
						"profile_permissions_unrepairable",
						"Profile permissions could not be repaired.",
						context,
						{ profile_dir: profile.realPath },
					);
				}
				if (profile.mode !== "700") {
					throw unrepairableError(
						"profile_permissions_unrepairable",
						"Profile permissions did not become owner-only after repair.",
						context,
						{ profile_dir: profile.realPath, observed_mode: profile.mode },
					);
				}
				mutations.push({ id: "profile_permissions", path: profile.realPath });
			}
		}

		// 5. Re-prove. A failure here is a check-owned station re-emitted by
		// reference — except stale DevToolsActivePort content, the one proof
		// failure repair owns fixing (ported: preflight DevToolsActivePort write).
		const proofInput: WarmChromeCheckProofInput = {
			command: invocation.displayCommand,
			endpoint: invocation.endpoint,
			port: invocation.port,
			...(invocation.profileInput === undefined
				? {}
				: { profileInput: invocation.profileInput }),
		};
		let proof: WarmChromeVerifiedProof;
		try {
			proof = await runWarmChromeCheckProof(proofInput, runtime, deps);
		} catch (error) {
			if (!mutationsAllowed || !isStaleDevToolsActivePort(error)) {
				if (error instanceof WarmChromeRuntimeError && mutations.length > 0) {
					throw withRepairMutationData(error, mutations);
				}
				throw error;
			}
			const activePortPath = join(
				profile?.realPath ?? target,
				"DevToolsActivePort",
			);
			// Never-follow-symlink guard: chmod 0o700 does not remove an already
			// planted symlink, and the seam's writeTextFile follows one — so the
			// injected lstat probe refuses first. (lstat-then-write leaves a
			// narrow TOCTOU window; closing it needs an O_NOFOLLOW/tmp-rename
			// write primitive on the seam — deferred, seam is U4-owned.)
			if ((await deps.lstatFileKind(activePortPath)) === "symlink") {
				throw unrepairableError(
					"devtools_active_port_symlink",
					"A symlink is planted at DevToolsActivePort; repair refuses to follow it and did not write.",
					context,
					{
						devtools_active_port_path: activePortPath,
						...repairMutationData(mutations),
					},
				);
			}
			const liveWsPath = await readLiveBrowserWsPath(
				runtime,
				invocation.endpoint,
				invocation.port,
			);
			if (liveWsPath === null) {
				// The original stale-port verdict re-throws, but earlier mutations
				// (chmod, dir creation) already landed and must stay on the envelope.
				if (error instanceof WarmChromeRuntimeError && mutations.length > 0) {
					throw withRepairMutationData(error, mutations);
				}
				throw error;
			}
			// Ownership gate for the write, mirroring the chmod path: that gate only
			// fires when mode !== 700, so a profile already at 700 but owned by
			// another user would otherwise reach this write. Never rewrite proof
			// state inside a profile we do not own.
			if (
				profile !== null &&
				profile.owner !== (await runtime.currentUser())
			) {
				throw unrepairableError(
					"profile_not_owned",
					"DevToolsActivePort repair requires a profile owned by the current user.",
					context,
					{
						profile_dir: profile.realPath,
						...repairMutationData(mutations),
					},
				);
			}
			try {
				await runtime.writeTextFile(
					activePortPath,
					`${invocation.port}\n${liveWsPath}\n`,
				);
			} catch {
				throw unrepairableError(
					"devtools_active_port_unwritable",
					"DevToolsActivePort could not be rewritten.",
					context,
					{
						devtools_active_port_path: activePortPath,
						...repairMutationData(mutations),
					},
				);
			}
			mutations.push({ id: "devtools_active_port", path: activePortPath });
			try {
				proof = await runWarmChromeCheckProof(proofInput, runtime, deps);
			} catch (verifyError) {
				if (verifyError instanceof WarmChromeRuntimeError) {
					throw withRepairMutationData(verifyError, mutations);
				}
				throw verifyError;
			}
		}

		// 6. Repaired. The mutation pin enumerates every cross-tool-visible
		// change (chmod, dir creation, profile writes) with its exact path.
		const actionIds = mutations.map((mutation) => mutation.id);
		const action = warmChromeRuntimeAction("use_verified_endpoint");
		return {
			data: {
				...proof.data,
				repair_actions: actionIds,
				repair_mutations: mutations.map((mutation) => ({
					id: mutation.id,
					path: mutation.path,
				})),
			},
			plain: [
				"browser_ready",
				`command=${invocation.displayCommand}`,
				`endpoint=${proof.endpoint}`,
				`port=${invocation.port}`,
				`browser=${proof.browser}`,
				`profile=${String(proof.data.profile_dir)}`,
				`repaired=${actionIds.length > 0 ? actionIds.join(",") : "none"}`,
			].join(" "),
			runtimeActions: [
				{
					...action,
					summary: `${action.summary} Verified endpoint: ${proof.endpoint}.`,
				},
			],
			continuation: { next_action_id: "use_verified_endpoint" },
		};
	};
}

function repairMutationData(
	mutations: readonly WarmChromeRepairMutation[],
): Record<string, unknown> {
	return {
		repair_actions: mutations.map((mutation) => mutation.id),
		repair_mutations: mutations.map((mutation) => ({
			id: mutation.id,
			path: mutation.path,
		})),
	};
}

function withRepairMutationData(
	error: WarmChromeRuntimeError,
	mutations: readonly WarmChromeRepairMutation[],
): WarmChromeRuntimeError {
	return new WarmChromeRuntimeError(error.code, error.message, {
		...error.options,
		data: {
			...(error.options.data ?? {}),
			...repairMutationData(mutations),
		},
	});
}

async function inspectListener(
	runtime: WarmChromeRuntime,
	port: string,
): Promise<ListenerProcess | null> {
	try {
		return await runtime.findListener(port);
	} catch {
		// Unattributable port: nothing is verified, so nothing may be repaired
		// around or terminated; the proof chain classifies the occupation.
		return null;
	}
}

function isRealGoogleChrome(listener: ListenerProcess): boolean {
	return (
		parseProcessCommand(listener.command).executable ===
		REAL_GOOGLE_CHROME_BINARY
	);
}

// The observed listener's profile is another instance's directory. When it is
// the operator's everyday DEFAULT Chrome profile, its raw path discloses the OS
// account name and HOME layout — the foreign-listener redaction doctrine forbids
// emitting it. Report a non-path marker instead so the mismatch stays legible.
function redactListenerProfileDir(
	runtime: WarmChromeRuntime,
	listenerTarget: string,
): string {
	return isDefaultChromeProfilePath(listenerTarget, runtime.env)
		? "<default-chrome-profile>"
		: listenerTarget;
}

async function sameProfileTarget(
	runtime: WarmChromeRuntime,
	left: string,
	right: string,
): Promise<boolean> {
	if (left === right) return true;
	try {
		const [leftProfile, rightProfile] = await Promise.all([
			runtime.statProfile(left),
			runtime.statProfile(right),
		]);
		return leftProfile.realPath === rightProfile.realPath;
	} catch {
		return false;
	}
}

function isStaleDevToolsActivePort(error: unknown): boolean {
	return (
		error instanceof WarmChromeRuntimeError &&
		error.code === "invalid_cdp" &&
		error.options.data?.reason === "endpoint_id_mismatch"
	);
}

// Hygiene data source: the live /json/version answer, validated to the same
// loopback + browser-path posture the proof chain enforces. Anything less than
// a fully valid answer skips the write and re-throws the original verdict.
async function readLiveBrowserWsPath(
	runtime: WarmChromeRuntime,
	endpoint: string,
	port: string,
): Promise<string | null> {
	let value: unknown;
	try {
		value = await runtime.fetchJson(`${endpoint}/json/version`);
	} catch {
		return null;
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const wsUrl = (value as Record<string, unknown>).webSocketDebuggerUrl;
	if (typeof wsUrl !== "string") return null;
	let parsed: URL;
	try {
		parsed = new URL(wsUrl);
	} catch {
		return null;
	}
	if (
		parsed.protocol !== "ws:" ||
		parsed.hostname !== "127.0.0.1" ||
		parsed.port !== port ||
		!parsed.pathname.startsWith("/devtools/browser/")
	) {
		return null;
	}
	return parsed.pathname;
}
