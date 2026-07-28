// ---------------------------------------------------------------------------
// Browser Runbook engine (platform plan 2026-07-21-002 U4, R30/R31/R35;
// release contract R7/R23-adjacent).
//
// I/O at the edges over the shared fs port; every runbook decision flows
// through the pure U4 model (browser-use-runbook-model.ts). Discovery reads
// declarative runbooks from the code-owned XDG data location
// (`$XDG_DATA_HOME/browser-use/runbooks/<service-id>/<flow-id>/runbook.json`);
// the catalog projection lists them redacted with health; show returns one
// validated definition; run compiles a bounded plan and binds it to the
// existing agent-browser executor per-step. Confidential steps route through the
// caller-injected auth-delivery seam (R30); this engine never resolves a secret
// — the executor owns the sensitive-interval choreography, and an absent native
// capability fails a confidential runbook closed with a typed repair pointer.
//
// F7 continuation: execution accepts a resume-from step index and compiles
// only from there, so a resumed run replays no already-confirmed mutation. The
// shared run store (browser-use-runs.ts) owns durable run state; this engine
// owns the runbook definition and the plan, and returns the executor's
// structural truth verbatim.
//
// Import direction: model + agent-browser executor + paths port + core. No
// Date.now, no Math.random, no process.cwd().
// ---------------------------------------------------------------------------

import { constants as fsConstants, existsSync } from "node:fs";
import { lstat as fsLstat, open as fsOpen } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AgentBrowserAuthDeliveryContext,
	type AgentBrowserExecutionResult,
	type AgentBrowserExecutionRuntime,
	type AgentBrowserTask,
	type AgentBrowserVerifiedHandoff,
	executeAgentBrowserTask,
} from "./browser-use-agent-browser";
import { redactUnsafeText } from "./browser-use-core";
import type { BrowserUsePlatformFs } from "./browser-use-paths";
import {
	type BrowserUseRunbook,
	type BrowserUseRunbookCatalogRow,
	type BrowserUseRunbookHealth,
	type BrowserUseRunbookInputs,
	type BrowserUseRunbookPlan,
	type BrowserUseRunbookReadActionMeta,
	type BrowserUseRunbookStep,
	materializeRunbookInputs,
	parseRunbookRecord,
	projectRunbookCatalogRow,
	planRunbookExecution,
	validateRunbook,
} from "./browser-use-runbook-model";
import {
	type BrowserUseActionGenerationSeam,
	type BrowserUseResolvedReviewedAction,
	type BrowserUseReviewedActionRefusal,
	captureStructuredResult,
	itemKeysAreValid,
	resolveReviewedAction,
} from "./browser-use-runbook-actions";
import type { AgentBrowserTaskStep } from "./browser-use-agent-browser";
import type { BrowserUseRunStructuredResult } from "./browser-use-run-model";

// --- Discovery location ------------------------------------------------------

/** The code-owned runbook file name under each flow directory. */
const RUNBOOK_FILE = "runbook.json";
/** The optional per-flow outcome journal (R31) informing health. */
const RUNBOOK_OUTCOME_FILE = "outcome.json";
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The runbooks root under the admitted XDG data root:
 * `$XDG_DATA_HOME/browser-use/runbooks`. Derived from the paths port's
 * `data.root` so the engine takes no new path-owner responsibility (paths
 * owns root admission; the runbook module owns its own subtree, mirroring the
 * runs/attestations subtree precedent).
 *
 * @param dataRoot - The admitted `paths.data.root`
 * @returns Absolute runbooks root
 */
export function runbooksRoot(dataRoot: string): string {
	return join(dataRoot, "runbooks");
}

/**
 * The two legitimate layouts this compiled/source module can run from, and the
 * shipped-runbooks candidate under each:
 *
 * - REPO / test / `path bin`: module at `<skill>/src/browser-use-runbook.ts`,
 *   catalog at `<skill>/runbooks` — one level UP from the module dir.
 * - PACKAGED bin: module at `<install>/dist/browser-use.js`, catalog copied to
 *   `<install>/dist/runbooks` (build-dist.ts) — SAME dir as the module. The
 *   published tarball ships only `dist/` (package.json `files`), so no sibling
 *   `<install>/runbooks` exists; the dist-adjacent copy is the only catalog
 *   that travels with the bin.
 *
 * Both candidates are probed; the first that exists on disk wins. The order
 * puts the dist-adjacent copy first so a packaged bin never accidentally
 * resolves to a stray `../runbooks` above the install root.
 *
 * @returns The ordered shipped-runbooks candidate roots, most-specific first
 */
function shippedRunbooksRootCandidates(): readonly [string, string] {
	const moduleDir = dirname(fileURLToPath(import.meta.url));
	return [
		// Packaged layout: dist/browser-use.js -> dist/runbooks
		join(moduleDir, "runbooks"),
		// Repo/src layout: src/browser-use-runbook.ts -> <skill>/runbooks
		join(moduleDir, "..", "runbooks"),
	];
}

/**
 * The code-owned SHIPPED runbooks root. Resolves correctly in BOTH the
 * repo-local `src/` layout (`<skill>/runbooks`) and the packaged `dist/` layout
 * (`<install>/dist/runbooks`) — see `shippedRunbooksRootCandidates()`.
 * Production runbooks ship here so `runbook list` discovers them at runtime
 * without any XDG seeding step (wave-4 `catalog_count=0` fix). Discovery scans
 * this root IN ADDITION to the XDG store; an operator-authored runbook under
 * the data root with the same service/flow id overrides the shipped one (store
 * wins), mirroring the asset-promotion precedent where user-owned data
 * supersedes shipped defaults.
 *
 * Returns the first candidate that exists on disk; when neither exists it
 * returns the packaged-layout candidate so callers still resolve a concrete,
 * inspectable path (the missing directory then surfaces as a typed health
 * condition in `listRunbooks` rather than a silent empty catalog).
 *
 * Read-only: the engine never writes here. The directory is versioned in the
 * repo and copied into `dist/` at build time, so its runbooks travel with the
 * code, not the machine.
 *
 * @returns Absolute shipped-runbooks root
 */
export function shippedRunbooksRoot(): string {
	const candidates = shippedRunbooksRootCandidates();
	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

// --- Typed refusals ----------------------------------------------------------

/**
 * Typed packaging diagnostic: the code-owned shipped runbooks root does not
 * exist on disk in any legitimate layout. Thrown by `listRunbooks` so a
 * packaged bin that dropped `dist/runbooks/` fails LOUD with a repair pointer
 * instead of silently reporting `runbook_count=0`. Carries a `code` tag so the
 * CLI/driver can render it as a typed health condition rather than a generic
 * crash.
 */
export class BrowserUseShippedRunbooksMissingError extends Error {
	readonly code = "runbook_shipped_root_missing" as const;
	readonly shippedRoot: string;
	constructor(shippedRoot: string) {
		super(
			`shipped runbook catalog missing at ${shippedRoot}; the packaged build must copy runbooks/ into dist (see build-dist.ts).`,
		);
		this.name = "BrowserUseShippedRunbooksMissingError";
		this.shippedRoot = shippedRoot;
	}
}

/** Typed discovery/show refusal. */
export type BrowserUseRunbookDiscoveryFailure = {
	code:
		| "runbook_not_found"
		| "runbook_record_corrupt"
		| "runbook_record_invalid"
		| "runbook_id_invalid";
	message: string;
};

function failure(
	code: BrowserUseRunbookDiscoveryFailure["code"],
	message: string,
): BrowserUseRunbookDiscoveryFailure {
	return { code, message: redactUnsafeText(message) };
}

function discoveryFailure(
	code: BrowserUseRunbookDiscoveryFailure["code"],
	message: string,
): { ok: false; failure: BrowserUseRunbookDiscoveryFailure } {
	return { ok: false, failure: failure(code, message) };
}

// --- Parse one runbook file --------------------------------------------------

function parseRunbookRaw(
	raw: string,
):
	| { ok: true; runbook: BrowserUseRunbook }
	| { ok: false; failure: BrowserUseRunbookDiscoveryFailure } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return discoveryFailure(
			"runbook_record_corrupt",
			"runbook file is not valid JSON.",
		);
	}
	// TOTAL parse (drop-v1): prove the v2 object shape before any use — the
	// engine NEVER casts untrusted JSON to BrowserUseRunbook. A non-object, a
	// non-v2 version, or a malformed step/input/schema is a typed shape refusal.
	const shape = parseRunbookRecord(parsed);
	if (!shape.ok) {
		return discoveryFailure(
			"runbook_record_invalid",
			`runbook shape invalid: ${shape.issue.code}.`,
		);
	}
	const runbook = shape.runbook;
	const issues = validateRunbook(runbook);
	if (issues.length > 0) {
		return discoveryFailure(
			"runbook_record_invalid",
			`runbook violates ${issues.map((i) => i.code).join(", ")}.`,
		);
	}
	return { ok: true, runbook };
}

// --- Health (R31) ------------------------------------------------------------

/**
 * Derive health from validation plus the optional outcome journal (R31). A
 * runbook that fails validation is `stale`; a runbook whose last recorded
 * outcome healed a selector or observed drift is `degrading`; otherwise
 * `healthy`. Absent/corrupt outcome journals default to `healthy` — validity
 * is proven, and no drift has been recorded.
 */
async function deriveHealth(
	fs: BrowserUsePlatformFs,
	runbook: BrowserUseRunbook,
	outcomePath: string,
): Promise<BrowserUseRunbookHealth> {
	if (validateRunbook(runbook).length > 0) return "stale";
	let raw: string;
	try {
		raw = await fs.readTextFile(outcomePath);
	} catch {
		return "healthy";
	}
	try {
		const parsed = JSON.parse(raw) as {
			last_result?: unknown;
			steps_healed?: unknown;
			drifted_selectors?: unknown;
		};
		const healed =
			typeof parsed.steps_healed === "number" && parsed.steps_healed > 0;
		const drifted =
			Array.isArray(parsed.drifted_selectors) &&
			parsed.drifted_selectors.length > 0;
		if (parsed.last_result === "stale") return "stale";
		return healed || drifted ? "degrading" : "healthy";
	} catch {
		return "healthy";
	}
}

// --- List (R35) --------------------------------------------------------------

/**
 * Scan ONE runbooks root, projecting each valid runbook as a redacted catalog
 * row keyed by `service_id/flow_id`. A missing root is an empty map; a corrupt
 * or invalid runbook file is skipped (it surfaces on `runbook show` with its
 * typed refusal). Shared by the shipped and store scans; the caller merges.
 */
async function scanRunbooksRoot(
	fs: BrowserUsePlatformFs,
	root: string,
): Promise<Map<string, BrowserUseRunbookCatalogRow>> {
	const rows = new Map<string, BrowserUseRunbookCatalogRow>();
	const rootStat = await fs.lstat(root);
	if (rootStat === undefined || rootStat.kind !== "directory") return rows;
	for (const serviceId of await fs.readDirectory(root)) {
		if (!SAFE_SEGMENT.test(serviceId)) continue;
		const serviceDir = join(root, serviceId);
		const serviceStat = await fs.lstat(serviceDir);
		if (serviceStat === undefined || serviceStat.kind !== "directory") continue;
		for (const flowId of await fs.readDirectory(serviceDir)) {
			if (!SAFE_SEGMENT.test(flowId)) continue;
			const filePath = join(serviceDir, flowId, RUNBOOK_FILE);
			let raw: string;
			try {
				raw = await fs.readTextFile(filePath);
			} catch {
				continue;
			}
			const parsed = parseRunbookRaw(raw);
			if (!parsed.ok) continue;
			const health = await deriveHealth(
				fs,
				parsed.runbook,
				join(serviceDir, flowId, RUNBOOK_OUTCOME_FILE),
			);
			rows.set(
				`${serviceId}/${flowId}`,
				projectRunbookCatalogRow(parsed.runbook, health),
			);
		}
	}
	return rows;
}

/**
 * Discover and project every valid runbook as a redacted catalog row (R35).
 * Discovery scans the code-owned shipped catalog (`shippedRunbooksRoot()`)
 * AND the XDG data-root store (`runbooksRoot(dataRoot)`); an operator-authored
 * runbook under the store with the same service/flow id overrides the shipped
 * one. A missing root contributes nothing; a corrupt or invalid file is
 * skipped (it surfaces on `runbook show` with its typed refusal). Rows sort by
 * service then flow id.
 *
 * @param fs - Platform fs port
 * @param dataRoot - The admitted `paths.data.root`
 * @returns Sorted redacted catalog rows
 */
export async function listRunbooks(
	fs: BrowserUsePlatformFs,
	dataRoot: string,
): Promise<readonly BrowserUseRunbookCatalogRow[]> {
	// Fail closed if the shipped catalog directory is missing: a packaged bin
	// that dropped `dist/runbooks/` must surface a typed diagnostic, never a
	// silent empty catalog (the wave-5 packaging gap). A present-but-empty
	// shipped root is a legitimate empty scan and does not trip this.
	const shippedRoot = shippedRunbooksRoot();
	const shippedStat = await fs.lstat(shippedRoot);
	if (shippedStat === undefined || shippedStat.kind !== "directory") {
		throw new BrowserUseShippedRunbooksMissingError(shippedRoot);
	}
	const shipped = await scanRunbooksRoot(fs, shippedRoot);
	const store = await scanRunbooksRoot(fs, runbooksRoot(dataRoot));
	// Store overrides shipped on id collision.
	const merged = new Map(shipped);
	for (const [id, row] of store) merged.set(id, row);
	return [...merged.values()].sort((a, b) => {
		if (a.service_id !== b.service_id) {
			return a.service_id < b.service_id ? -1 : 1;
		}
		return a.flow_id < b.flow_id ? -1 : a.flow_id > b.flow_id ? 1 : 0;
	});
}

// --- Show --------------------------------------------------------------------

/** Typed `runbook show` outcome. */
export type BrowserUseRunbookShowResult =
	| { ok: true; runbook: BrowserUseRunbook; health: BrowserUseRunbookHealth }
	| { ok: false; failure: BrowserUseRunbookDiscoveryFailure };

/**
 * Load and validate one runbook from ONE resolved runbooks root. `absent` is
 * a clean ENOENT/ENOTDIR miss (the caller may fall back to another root);
 * `record_corrupt`/`record_invalid` are fail-closed refusals that MUST surface
 * (never silently fall back — a broken store record needs a repair, not a
 * shadowed shipped default). Never writes.
 */
async function loadRunbookFromRoot(
	fs: BrowserUsePlatformFs,
	runbooksRootDir: string,
	id: { serviceId: string; flowId: string },
): Promise<
	| { ok: true; runbook: BrowserUseRunbook; health: BrowserUseRunbookHealth }
	| { ok: false; absent: true }
	| { ok: false; absent: false; failure: BrowserUseRunbookDiscoveryFailure }
> {
	const flowDir = join(runbooksRootDir, id.serviceId, id.flowId);
	let raw: string;
	try {
		raw = await fs.readTextFile(join(flowDir, RUNBOOK_FILE));
	} catch (error) {
		const code = (error as { code?: string }).code;
		if (code === "ENOENT" || code === "ENOTDIR") {
			return { ok: false, absent: true };
		}
		return {
			ok: false,
			absent: false,
			failure: failure(
				"runbook_record_corrupt",
				`runbook file could not be read (${code ?? "unknown"}).`,
			),
		};
	}
	const parsed = parseRunbookRaw(raw);
	if (!parsed.ok) return { ok: false, absent: false, failure: parsed.failure };
	const health = await deriveHealth(
		fs,
		parsed.runbook,
		join(flowDir, RUNBOOK_OUTCOME_FILE),
	);
	return { ok: true, runbook: parsed.runbook, health };
}

/**
 * Load and validate one runbook by service/flow id. Resolution tries the XDG
 * data-root store first, then the code-owned shipped catalog: an operator's
 * store record overrides the shipped default, but a truly absent store record
 * falls back to the shipped one. A missing file in BOTH roots is
 * `runbook_not_found`; torn JSON is `runbook_record_corrupt`; a well-formed
 * file failing the R30 invariants is `runbook_record_invalid`. A corrupt or
 * invalid STORE record fails closed and never falls back to shipped. Never
 * writes.
 *
 * @param fs - Platform fs port
 * @param dataRoot - The admitted `paths.data.root`
 * @param id - Service and flow id
 * @returns The validated runbook plus its health, or one typed refusal
 */
export async function showRunbook(
	fs: BrowserUsePlatformFs,
	dataRoot: string,
	id: { serviceId: string; flowId: string },
): Promise<BrowserUseRunbookShowResult> {
	if (!SAFE_SEGMENT.test(id.serviceId) || !SAFE_SEGMENT.test(id.flowId)) {
		return {
			ok: false,
			failure: failure(
				"runbook_id_invalid",
				"service and flow id must be safe lowercase slugs.",
			),
		};
	}
	const fromStore = await loadRunbookFromRoot(fs, runbooksRoot(dataRoot), id);
	if (fromStore.ok) {
		return { ok: true, runbook: fromStore.runbook, health: fromStore.health };
	}
	// A corrupt/invalid STORE record fails closed — never shadowed by shipped.
	if (!fromStore.absent) return { ok: false, failure: fromStore.failure };
	const fromShipped = await loadRunbookFromRoot(fs, shippedRunbooksRoot(), id);
	if (fromShipped.ok) {
		return {
			ok: true,
			runbook: fromShipped.runbook,
			health: fromShipped.health,
		};
	}
	if (!fromShipped.absent) return { ok: false, failure: fromShipped.failure };
	return {
		ok: false,
		failure: failure(
			"runbook_not_found",
			`no runbook is defined for ${id.serviceId}/${id.flowId}.`,
		),
	};
}

// --- Run (execution binding, R30, F7) ----------------------------------------

/** Typed runbook execution refusal (before the executor is reached). */
export type BrowserUseRunbookExecutionRefusal = {
	code:
		| "runbook_not_found"
		| "runbook_record_corrupt"
		| "runbook_record_invalid"
		| "runbook_id_invalid"
		| "runbook_invalid"
		| "runbook_input_missing"
		| "runbook_input_rejected"
		| "runbook_resume_out_of_range"
		| "runbook_neutral_checkpoint_unavailable"
		| "runbook_action_registry_unavailable"
		| "runbook_action_refused"
		| "runbook_confidential_native_capability_absent"
		| "runbook_confidential_delivery_unavailable";
	message: string;
};

/**
 * The auth-delivery seam the CLI driver injects (auth plan U5/U11). Given the
 * plan's pending confidential item bindings, it yields the sensitive-interval
 * {@link AgentBrowserAuthDeliveryContext} the agent-browser executor routes each
 * confidential fill through — or a typed `blocked` outcome when the native
 * capability is present but the sensitive-interval transaction could not
 * complete (an unresolved binding, an unproven target). The seam is present ONLY
 * when a native Token Retrieval Port exists (the driver builds it from the
 * Browser Authentication provider); when the native capability is absent the
 * driver injects nothing and the engine fails closed on a typed repair pointer —
 * never a public bypass in either branch.
 */
export type BrowserUseRunbookAuthDeliveryOutcome =
	| { ok: true; context: AgentBrowserAuthDeliveryContext }
	| { ok: false; message: string };

export type BrowserUseRunbookAuthDelivery = (input: {
	pendingItemBindings: readonly string[];
	handoff: AgentBrowserVerifiedHandoff;
	runId: string;
	targetTabId: string;
}) => Promise<BrowserUseRunbookAuthDeliveryOutcome>;

/**
 * A runbook execution outcome. `refused` is a typed engine refusal reached
 * BEFORE any browser effect; `executed` carries the agent-browser executor's
 * structural truth verbatim plus the plan facts (resume index, total steps,
 * pending item bindings) the caller records onto the shared run.
 */
/**
 * One captured read-action outcome for the shared run (R21, R24): the bounded,
 * validated, redacted structured result, or a typed capture refusal that keeps
 * an unredactable or schema-mismatched read observation OUT of durable state
 * without inventing a success. `action_id` names the read action it came from.
 */
export type BrowserUseRunbookStructuredResult = BrowserUseRunStructuredResult;

type RawFreeAgentBrowserExecutionResult =
	AgentBrowserExecutionResult extends infer Result
		? Result extends unknown
			? Omit<Result, "read_results">
			: never
		: never;

export type BrowserUseRunbookExecutionResult =
	| { ok: false; refusal: BrowserUseRunbookExecutionRefusal }
	| {
			ok: true;
			plan: BrowserUseRunbookExecutionPlan;
			/**
			 * Structural executor truth only. Raw read observations are consumed at
			 * this boundary and cannot escape through the public result type.
			 */
			result: RawFreeAgentBrowserExecutionResult;
			/**
			 * Bounded structured results captured from this run's read actions
			 * (R21, R24), in executor order. Present only when a read action ran and
			 * confirmed; the caller records these onto the shared run. A capture
			 * refusal rides here too so an unredactable read never silently vanishes.
			 */
			structured_results?: readonly BrowserUseRunbookStructuredResult[];
	  };

type BrowserUseRunbookExecutionPlan = Pick<
	BrowserUseRunbookPlan,
	| "service_id"
	| "flow_id"
	| "version"
	| "resume_from_step"
	| "total_steps"
	| "pending_item_bindings"
>;

function executionPlanOf(
	plan: BrowserUseRunbookPlan,
): BrowserUseRunbookExecutionPlan {
	return {
		service_id: plan.service_id,
		flow_id: plan.flow_id,
		version: plan.version,
		resume_from_step: plan.resume_from_step,
		total_steps: plan.total_steps,
		pending_item_bindings: plan.pending_item_bindings,
	};
}

export type BrowserUsePreparedRunbookExecution =
	| { ok: false; refusal: BrowserUseRunbookExecutionRefusal }
	| { ok: true; plan: BrowserUseRunbookPlan };

/**
 * The single allowed origin a reviewed action resolves against: a runbook that
 * declares reviewed actions must declare EXACTLY ONE allowed origin so the
 * action's exact allowed origin is unambiguous (R17). A runbook with reviewed
 * actions and multiple origins is refused before any resolution.
 */
function singleAllowedOrigin(
	runbook: BrowserUseRunbook,
): { ok: true; origin: string } | { ok: false } {
	return runbook.allowed_origins.length === 1 && runbook.allowed_origins[0] !== undefined
		? { ok: true, origin: runbook.allowed_origins[0] }
		: { ok: false };
}

// Substitute the runbook's typed inputs into an action step's declared input
// map: each value is a scalar token or an already-structured input value keyed
// by input id. `{{id}}` tokens resolve to the input value verbatim (structured
// values pass through unchanged; scalar values render as the raw value).
function resolveActionInputs(
	declared: Readonly<Record<string, string>>,
	inputs: BrowserUseRunbookInputs,
): Readonly<Record<string, unknown>> {
	const out: Record<string, unknown> = {};
	for (const [key, token] of Object.entries(declared)) {
		const match = /^\{\{([a-z0-9_]+)\}\}$/.exec(token);
		if (match?.[1] === undefined) {
			out[key] = token;
			continue;
		}
		const resolved = inputs[match[1]];
		if (resolved !== undefined) out[key] = resolved;
	}
	return out;
}

/**
 * Resolve every `action`/`iterate` step in a runbook into engine-verified
 * executor `evaluate` steps (U3, R16-R23). Each action is resolved ONLY through
 * the injected generation seam and the content-addressed reviewed-action
 * registry; any refusal (candidate, changed digest, wrong origin, undeclared
 * effect, invalid input, missing postcondition, unsupported containment) fails
 * closed BEFORE any executor step is built. An `iterate` step expands into one
 * verified action step per stable item key drawn from its `over_input` array.
 *
 * @returns A map (absolute step index -> verified executor steps), or the first
 *   typed action refusal.
 */
async function resolveRunbookActionSteps(
	runbook: BrowserUseRunbook,
	inputs: BrowserUseRunbookInputs,
	seam: BrowserUseActionGenerationSeam,
): Promise<
	| {
			ok: true;
			resolved: ReadonlyMap<number, readonly AgentBrowserTaskStep[]>;
			readActionMeta: Readonly<
				Record<string, BrowserUseRunbookReadActionMeta>
			>;
	  }
	| { ok: false; refusal: BrowserUseReviewedActionRefusal }
> {
	const origin = singleAllowedOrigin(runbook);
	const resolved = new Map<number, readonly AgentBrowserTaskStep[]>();
	// Result schema + sensitivity for each read action execution, keyed by its
	// action + optional item identity so iterated reads cannot overwrite one
	// another's capture policy (R21, R24). A mutation contributes nothing here.
	const readActionMeta: Record<string, BrowserUseRunbookReadActionMeta> = {};
	const recordReadMeta = (
		resolvedAction: BrowserUseResolvedReviewedAction,
		itemKey?: string,
	) => {
		if (resolvedAction.effect_class === "read") {
			readActionMeta[`${resolvedAction.step.action_id}:${itemKey ?? ""}`] = {
				result_schema: resolvedAction.result_schema,
				result_sensitivity: resolvedAction.result_sensitivity,
			};
		}
	};
	for (const [index, step] of runbook.steps.entries()) {
		if (step.kind !== "action" && step.kind !== "iterate") continue;
		if (!origin.ok) {
			return {
				ok: false,
				refusal: {
					code: "action_origin_invalid",
					message:
						"a runbook declaring reviewed actions must declare exactly one exact allowed origin.",
				},
			};
		}
		if (step.kind === "action") {
			const one = await resolveReviewedAction({
				actionId: step.action_id,
				expectedDigest: step.expected_digest,
				requestedOrigin: origin.origin,
				inputs: resolveActionInputs(step.inputs, inputs),
				seam,
			});
			if (!one.ok) return { ok: false, refusal: one.refusal };
			recordReadMeta(one.resolved);
			resolved.set(index, [one.resolved.step]);
			continue;
		}
		// iterate: one verified action per stable item key from `over_input`.
		const overRaw = inputs[step.over_input];
		if (!itemKeysAreValid(overRaw)) {
			return {
				ok: false,
				refusal: {
					code: "action_input_rejected",
					message:
						"iterate input must be a non-empty bounded sequence of unique safe stable item keys.",
				},
			};
		}
		const itemKeys = overRaw;
		const steps: AgentBrowserTaskStep[] = [];
		for (const key of itemKeys) {
			const perItemInputs = resolveActionInputs(step.step.inputs, inputs);
			const one = await resolveReviewedAction({
				actionId: step.step.action_id,
				expectedDigest: step.step.expected_digest,
				requestedOrigin: origin.origin,
				inputs: { ...perItemInputs, item_key: key },
				seam,
			});
			if (!one.ok) return { ok: false, refusal: one.refusal };
			recordReadMeta(one.resolved, key);
			// Each evaluated action invalidates task-local snapshot freshness. Give
			// every iterated item its own fresh structural observation so item N+1
			// never runs against item N's stale page state.
			steps.push(
				{ kind: "snapshot", interactive: false },
				{ ...one.resolved.step, item_key: key },
			);
		}
		resolved.set(index, steps);
	}
	return { ok: true, resolved, readActionMeta };
}

/**
 * Load and compile one runbook before any target, auth, or durable-run effect.
 * When the runbook declares reviewed-action or iteration steps, an
 * `actionSeam` MUST be supplied so each action resolves through a staged/active
 * generation and its content-addressed registry (U3); without it, an action
 * step refuses `runbook_action_registry_unavailable`.
 */
export async function prepareRunbookExecution(
	fs: BrowserUsePlatformFs,
	dataRoot: string,
	input: {
		serviceId: string;
		flowId: string;
		inputs: BrowserUseRunbookInputs;
		resumeFromStep: number;
		actionSeam?: BrowserUseActionGenerationSeam;
	},
): Promise<BrowserUsePreparedRunbookExecution> {
	const shown = await showRunbook(fs, dataRoot, {
		serviceId: input.serviceId,
		flowId: input.flowId,
	});
	if (!shown.ok) return { ok: false, refusal: shown.failure };
	const normalizedInputs = materializeRunbookInputs(
		shown.runbook,
		input.inputs,
	);
	let resolvedActionSteps:
		| ReadonlyMap<number, readonly AgentBrowserTaskStep[]>
		| undefined;
	let readActionMeta:
		| Readonly<Record<string, BrowserUseRunbookReadActionMeta>>
		| undefined;
	const hasActionSteps = shown.runbook.steps.some(
		(step: BrowserUseRunbookStep) =>
			step.kind === "action" || step.kind === "iterate",
	);
	if (hasActionSteps && input.actionSeam !== undefined) {
		const resolution = await resolveRunbookActionSteps(
			shown.runbook,
			normalizedInputs,
			input.actionSeam,
		);
		if (!resolution.ok) {
			return {
				ok: false,
				refusal: {
					code: "runbook_action_refused",
					message: `reviewed action refused (${resolution.refusal.code}): ${resolution.refusal.message}`,
				},
			};
		}
		resolvedActionSteps = resolution.resolved;
		readActionMeta = resolution.readActionMeta;
	}
	const planned = planRunbookExecution(shown.runbook, {
		inputs: normalizedInputs,
		resumeFromStep: input.resumeFromStep,
		...(resolvedActionSteps !== undefined ? { resolvedActionSteps } : {}),
		...(readActionMeta !== undefined ? { readActionMeta } : {}),
	});
	return planned.ok
		? { ok: true, plan: planned.plan }
		: { ok: false, refusal: planned.refusal };
}

/**
 * Execute an already-compiled plan against one exact, preflighted target.
 */
export async function executePreparedRunbook(
	deps: {
		runtime: AgentBrowserExecutionRuntime;
		authDelivery?: BrowserUseRunbookAuthDelivery;
		afterNeutralOpen?: (nextStep: number) => Promise<boolean>;
	},
	input: {
		plan: BrowserUseRunbookPlan;
		handoff: AgentBrowserVerifiedHandoff;
		runId: string;
		targetTabId: string;
		expectedTargetUrl?: string;
	},
): Promise<BrowserUseRunbookExecutionResult> {
	const plan = input.plan;
	const neutralOpen = plan.steps[0]?.kind === "open" ? plan.steps[0] : undefined;
	if (
		input.expectedTargetUrl === "about:blank" &&
		neutralOpen !== undefined &&
		plan.pending_item_bindings.length > 0 &&
		deps.afterNeutralOpen === undefined
	) {
		return {
			ok: false,
			refusal: {
				code: "runbook_neutral_checkpoint_unavailable",
				message:
					"a confidential runbook starting from about:blank requires a durable checkpoint after its first open and before authentication.",
			},
		};
	}
	let completedNeutralOpen: AgentBrowserExecutionResult | undefined;
	if (
		input.expectedTargetUrl === "about:blank" &&
		neutralOpen !== undefined &&
		plan.pending_item_bindings.length > 0 &&
		deps.afterNeutralOpen !== undefined
	) {
		completedNeutralOpen = await executeAgentBrowserTask(deps.runtime, {
			handoff: input.handoff,
			run_id: input.runId,
			target_tab_id: input.targetTabId,
			allowed_origins: plan.allowed_origins,
			steps: [neutralOpen],
			allow_neutral_target: true,
			...(input.expectedTargetUrl !== undefined
				? { expected_target_url: input.expectedTargetUrl }
				: {}),
		});
		if (!completedNeutralOpen.ok) {
			return {
				ok: true,
				plan: executionPlanOf(plan),
				result: completedNeutralOpen,
			};
		}
		const checkpointed = await deps.afterNeutralOpen(
			plan.resume_from_step + 1,
		);
		if (!checkpointed) {
			return {
				ok: true,
				plan: executionPlanOf(plan),
				result: {
					ok: false,
					code: "agent_browser_mutation_effect_unknown",
					outcome: "unknown",
					message:
						"the neutral opening navigation confirmed, but its durable runbook checkpoint could not be recorded; inspect before retry.",
					executed_steps: 1,
					mutation_dispatched: true,
				},
			};
		}
	}
	let authDelivery: AgentBrowserAuthDeliveryContext | undefined;
	if (plan.pending_item_bindings.length > 0) {
		if (deps.authDelivery === undefined) {
			return {
				ok: false,
				refusal: {
					code: "runbook_confidential_native_capability_absent",
					message:
						"the runbook has a confidential field; confidential delivery must go through the Browser Authentication Transaction, whose native Token Retrieval capability is absent on this machine. Acquire the native capability before running this runbook.",
				},
			};
		}
		const built = await deps.authDelivery({
			pendingItemBindings: plan.pending_item_bindings,
			handoff: input.handoff,
			runId: input.runId,
			targetTabId: input.targetTabId,
		});
		if (!built.ok) {
			return {
				ok: false,
				refusal: {
					code: "runbook_confidential_delivery_unavailable",
					message: built.message,
				},
			};
		}
		authDelivery = built.context;
	}
	const task: AgentBrowserTask = {
		handoff: input.handoff,
		run_id: input.runId,
		target_tab_id: input.targetTabId,
		allowed_origins: plan.allowed_origins,
		steps:
			completedNeutralOpen === undefined ? plan.steps : plan.steps.slice(1),
		allow_neutral_target:
			completedNeutralOpen === undefined && plan.steps[0]?.kind === "open",
		...(input.expectedTargetUrl !== undefined
			? {
					expected_target_url:
						completedNeutralOpen === undefined
							? input.expectedTargetUrl
							: neutralOpen?.url,
				}
			: {}),
		...(authDelivery !== undefined ? { auth_delivery: authDelivery } : {}),
	};
	if (task.steps.length === 0 && completedNeutralOpen !== undefined) {
		return {
			ok: true,
			plan: executionPlanOf(plan),
			result: completedNeutralOpen,
		};
	}
	const result = await executeAgentBrowserTask(deps.runtime, task);
	const combinedResult: AgentBrowserExecutionResult =
		completedNeutralOpen === undefined
			? result
			: {
					...result,
					executed_steps:
						completedNeutralOpen.executed_steps + result.executed_steps,
					mutation_dispatched:
						completedNeutralOpen.mutation_dispatched ||
						result.mutation_dispatched,
				};
	const structuredResults = captureRunbookReadResults(
		combinedResult,
		plan.read_action_meta,
	);
	const structuralResult: RawFreeAgentBrowserExecutionResult = combinedResult.ok
		? (({ read_results: _rawReadResults, ...result }) => result)(combinedResult)
		: combinedResult;
	return {
		ok: true,
		plan: executionPlanOf(plan),
		result: structuralResult,
		...(structuredResults.length > 0
			? { structured_results: structuredResults }
			: {}),
	};
}

/**
 * Validate + redact each confirmed read action's raw observation into a bounded
 * structured result for the shared run (R21, R24). A read result whose action
 * has no result-schema meta is skipped (it was not a read action). A payload
 * that is unredactable or schema-mismatched becomes a typed capture refusal —
 * it never enters durable state as a fabricated success. High-sensitivity or
 * oversized read payloads spill through `captureStructuredResult`'s governed-
 * artifact minter; U4 keeps Oncore grid state bounded + low-sensitivity so it
 * stays inline, and a spill demand fails closed as a capture refusal until a
 * retention-owned minter is wired (U6/U8), never silently inlining a large or
 * sensitive payload.
 */
function captureRunbookReadResults(
	result: AgentBrowserExecutionResult,
	readActionMeta: Readonly<Record<string, BrowserUseRunbookReadActionMeta>>,
): readonly BrowserUseRunbookStructuredResult[] {
	if (!result.ok || result.read_results === undefined) return [];
	const captured: BrowserUseRunbookStructuredResult[] = [];
	for (const read of result.read_results) {
		const meta =
			readActionMeta[`${read.action_id}:${read.item_key ?? ""}`];
		if (meta === undefined) {
			// The executor only emits `read_results` for read `evaluate` steps, so
			// a missing meta entry is an identity/planning mismatch (e.g. an item
			// key that did not round-trip), NOT "this wasn't a read". Dropping the
			// observation silently would discard a captured read with no durable
			// trace; fail closed with a typed refusal instead, consistent with the
			// spillover path's fail-closed posture.
			captured.push({
				ok: false,
				action_id: read.action_id,
				...(read.item_key !== undefined ? { item_key: read.item_key } : {}),
				refusal: {
					code: "structured_result_metadata_missing",
					message:
						"a read result was emitted with no matching result-schema metadata; its action id / item key did not resolve to a planned read action, so the observation is withheld from durable state.",
				},
			});
			continue;
		}
		// U4 has no retention-owned artifact minter yet: a read that demands
		// spillover (oversized or high-sensitivity) fails closed as a typed
		// capture refusal rather than silently inlining. The minter's sentinel
		// return sets a side flag converted below. U6/U8 supply the real
		// governed-artifact minter.
		let spillDemanded = false;
		const capture = captureStructuredResult({
			value: read.data,
			schema: meta.result_schema,
			sensitivity: meta.result_sensitivity,
			spillToGovernedArtifact: () => {
				spillDemanded = true;
				return "";
			},
		});
		if (spillDemanded) {
			captured.push({
				ok: false,
				action_id: read.action_id,
				...(read.item_key !== undefined ? { item_key: read.item_key } : {}),
				refusal: {
					code: "structured_result_spillover_unavailable",
					message:
						"the read result requires a governed artifact (oversized or high-sensitivity), but no retention-owned minter is wired in this generation; it is withheld from durable state.",
				},
			});
			continue;
		}
		if (capture.ok) {
			captured.push({
				ok: true,
				action_id: read.action_id,
				...(read.item_key !== undefined ? { item_key: read.item_key } : {}),
				outcome: capture.outcome,
			});
			continue;
		}
		captured.push({
			ok: false,
			action_id: read.action_id,
			...(read.item_key !== undefined ? { item_key: read.item_key } : {}),
			refusal: capture.refusal,
		});
	}
	return captured;
}

/**
 * Execute one runbook through the agent-browser lane (R30, F7). The engine
 * loads and validates the runbook, plans the bounded steps from
 * `resumeFromStep` onward (F7 restart-safe resume), then routes any confidential
 * step through the caller-injected auth-delivery seam (R30 — this engine never
 * resolves a secret; the executor owns the sensitive-interval choreography). A
 * confidential runbook with no seam injected (native capability absent) refuses
 * closed with a typed repair pointer. The compiled steps then bind to the
 * existing agent-browser executor and its structural truth returns verbatim.
 *
 * The caller (the CLI driver) owns durable shared-run state: it records the
 * executor's terminal/blocked truth through the fenced run-store pipeline, and
 * on a confirmed partial run advances the persisted resume index by
 * `resume_from_step + executed_steps` so a later resume replays only unproven
 * steps.
 *
 * A caller starting a confidential runbook from `about:blank` supplies both
 * `expectedTargetUrl` and `afterNeutralOpen`. The hook must durably checkpoint
 * the confirmed first open before authentication construction can proceed.
 *
 * @param deps - fs port, runtime, data root, auth and neutral checkpoint seams
 * @param input - Runbook id, handoff, target tab and URL, inputs, resume index
 * @returns One typed refusal, or the executor's structural result plus plan facts
 */
export async function runRunbook(
	deps: {
		fs: BrowserUsePlatformFs;
		runtime: AgentBrowserExecutionRuntime;
		dataRoot: string;
		/**
		 * Auth-delivery seam (auth plan U11). Present ONLY when the native Token
		 * Retrieval Port exists; absence means the native auth capability is
		 * absent, so a confidential runbook fails closed with a typed repair
		 * pointer rather than dispatching an unauthenticated fill.
		 */
		authDelivery?: BrowserUseRunbookAuthDelivery;
		/**
		 * Durable checkpoint after a neutral first open. Required with
		 * `expectedTargetUrl: "about:blank"` for confidential runbooks.
		 */
		afterNeutralOpen?: (nextStep: number) => Promise<boolean>;
		/**
		 * The staged/active generation seam that resolves reviewed-action assets
		 * (U3). Required for a runbook declaring `action`/`iterate` steps; absent
		 * for action-free runbooks.
		 */
		actionSeam?: BrowserUseActionGenerationSeam;
	},
	input: {
		serviceId: string;
		flowId: string;
		handoff: AgentBrowserVerifiedHandoff;
		runId: string;
		targetTabId: string;
		expectedTargetUrl?: string;
		inputs: BrowserUseRunbookInputs;
		resumeFromStep: number;
	},
): Promise<BrowserUseRunbookExecutionResult> {
	const prepared = await prepareRunbookExecution(deps.fs, deps.dataRoot, {
		serviceId: input.serviceId,
		flowId: input.flowId,
		inputs: input.inputs,
		resumeFromStep: input.resumeFromStep,
		...(deps.actionSeam !== undefined ? { actionSeam: deps.actionSeam } : {}),
	});
	if (!prepared.ok) return prepared;
	return await executePreparedRunbook(
		{
			runtime: deps.runtime,
			...(deps.authDelivery !== undefined
				? { authDelivery: deps.authDelivery }
				: {}),
			...(deps.afterNeutralOpen !== undefined
				? { afterNeutralOpen: deps.afterNeutralOpen }
				: {}),
		},
		{
			plan: prepared.plan,
			handoff: input.handoff,
			runId: input.runId,
			targetTabId: input.targetTabId,
			...(input.expectedTargetUrl !== undefined
				? { expectedTargetUrl: input.expectedTargetUrl }
				: {}),
		},
	);
}

// --- Effective-catalog resolver + shadow matrix (R7, R14) --------------------

/**
 * The three shadow layers, highest precedence first (R7):
 *   - `active-generation`: the future active Corpus Generation (U8). In U2 no
 *     generation is activated, so the seam is an INTERFACE the resolver reads
 *     through; a caller with an active generation plugs its records in here.
 *   - `compat-xdg`: the operator-authored XDG data-root store
 *     (`runbooksRoot(dataRoot)`) — a compatibility override.
 *   - `shipped-base`: the immutable code-owned shipped catalog.
 * List/show/run all resolve through this one matrix.
 */
export const BROWSER_USE_RUNBOOK_EFFECTIVE_SOURCES = [
	"active-generation",
	"compat-xdg",
	"shipped-base",
] as const;

/** Effective-source union (R7). */
export type BrowserUseRunbookEffectiveSource =
	(typeof BROWSER_USE_RUNBOOK_EFFECTIVE_SOURCES)[number];

/**
 * The active-generation seam (R7 interface). A future active generation (U8)
 * loads one runbook record for an id from its immutable generation store. A
 * record at this layer that is corrupt or invalid FAILS CLOSED at this layer
 * and never falls through to a lower layer. In U2 this seam is not supplied, so
 * the resolver starts at the compat-xdg layer. `absent` lets the resolver
 * descend to the next layer only when this layer holds NO record for the id.
 */
export type BrowserUseActiveGenerationSeam = {
	/**
	 * @returns the layer's outcome for one id: a valid runbook, a typed
	 * fail-closed failure, or clean absence (descend to the next layer).
	 */
	loadRunbook(id: {
		serviceId: string;
		flowId: string;
	}): Promise<
		| { ok: true; runbook: BrowserUseRunbook; health: BrowserUseRunbookHealth }
		| { ok: false; absent: true }
		| { ok: false; absent: false; failure: BrowserUseRunbookDiscoveryFailure }
	>;
	/** Every id the active generation declares (for whole-catalog verification). */
	listIds(): Promise<readonly { serviceId: string; flowId: string }[]>;
};

/**
 * One resolved effective-catalog record: the id, the effective source it came
 * from, and either the validated runbook or the typed failure that record hit
 * at its resolving layer (R14 — a corrupt record never silently disappears).
 */
export type BrowserUseEffectiveCatalogEntry = {
	service_id: string;
	flow_id: string;
	effective_source: BrowserUseRunbookEffectiveSource;
	version?: string;
} & (
	| { ok: true; runbook: BrowserUseRunbook; health: BrowserUseRunbookHealth }
	| { ok: false; failure: BrowserUseRunbookDiscoveryFailure }
);

/**
 * Resolve ONE id through the shadow matrix (R7). Highest present layer wins; a
 * corrupt/invalid record at a layer FAILS CLOSED at that layer (never falls
 * through to a lower layer). Absent-only descends. This is the single owner
 * list/show/run resolve through so precedence and fail-closed behavior can
 * never diverge across the three commands.
 *
 * @param fs - Platform fs port
 * @param dataRoot - The admitted `paths.data.root`
 * @param id - Service and flow id
 * @param seam - The optional active-generation layer (U8); absent in U2
 * @returns One resolved effective-catalog entry, or `undefined` when no layer
 *   holds the id at all
 */
export async function resolveEffectiveRunbook(
	fs: BrowserUsePlatformFs,
	dataRoot: string,
	id: { serviceId: string; flowId: string },
	seam?: BrowserUseActiveGenerationSeam,
): Promise<BrowserUseEffectiveCatalogEntry | undefined> {
	if (seam !== undefined) {
		const fromGeneration = await seam.loadRunbook(id);
		if (fromGeneration.ok) {
			return {
				service_id: id.serviceId,
				flow_id: id.flowId,
				effective_source: "active-generation",
				version: fromGeneration.runbook.version,
				ok: true,
				runbook: fromGeneration.runbook,
				health: fromGeneration.health,
			};
		}
		// A corrupt/invalid higher-priority record fails closed at this layer.
		if (!fromGeneration.absent) {
			return {
				service_id: id.serviceId,
				flow_id: id.flowId,
				effective_source: "active-generation",
				ok: false,
				failure: fromGeneration.failure,
			};
		}
	}
	const fromStore = await loadRunbookFromRoot(fs, runbooksRoot(dataRoot), id);
	if (fromStore.ok) {
		return {
			service_id: id.serviceId,
			flow_id: id.flowId,
			effective_source: "compat-xdg",
			version: fromStore.runbook.version,
			ok: true,
			runbook: fromStore.runbook,
			health: fromStore.health,
		};
	}
	if (!fromStore.absent) {
		return {
			service_id: id.serviceId,
			flow_id: id.flowId,
			effective_source: "compat-xdg",
			ok: false,
			failure: fromStore.failure,
		};
	}
	const fromShipped = await loadRunbookFromRoot(fs, shippedRunbooksRoot(), id);
	if (fromShipped.ok) {
		return {
			service_id: id.serviceId,
			flow_id: id.flowId,
			effective_source: "shipped-base",
			version: fromShipped.runbook.version,
			ok: true,
			runbook: fromShipped.runbook,
			health: fromShipped.health,
		};
	}
	if (!fromShipped.absent) {
		return {
			service_id: id.serviceId,
			flow_id: id.flowId,
			effective_source: "shipped-base",
			ok: false,
			failure: fromShipped.failure,
		};
	}
	return undefined;
}

/**
 * Whole-catalog verification (R14): resolve EVERY id any layer declares through
 * the shadow matrix and report, per id, the expected id, its effective source,
 * generation/version, and either the validated runbook or the typed failure the
 * resolving layer hit. An invalid or corrupt record never disappears — it
 * surfaces here as a failed entry at its own effective source.
 *
 * @param fs - Platform fs port
 * @param dataRoot - The admitted `paths.data.root`
 * @param seam - The optional active-generation layer (U8); absent in U2
 * @returns Every resolved entry, sorted by service then flow id
 */
export async function verifyEffectiveCatalog(
	fs: BrowserUsePlatformFs,
	dataRoot: string,
	seam?: BrowserUseActiveGenerationSeam,
): Promise<readonly BrowserUseEffectiveCatalogEntry[]> {
	const ids = new Map<string, { serviceId: string; flowId: string }>();
	const collect = async (root: string): Promise<void> => {
		const rootStat = await fs.lstat(root);
		if (rootStat === undefined || rootStat.kind !== "directory") return;
		for (const serviceId of await fs.readDirectory(root)) {
			if (!SAFE_SEGMENT.test(serviceId)) continue;
			const serviceDir = join(root, serviceId);
			const serviceStat = await fs.lstat(serviceDir);
			if (serviceStat === undefined || serviceStat.kind !== "directory") continue;
			for (const flowId of await fs.readDirectory(serviceDir)) {
				if (!SAFE_SEGMENT.test(flowId)) continue;
				ids.set(`${serviceId}/${flowId}`, { serviceId, flowId });
			}
		}
	};
	if (seam !== undefined) {
		for (const id of await seam.listIds()) {
			ids.set(`${id.serviceId}/${id.flowId}`, id);
		}
	}
	await collect(runbooksRoot(dataRoot));
	await collect(shippedRunbooksRoot());
	const entries: BrowserUseEffectiveCatalogEntry[] = [];
	for (const id of ids.values()) {
		const resolved = await resolveEffectiveRunbook(fs, dataRoot, id, seam);
		if (resolved !== undefined) entries.push(resolved);
	}
	return entries.sort((a, b) => {
		if (a.service_id !== b.service_id) return a.service_id < b.service_id ? -1 : 1;
		return a.flow_id < b.flow_id ? -1 : a.flow_id > b.flow_id ? 1 : 0;
	});
}

// --- Private-file structured-input route (R10, R41) --------------------------

/** Bounded private-file JSON input ceiling (R10): refuse oversized content. */
export const RUNBOOK_PRIVATE_INPUT_MAX_BYTES = 64 * 1024;

/** Typed private-file input refusal. Never carries the value or source path. */
export type BrowserUseRunbookPrivateInputRefusal = {
	code:
		| "private_input_path_unsafe"
		| "private_input_open_failed"
		| "private_input_not_regular"
		| "private_input_wrong_owner"
		| "private_input_mode_loose"
		| "private_input_multiple_links"
		| "private_input_oversize"
		| "private_input_json_invalid"
		| "private_input_shape_invalid";
	message: string;
};

/**
 * A single admitted private-file structured-input read (R10/R41). One value id
 * carries a structured value the runbook's typed-input schema then validates.
 * The path and value NEVER appear in argv, output, receipts, or provenance —
 * callers pass this map straight into the input binding.
 */
export type BrowserUseRunbookPrivateInputResult =
	| { ok: true; inputs: Readonly<Record<string, unknown>> }
	| { ok: false; refusal: BrowserUseRunbookPrivateInputRefusal };

function privateInputRefusal(
	code: BrowserUseRunbookPrivateInputRefusal["code"],
	message: string,
): { ok: false; refusal: BrowserUseRunbookPrivateInputRefusal } {
	// Redaction is a safety net; the message names the failed check, never bytes.
	return { ok: false, refusal: { code, message: redactUnsafeText(message) } };
}

// Prove containment beneath the admitted input root WITHOUT following symlinks
// (a path check on the normalized strings, not a realpath resolution — the
// no-follow open below is the enforcement, this is the pre-open path gate).
function containedBeneath(root: string, candidate: string): boolean {
	const normalizedRoot = normalize(resolve(root));
	const normalizedCandidate = normalize(resolve(candidate));
	if (normalizedCandidate === normalizedRoot) return false; // a file, not the root itself
	const rel = relative(normalizedRoot, normalizedCandidate);
	return (
		rel.length > 0 &&
		!rel.startsWith("..") &&
		!isAbsolute(rel) &&
		!rel.split(sep).includes("..")
	);
}

// Reject a symlink (or non-directory) at the admitted root or any intermediate
// path component before opening the final file. Node exposes no portable
// openat(2)-style API that can anchor each lookup to the previously-opened
// directory descriptor, so an attacker able to rename an ancestor can still
// race this check and the final open. The final component remains protected by
// O_NOFOLLOW, and every file invariant remains descriptor-checked after open.
async function intermediatePathIsSymlinkFree(
	root: string,
	candidate: string,
): Promise<boolean> {
	const normalizedRoot = normalize(resolve(root));
	const rel = relative(normalizedRoot, normalize(resolve(candidate)));
	const components = rel.split(sep);
	const directories = [
		normalizedRoot,
		...components.slice(0, -1).map((_component, index) =>
			join(normalizedRoot, ...components.slice(0, index + 1)),
		),
	];
	for (const directory of directories) {
		try {
			const stat = await fsLstat(directory);
			if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
		} catch {
			return false;
		}
	}
	return true;
}

function boundedPrivateInputMaxBytes(requested: number | undefined): number {
	if (requested === undefined || !Number.isFinite(requested)) {
		return RUNBOOK_PRIVATE_INPUT_MAX_BYTES;
	}
	return Math.max(
		0,
		Math.min(Math.floor(requested), RUNBOOK_PRIVATE_INPUT_MAX_BYTES),
	);
}

/**
 * Read ONE bounded private-file JSON structured input (R10, KTD14). The
 * security contract, all proven BEFORE any value byte is read:
 *   1. the path is absolute and contained beneath the admitted input root;
 *   2. the admitted root and every intermediate component are directories, not
 *      symlinks, then the file opens with O_NOFOLLOW (a symlink at the final
 *      component fails the open);
 *   3. descriptor-level `fstat` (never a path stat that a swap could race)
 *      proves: a regular file, the expected owner, owner-only mode (0600 or
 *      stricter), link count EXACTLY one (no hard-link alias), and bounded size;
 *   4. at most the capped bound plus one byte is read through THAT descriptor,
 *      then parsed and shape-checked.
 * Static intermediate symlinks, final-component replacement/symlink attempts,
 * hard links, and path escapes fail closed. Node has no portable descriptor-
 * relative open, so the pre-open intermediate check cannot eliminate an
 * atomic ancestor-rename race. The value id is `inputId`; the returned map
 * carries only the structured value.
 *
 * @param input - The input id, admitted input root, absolute file path, and the
 *   expected owner uid (defaults to the process uid)
 * @returns The structured input map, or one typed refusal
 */
export async function readPrivateStructuredInput(input: {
	inputId: string;
	inputRoot: string;
	filePath: string;
	expectedOwnerUid?: number;
	maxBytes?: number;
}): Promise<BrowserUseRunbookPrivateInputResult> {
	const maxBytes = boundedPrivateInputMaxBytes(input.maxBytes);
	const expectedUid = input.expectedOwnerUid ?? process.getuid?.();
	if (!isAbsolute(input.filePath) || !containedBeneath(input.inputRoot, input.filePath)) {
		return privateInputRefusal(
			"private_input_path_unsafe",
			"the private input path is not an absolute file contained beneath the admitted input root.",
		);
	}
	if (!(await intermediatePathIsSymlinkFree(input.inputRoot, input.filePath))) {
		return privateInputRefusal(
			"private_input_path_unsafe",
			"the private input path has a symlink or non-directory before its final component.",
		);
	}
	// Open ONCE with no-follow: a symlink at the final component fails here, so a
	// symlink redirect (and a race that swaps a regular file for a symlink) can
	// never be dereferenced. Every check below reads THIS descriptor's fstat.
	let handle: import("node:fs/promises").FileHandle;
	try {
		handle = await fsOpen(
			input.filePath,
			fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
		);
	} catch {
		return privateInputRefusal(
			"private_input_open_failed",
			"the private input file could not be opened with no-follow semantics (missing file, a symlink at the final component, or a permission error).",
		);
	}
	try {
		const stat = await handle.stat();
		if (!stat.isFile()) {
			return privateInputRefusal(
				"private_input_not_regular",
				"the private input descriptor is not a regular file.",
			);
		}
		if (expectedUid !== undefined && stat.uid !== expectedUid) {
			return privateInputRefusal(
				"private_input_wrong_owner",
				"the private input file is owned by another user.",
			);
		}
		if ((stat.mode & 0o077) !== 0) {
			return privateInputRefusal(
				"private_input_mode_loose",
				"the private input file carries group/other permission bits (owner-only mode required).",
			);
		}
		if (stat.nlink !== 1) {
			return privateInputRefusal(
				"private_input_multiple_links",
				"the private input file has a link count other than one (a hard-link alias is refused).",
			);
		}
		if (stat.size > maxBytes) {
			return privateInputRefusal(
				"private_input_oversize",
				`the private input file exceeds the ${maxBytes}-byte bound.`,
			);
		}
		// Only now, after every descriptor-level check passed, read the value
		// bytes through the same proven descriptor. The bounded buffer catches
		// growth after fstat without allocating from the concurrently-grown size.
		const buffer = Buffer.alloc(maxBytes + 1);
		let bytesRead = 0;
		while (bytesRead < buffer.length) {
			const chunk = await handle.read(
				buffer,
				bytesRead,
				buffer.length - bytesRead,
				bytesRead,
			);
			if (chunk.bytesRead === 0) break;
			bytesRead += chunk.bytesRead;
		}
		if (bytesRead > maxBytes) {
			return privateInputRefusal(
				"private_input_oversize",
				`the private input file exceeds the ${maxBytes}-byte bound.`,
			);
		}
		const raw = buffer.subarray(0, bytesRead).toString("utf8");
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			return privateInputRefusal(
				"private_input_json_invalid",
				"the private input file is not valid JSON.",
			);
		}
		return { ok: true, inputs: { [input.inputId]: parsed } };
	} finally {
		await handle.close();
	}
}
