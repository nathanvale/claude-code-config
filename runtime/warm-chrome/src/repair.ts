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

import { randomUUID } from "node:crypto";
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	rmdir,
	unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";

import {
	type WarmChromeCommandHandler,
	type WarmChromeCommandSuccess,
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
	type JsonObject,
	WARM_CHROME_CONTRACT_ID,
	WARM_CHROME_DEFAULT_PROFILE_DIR,
	WARM_CHROME_PROFILE_NAME,
	WARM_CHROME_SCHEMA_VERSION,
	type WarmChromeRepairActionId,
	type WarmChromeRepairReason,
	isJsonObject,
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

type ProfileOnlyRepairErrorContext = Pick<RepairErrorContext, "command">;

const PROFILE_PREFERENCES_MAX_BYTES = 1_048_576;

// Every unrepairable verdict fails closed on exit 20 with plain diagnostics.
// The runtime_diagnostics failure domain routes the chassis primary action to
// inspect_diagnostics (the repair.unrepairable catalog pin); the chassis
// primaryActionId override union only carries inspect_listener.
function unrepairableError(
	reason: WarmChromeRepairReason,
	message: string,
	context: RepairErrorContext | ProfileOnlyRepairErrorContext,
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
		if (invocation.profileOnly) {
			const profileOnlyContext: ProfileOnlyRepairErrorContext = {
				command: invocation.displayCommand,
			};
			return repairProfilePolicyOnly(
				invocation,
				runtime,
				profileOnlyContext,
			);
		}
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

		// 5. Re-prove from live runtime evidence. Any failure is a check-owned
		// station re-emitted by reference; DevToolsActivePort is hint material and
		// cannot veto browser identity.
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
			if (error instanceof WarmChromeRuntimeError && mutations.length > 0) {
				throw withRepairMutationData(error, mutations);
			}
			throw error;
		}

		// 6. Reconcile stale adapter hint material only after the live proof passes.
		// Fixed-port Chrome does not refresh DevToolsActivePort, so repair owns this
		// optional hygiene without making the file browser-entry authority.
		const liveWsPath = new URL(proof.webSocketDebuggerUrl).pathname;
		const shouldRepairActivePort =
			mutationsAllowed &&
			profile !== null &&
			(await devToolsActivePortNeedsRepair(
				deps,
				profile.realPath,
				invocation.port,
				liveWsPath,
			));
		if (shouldRepairActivePort && profile !== null) {
			if (
				await devToolsActivePortWriteTargetStillMatches({
					runtime,
					port: invocation.port,
					expectedProfile: profile,
					context,
					mutations,
				})
			) {
				// Ownership gate for the write, mirroring the chmod path: that gate only
				// fires when mode !== 700, so a profile already at 700 but owned by
				// another user would otherwise reach this write.
				if (profile.owner !== (await runtime.currentUser())) {
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
				const activePortPath = join(profile.realPath, "DevToolsActivePort");
				// Never-follow-symlink guard: chmod 0o700 does not remove an already
				// planted symlink, and the seam's writeTextFile follows one.
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
		}

		// 7. Repaired. The mutation pin enumerates every cross-tool-visible
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

type ProfilePolicyInspection = {
	preferences: JsonObject;
	preferencesPath: string;
	serializedPreferences: string;
	writePreferences: boolean;
};

// Profile-only mode owns no browser-entry authority. It accepts one explicit
// path, writes only that path, and returns a policy-clean signal without an
// endpoint action or continuation.
async function repairProfilePolicyOnly(
	invocation: Parameters<WarmChromeCommandHandler>[0],
	runtime: WarmChromeRuntime,
	context: ProfileOnlyRepairErrorContext,
): Promise<WarmChromeCommandSuccess> {
	const profileDir = invocation.profileInput;
	if (profileDir === undefined || !isCanonicalProfilePath(profileDir)) {
		throw unrepairableError(
			"profile_path_noncanonical",
			"Choose an absolute canonical profile path with no trailing slash or dot segments, then rerun profile-only repair.",
			context,
			profileDir === undefined ? {} : { profile_dir: profileDir },
		);
	}
	const homeDir = runtime.env.HOME?.replace(/\/+$/, "");
	if (
		profileDir === homeDir ||
		isDefaultChromeProfilePath(profileDir, runtime.env)
	) {
		throw unrepairableError(
			"profile_path_invalid",
			"Choose a dedicated profile directory, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
	await assertProfilePathCanonicalOnDisk(profileDir, context);
	await assertProfilePathNotSymlink(profileDir, context);
	let profileInfo = await lstatForRepair(profileDir, context);
	if (profileInfo !== null && !profileInfo.isDirectory()) {
		throw unrepairableError(
			"profile_path_invalid",
			"Choose an empty dedicated profile directory, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
	if (
		profileInfo !== null &&
		String(profileInfo.uid) !== (await runtime.currentUser())
	) {
		throw unrepairableError(
			"profile_not_owned",
			"Choose a profile owned by the current user or correct its ownership manually, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
	await assertProfileUnlocked(runtime, profileDir, context);

	const mutations: WarmChromeRepairMutation[] = [];
	let originalMode: number | null = null;
	let restoreModeOnFailure = false;
	let defaultDirCreated = false;
	try {
		if (profileInfo === null) {
			let profileCreated = false;
			try {
				await assertProfilePathCanonicalOnDisk(profileDir, context);
				await mkdir(profileDir, { mode: 0o700 });
				profileCreated = true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
					throw unrepairableError(
						"profile_dir_uncreatable",
						"Create the parent directory or correct filesystem access, then rerun profile-only repair.",
						context,
						{ profile_dir: profileDir },
					);
				}
			}
			await assertProfilePathNotSymlink(profileDir, context);
			profileInfo = await lstatForRepair(profileDir, context);
			if (profileInfo === null || !profileInfo.isDirectory()) {
				throw unrepairableError(
					"profile_path_invalid",
					"Choose an empty dedicated profile directory, then rerun profile-only repair.",
					context,
					{ profile_dir: profileDir },
				);
			}
			if (String(profileInfo.uid) !== (await runtime.currentUser())) {
				throw unrepairableError(
					"profile_not_owned",
					"Choose a profile owned by the current user or correct its ownership manually, then rerun profile-only repair.",
					context,
					{ profile_dir: profileDir },
				);
			}
			if (profileCreated) {
				mutations.push({ id: "profile_dir_created", path: profileDir });
			}
		}

		const observedMode = Number(profileInfo.mode) & 0o777;
		if (observedMode !== 0o700) {
			originalMode = observedMode;
			try {
				await assertProfileUnlocked(runtime, profileDir, context);
				await assertProfilePathCanonicalOnDisk(profileDir, context);
				await chmod(profileDir, 0o700);
				profileInfo = await lstatForRepair(profileDir, context);
			} catch (error) {
				if (error instanceof WarmChromeRuntimeError) throw error;
				throw unrepairableError(
					"profile_permissions_unrepairable",
					"Correct the profile directory mode to owner-only, then rerun profile-only repair.",
					context,
					{ profile_dir: profileDir },
				);
			}
			if (
				profileInfo === null ||
				(Number(profileInfo.mode) & 0o777) !== 0o700 ||
				String(profileInfo.uid) !== (await runtime.currentUser())
			) {
				throw unrepairableError(
					"profile_permissions_unrepairable",
					"Correct the profile directory mode to owner-only, then rerun profile-only repair.",
					context,
					{ profile_dir: profileDir },
				);
			}
			restoreModeOnFailure = true;
			mutations.push({ id: "profile_permissions", path: profileDir });
		}

		const inspection = await inspectProfilePolicy(profileDir, context);
		if (inspection.writePreferences) {
			await assertProfileUnlocked(runtime, profileDir, context);
			await assertLoginDataEmpty(profileDir, context);
			const defaultDir = dirname(inspection.preferencesPath);
			const defaultInfo = await lstatForRepair(defaultDir, context);
			if (defaultInfo === null) {
				try {
					await assertProfilePathCanonicalOnDisk(profileDir, context);
					await mkdir(defaultDir, { mode: 0o700 });
					defaultDirCreated = true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
						throw unrepairableError(
							"profile_preferences_unwritable",
							"Correct filesystem access for the dedicated profile, then rerun profile-only repair.",
							context,
							{ profile_dir: profileDir },
						);
					}
				}
			}
			await assertRegularDirectory(defaultDir, context, profileDir);
			await assertPathNotSymlink(inspection.preferencesPath, context, profileDir);
			await assertProfileUnlocked(runtime, profileDir, context);
			try {
				await writeTextFileAtomically(
					inspection.preferencesPath,
					inspection.serializedPreferences,
					async () => {
						await assertProfilePathCanonicalOnDisk(profileDir, context);
						await assertPathNotSymlink(
							inspection.preferencesPath,
							context,
							profileDir,
						);
						await assertLoginDataEmpty(profileDir, context);
						await assertProfileUnlocked(runtime, profileDir, context);
					},
				);
			} catch (error) {
				if (defaultDirCreated) {
					await rmdir(defaultDir).catch(() => undefined);
				}
				if (error instanceof WarmChromeRuntimeError) throw error;
				throw unrepairableError(
					"profile_preferences_unwritable",
					"Correct filesystem access for the dedicated profile, then rerun profile-only repair.",
					context,
					{ profile_dir: profileDir },
				);
			}
			mutations.push({
				id: "profile_preferences",
				path: inspection.preferencesPath,
			});
			restoreModeOnFailure = false;
		}

		await verifyProfilePolicyClean(profileDir, runtime, context);
	} catch (error) {
		if (restoreModeOnFailure && originalMode !== null) {
			const modeToRestore = originalMode;
			await assertProfilePathCanonicalOnDisk(profileDir, context)
				.then(() => chmod(profileDir, modeToRestore))
				.catch(() => undefined);
		}
		throw error;
	}

	const actionIds = mutations.map((mutation) => mutation.id);
	return {
		data: {
			contract_id: WARM_CHROME_CONTRACT_ID,
			schema_version: WARM_CHROME_SCHEMA_VERSION,
			profile_policy: "clean",
			profile_dir: profileDir,
			...repairMutationData(mutations),
		},
		plain: [
			"profile_policy_clean",
			`command=${invocation.displayCommand}`,
			`profile=${profileDir}`,
			`profile.name=${WARM_CHROME_PROFILE_NAME}`,
			"credentials_enable_service=false",
			"profile.password_manager_enabled=false",
			"autofill.profile_enabled=false",
			"autofill.credit_card_enabled=false",
			"sync.requested=false",
			"saved_logins=absent",
			`repaired=${actionIds.length > 0 ? actionIds.join(",") : "none"}`,
		].join(" "),
	};
}

function isCanonicalProfilePath(path: string): boolean {
	return (
		isAbsolute(path) &&
		!path.includes("\0") &&
		!path.endsWith("/") &&
		normalize(path) === path &&
		dirname(path) !== path
	);
}

async function assertProfilePathCanonicalOnDisk(
	profileDir: string,
	context: ProfileOnlyRepairErrorContext,
): Promise<void> {
	let inspectedPath = profileDir;
	let resolvedPath: string;
	try {
		resolvedPath = await realpath(inspectedPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw unrepairableError(
				"profile_path_uninspectable",
				"Correct filesystem access for the dedicated profile, then rerun profile-only repair.",
				context,
				{ profile_dir: profileDir },
			);
		}
		inspectedPath = dirname(profileDir);
		try {
			resolvedPath = await realpath(inspectedPath);
		} catch {
			throw unrepairableError(
				"profile_path_uninspectable",
				"Create the parent directory or correct filesystem access, then rerun profile-only repair.",
				context,
				{ profile_dir: profileDir },
			);
		}
	}
	if (resolvedPath !== inspectedPath) {
		throw unrepairableError(
			"profile_path_symlink",
			"Choose a profile path whose parent chain contains no symbolic links, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
}

async function assertProfilePathNotSymlink(
	profileDir: string,
	context: ProfileOnlyRepairErrorContext,
): Promise<void> {
	const info = await lstatForRepair(profileDir, context);
	if (info?.isSymbolicLink()) {
		throw unrepairableError(
			"profile_path_symlink",
			"Choose a profile path that is a directory, not a symbolic link, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
	if (info !== null && !info.isDirectory()) {
		throw unrepairableError(
			"profile_path_invalid",
			"Choose an empty dedicated profile directory, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
}

async function lstatForRepair(
	path: string,
	context: ProfileOnlyRepairErrorContext,
): Promise<Awaited<ReturnType<typeof lstat>> | null> {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw unrepairableError(
			"profile_path_uninspectable",
			"Correct filesystem access for the dedicated profile, then rerun profile-only repair.",
			context,
			{ profile_dir: path },
		);
	}
}

async function assertProfileUnlocked(
	runtime: WarmChromeRuntime,
	profileDir: string,
	context: ProfileOnlyRepairErrorContext,
): Promise<void> {
	let lock: Awaited<ReturnType<WarmChromeRuntime["readSingletonLock"]>>;
	try {
		lock = await runtime.readSingletonLock(profileDir);
	} catch {
		throw unrepairableError(
			"profile_locked",
			"Stop Warm Chrome, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
	if (lock === null || !lock.local) return;
	let alive = true;
	if (lock.pid !== null) {
		try {
			alive = await runtime.isProcessAlive(lock.pid);
		} catch {
			alive = true;
		}
	}
	if (alive) {
		throw unrepairableError(
			"profile_locked",
			"Stop Warm Chrome, then rerun profile-only repair.",
			context,
			{
				profile_dir: profileDir,
				...(lock.pid === null ? {} : { lock_pid: lock.pid }),
			},
		);
	}
}

async function inspectProfilePolicy(
	profileDir: string,
	context: ProfileOnlyRepairErrorContext,
): Promise<ProfilePolicyInspection> {
	const defaultDir = join(profileDir, "Default");
	const preferencesPath = join(defaultDir, "Preferences");
	await assertRegularDirectory(defaultDir, context, profileDir, true);
	await assertLoginDataEmpty(profileDir, context);
	await assertPathNotSymlink(preferencesPath, context, profileDir);
	const preferencesInfo = await lstatForRepair(preferencesPath, context);
	let source: string | null = null;
	let preferences: JsonObject = {};
	if (preferencesInfo !== null) {
		if (!preferencesInfo.isFile()) {
			throw unrepairableError(
				"profile_preferences_unreadable",
				"Move the unreadable Preferences entry aside only after manual review, then rerun profile-only repair.",
				context,
				{ profile_dir: profileDir },
			);
		}
		if (preferencesInfo.size > PROFILE_PREFERENCES_MAX_BYTES) {
			throw unrepairableError(
				"profile_preferences_too_large",
				"Review and reduce the Preferences file below the policy limit, then rerun profile-only repair.",
				context,
				{ profile_dir: profileDir },
			);
		}
		try {
			source = await readFile(preferencesPath, "utf8");
			const parsed: unknown = JSON.parse(source);
			if (!isJsonObject(parsed)) throw new Error("not an object");
			preferences = parsed;
		} catch {
			throw unrepairableError(
				"profile_preferences_unreadable",
				"Move the unreadable Preferences file aside only after manual review, then rerun profile-only repair.",
				context,
				{ profile_dir: profileDir },
			);
		}
	}
	const writePreferences = !profilePolicyFlagsAreClean(preferences);
	const merged = mergeProfilePolicyPreferences(preferences);
	const serializedPreferences = serializePreferences(merged, source);
	if (Buffer.byteLength(serializedPreferences) > PROFILE_PREFERENCES_MAX_BYTES) {
		throw unrepairableError(
			"profile_preferences_too_large",
			"Review and reduce the Preferences file below the policy limit, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
	return {
		preferences: merged,
		preferencesPath,
		serializedPreferences,
		writePreferences: preferencesInfo === null || writePreferences,
	};
}

async function assertRegularDirectory(
	path: string,
	context: ProfileOnlyRepairErrorContext,
	profileDir: string,
	allowMissing = false,
): Promise<void> {
	const info = await lstatForRepair(path, context);
	if (info === null && allowMissing) return;
	if (info?.isSymbolicLink()) {
		throw unrepairableError(
			"profile_path_symlink",
			"Choose a profile path whose existing components are directories, not symbolic links, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
	if (info === null || !info.isDirectory()) {
		throw unrepairableError(
			"profile_path_invalid",
			"Choose an empty dedicated profile directory, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
}

async function assertPathNotSymlink(
	path: string,
	context: ProfileOnlyRepairErrorContext,
	profileDir: string,
): Promise<void> {
	if ((await lstatForRepair(path, context))?.isSymbolicLink()) {
		throw unrepairableError(
			"profile_path_symlink",
			"Choose a profile path whose existing components are directories, not symbolic links, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
}

const PROFILE_CREDENTIAL_STORES = [
	"Login Data",
	"Login Data For Account",
	"Web Data",
] as const;

async function assertLoginDataEmpty(
	profileDir: string,
	context: ProfileOnlyRepairErrorContext,
): Promise<void> {
	for (const credentialStore of PROFILE_CREDENTIAL_STORES) {
		const storePath = join(profileDir, "Default", credentialStore);
		const info = await lstatForRepair(storePath, context);
		if (info?.isSymbolicLink()) {
			throw unrepairableError(
				"profile_path_symlink",
				"Choose a profile path whose existing components are directories, not symbolic links, then rerun profile-only repair.",
				context,
				{ profile_dir: profileDir },
			);
		}
		if (info !== null && info.size > 0) {
			throw unrepairableError(
				"profile_login_data_present",
				"Move the existing profile aside and rerun profile-only repair against a new empty directory.",
				context,
				{ profile_dir: profileDir },
			);
		}
	}
}

function nestedObject(value: unknown): JsonObject {
	return isJsonObject(value) ? value : {};
}

function mergeProfilePolicyPreferences(preferences: JsonObject): JsonObject {
	return {
		...preferences,
		credentials_enable_service: false,
		profile: {
			...nestedObject(preferences.profile),
			name: WARM_CHROME_PROFILE_NAME,
			password_manager_enabled: false,
		},
		autofill: {
			...nestedObject(preferences.autofill),
			profile_enabled: false,
			credit_card_enabled: false,
		},
		sync: {
			...nestedObject(preferences.sync),
			requested: false,
		},
	};
}

function profilePolicyFlagsAreClean(preferences: JsonObject): boolean {
	const profile = nestedObject(preferences.profile);
	const autofill = nestedObject(preferences.autofill);
	const sync = nestedObject(preferences.sync);
	return (
		preferences.credentials_enable_service === false &&
		profile.name === WARM_CHROME_PROFILE_NAME &&
		profile.password_manager_enabled === false &&
		autofill.profile_enabled === false &&
		autofill.credit_card_enabled === false &&
		sync.requested === false
	);
}

function serializePreferences(
	preferences: JsonObject,
	source: string | null,
): string {
	if (source === null) return `${JSON.stringify(preferences)}\n`;
	const indent = source.match(/\n([\t ]+)"/)?.[1] ?? "";
	const trailingNewline = source.endsWith("\n") ? "\n" : "";
	return `${JSON.stringify(preferences, null, indent)}${trailingNewline}`;
}

async function writeTextFileAtomically(
	path: string,
	content: string,
	assertTargetSafe: () => Promise<void>,
): Promise<void> {
	const tempPath = join(
		dirname(path),
		`.Preferences.${process.pid}.${randomUUID()}.tmp`,
	);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(tempPath, "wx", 0o600);
		await handle.writeFile(content, "utf8");
		await handle.sync();
		await handle.close();
		handle = null;
		await assertTargetSafe();
		await rename(tempPath, path);
	} finally {
		await handle?.close().catch(() => undefined);
		await unlink(tempPath).catch(() => undefined);
	}
}

async function verifyProfilePolicyClean(
	profileDir: string,
	runtime: WarmChromeRuntime,
	context: ProfileOnlyRepairErrorContext,
): Promise<void> {
	const profileInfo = await lstatForRepair(profileDir, context);
	if (
		profileInfo === null ||
		!profileInfo.isDirectory() ||
		(Number(profileInfo.mode) & 0o777) !== 0o700 ||
		String(profileInfo.uid) !== (await runtime.currentUser())
	) {
		throw unrepairableError(
			"profile_permissions_unrepairable",
			"Correct the profile directory mode and ownership, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
	const inspection = await inspectProfilePolicy(profileDir, context);
	if (inspection.writePreferences || !profilePolicyFlagsAreClean(inspection.preferences)) {
		throw unrepairableError(
			"profile_preferences_unwritable",
			"Correct filesystem access for the dedicated profile, then rerun profile-only repair.",
			context,
			{ profile_dir: profileDir },
		);
	}
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

async function devToolsActivePortNeedsRepair(
	deps: WarmChromeRepairDeps,
	profileDir: string,
	port: string,
	liveWsPath: string,
): Promise<boolean> {
	try {
		const activePort = await deps.readDevToolsActivePort(profileDir);
		return (
			activePort !== null &&
			(activePort.port !== port || activePort.wsPath !== liveWsPath)
		);
	} catch {
		return true;
	}
}

async function devToolsActivePortWriteTargetStillMatches(input: {
	runtime: WarmChromeRuntime;
	port: string;
	expectedProfile: ProfileStat;
	context: RepairErrorContext;
	mutations: readonly WarmChromeRepairMutation[];
}): Promise<boolean> {
	const listener = await inspectListener(input.runtime, input.port);
	if (listener === null) return false;
	if (!isRealGoogleChrome(listener)) {
		throw unrepairableError(
			"foreign_listener_on_port",
			"A foreign process owns the requested CDP port; repair refuses to write DevToolsActivePort for an unverified listener.",
			input.context,
			{
				listener: redactListenerDetail(listener),
				...repairMutationData(input.mutations),
			},
		);
	}
	const listenerDir = extractUserDataDir(listener.command);
	if (listenerDir === null) return false;
	const listenerTarget = expandHome(listenerDir, input.runtime.env);
	if (!isAbsolute(listenerTarget)) {
		throw unrepairableError(
			"profile_mismatch",
			"Listener profile path is relative and cannot be repaired safely.",
			input.context,
			{
				listener_profile_dir: redactListenerProfileDir(
					input.runtime,
					listenerTarget,
				),
				profile_dir: input.expectedProfile.realPath,
				...repairMutationData(input.mutations),
			},
		);
	}
	let listenerProfile: ProfileStat;
	try {
		listenerProfile = await input.runtime.statProfile(listenerTarget);
	} catch {
		return false;
	}
	if (listenerProfile.realPath !== input.expectedProfile.realPath) {
		throw unrepairableError(
			"profile_mismatch",
			"Listener profile changed before DevToolsActivePort could be rewritten safely.",
			input.context,
			{
				listener_profile_dir: redactListenerProfileDir(
					input.runtime,
					listenerTarget,
				),
				profile_dir: input.expectedProfile.realPath,
				...repairMutationData(input.mutations),
			},
		);
	}
	return true;
}
