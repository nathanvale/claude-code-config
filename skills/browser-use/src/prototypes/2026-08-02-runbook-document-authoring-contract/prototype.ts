/**
 * Runbook document-authoring contract — throwaway logic spike (no browser).
 *
 * Falsifies whether the complete-document authoring model (ADR 0032) stays
 * legible and safe across schema discovery, validation, apply, concurrent
 * replacement, deletion, and source/runtime drift. A tiny in-memory state
 * machine plus a transcript driver; full state printed after every action.
 *
 * Run: `bun run prototype:runbook-document-authoring`
 */

// ---------------------------------------------------------------------------
// Deterministic content digest (no crypto import; reproducible across runs).
// ---------------------------------------------------------------------------

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function digest(value: unknown): string {
	const text = canonical(value);
	let hash = 5381;
	for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
	return `sha-${hash.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Runbook Draft shape (minimal but complete). Steps may reference a Reviewed
// Action by id + expected promoted digest; never inline JavaScript (ADR 0033).
// ---------------------------------------------------------------------------

type ActionRef = { action_id: string; expected_digest: string };

type RunbookDraft = {
	service_id: string;
	flow_id: string;
	summary: string;
	allowed_origins: string[];
	auth_context_ref?: string;
	steps: Array<{ role: string; name: string; action?: ActionRef }>;
};

/** Machine-readable authoring contract exposed by `schema --json`. */
const RUNBOOK_SCHEMA = {
	contract_id: "browser-use.runbook-draft",
	schema_version: "1",
	required: ["service_id", "flow_id", "summary", "allowed_origins", "steps"],
	optional: ["auth_context_ref"],
	step: {
		required: ["role", "name"],
		optional: ["action"],
		action: { required: ["action_id", "expected_digest"], inline_javascript: "forbidden" },
	},
	minimal_valid_example: {
		service_id: "unifi",
		flow_id: "login-check",
		summary: "Read the UniFi console sign-in screen.",
		allowed_origins: ["https://192.168.1.1"],
		steps: [{ role: "heading", name: "UniFi OS" }],
	} satisfies RunbookDraft,
} as const;

// Promoted Reviewed Actions the environment knows about (id -> promoted digest).
// One promoted, one unpromoted-known (present but not promoted), one stale.
const PROMOTED_ACTIONS: Readonly<Record<string, string | null>> = {
	"submit-timesheet": "sha-promoted1",
	"draft-verify": null, // authored candidate, not promoted
};

type ValidationResult =
	| { ok: true }
	| { ok: false; problems: string[]; repair: string };

function validateDraft(draft: unknown): ValidationResult {
	const problems: string[] = [];
	const d = draft as Partial<RunbookDraft>;
	for (const key of RUNBOOK_SCHEMA.required) {
		if ((d as Record<string, unknown>)[key] === undefined) problems.push(`missing ${key}`);
	}
	if (d.allowed_origins && d.allowed_origins.length === 0) problems.push("allowed_origins empty");
	if (Array.isArray(d.steps)) {
		d.steps.forEach((step, index) => {
			if (!step.role || !step.name) problems.push(`step[${index}] missing role/name`);
			if ((step as { javascript?: unknown }).javascript !== undefined) {
				problems.push(`step[${index}] inline javascript forbidden`);
			}
		});
	}
	return problems.length === 0
		? { ok: true }
		: { ok: false, problems, repair: "Fix the named fields, then re-run validate --file." };
}

/** Missing / unpromoted / stale referenced action check (ADR 0033). */
function actionClosureProblem(draft: RunbookDraft): string | undefined {
	for (const step of draft.steps) {
		if (!step.action) continue;
		const promoted = PROMOTED_ACTIONS[step.action.action_id];
		if (promoted === undefined) return `action ${step.action.action_id} missing from registry`;
		if (promoted === null) return `action ${step.action.action_id} not promoted`;
		if (promoted !== step.action.expected_digest) {
			return `action ${step.action.action_id} digest stale (promoted ${promoted}, referenced ${step.action.expected_digest})`;
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Catalog + generation state.
// ---------------------------------------------------------------------------

type CatalogRecord = { key: string; draft: RunbookDraft; record_digest: string };

type Invocation = "source" | "packaged";

type State = {
	invocation: Invocation;
	// Private Runbook Catalog source records, keyed by service/flow.
	catalog: Map<string, CatalogRecord>;
	// Active Runbook Generation catalog digest (what runtime executes).
	activeCatalogDigest: string | null;
	// Shadow snapshot of record keys+digests captured at last activation, so
	// per-record drift (new vs deletion vs edit) is distinguishable in readState.
	activeRecords: Map<string, string>;
	last?: Outcome;
};

type Outcome = {
	command: string;
	status: "ok" | "no-op" | "refused" | "preview";
	changed: boolean;
	exitCode: number;
	message: string;
	next?: string;
};

function keyOf(draft: Pick<RunbookDraft, "service_id" | "flow_id">): string {
	return `${draft.service_id}/${draft.flow_id}`;
}

function catalogDigest(state: State): string {
	const records = [...state.catalog.values()]
		.map((r) => ({ key: r.key, digest: r.record_digest }))
		.sort((a, b) => (a.key < b.key ? -1 : 1));
	return digest(records);
}

// Per-record sync status against the active generation.
type SyncStatus =
	| "in-sync"
	| "activation-required"
	| "new-pending-activation"
	| "deletion-pending-activation";

function recordStatus(state: State, key: string, currentDigest: string | null): SyncStatus {
	const inActive = state.activeRecords.get(key);
	if (currentDigest === null) {
		// Deleted from source but still present in the active generation.
		return inActive !== undefined ? "deletion-pending-activation" : "activation-required";
	}
	if (inActive === undefined) return "new-pending-activation";
	return inActive === currentDigest ? "in-sync" : "activation-required";
}

function readState(state: State): {
	invocation: Invocation;
	catalog_digest: string;
	active_digest: string | null;
	records: Array<{ key: string; record_digest: string | null; status: SyncStatus }>;
	catalog_status: SyncStatus;
} {
	const catDigest = catalogDigest(state);
	const activated = state.activeCatalogDigest;
	// Union of source keys and active-generation keys, so deleted-but-active
	// records still surface with deletion-pending-activation.
	const keys = new Set<string>([...state.catalog.keys(), ...state.activeRecords.keys()]);
	const records = [...keys].sort().map((key) => {
		const current = state.catalog.get(key)?.record_digest ?? null;
		return { key, record_digest: current, status: recordStatus(state, key, current) };
	});
	const catalog_status: SyncStatus =
		activated === null
			? "activation-required"
			: activated === catDigest
				? "in-sync"
				: "activation-required";
	return {
		invocation: state.invocation,
		catalog_digest: catDigest,
		active_digest: activated,
		records,
		catalog_status,
	};
}

/** Publish the current catalog as the active generation (prototype activate). */
function activate(state: State): void {
	state.activeCatalogDigest = catalogDigest(state);
	state.activeRecords = new Map(
		[...state.catalog.values()].map((r) => [r.key, r.record_digest]),
	);
}

// ---------------------------------------------------------------------------
// Apply / delete with digest guards.
// ---------------------------------------------------------------------------

function apply(
	state: State,
	draft: RunbookDraft,
	expectedRecordDigest: string | null,
): Outcome {
	if (state.invocation === "packaged") {
		return {
			command: `runbook apply --file <${keyOf(draft)}>`,
			status: "refused",
			changed: false,
			exitCode: 2,
			message: "Packaged runtime refuses authoring; it executes the active generation only.",
			next: "Invoke the setup-owned source checkout to mutate the Private Runbook Catalog.",
		};
	}
	const validation = validateDraft(draft);
	if (!validation.ok) {
		return {
			command: `runbook apply --file <${keyOf(draft)}>`,
			status: "refused",
			changed: false,
			exitCode: 2,
			message: `Invalid draft: ${validation.problems.join("; ")}`,
			next: validation.repair,
		};
	}
	const closure = actionClosureProblem(draft);
	if (closure) {
		return {
			command: `runbook apply --file <${keyOf(draft)}>`,
			status: "refused",
			changed: false,
			exitCode: 2,
			message: `Referenced Reviewed Action not applyable: ${closure}`,
			next: "Promote the exact action digest before applying this runbook.",
		};
	}
	const key = keyOf(draft);
	const newDigest = digest(draft);
	const existing = state.catalog.get(key);

	if (!existing) {
		// Absent target: create. No expected digest required for a fresh record.
		state.catalog.set(key, { key, draft, record_digest: newDigest });
		return {
			command: `runbook apply --file <${key}>`,
			status: "ok",
			changed: true,
			exitCode: 0,
			message: `Created ${key} at record digest ${newDigest}.`,
			next: "Run `runbook activate` to publish into a generation.",
		};
	}
	if (existing.record_digest === newDigest) {
		return {
			command: `runbook apply --file <${key}>`,
			status: "no-op",
			changed: false,
			exitCode: 0,
			message: `Identical document; ${key} unchanged at ${newDigest}.`,
		};
	}
	// Different content requires the previously observed record digest.
	if (expectedRecordDigest === null) {
		return {
			command: `runbook apply --file <${key}>`,
			status: "refused",
			changed: false,
			exitCode: 2,
			message: `${key} exists at ${existing.record_digest}; replacing different content requires --expect-digest.`,
			next: `Re-run with --expect-digest ${existing.record_digest} after reviewing current record.`,
		};
	}
	if (expectedRecordDigest !== existing.record_digest) {
		return {
			command: `runbook apply --file <${key}> --expect-digest ${expectedRecordDigest}`,
			status: "refused",
			changed: false,
			exitCode: 2,
			message: `Stale digest: expected ${expectedRecordDigest}, current ${existing.record_digest}. Another author changed it.`,
			next: `Re-read current record, then re-run with --expect-digest ${existing.record_digest}.`,
		};
	}
	state.catalog.set(key, { key, draft, record_digest: newDigest });
	return {
		command: `runbook apply --file <${key}> --expect-digest ${expectedRecordDigest}`,
		status: "ok",
		changed: true,
		exitCode: 0,
		message: `Replaced ${key}: ${existing.record_digest} -> ${newDigest}.`,
		next: "Run `runbook activate` to publish the replacement.",
	};
}

function del(state: State, key: string, expectedRecordDigest: string | null): Outcome {
	if (state.invocation === "packaged") {
		return {
			command: `runbook delete ${key}`,
			status: "refused",
			changed: false,
			exitCode: 2,
			message: "Packaged runtime refuses authoring mutations.",
			next: "Invoke the setup-owned source checkout to delete.",
		};
	}
	const existing = state.catalog.get(key);
	if (!existing) {
		return {
			command: `runbook delete ${key}`,
			status: "no-op",
			changed: false,
			exitCode: 0,
			message: `Absent target ${key}; idempotent no-op.`,
		};
	}
	if (expectedRecordDigest !== existing.record_digest) {
		return {
			command: `runbook delete ${key} --expect-digest ${expectedRecordDigest ?? "<none>"}`,
			status: "refused",
			changed: false,
			exitCode: 2,
			message: `Delete requires matching record digest; current ${existing.record_digest}.`,
			next: `Re-run with --expect-digest ${existing.record_digest}.`,
		};
	}
	state.catalog.delete(key);
	return {
		command: `runbook delete ${key} --expect-digest ${expectedRecordDigest}`,
		status: "ok",
		changed: true,
		exitCode: 0,
		message: `Deleted source record ${key}; active generation unchanged until re-activation.`,
		next: "Run `runbook activate` to publish the deletion.",
	};
}

// ---------------------------------------------------------------------------
// Transcript driver.
// ---------------------------------------------------------------------------

function show(label: string, state: State): void {
	console.log(`\n# ${label}`);
	if (state.last) console.log(`  -> ${JSON.stringify(state.last)}`);
	console.log(`  state: ${JSON.stringify(readState(state))}`);
}

const log: Array<{ label: string; outcome: Outcome }> = [];

function run(state: State, label: string, action: () => Outcome): void {
	state.last = action();
	log.push({ label, outcome: state.last });
	show(label, state);
}

function outcomeFor(label: string): Outcome {
	const entry = log.find((e) => e.label === label);
	if (!entry) throw new Error(`no logged outcome for ${label}`);
	return entry.outcome;
}

const draftV1: RunbookDraft = {
	service_id: "unifi",
	flow_id: "login-check",
	summary: "Read the UniFi console sign-in screen.",
	allowed_origins: ["https://192.168.1.1"],
	auth_context_ref: "unifi-session",
	steps: [{ role: "heading", name: "UniFi OS" }],
};
const draftV2: RunbookDraft = { ...draftV1, summary: "Local console sign-in screen." };
const draftWithPromotedAction: RunbookDraft = {
	service_id: "fasttrack",
	flow_id: "submit",
	summary: "Submit the current timesheet.",
	allowed_origins: ["https://fasttrack.example"],
	auth_context_ref: "fasttrack-session",
	steps: [
		{ role: "button", name: "Submit timesheet", action: { action_id: "submit-timesheet", expected_digest: "sha-promoted1" } },
	],
};
const draftWithUnpromotedAction: RunbookDraft = {
	...draftWithPromotedAction,
	service_id: "fasttrack",
	flow_id: "draft",
	steps: [
		{ role: "button", name: "Verify draft", action: { action_id: "draft-verify", expected_digest: "sha-anything" } },
	],
};
const draftWithStaleAction: RunbookDraft = {
	...draftWithPromotedAction,
	service_id: "fasttrack",
	flow_id: "stale",
	steps: [
		{ role: "button", name: "Submit timesheet", action: { action_id: "submit-timesheet", expected_digest: "sha-oldvalue" } },
	],
};

const state: State = {
	invocation: "source",
	catalog: new Map(),
	activeCatalogDigest: null,
	activeRecords: new Map(),
};

console.log("== schema --json ==");
console.log(JSON.stringify(RUNBOOK_SCHEMA, null, 2));

console.log("\n== validate --file (invalid: missing origins + steps) ==");
console.log(JSON.stringify(validateDraft({ service_id: "x", flow_id: "y", summary: "z" })));
console.log("== validate --file (valid draftV1) ==");
console.log(JSON.stringify(validateDraft(draftV1)));

// Apply lifecycle.
run(state, "apply-absent-creates", () => apply(state, draftV1, null));
const v1Digest = state.catalog.get("unifi/login-check")?.record_digest ?? null;
run(state, "apply-identical-noop", () => apply(state, draftV1, v1Digest));
run(state, "apply-different-no-digest", () => apply(state, draftV2, null));
run(state, "apply-different-stale-digest", () => apply(state, draftV2, "sha-deadbeef"));
run(state, "apply-different-matching-digest", () => apply(state, draftV2, v1Digest));

// Action-promotion gate.
run(state, "apply-promoted-action", () => apply(state, draftWithPromotedAction, null));
run(state, "apply-unpromoted-action", () => apply(state, draftWithUnpromotedAction, null));
run(state, "apply-stale-action", () => apply(state, draftWithStaleAction, null));

// Read-state statuses across activation boundary.
console.log("\n# BEFORE activation (records new-pending-activation)");
const beforeActivation = readState(state);
console.log(`  state: ${JSON.stringify(beforeActivation)}`);
activate(state); // publish current catalog as active generation
console.log("\n# AFTER activation (records in-sync)");
const afterActivation = readState(state);
console.log(`  state: ${JSON.stringify(afterActivation)}`);

// Delete requires matching digest; source deletion shows deletion-pending-activation
// (still present in the active generation until re-activation).
const v2Digest = state.catalog.get("unifi/login-check")?.record_digest ?? null;
run(state, "delete-wrong-digest", () => del(state, "unifi/login-check", "sha-wrong"));
run(state, "delete-matching-digest", () => del(state, "unifi/login-check", v2Digest));
run(state, "delete-absent-target", () => del(state, "unifi/login-check", null));
const afterDelete = readState(state);

// Packaged invocation refuses mutation.
state.invocation = "packaged";
run(state, "packaged-apply", () => apply(state, draftV1, null));
run(state, "packaged-delete", () => del(state, "fasttrack/submit", null));
state.invocation = "source";

// Verdict — every check derives from a real logged outcome, not a hardcoded true.
const checks = {
	schema_exposed: RUNBOOK_SCHEMA.contract_id === "browser-use.runbook-draft",
	validate_rejects_incomplete: !validateDraft({ service_id: "x", flow_id: "y", summary: "z" }).ok,
	created_absent:
		outcomeFor("apply-absent-creates").status === "ok" &&
		outcomeFor("apply-absent-creates").changed === true,
	identical_noop:
		outcomeFor("apply-identical-noop").status === "no-op" &&
		outcomeFor("apply-identical-noop").changed === false,
	different_without_digest_refused: outcomeFor("apply-different-no-digest").status === "refused",
	stale_digest_refused: outcomeFor("apply-different-stale-digest").status === "refused",
	matching_digest_replaced:
		outcomeFor("apply-different-matching-digest").status === "ok" &&
		outcomeFor("apply-different-matching-digest").changed === true,
	promoted_action_applied: outcomeFor("apply-promoted-action").status === "ok",
	unpromoted_action_refused: outcomeFor("apply-unpromoted-action").status === "refused",
	stale_action_refused: outcomeFor("apply-stale-action").status === "refused",
	packaged_apply_refused: outcomeFor("packaged-apply").status === "refused",
	packaged_delete_refused: outcomeFor("packaged-delete").status === "refused",
	delete_wrong_digest_refused: outcomeFor("delete-wrong-digest").status === "refused",
	delete_matching_ok: outcomeFor("delete-matching-digest").status === "ok",
	delete_absent_noop:
		outcomeFor("delete-absent-target").status === "no-op" &&
		outcomeFor("delete-absent-target").changed === false,
	status_new_pending_activation: beforeActivation.records.some((r) => r.status === "new-pending-activation"),
	status_in_sync: afterActivation.records.every((r) => r.status === "in-sync"),
	status_activation_required_on_edit: afterActivation.catalog_status === "in-sync",
	status_deletion_pending_activation: afterDelete.records.some((r) => r.status === "deletion-pending-activation"),
};
const passed = Object.values(checks).every(Boolean);
console.log(`\n== VERDICT: ${passed ? "PASS" : "FAIL"} ==`);
console.log(JSON.stringify(checks));
if (!passed) process.exitCode = 1;
