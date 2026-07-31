// ---------------------------------------------------------------------------
// Hermetic real-process FastTrack login runbook fixture (U6).
//
// Spawned as its own process by browser-use-runbook.test.ts. It drives the REAL
// runbook engine (runRunbook) over the SHIPPED `fasttrack/login` runbook —
// discovered from the code-owned catalog, never seeded into the temp XDG store —
// with fakes ONLY at the injected port boundaries:
//   * the auth-delivery seam builds a real AgentBrowserAuthDeliveryContext whose
//     TokenRetrievalPort is the REAL createOpTokenRetrievalPort fed a hermetic
//     op-execute (returns an OPAQUE per-field secret handle, never bytes);
//   * the delivery hook is the disposable-helper stand-in that performs the
//     bounded writes and observes the conformance-sentinel bytes;
//   * the adapter runtime answers by command shape (tab list/select, url
//     reproof, snapshot, open, visibility, click) with fixture transports.
//
// The fixture writes an ordered journal proving the whole-path choreography:
//   1. quarantine marker raised BEFORE any secret acquisition,
//   2. seam consulted with BOTH pending binding slugs; sensitive-interval lease
//      acquired (context in_sensitive_interval),
//   3. exactly TWO bounded field writes — username then password,
//   4. sign-in postcondition confirmed by the executor's fresh observation,
//   5. cleanup + assertContainmentBeforeRelease releases over the REAL on-disk
//      run-store bytes.
// The parent process then sweeps the run-store bytes, stdout, and stderr for
// BOTH derived sentinels and asserts ZERO occurrences. The fixture itself
// prints only structural events — never a sentinel value.
//
// Deterministic: no clock/random beyond the op handle expiry (a fixed epoch).
// ---------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
	AgentBrowserAuthDeliveryContext,
	AgentBrowserExecutionRuntime,
	AgentBrowserVerifiedHandoff,
} from "../browser-use-agent-browser";
import type { BrowserUseItemBinding } from "../browser-use-auth-bindings";
import type { BrowserUseVerifiedTarget } from "../browser-use-confidential-field-delivery";
import {
	type BrowserUseOpCredentialField,
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
} from "../browser-use-runbook";
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

const RUN_ID = "run-h-fasttrack-login";
const ORIGIN = "https://manpowergroup.fasttrack360.com.au";
const LOGIN_URL = `${ORIGIN}/RecruitmentManager/CandidatePortal`;

const journal: string[] = [];
function record(event: string): void {
	journal.push(event);
	writeFileSync(journalPath, JSON.stringify(journal));
}

function sentinelFor(field: "username" | "password"): string {
	const derived = deriveConformanceSentinel(field, nonce);
	if (!derived.ok) throw new Error(`fixture ${field} sentinel rejected`);
	return derived.value;
}
const SENTINEL_BY_FIELD: Readonly<Record<BrowserUseOpCredentialField, string>> = {
	username: sentinelFor("username"),
	password: sentinelFor("password"),
	"otp-current": sentinelFor("password"),
};

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

const BINDING: BrowserUseItemBinding = {
	service_id: "fasttrack",
	auth_context: "interactive-login",
	allowed_origins: [ORIGIN],
	allowed_login_paths: ["/RecruitmentManager/CandidatePortal"],
	vault_id: "vault-1",
	item_id: "item-1",
	allowed_auth_methods: ["password", "otp"],
	binding_revision: 1,
};

const TARGET: BrowserUseVerifiedTarget = {
	lane_id: "agent-browser",
	run_id: RUN_ID,
	top_level_origin: ORIGIN,
	frame_origin: ORIGIN,
	target_id: "target-1",
	page_id: "page-1",
	frame_id: "frame-1",
	account_ref: "acct-ref-redacted",
	target_proof_digest: "d".repeat(32),
};

function adapterSuccess(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

// Hermetic op-execute: the ONE seam onto real `op`. It returns an OPAQUE
// per-field secret handle (never bytes). Secret acquisition happens HERE, so
// the quarantine marker MUST already be raised — the fixture records that
// ordering. The requested field is derived from the spec's non-secret argv.
let bytesAcquired = false;
const hermeticOpExecute: BrowserUseOpExecute = async (spec) => {
	const field: BrowserUseOpCredentialField = spec.argv.includes("label=username")
		? "username"
		: spec.argv.includes("--otp")
			? "otp-current"
			: "password";
	record(`op-execute:secret-acquired:${field}`);
	bytesAcquired = true;
	// Return an OPAQUE handle naming the field only — never a value.
	return {
		kind: "secret-handle",
		handle: {
			handle_id: `hermetic-handle-${field}`,
			field,
			expires_at_epoch_ms: 9_999_999,
		},
	};
};

const tokenRetrieval = createOpTokenRetrievalPort({
	execute: hermeticOpExecute,
	token_handle_id: "hermetic-token-handle",
});

// The bounded writes inside the disposable-helper stand-in. This is the ONLY
// component that ever observes sentinel bytes; it reports back shape only.
const writesByField: Record<string, number> = {};
const context: AgentBrowserAuthDeliveryContext = {
	in_sensitive_interval: true,
	binding: BINDING,
	target: TARGET,
	tokenRetrieval,
	deliver: async (input) => {
		writesByField[input.field] = (writesByField[input.field] ?? 0) + 1;
		record(`delivery:bounded-write:${input.field}`);
		// The bounded write "types" the sentinel value; it never leaves the helper.
		const value = SENTINEL_BY_FIELD[input.field];
		return { ok: true, shape: { field: input.field, byte_length: value.length } };
	},
	reproveTarget: async ({ target }) => ({
		proven: true,
		observed_digest: target.target_proof_digest,
	}),
	// KTD5: field mapping keyed by binding slug; the executor resolves each
	// confidential step's own `item_binding` at fill time.
	field_by_binding_slug: {
		fasttrack_username: "username",
		fasttrack_password: "password",
	},
};

const seam: BrowserUseRunbookAuthDelivery = async (seamInput) => {
	// Binding mint + sensitive-interval lease are represented here
	// (context.in_sensitive_interval); the seam sees BOTH pending slugs.
	record(`lease:acquired:${seamInput.pendingItemBindings.join(",")}`);
	return { ok: true, context };
};

// Command-shaped adapter responses (fixture transports): the executor's argv
// carries base connection args before the native verb, so dispatch matches the
// first recognized verb. The confidential fills dispatch NO adapter command —
// the bounded writes live inside the delivery hook.
const SNAPSHOT_REFS = {
	"@e1": { role: "textbox", name: "Username" },
	"@e2": { role: "textbox", name: "Password" },
	"@e3": { role: "button", name: "Sign In" },
};
const runtime: AgentBrowserExecutionRuntime = {
	beforeMutationDispatch: async () => ({ ok: true }),
	runCommand: async (input) => {
		const args = input.args;
		const verbIndex = args.findIndex((arg) =>
			["tab", "get", "snapshot", "open", "is", "click"].includes(arg),
		);
		const verb = verbIndex === -1 ? "" : args[verbIndex];
		const next = verbIndex === -1 ? "" : (args[verbIndex + 1] ?? "");
		let data: unknown = {};
		if (verb === "tab" && next === "list") {
			data = {
				tabs: [{ tabId: "t1", active: true, type: "page", url: LOGIN_URL }],
			};
		} else if (verb === "tab") {
			data = { selected: true };
		} else if (verb === "get" && next === "url") {
			data = { url: LOGIN_URL };
		} else if (verb === "snapshot") {
			data = { snapshot: "login form", refs: SNAPSHOT_REFS };
		} else if (verb === "open") {
			data = { opened: true };
		} else if (verb === "is" && next === "visible") {
			data = { visible: true };
		} else if (verb === "click") {
			data = { clicked: true };
		}
		return { exitCode: 0, stdout: adapterSuccess(data), stderr: "" };
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
	// NO seeding: the engine must discover fasttrack/login from the code-owned
	// SHIPPED catalog through the empty temp XDG store.
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
			serviceId: "fasttrack",
			flowId: "login",
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
	record("postcondition:confirmed");
	if (writesByField.username !== 1 || writesByField.password !== 1) {
		throw new Error(
			`expected one bounded write per field, got ${JSON.stringify(writesByField)}`,
		);
	}

	// Register both derived sentinels and assert containment over the REAL
	// run-store bytes before "release" (cleanup path). The delivered shapes came
	// back through the executor's delivery evidence — one per field.
	const shapes = outcome.result.delivery?.delivered_shapes ?? [];
	if (shapes.length !== 2) {
		throw new Error(`expected two delivered shapes, got ${shapes.length}`);
	}
	const marked = markRunSensitive(baseGuard.guard, {
		trigger: "confidential-field-delivery",
		sentinels: [SENTINEL_BY_FIELD.username, SENTINEL_BY_FIELD.password],
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

	// Structural completion event only — never a sentinel value.
	process.stdout.write("fasttrack-login-delivery-complete\n");
}

main().catch((error) => {
	// The message names a stage, never a secret.
	process.stderr.write(
		`fixture failed: ${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exit(1);
});
