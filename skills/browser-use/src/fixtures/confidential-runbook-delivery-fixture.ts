// ---------------------------------------------------------------------------
// Hermetic real-process runbook-run confidential-delivery fixture (U13 tier-H).
//
// Spawned as its own process by browser-use-confidential-delivery-seam.test.ts.
// It drives the REAL runbook engine (runRunbook) end-to-end over a REAL temp
// XDG store, with fakes ONLY at the injected port boundaries:
//   * the auth-delivery seam builds a real AgentBrowserAuthDeliveryContext whose
//     TokenRetrievalPort is the REAL createOpTokenRetrievalPort fed a hermetic
//     op-execute (returns an OPAQUE secret handle, never bytes);
//   * the delivery hook is the disposable-helper stand-in that performs the one
//     bounded write and observes the conformance-sentinel bytes.
//
// The fixture writes an ordered journal proving the choreography's phase order:
//   1. quarantine marker raised BEFORE secret acquisition,
//   2. sensitive-interval lease acquired (context in_sensitive_interval),
//   3. exactly ONE bounded field write,
//   4. cleanup + assertContainmentBeforeRelease releases over the REAL on-disk
//      run-store bytes.
// The parent process then sweeps the run-store bytes, stdout, stderr, and any
// artifacts for the derived sentinel and asserts ZERO occurrences. The fixture
// itself prints only structural events — never the sentinel value.
//
// Deterministic: no clock/random beyond the op handle expiry (a fixed epoch).
// ---------------------------------------------------------------------------

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentBrowserAuthDeliveryContext,
	AgentBrowserExecutionRuntime,
	AgentBrowserVerifiedHandoff,
} from "../browser-use-agent-browser";
import type { BrowserUseItemBinding } from "../browser-use-auth-bindings";
import type { BrowserUseVerifiedTarget } from "../browser-use-confidential-field-delivery";
import {
	type BrowserUseOpExecute,
	createOpTokenRetrievalPort,
} from "../browser-use-op";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "../browser-use-paths";
import {
	type BrowserUseRunbookAuthDelivery,
	runRunbook,
	runbooksRoot,
} from "../browser-use-runbook";
import type { BrowserUseRunbook } from "../browser-use-runbook-model";
import { createSharedRun } from "../browser-use-runs";
import { deriveConformanceSentinel } from "../browser-use-secret-scan";
import {
	assertContainmentBeforeRelease,
	beginSensitiveRunGuard,
	type BrowserUseGovernedSurface,
	markRunSensitive,
} from "../browser-use-sensitive-run";

const dataRoot = process.argv[2];
const stateRoot = process.argv[3];
const journalPath = process.argv[4];
const nonce = process.argv[5];
if (
	dataRoot === undefined ||
	stateRoot === undefined ||
	journalPath === undefined ||
	nonce === undefined
) {
	throw new Error("fixture requires dataRoot, stateRoot, journalPath, nonce");
}

const RUN_ID = "run-h-runbook-cfd";
const journal: string[] = [];
function record(event: string): void {
	journal.push(event);
	writeFileSync(journalPath, JSON.stringify(journal));
}

const sentinel = deriveConformanceSentinel("password", nonce);
if (!sentinel.ok) throw new Error("fixture sentinel rejected");
const SENTINEL_VALUE = sentinel.value;

const HANDOFF = {
	outcome: "verified",
	environment: { name: "agent-chrome", profile: "default" },
	browser_entry_mode: "explicit-cdp",
	attachment: {
		adapter_id: "agent-browser",
		route: "explicit-cdp",
		probe_executable: "/opt/browser-connect/agent-browser",
	},
	endpoint: {
		http: "http://127.0.0.1:9222",
		ws: "ws://127.0.0.1:9222/devtools/browser/fixture",
	},
	launch: { launched: false },
	proof: {
		environment_contract_id: "warm-chrome.browser-entry",
		environment_schema_version: "1",
		route_evidence: "verified-live",
	},
	contract_id: "browser-connect.verified-handoff",
	schema_version: "2",
} as const;

const RUNBOOK: BrowserUseRunbook = {
	contract: "browser-use.runbook",
	schema_version: "1",
	service_id: "oncore",
	flow_id: "with-secret",
	flow_name: "sign-in",
	version: "1",
	summary: "Confidential sign-in runbook.",
	allowed_origins: ["https://portal.example.com"],
	inputs: [],
	steps: [
		{ kind: "snapshot", interactive: true },
		{
			kind: "fill",
			ref: "@e1",
			sensitivity: "confidential",
			item_binding: "oncore_password",
			postcondition: {
				kind: "value-equals",
				selector: "input[name=password]",
				value: "•••",
			},
		},
	],
};

const BINDING: BrowserUseItemBinding = {
	service_id: "oncore",
	auth_context: "interactive-login",
	allowed_origins: ["https://portal.example.com"],
	allowed_login_paths: [],
	vault_id: "vault-1",
	item_id: "item-1",
	allowed_auth_methods: ["password", "otp"],
	binding_revision: 1,
};

const TARGET: BrowserUseVerifiedTarget = {
	lane_id: "agent-browser",
	run_id: RUN_ID,
	top_level_origin: "https://portal.example.com",
	frame_origin: "https://portal.example.com",
	target_id: "target-1",
	page_id: "page-1",
	frame_id: "frame-1",
	account_ref: "acct-ref-redacted",
	target_proof_digest: "d".repeat(32),
};

function adapterSuccess(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

// The REAL runbook seed on disk under the admitted data root the engine reads.
function seedRunbook(admittedDataRoot: string): void {
	const dir = join(
		runbooksRoot(admittedDataRoot),
		RUNBOOK.service_id,
		RUNBOOK.flow_id,
	);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "runbook.json"), JSON.stringify(RUNBOOK));
}

// Hermetic op-execute: the ONE seam onto real `op`. It returns an OPAQUE
// secret handle (never bytes). Secret acquisition happens HERE, so the
// quarantine marker MUST already be raised — the fixture records that ordering.
let bytesAcquired = false;
const hermeticOpExecute: BrowserUseOpExecute = async (_spec) => {
	// The credential-field capture spec is the only one that mints a handle; the
	// quarantine marker precedes it (raised at run resolution below).
	record("op-execute:secret-acquired");
	bytesAcquired = true;
	// Return an OPAQUE handle naming the field only — never a value.
	return {
		kind: "secret-handle",
		handle: {
			handle_id: "hermetic-handle-password",
			field: "password",
			expires_at_epoch_ms: 9_999_999,
		},
	};
};

const tokenRetrieval = createOpTokenRetrievalPort({
	execute: hermeticOpExecute,
	token_handle_id: "hermetic-token-handle",
});

// One bounded write inside the disposable-helper stand-in. This is the ONLY
// component that ever observes the sentinel bytes; it reports back shape only.
let writes = 0;
const context: AgentBrowserAuthDeliveryContext = {
	in_sensitive_interval: true,
	binding: BINDING,
	target: TARGET,
	tokenRetrieval,
	deliver: async (input) => {
		writes += 1;
		record("delivery:bounded-write");
		// The bounded write "types" the sentinel value; it never leaves the helper.
		const value = SENTINEL_VALUE;
		return { ok: true, shape: { field: input.field, byte_length: value.length } };
	},
	reproveTarget: async ({ target }) => ({
		proven: true,
		observed_digest: target.target_proof_digest,
	}),
	field_by_ref: { "@e1": "password" },
};

const seam: BrowserUseRunbookAuthDelivery = async (seamInput) => {
	// The sensitive-interval lease is acquired here (context.in_sensitive_interval).
	record(`lease:acquired:${seamInput.pendingItemBindings.join(",")}`);
	return { ok: true, context };
};

// Deterministic index-ordered adapter responses for the command sequence:
// tab list, tab select, interactive snapshot (yields @e1), then the post-auth
// value-equals proof (reprove-origin `get url`, then `get value`). The
// confidential fill itself dispatches NO adapter command — the bounded write
// lives inside the delivery hook.
const RESPONSES: readonly string[] = [
	adapterSuccess({
		tabs: [
			{ tabId: "t1", active: true, type: "page", url: "https://portal.example.com/timesheets" },
		],
	}),
	adapterSuccess({ selected: true }),
	adapterSuccess({ snapshot: "@e1 textbox password", refs: { "@e1": {} } }),
	adapterSuccess({ url: "https://portal.example.com/timesheets" }),
	adapterSuccess({ value: "•••" }),
];
let responseIndex = 0;
const runtime: AgentBrowserExecutionRuntime = {
	runCommand: async () => {
		const stdout = RESPONSES[responseIndex++] ?? adapterSuccess({});
		return { exitCode: 0, stdout, stderr: "" };
	},
};

const env: Record<string, string | undefined> = {
	HOME: join(stateRoot, "home"),
	XDG_DATA_HOME: dataRoot,
	XDG_STATE_HOME: stateRoot,
	XDG_RUNTIME_DIR: join(stateRoot, "runtime"),
	XDG_CONFIG_HOME: join(stateRoot, "config"),
};

async function main(): Promise<void> {
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	seedRunbook(opened.paths.data.root);
	const deps = { fs, paths: opened.paths, clock: () => 1 };

	// Create the shared run FIRST so real run-store bytes exist to sweep.
	const created = await createSharedRun(deps, {
		run_id: RUN_ID,
		state: "running",
		task_intent: "runbook-execution",
		environment_profile: { environment: "agent-chrome", profile: "default" },
		adapter_id: "agent-browser",
		handoff_evidence_id: "seed",
		mutation_dispatched: false,
		artifacts: [],
	});
	if (!created.ok) throw new Error(`run create refused: ${created.code}`);

	// Quarantine marker raised at run resolution, BEFORE any secret acquisition.
	const baseGuard = beginSensitiveRunGuard(RUN_ID);
	if (!baseGuard.ok) throw new Error("guard begin refused");
	record("quarantine:raised");
	if (bytesAcquired) throw new Error("secret acquired before quarantine");

	const outcome = await runRunbook(
		{ fs, runtime, dataRoot: opened.paths.data.root, authDelivery: seam },
		{
			serviceId: "oncore",
			flowId: "with-secret",
			handoff: HANDOFF as AgentBrowserVerifiedHandoff,
			runId: RUN_ID,
			targetTabId: "t1",
			inputs: {},
			resumeFromStep: 0,
		},
	);
	if (!outcome.ok) throw new Error(`engine refused: ${outcome.refusal.code}`);
	if (!outcome.result.ok) {
		throw new Error(`executor not confirmed: ${outcome.result.code}`);
	}
	if (writes !== 1) throw new Error(`expected one bounded write, got ${writes}`);

	// Register the derived sentinel and assert containment over the REAL run-store
	// bytes before "release" (cleanup path). The delivered shape came back from
	// the executor's delivery evidence.
	const shapes = outcome.result.delivery?.delivered_shapes ?? [];
	if (shapes.length !== 1) throw new Error("missing delivered shape");
	const marked = markRunSensitive(baseGuard.guard, {
		trigger: "confidential-field-delivery",
		sentinels: [
			// The registered sentinel is the derived marker (== the delivered value).
			SENTINEL_VALUE,
		],
	});
	if (!marked.ok) throw new Error(`mark refused: ${marked.rejection.code}`);

	const runFilePath = deps.paths.state.runFile(RUN_ID);
	const runBytes = await fs.readTextFile(runFilePath);
	const surfaces: BrowserUseGovernedSurface[] = [
		{ kind: "run-store-file", label: runFilePath, content: runBytes },
	];
	const gate = assertContainmentBeforeRelease(marked.guard, surfaces);
	if (!gate.release) throw new Error(`containment withheld: ${gate.reason}`);
	record("cleanup:released");

	// Structural completion event only — never the sentinel value.
	process.stdout.write("runbook-delivery-complete\n");
}

main().catch((error) => {
	// The message names a stage, never a secret.
	process.stderr.write(
		`fixture failed: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exit(1);
});
