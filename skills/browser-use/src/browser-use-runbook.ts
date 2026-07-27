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
// existing agent-browser executor per-step. Confidential steps refuse to the
// auth transaction inside the executor (R30) — this engine never resolves a
// secret and never becomes an auth delivery path.
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

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
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
	projectRunbookCatalogRow,
	planRunbookExecution,
	validateRunbook,
} from "./browser-use-runbook-model";

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
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		return discoveryFailure(
			"runbook_record_invalid",
			"runbook file is not a JSON object.",
		);
	}
	const runbook = parsed as BrowserUseRunbook;
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
		| "runbook_confidential_requires_auth_transaction";
	message: string;
};

/**
 * A runbook execution outcome. `refused` is a typed engine refusal reached
 * BEFORE any browser effect; `executed` carries the agent-browser executor's
 * structural truth verbatim plus the plan facts (resume index, total steps,
 * pending item bindings) the caller records onto the shared run.
 */
export type BrowserUseRunbookExecutionResult =
	| { ok: false; refusal: BrowserUseRunbookExecutionRefusal }
	| {
			ok: true;
			plan: Pick<
				BrowserUseRunbookPlan,
				| "service_id"
				| "flow_id"
				| "version"
				| "resume_from_step"
				| "total_steps"
				| "pending_item_bindings"
			>;
			result: AgentBrowserExecutionResult;
	  };

/**
 * Execute one runbook through the agent-browser lane (R30, F7). The engine
 * loads and validates the runbook, plans the bounded steps from
 * `resumeFromStep` onward (F7 restart-safe resume), refuses closed when a
 * confidential step is present but auth delivery is not wired here (R30 — this
 * engine never resolves a secret), then binds the compiled steps to the
 * existing agent-browser executor and returns its structural truth verbatim.
 *
 * The caller (the CLI driver) owns durable shared-run state: it records the
 * executor's terminal/blocked truth through the fenced run-store pipeline, and
 * on a confirmed partial run advances the persisted resume index by
 * `resume_from_step + executed_steps` so a later resume replays only unproven
 * steps.
 *
 * @param deps - fs port, agent-browser runtime, admitted data root
 * @param input - Runbook id, verified handoff, target tab, inputs, resume index
 * @returns One typed refusal, or the executor's structural result plus plan facts
 */
export async function runRunbook(
	deps: {
		fs: BrowserUsePlatformFs;
		runtime: AgentBrowserExecutionRuntime;
		dataRoot: string;
	},
	input: {
		serviceId: string;
		flowId: string;
		handoff: AgentBrowserVerifiedHandoff;
		runId: string;
		targetTabId: string;
		inputs: BrowserUseRunbookInputs;
		resumeFromStep: number;
	},
): Promise<BrowserUseRunbookExecutionResult> {
	const shown = await showRunbook(deps.fs, deps.dataRoot, {
		serviceId: input.serviceId,
		flowId: input.flowId,
	});
	if (!shown.ok) {
		return { ok: false, refusal: shown.failure };
	}
	const planned = planRunbookExecution(shown.runbook, {
		inputs: input.inputs,
		resumeFromStep: input.resumeFromStep,
	});
	if (!planned.ok) {
		return { ok: false, refusal: planned.refusal };
	}
	const plan = planned.plan;
	// R30 boundary: a confidential step needs the Browser Authentication
	// Transaction; this engine never resolves a secret, so a pending item
	// binding refuses closed with a repair pointer rather than dispatching an
	// empty confidential fill that the executor would refuse anyway. This keeps
	// the refusal at the engine seam where the auth continuation is named.
	if (plan.pending_item_bindings.length > 0) {
		return {
			ok: false,
			refusal: {
				code: "runbook_confidential_requires_auth_transaction",
				message:
					"the runbook has a confidential field; confidential delivery must go through the Browser Authentication Transaction, which is not wired into runbook run yet.",
			},
		};
	}
	const task: AgentBrowserTask = {
		handoff: input.handoff,
		run_id: input.runId,
		target_tab_id: input.targetTabId,
		allowed_origins: plan.allowed_origins,
		steps: plan.steps,
	};
	const result = await executeAgentBrowserTask(deps.runtime, task);
	return {
		ok: true,
		plan: {
			service_id: plan.service_id,
			flow_id: plan.flow_id,
			version: plan.version,
			resume_from_step: plan.resume_from_step,
			total_steps: plan.total_steps,
			pending_item_bindings: plan.pending_item_bindings,
		},
		result,
	};
}
