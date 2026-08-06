// U6: single module owns the `launch` lifecycle (plan R7/R9/R10/R10a).
//
// Order of operations: launch-binary guard, pre-spawn proof short-circuit
// (already_verified), competing-instance guard against the 9222 convention,
// fail-closed classification (only "nothing listens" permits a spawn), launch
// profile posture, SingletonLock pre-bind refusal, seam spawn, then a bounded
// readiness poll that re-enters the U5 proof chain and applies the race
// policy against our own spawned child.
//
// Launch owns its reason ids locally (plan U6): readiness_timeout,
// own_child_kill_failed, prior_launch_mid_startup, launch_binary_not_real_chrome.
// Post-spawn proof failures pass their check reason through unchanged so the
// spawned_unverified envelope names the same machine-readable cause the
// check station would, and carry that check station's primary action as a
// secondary affordance so the agent never loses a known-good repair path.

import type { BranchStation } from "@side-quest/cli-command-facade";

import { warmChromeBranchStationCatalog } from "./branch-station-catalog.ts";
import {
	type WarmChromeCommandHandler,
	type WarmChromeCommandSuccess,
	type WarmChromeExecuteInvocation,
	warmChromeRuntimeAction,
} from "./cli.ts";
import {
	WARM_CHROME_DEFAULT_PROFILE_DIR,
	type WarmChromeRuntimeActionId,
} from "./model.ts";
import {
	createDefaultProofDeps,
	runWarmChromeCheckProof,
	type WarmChromeCheckProofInput,
	type WarmChromeProofDeps,
	type WarmChromeVerifiedProof,
} from "./proof.ts";
import {
	expandHome,
	isDefaultChromeProfilePath,
	REAL_GOOGLE_CHROME_BINARY,
	type SingletonLock,
	type SpawnedChrome,
	WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER,
	type WarmChromeRuntime,
	WarmChromeRuntimeError,
} from "./runtime.ts";

/**
 * Bounded readiness budget for the post-spawn verification poll (plan R7).
 *
 * Replaces the legacy preflight's ad-hoc `30 x sleep(500)` loop (~15s) with
 * one named contract constant. Budget exhaustion is a verdict
 * (`spawned_unverified` reason `readiness_timeout`), never a silent hang.
 *
 * @defaultValue 15000
 */
export const WARM_CHROME_LAUNCH_READINESS_BUDGET_MS = 15_000;

/**
 * Interval between post-spawn proof re-entries inside the readiness budget.
 *
 * @defaultValue 500
 */
export const WARM_CHROME_LAUNCH_READINESS_POLL_INTERVAL_MS = 500;

/**
 * Convention CDP port the competing-instance guard (R10a) probes before any
 * spawn on a non-convention port.
 *
 * @defaultValue "9222"
 */
export const WARM_CHROME_CONVENTION_PORT = "9222";

// Startup URL the spawn seam opens; a concrete page keeps the default browser
// context populated so the R6a default-context proof has a page target.
const WARM_CHROME_LAUNCH_STARTUP_URL = "https://example.com/";

/**
 * Launch-owned reason ids (plan U6), keyed by canonical error code.
 *
 * Post-spawn proof failures additionally pass every check reason through
 * unchanged (see {@link WarmChromeLaunchReason}); this map owns only the
 * reasons the launch lifecycle itself can mint.
 */
export const WARM_CHROME_LAUNCH_REASONS = {
	spawned_unverified: [
		"readiness_timeout",
		"spawn_failed",
		"own_child_kill_failed",
		"prior_launch_mid_startup",
	],
	wrong_browser: [
		"chrome_for_testing",
		"chromium",
		"launch_binary_not_real_chrome",
	],
} as const;

/**
 * Launch-local reason union.
 */
export type WarmChromeLaunchLocalReason =
	(typeof WARM_CHROME_LAUNCH_REASONS)[keyof typeof WARM_CHROME_LAUNCH_REASONS][number];

type LaunchContext = {
	command: string;
	endpoint: string;
	port: string;
};

type ProofOutcome =
	| { kind: "verified"; proof: WarmChromeVerifiedProof }
	| { kind: "failed"; error: WarmChromeRuntimeError };

async function runProofOutcome(
	input: WarmChromeCheckProofInput,
	runtime: WarmChromeRuntime,
	deps: WarmChromeProofDeps,
): Promise<ProofOutcome> {
	try {
		return {
			kind: "verified",
			proof: await runWarmChromeCheckProof(input, runtime, deps),
		};
	} catch (error) {
		if (!(error instanceof WarmChromeRuntimeError)) throw error;
		return { kind: "failed", error };
	}
}

/**
 * Build the `launch` command handler.
 *
 * @param overrides - Proof-dep overrides; tests inject canned CDP results
 * @returns Handler for the cli.ts dispatch registry
 *
 * @example
 * ```typescript
 * const exitCode = await main(["launch"], {
 *   handlers: { launch: createLaunchCommandHandler() },
 * })
 * ```
 */
export function createLaunchCommandHandler(
	overrides: Partial<WarmChromeProofDeps> = {},
): WarmChromeCommandHandler {
	const deps: WarmChromeProofDeps = {
		...createDefaultProofDeps(),
		...overrides,
	};
	return async (invocation, runtime) => {
		const context: LaunchContext = {
			command: invocation.displayCommand,
			endpoint: invocation.endpoint,
			port: invocation.port,
		};
		// A healthy endpoint would prove the RUNNING Chrome, not the
		// operator-supplied --chrome/CHROME_BIN value; validate before the reuse
		// short-circuit so a CfT/Chromium launch input always fails closed (R6).
		assertRealChromeLaunchBinary(invocation.chromeBin, context);

		const proofInput: WarmChromeCheckProofInput = {
			command: invocation.displayCommand,
			endpoint: invocation.endpoint,
			port: invocation.port,
			...(invocation.profileInput === undefined
				? {}
				: { profileInput: invocation.profileInput }),
		};

		// 1. Pre-spawn probe short-circuit: an already-verified Warm Chrome on
		// the requested endpoint means nothing spawns (launch.already_verified).
		const preSpawn = await runProofOutcome(proofInput, runtime, deps);
		if (preSpawn.kind === "verified") {
			return launchSuccess(invocation, preSpawn.proof, false);
		}

		// 2. Competing-instance guard (R10a): --port/--endpoint naming another
		// port does not license a second Warm Chrome when the 9222 convention
		// already runs verified — a second instance is an adapter-drift feeder.
		// The caller's --profile expectation rides the probe so a verified
		// convention Chrome on a DIFFERENT profile fails loudly instead of
		// returning an exit-0 envelope that silently drops --profile semantics;
		// on success the ok envelope carries the 9222 endpoint (R8: the envelope
		// is the only endpoint authority).
		if (invocation.port !== WARM_CHROME_CONVENTION_PORT) {
			const convention = await runProofOutcome(
				{
					command: invocation.displayCommand,
					endpoint: `http://127.0.0.1:${WARM_CHROME_CONVENTION_PORT}`,
					port: WARM_CHROME_CONVENTION_PORT,
					...(invocation.profileInput === undefined
						? {}
						: { profileInput: invocation.profileInput }),
				},
				runtime,
				deps,
			);
			if (convention.kind === "verified") {
				return launchSuccess(invocation, convention.proof, false);
			}
			// The profiled probe failed — but its verdict may be about the caller's
			// --profile input (unsafe_profile/invalid_profile_path for a not-yet
			// existing or relative --profile), which the proof checks BEFORE the
			// profile-match step. That must not license a spawn: re-probe the
			// convention port WITHOUT the caller profile to answer the only question
			// the guard cares about — does a verified Warm Chrome already hold 9222.
			// If yes, the caller cannot have a second Warm Chrome regardless of the
			// --profile verdict shape, so re-emit their profiled verdict (the honest
			// reason their invocation can't be satisfied); spawning would be drift.
			const conventionNoProfile = await runProofOutcome(
				{
					command: invocation.displayCommand,
					endpoint: `http://127.0.0.1:${WARM_CHROME_CONVENTION_PORT}`,
					port: WARM_CHROME_CONVENTION_PORT,
				},
				runtime,
				deps,
			);
			if (conventionNoProfile.kind === "verified") {
				throw convention.error;
			}
			// Convention port holds no verified Warm Chrome; the requested-port
			// verdict stays authoritative.
		}

		// 3. Fail-closed classification: only "nothing listens" permits a spawn.
		// Every other pre-spawn verdict re-emits its check-owned station by
		// reference (U3 re-emit map) — including port_occupied_foreign, which
		// the catalog also pins as launch.port_occupied_foreign
		// (fails_closed_without_spawn) with suggested_explicit_port intact.
		if (
			preSpawn.error.code !== "endpoint_unreachable" ||
			preSpawn.error.options.data?.reason !== "no_listener"
		) {
			throw preSpawn.error;
		}

		// 4. Launch profile posture, then the pre-bind refusal (R9): Chrome
		// claims the profile SingletonLock before binding its CDP port, so a
		// present lock while the port looks free means a prior launch is
		// mid-startup. Profile-state inspection, not an ownership record.
		const profileInput =
			invocation.profileInput ?? WARM_CHROME_DEFAULT_PROFILE_DIR;
		const expandedProfile = expandHome(profileInput, runtime.env);
		assertLaunchProfilePosture(expandedProfile, runtime, context);
		// Resolve an existing target before any mutation: statProfile returns the
		// realpath, so a --profile symlink into the default Chrome tree is
		// rejected here, BEFORE ensureProfileDir chmods the resolved dir. (A
		// symlink to a not-yet-existing path has nothing to resolve; the
		// post-ensureProfileDir re-check below covers create-through-symlink.)
		try {
			const resolved = await runtime.statProfile(expandedProfile);
			assertLaunchProfilePosture(resolved.realPath, runtime, context);
		} catch (error) {
			if (error instanceof WarmChromeRuntimeError) throw error;
			// statProfile threw because the path does not exist yet — fine; the
			// dir is created fresh below and re-checked after resolution.
		}
		const lock = await runtime.readSingletonLock(expandedProfile);
		// A foreign-host lock (synced/NFS home shared across a fleet) names a pid
		// this machine cannot probe; its host owns that Chrome, not us, so it can
		// never hold our local port. Ignore it rather than aliasing its remote pid
		// onto a local process and permanently bricking launch.
		if (lock?.local) {
			const lockAlive =
				lock.pid === null ? true : await isLockPidAlive(runtime, lock.pid);
			if (lockAlive) {
				throw spawnedUnverifiedError({
					reason: "prior_launch_mid_startup",
					message:
						"A prior Warm Chrome launch holds the profile SingletonLock while the port is not answering; refusing to spawn a second Chrome.",
					hintSummary:
						"A launch is mid-startup on this profile; wait, rerun warm-chrome check, and inspect diagnostics before any respawn.",
					data: {
						...context,
						...(lock.pid === null ? {} : { lock_pid: lock.pid }),
					},
				});
			}
		}

		// 5. Spawn through the seam's handle-returning spawnChrome.
		let profileDir: string;
		try {
			profileDir = await runtime.ensureProfileDir(expandedProfile);
		} catch {
			throw new WarmChromeRuntimeError(
				"unsafe_profile",
				"Warm Chrome launch profile must be a directory path that can be created.",
				{
					recoverability: "repair_state",
					hintAction: "repair_state",
					hintSummary:
						"Choose a dedicated persistent Warm Chrome profile directory.",
					data: { reason: "invalid_profile_path", ...context },
				},
			);
		}
		// Re-assert posture against the RESOLVED profile path: the pre-spawn
		// guard above checks the caller's textual path, but ensureProfileDir
		// returns the realpath, so a symlink to the default Chrome profile (or a
		// temp dir) only reveals itself here. Fail before spawn — after
		// spawnChrome, Chrome would already be attached to the everyday profile.
		assertLaunchProfilePosture(profileDir, runtime, context);
		let child: SpawnedChrome;
		try {
			child = await runtime.spawnChrome({
				chromeBin: invocation.chromeBin,
				port: invocation.port,
				profileDir,
				startupUrl: WARM_CHROME_LAUNCH_STARTUP_URL,
			});
		} catch {
			throw spawnedUnverifiedError({
				reason: "spawn_failed",
				message:
					"Chrome launch wrote profile state but the browser process did not start.",
				hintSummary:
					"Chrome failed during startup; inspect diagnostics before any adapter work.",
				data: {
					...context,
					profile_dir: profileDir,
				},
			});
		}

		// 6. Bounded readiness poll re-entering the U5 proof chain (R7). Budget
		// exhaustion or a non-transient post-spawn proof failure lands
		// launch.spawned_unverified; success applies the race policy (R10).
		const deadline = runtime.now() + WARM_CHROME_LAUNCH_READINESS_BUDGET_MS;
		for (;;) {
			const outcome = await runProofOutcome(proofInput, runtime, deps);
			if (outcome.kind === "verified") {
				return resolveSpawnRace(invocation, outcome.proof, child, context);
			}
			if (
				outcome.error.code !== "endpoint_unreachable" &&
				!isTransientStartupFailure(outcome.error)
			) {
				// Waiting cannot repair a post-spawn proof failure: the check
				// reason passes through and the check station's primary action is
				// carried so the agent keeps a known-good repair path.
				throw spawnedUnverifiedFromCheckFailure(outcome.error, child, context);
			}
			// A dead child is a failed spawn UNLESS a rival launch is mid-startup:
			// Chrome's ProcessSingleton retires the loser BECAUSE the winner holds
			// the profile SingletonLock, so a live foreign lock means the race
			// policy can still converge on the winner's verified endpoint — keep
			// polling instead of aborting the recovery.
			if (
				!(await isSpawnedProcessAlive(runtime, child.pid)) &&
				!(await hasLiveRivalLaunch(runtime, profileDir, child.pid))
			) {
				throw spawnedUnverifiedError({
					reason: "spawn_failed",
					message:
						"Chrome spawned but exited before its DevTools endpoint verified.",
					hintSummary:
						"Chrome exited during startup; inspect diagnostics before any adapter work.",
					data: {
						...context,
						spawned_pid: child.pid,
						last_check_code: outcome.error.code,
						...(typeof outcome.error.options.data?.reason === "string"
							? { last_check_reason: outcome.error.options.data.reason }
							: {}),
					},
				});
			}
			if (runtime.now() >= deadline) {
				throw spawnedUnverifiedError({
					reason: "readiness_timeout",
					message:
						"Chrome spawned but its DevTools endpoint did not verify within the readiness budget.",
					hintSummary:
						"Chrome was spawned and browser state was written; a blind respawn is wrong — inspect diagnostics, then rerun warm-chrome check.",
					data: {
						...context,
						spawned_pid: child.pid,
						readiness_budget_ms: WARM_CHROME_LAUNCH_READINESS_BUDGET_MS,
						last_check_code: outcome.error.code,
						...(typeof outcome.error.options.data?.reason === "string"
							? { last_check_reason: outcome.error.options.data.reason }
							: {}),
					},
				});
			}
			await runtime.sleep(WARM_CHROME_LAUNCH_READINESS_POLL_INTERVAL_MS);
		}
	};
}

// A mid-startup rival Chrome can transiently expose CDP contention or fail a
// round-trip while its endpoint settles. Inside the readiness budget these are
// retryable so the race policy can run once the survivor verifies.
function isTransientStartupFailure(error: WarmChromeRuntimeError): boolean {
	const reason = error.options.data?.reason;
	if (error.code === "invalid_cdp") {
		return reason === "cdp_contention" || reason === "roundtrip_failed";
	}
	if (error.code === "listener_mismatch") {
		return reason === "pid_mismatch" || reason === "listener_missing";
	}
	return false;
}

// R10 race policy: the verified listener pid decides. If it is not our own
// spawned child, another Warm Chrome won the startup race (interleaved launch
// or Chrome's ProcessSingleton); terminate ONLY our own child and land
// already_verified. The verified survivor is never touched (package hard
// rule: never terminate a listener the proof did not verify as ours to kill).
async function resolveSpawnRace(
	invocation: WarmChromeExecuteInvocation,
	proof: WarmChromeVerifiedProof,
	child: SpawnedChrome,
	context: LaunchContext,
): Promise<WarmChromeCommandSuccess> {
	const verifiedPid = Number(proof.data.browser_pid);
	if (verifiedPid === child.pid) {
		return launchSuccess(invocation, proof, true);
	}
	let killed: boolean;
	try {
		killed = await child.kill();
	} catch {
		// An exception here means the pid is already gone: real Chrome's
		// ProcessSingleton may retire the loser's child before we do. An
		// already-exited child does not change the station.
		killed = true;
	}
	if (!killed) {
		throw spawnedUnverifiedError({
			reason: "own_child_kill_failed",
			message:
				"Lost the launch race to another verified Warm Chrome and failed to terminate our own spawned child.",
			hintSummary:
				"Browser state was written and a duplicate Chrome child may survive; inspect diagnostics before any respawn.",
			data: {
				...context,
				spawned_pid: child.pid,
				verified_pid: verifiedPid,
			},
		});
	}
	return launchSuccess(invocation, proof, true);
}

function launchSuccess(
	invocation: WarmChromeExecuteInvocation,
	proof: WarmChromeVerifiedProof,
	launchPerformed: boolean,
): WarmChromeCommandSuccess {
	const action = warmChromeRuntimeAction("use_verified_endpoint");
	return {
		// The proof's ok payload is the endpoint authority (R8); launch only adds
		// whether this invocation performed a browser spawn/write.
		data: { ...proof.data, launch_performed: launchPerformed },
		plain: [
			"browser_ready",
			`command=${invocation.displayCommand}`,
			`endpoint=${proof.endpoint}`,
			`port=${String(proof.data.port)}`,
			`browser=${proof.browser}`,
			`profile=${String(proof.data.profile_dir)}`,
			`launched=${launchPerformed}`,
		].join(" "),
		runtimeActions: [
			{
				...action,
				// R8: guidance carries the ACTUAL verified endpoint — for the
				// competing-instance guard that is the 9222 convention endpoint,
				// not the port the caller asked to spawn on.
				summary: `${action.summary} Verified endpoint: ${proof.endpoint}.`,
			},
		],
		continuation: { next_action_id: "use_verified_endpoint" },
	};
}

type SpawnedUnverifiedInput = {
	reason: string;
	message: string;
	hintSummary: string;
	data: Record<string, unknown>;
	secondaryActionIds?: readonly WarmChromeRuntimeActionId[];
};

// launch.spawned_unverified builder. The catalog pins inspect_diagnostics as
// this station's primary action; the chassis routes the runtime_diagnostics
// failure domain there, and the explicit exit 20 keeps the browser-entry
// semantics (no_adapter_fallback constraint rides every exit-20 envelope).
function spawnedUnverifiedError(
	input: SpawnedUnverifiedInput,
): WarmChromeRuntimeError {
	return new WarmChromeRuntimeError("spawned_unverified", input.message, {
		exitCode: WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER,
		failureDomain: "runtime_diagnostics",
		severity: "error",
		recoverability: "repair_state",
		hintAction: "repair_state",
		hintSummary: input.hintSummary,
		...(input.secondaryActionIds?.length
			? { secondaryActionIds: input.secondaryActionIds }
			: {}),
		data: { reason: input.reason, ...input.data },
	});
}

function spawnedUnverifiedFromCheckFailure(
	cause: WarmChromeRuntimeError,
	child: SpawnedChrome,
	context: LaunchContext,
): WarmChromeRuntimeError {
	const secondaryActionId = checkStationPrimaryActionId(cause.code);
	const secondary =
		secondaryActionId === undefined
			? undefined
			: warmChromeRuntimeAction(secondaryActionId);
	const causeReason =
		typeof cause.options.data?.reason === "string"
			? cause.options.data.reason
			: cause.code;
	return spawnedUnverifiedError({
		reason: causeReason,
		message: `Chrome spawned but post-spawn verification failed: ${cause.message}`,
		hintSummary: secondary
			? `Chrome was spawned and browser state was written; a blind respawn is wrong. Known-good repair: ${secondary.summary}`
			: "Chrome was spawned and browser state was written; a blind respawn is wrong — inspect diagnostics.",
		// The re-emitted check station's primary action rides runtime_actions
		// as a secondary entry (chassis appends it after inspect_diagnostics)
		// so the agent keeps a known-good repair action at its deepest point.
		...(secondaryActionId === undefined
			? {}
			: { secondaryActionIds: [secondaryActionId] }),
		data: {
			// Cause detail first (already redacted by the proof chain), then the
			// launch context and the pass-through reason authority.
			...(cause.options.data ?? {}),
			...context,
			reason: causeReason,
			failed_check_code: cause.code,
			spawned_pid: child.pid,
		},
	});
}

// Mechanical secondary-action derivation: the re-emitted check station's
// declared primary action, read from the catalog by reference so it can never
// fork from the check-owned declaration.
function checkStationPrimaryActionId(
	code: string,
): WarmChromeRuntimeActionId | undefined {
	const station = (
		warmChromeBranchStationCatalog as readonly BranchStation[]
	).find((candidate) => candidate.id === `check.${code}`);
	const actionId = station?.expectedActionId;
	if (typeof actionId !== "string") return undefined;
	try {
		warmChromeRuntimeAction(actionId as WarmChromeRuntimeActionId);
	} catch {
		return undefined;
	}
	return actionId as WarmChromeRuntimeActionId;
}

function assertRealChromeLaunchBinary(
	chromeBin: string,
	context: LaunchContext,
): void {
	if (chromeBin === REAL_GOOGLE_CHROME_BINARY) return;
	const reason = /chrome for testing|chrome-mac/i.test(chromeBin)
		? "chrome_for_testing"
		: /chromium/i.test(chromeBin)
			? "chromium"
			: "launch_binary_not_real_chrome";
	throw new WarmChromeRuntimeError(
		"wrong_browser",
		"Warm Chrome launch requires the real Google Chrome app binary.",
		{
			recoverability: "repair_state",
			hintAction: "repair_state",
			hintSummary: "Launch with the stable Google Chrome app binary.",
			data: { reason, ...context },
		},
	);
}

function assertLaunchProfilePosture(
	path: string,
	runtime: WarmChromeRuntime,
	context: LaunchContext,
): void {
	if (isDefaultChromeProfilePath(path, runtime.env)) {
		throw new WarmChromeRuntimeError(
			"unsafe_profile",
			"Warm Chrome cannot launch on the everyday default Chrome profile.",
			{
				exitCode: WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER,
				failureDomain: "input",
				recoverability: "change_input",
				hintAction: "change_input",
				hintSummary: "Choose a dedicated persistent Warm Chrome profile.",
				data: { reason: "default_profile", ...context },
			},
		);
	}
	if (runtime.isTemporaryPath(path)) {
		throw new WarmChromeRuntimeError(
			"unsafe_profile",
			"Warm Chrome profile must be persistent, not a throwaway temporary directory.",
			{
				exitCode: WARM_CHROME_BROWSER_ENTRY_EXIT_CODE_NUMBER,
				failureDomain: "input",
				recoverability: "change_input",
				hintAction: "change_input",
				hintSummary: "Choose a dedicated persistent Warm Chrome profile.",
				data: { reason: "throwaway_profile", ...context },
			},
		);
	}
}

// Post-spawn rival detection for the readiness poll's dead-child gate. A
// SingletonLock owned by a live pid that is not our own child is a rival
// launch mid-startup (the pre-bind refusal's mirror image); an absent lock,
// our own child's lingering lock, or a dead owner proves no rival is coming.
async function hasLiveRivalLaunch(
	runtime: WarmChromeRuntime,
	profileDir: string,
	ownPid: number,
): Promise<boolean> {
	let lock: SingletonLock | null;
	try {
		lock = await runtime.readSingletonLock(profileDir);
	} catch {
		return true;
	}
	if (lock === null) return false;
	// A foreign-host lock is another machine's launch, never our local rival.
	if (!lock.local) return false;
	if (lock.pid === ownPid) return false;
	// An unparseable owner pid mirrors the pre-bind fail-closed posture: treat
	// the launch as mid-startup rather than minting a premature spawn_failed.
	if (lock.pid === null) return true;
	return isLockPidAlive(runtime, lock.pid);
}

async function isLockPidAlive(
	runtime: WarmChromeRuntime,
	pid: number,
): Promise<boolean> {
	try {
		return await runtime.isProcessAlive(pid);
	} catch {
		return true;
	}
}

async function isSpawnedProcessAlive(
	runtime: WarmChromeRuntime,
	pid: number,
): Promise<boolean> {
	try {
		return await runtime.isProcessAlive(pid);
	} catch {
		return true;
	}
}
