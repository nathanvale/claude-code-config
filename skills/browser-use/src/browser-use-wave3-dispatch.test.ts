import { afterAll, describe, expect, test } from "bun:test";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import {
	fixedClock,
	makeTempXdgEnv,
} from "./browser-use-platform-test-helpers";
import type { RunStoreDeps } from "./browser-use-runs";
import { createSharedRun, loadSharedRun } from "./browser-use-runs";
import type { BrowserUseSharedRun } from "./browser-use-run-model";
import { runbooksRoot } from "./browser-use-runbook";
import type { BrowserUseRunbook } from "./browser-use-runbook-model";
import type { BrowserUseEnvironmentTokenRetrievalPort } from "./browser-use-environment-op";
import type {
	BrowserUseHumanIdentityAttestationDriver,
	BrowserUseHumanIdentityAttestationInput,
} from "./browser-use-human-identity-attestation";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import { candidateIdOf, targetEnvelopeIdOf } from "./browser-use-core";
import { parseHandoffFacts } from "./browser-use-discovery";
import { browserUseContracts } from "./command-contract";

// =========================================================================
// Wave-3 shared-CLI integration: chrome-devtools-mcp task-run dispatch and the
// live runbook family (list/show/run). CLI-level proof over the REAL driver via
// runForTest against a real temp XDG store. Adapter envelopes match the
// VERBATIM shapes proven in wave 1/2:
//   - agent-browser: {success, data, error}
//   - chrome-devtools-mcp: {content:[{type:"text",text}], isError?}
// =========================================================================

const disposables: { dispose(): void }[] = [];
afterAll(() => {
	for (const disposable of disposables) disposable.dispose();
});

// --- Handoff fixtures --------------------------------------------------------

function handoffEnvelope(
	adapterId: string,
	runId: string,
	endpoint = {
		http: "http://127.0.0.1:9222",
		ws: "ws://127.0.0.1:9222/devtools/browser/fixture",
	},
) {
	return {
		status: "ok",
		run_id: runId,
		data: {
			outcome: "verified",
			environment: { name: "agent-chrome", profile: "default" },
			browser_entry_mode: "explicit-cdp",
			attachment: {
				adapter_id: adapterId,
				route: "explicit-cdp",
				probe_executable: "/opt/browser-connect/probe",
			},
			endpoint,
			launch: { launched: false },
			proof: {
				environment_contract_id: "warm-chrome.browser-entry",
				environment_schema_version: "1",
				route_evidence: "verified-live",
			},
			contract_id: "browser-connect.verified-handoff",
			schema_version: "2",
		},
		error: null,
	};
}

// --- MCP / agent-browser envelope shapes -------------------------------------

function mcpText(text: string): string {
	return JSON.stringify({ content: [{ type: "text", text }] });
}
function chromePagesListing(): string {
	return mcpText(
		["## Pages", "0: example (https://example.test/) [selected]"].join("\n"),
	);
}
function chromeConsole(): string {
	return mcpText("## Console messages\n(no messages)");
}
function chromeNetwork(): string {
	return mcpText("## Network requests\n(no requests)");
}
function chromeTraceStarted(): string {
	return mcpText("## Trace\nRecording started.");
}
function chromeTraceStopped(): string {
	return mcpText("## Trace\nRecording stopped; 1 trace captured.");
}
function agentSuccess(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

// --- Store setup -------------------------------------------------------------

async function makeStore(): Promise<{
	env: Record<string, string | undefined>;
	deps: RunStoreDeps;
	dataRoot: string;
	base: string;
}> {
	const xdg = makeTempXdgEnv();
	disposables.push(xdg);
	const fs = createDefaultPlatformFs();
	const opened = await openBrowserUsePaths(fs, xdg.env);
	if (!opened.ok) throw new Error(`paths refused: ${opened.refusal.code}`);
	return {
		env: xdg.env,
		deps: { fs, paths: opened.paths, clock: fixedClock().now },
		dataRoot: opened.paths.data.root,
		base: xdg.base,
	};
}

async function gitFixtureCommand(
	input: {
		cwd: string;
		gitDir?: string;
		workTree?: string;
	},
	...args: string[]
): Promise<void> {
	const child = Bun.spawn(["git", ...args], {
		cwd: input.cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: {
			...process.env,
			...(input.gitDir === undefined ? {} : { GIT_DIR: input.gitDir }),
			...(input.workTree === undefined
				? {}
				: { GIT_WORK_TREE: input.workTree }),
		},
	});
	if ((await child.exited) !== 0) {
		throw new Error(await new Response(child.stderr).text());
	}
}

/**
 * Build a disposable committed catalog source and pass its GIT_DIR/GIT_WORK_TREE
 * to `run` explicitly. The env stays local to each spawned git/runtime call, so
 * no process-wide `process.env` mutation leaks across parallel tests.
 */
async function withCommittedCatalogSource<T>(
	base: string,
	run: (gitEnv: { GIT_DIR: string; GIT_WORK_TREE: string }) => Promise<T>,
	options: { excludeRunbooks?: readonly string[] } = {},
): Promise<T> {
	const repoRoot = resolve(import.meta.dir, "../../..");
	const workTree =
		options.excludeRunbooks === undefined
			? repoRoot
			: join(base, "catalog-source-worktree");
	if (options.excludeRunbooks !== undefined) {
		const browserUseRoot = join(workTree, "skills/browser-use");
		mkdirSync(browserUseRoot, { recursive: true });
		cpSync(
			join(repoRoot, "skills/browser-use/runbooks"),
			join(browserUseRoot, "runbooks"),
			{ recursive: true },
		);
		cpSync(
			join(repoRoot, "skills/browser-use/actions"),
			join(browserUseRoot, "actions"),
			{ recursive: true },
		);
		for (const relativePath of options.excludeRunbooks) {
			rmSync(join(browserUseRoot, "runbooks", relativePath));
		}
		await gitFixtureCommand({ cwd: workTree }, "init", "-q");
		await gitFixtureCommand({ cwd: workTree }, "config", "user.email", "test@example.invalid");
		await gitFixtureCommand({ cwd: workTree }, "config", "user.name", "Catalog Test");
		await gitFixtureCommand(
			{ cwd: workTree },
			"add",
			"skills/browser-use/runbooks",
			"skills/browser-use/actions",
		);
		await gitFixtureCommand({ cwd: workTree }, "commit", "-qm", "test catalog fixture");
		return await run({
			GIT_DIR: join(workTree, ".git"),
			GIT_WORK_TREE: workTree,
		});
	}
	const gitDir = join(base, "catalog-source.git");
	await gitFixtureCommand({ cwd: base }, "init", "--bare", "-q", gitDir);
	await gitFixtureCommand({ cwd: workTree, gitDir, workTree }, "config", "user.email", "test@example.invalid");
	await gitFixtureCommand({ cwd: workTree, gitDir, workTree }, "config", "user.name", "Catalog Test");
	await gitFixtureCommand(
		{ cwd: workTree, gitDir, workTree },
		"add",
		"skills/browser-use/runbooks",
		"skills/browser-use/actions",
	);
	await gitFixtureCommand({ cwd: workTree, gitDir, workTree }, "commit", "-qm", "test catalog fixture");
	return await run({ GIT_DIR: gitDir, GIT_WORK_TREE: workTree });
}

async function createPublicCatalogSource(
	base: string,
	runbook: BrowserUseRunbook,
): Promise<string> {
	const sourceRoot = join(base, "public-catalog-source");
	mkdirSync(
		join(
			sourceRoot,
			"skills/browser-use/runbooks",
			runbook.service_id,
			runbook.flow_id,
		),
		{ recursive: true },
	);
	mkdirSync(join(sourceRoot, "skills/browser-use/actions"), { recursive: true });
	writeFileSync(
		join(sourceRoot, "skills/browser-use/actions/registry.json"),
		'{"actions":[]}\n',
		"utf-8",
	);
	writeFileSync(
		join(
			sourceRoot,
			"skills/browser-use/runbooks",
			runbook.service_id,
			runbook.flow_id,
			"runbook.json",
		),
		`${JSON.stringify(runbook, null, 2)}\n`,
		"utf-8",
	);
	await gitFixtureCommand({ cwd: sourceRoot }, "init", "-q");
	await gitFixtureCommand({ cwd: sourceRoot }, "config", "user.email", "test@example.invalid");
	await gitFixtureCommand({ cwd: sourceRoot }, "config", "user.name", "Catalog Test");
	await gitFixtureCommand({ cwd: sourceRoot }, "add", "skills/browser-use/runbooks", "skills/browser-use/actions");
	await gitFixtureCommand({ cwd: sourceRoot }, "commit", "-qm", "initial catalog");
	return sourceRoot;
}

async function commitPublicCatalogRunbook(
	sourceRoot: string,
	runbook: BrowserUseRunbook,
	message: string,
): Promise<void> {
	const relativePath = `skills/browser-use/runbooks/${runbook.service_id}/${runbook.flow_id}/runbook.json`;
	writeFileSync(
		join(sourceRoot, relativePath),
		`${JSON.stringify(runbook, null, 2)}\n`,
		"utf-8",
	);
	await gitFixtureCommand({ cwd: sourceRoot }, "add", relativePath);
	await gitFixtureCommand({ cwd: sourceRoot }, "commit", "-qm", message);
}

async function publicCatalogDigest(
	env: Record<string, string | undefined>,
	sourceRoot: string,
): Promise<string> {
	const listed = await runForTest(
		["runbook", "list", "--json"],
		makeRuntime({ env, sourceCheckoutRoot: sourceRoot }),
	);
	expect(listed.exitCode).toBe(0);
	const digest = (parseJson(listed.stdout).data as Record<string, unknown>)
		.source_catalog_digest;
	if (typeof digest !== "string") throw new Error("source digest missing");
	return digest;
}

async function activatePublicCatalog(input: {
	env: Record<string, string | undefined>;
	sourceRoot: string;
	digest: string;
	expectedEpoch: number;
}) {
	return await runForTest(
		[
			"runbook", "activate",
			"--catalog-digest", input.digest,
			"--expected-epoch", String(input.expectedEpoch),
			"--json",
		],
		makeRuntime({ env: input.env, sourceCheckoutRoot: input.sourceRoot }),
	);
}

function writeHandoff(
	base: string,
	adapterId: string,
	runId: string,
	endpoint?: { http: string; ws: string },
): string {
	const path = join(base, `handoff-${adapterId}.json`);
	writeFileSync(
		path,
		JSON.stringify(handoffEnvelope(adapterId, runId, endpoint)),
		"utf-8",
	);
	return path;
}

function seedRunbook(dataRoot: string, runbook: BrowserUseRunbook): void {
	const dir = join(runbooksRoot(dataRoot), runbook.service_id, runbook.flow_id);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "runbook.json"), JSON.stringify(runbook), "utf-8");
}

// A read-only seed runbook: one open + one snapshot, no confidential input, no
// declared inputs (so a fresh run reaches total_steps and confirms).
function readOnlyRunbook(): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "oncore",
		flow_id: "snapshot-verify",
		flow_name: "verify-loaded",
		version: "2",
		summary: "Read-only snapshot verification.",
		allowed_origins: ["https://example.test"],
		inputs: [],
		steps: [
			{
				kind: "open",
				url: "https://example.test/",
				postcondition: { kind: "url-equals", url: "https://example.test/" },
			},
			{ kind: "snapshot", interactive: true },
		],
	};
}

function approvalGatedMutationRunbook(): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "fixture",
		flow_id: "approval-gated-submit",
		flow_name: "approval-gated-submit",
		version: "1",
		summary: "Capture approval evidence before one semantic submit mutation.",
		allowed_origins: ["https://example.test"],
		inputs: [],
		steps: [
			{
				kind: "open",
				url: "https://example.test/timesheet",
				postcondition: {
					kind: "url-equals",
					url: "https://example.test/timesheet",
				},
			},
			{ kind: "snapshot", interactive: false },
			{
				kind: "approval-gate",
				blocked_cause: "submit-approval-required",
			},
			{ kind: "snapshot", interactive: false },
			{
				kind: "click",
				target: { role: "button", name: "Submit" },
				postcondition: {
					kind: "element-visible",
					selector: ".submitted",
				},
			},
			{ kind: "snapshot", interactive: false },
		],
	};
}

function confidentialRunbook(): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "oncore",
		flow_id: "confidential-login",
		flow_name: "confidential-login",
		version: "1",
		summary: "Confidential login refusal fixture.",
		allowed_origins: ["https://example.test"],
		inputs: [],
		steps: [
			{
				kind: "fill",
				target: { role: "textbox", name: "Password" },
				sensitivity: "confidential",
				item_binding: "oncore_password",
				postcondition: {
					kind: "element-visible",
					selector: ".signed-in",
				},
			},
		],
	};
}

function authContextRunbook(origin: string): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "2",
		service_id: "fixture-auth",
		flow_id: "business-after-login",
		flow_name: "business-after-login",
		version: "1",
		summary: "Authenticate generically, then capture one business snapshot.",
		allowed_origins: [origin],
		auth_context_ref: "interactive-login",
		inputs: [],
		steps: [{ kind: "snapshot", interactive: true }],
	};
}

function authContextOpenRunbook(
	origin: string,
	path = "/login",
): BrowserUseRunbook {
	return {
		...authContextRunbook(origin),
		steps: [
			{
				kind: "open",
				url: `${origin}${path}`,
				postcondition: { kind: "url-equals", url: `${origin}${path}` },
			},
			{ kind: "snapshot", interactive: true },
		],
	};
}

function startAuthCdpFixture(input: {
	initial: "neutral" | "login" | "ambiguous" | "authenticated";
	origin?: string;
	initialUrl?: string;
}) {
	let screen = input.initial;
	const origin = input.origin ?? "http://127.0.0.1:45123";
	let targetUrl =
		input.initial === "neutral"
			? "about:blank"
			: (input.initialUrl ?? `${origin}/login`);
	const cdpTargetId = "cdp-target-auth";
	const methods: string[] = [];
	const navigations: string[] = [];
	const attachedTargetIds: string[] = [];
	const transport = {
		transport: {
			async request(message: {
				method: string;
				params?: Record<string, unknown>;
			}): Promise<unknown> {
				methods.push(message.method);
				switch (message.method) {
					case "Target.getTargets":
						return {
							targetInfos: [
								{ targetId: cdpTargetId, type: "page", url: targetUrl },
							],
						};
					case "Target.attachToTarget":
						attachedTargetIds.push(String(message.params?.targetId));
						if (message.params?.targetId !== cdpTargetId) {
							throw new Error("adapter tab id is not a CDP target id");
						}
						return { sessionId: "auth-session" };
					case "Page.getFrameTree":
						return {
							frameTree: { frame: { id: "frame-auth", url: targetUrl } },
						};
					case "Page.navigate": {
						const url = message.params?.url;
						if (typeof url !== "string") throw new Error("missing navigation URL");
						navigations.push(url);
						targetUrl = url;
						screen = "login";
						return { frameId: "frame-auth" };
					}
					case "Accessibility.getFullAXTree":
						return {
							nodes:
								screen === "login"
									? [
											{ nodeId: "form", role: { value: "form" }, name: { value: "Sign in" }, ignored: false, childIds: ["username", "password", "submit"] },
											{ nodeId: "username", parentId: "form", frameId: "frame-auth", role: { value: "textbox" }, name: { value: "Username" }, ignored: false, backendDOMNodeId: 11 },
											{ nodeId: "password", parentId: "form", frameId: "frame-auth", role: { value: "textbox" }, name: { value: "Password" }, ignored: false, backendDOMNodeId: 12 },
											{ nodeId: "submit", parentId: "form", frameId: "frame-auth", role: { value: "button" }, name: { value: "Sign in" }, ignored: false, backendDOMNodeId: 13 },
										]
									: [
											{ nodeId: "welcome", frameId: "frame-auth", role: { value: "heading" }, name: { value: "Welcome to Dashboard" }, ignored: false },
										],
						};
					case "DOM.resolveNode":
						return { object: { objectId: "field-object" } };
					case "DOM.getContentQuads":
						return { quads: [[0, 0, 20, 0, 20, 10, 0, 10]] };
					case "Input.dispatchMouseEvent":
						if (message.params?.type === "mouseReleased") screen = "ambiguous";
				}
				return {};
			},
		},
		close() {},
	};
	return {
		origin,
		transport,
		methods,
		navigations,
		attachedTargetIds,
		cdpTargetId,
	};
}

function authTokenPort(
	origin: string,
	loginPathOrCounts:
		| string
		| { fetches: number; redeems: number } = "/login",
): BrowserUseEnvironmentTokenRetrievalPort {
	const loginPath =
		typeof loginPathOrCounts === "string" ? loginPathOrCounts : "/login";
	const counts =
		typeof loginPathOrCounts === "string" ? undefined : loginPathOrCounts;
	const item = {
		item_id: "item-fixture",
		vault_id: "vault-fixture",
		origins: [origin],
		login_paths: [loginPath],
		supported_methods: ["password" as const],
		state: "active" as const,
	};
	return {
		listVaults: async () => ({ ok: true, vaults: [{ vault_id: "vault-fixture" }] }),
		listLoginItems: async () => ({ ok: true, items: [item] }),
		getLoginItem: async () => ({ ok: true, item }),
		fetchCredentialField: async ({ field }) => {
			if (counts !== undefined) counts.fetches += 1;
			return {
				ok: true,
				handle: { handle_id: `fixture-${field}`, field, expires_at_epoch_ms: 60_000 },
			};
		},
		redeemCredentialField: async () => {
			if (counts !== undefined) counts.redeems += 1;
			return {
				ok: true,
				shape: { field: "password", byte_length: 12 },
			};
		},
	};
}

// A runtime replaying a scripted adapter response sequence over the real store.
function scriptedRuntime(
	env: Record<string, string | undefined>,
	responses: readonly { stdout?: string; exitCode?: number; timedOut?: boolean }[],
) {
	let index = 0;
	const calls: Array<readonly string[]> = [];
	return {
		calls,
		runtime: makeRuntime({
			env,
			now: () => 1_000,
			platformFs: createDefaultPlatformFs(),
			readTextFile: (path: string) =>
				import("node:fs/promises").then((m) => m.readFile(path, "utf-8")),
			// Real disk write seams so the chrome executor's native-artifact write
			// actually lands under the temp store (this is a CLI integration proof
			// over the real driver, not a stubbed unit). ensureDirectory mirrors the
			// default runtime's recursive 0700 mkdir; writeTextFile writes the bytes.
			ensureDirectory: (path: string) =>
				import("node:fs/promises").then((m) =>
					m.mkdir(path, { recursive: true, mode: 0o700 }).then(() => undefined),
				),
			writeTextFile: (path: string, contents: string) =>
				import("node:fs/promises").then((m) =>
					m.writeFile(path, contents, { mode: 0o600 }),
				),
			runCommand: async (input) => {
				calls.push([input.command, ...input.args]);
				const response = responses[index++] ?? {};
				return {
					exitCode: response.exitCode ?? 0,
					stdout: response.stdout ?? "",
					stderr: "",
					...(response.timedOut === undefined ? {} : { timedOut: response.timedOut }),
				};
			},
		}),
	};
}

function humanIdentityAttestationFor(
	input: BrowserUseHumanIdentityAttestationInput,
	overrides: Partial<
		Extract<
			Awaited<ReturnType<BrowserUseHumanIdentityAttestationDriver>>,
			{ ok: true }
		>["attestation"]
	> = {},
) {
	return {
		run_id: input.run.run_id,
		handoff_evidence_id: input.run.handoff_evidence_id ?? "missing",
		lane_id: "agent-browser" as const,
		implementation_integrity_key: input.implementation_integrity_key,
		environment: input.run.environment_profile.environment,
		profile: input.run.environment_profile.profile,
		target_id: input.target_id,
		page_id: input.target_id,
		frame_id: input.target_id,
		service_id: input.service_id,
		auth_context: input.auth_context_ref,
		subject_reference: "subject-fixture",
		account_reference: "account-fixture",
		tenant_reference: "tenant-fixture",
		identity_basis: "human-identity-attestation" as const,
		identity_basis_digest: "b".repeat(64),
		observed_at_epoch_ms: 1_000,
		fresh_until_epoch_ms: 31_000,
		...overrides,
	};
}

function approvedBinding(origin: string, serviceId = "fixture-auth") {
	return {
		service_id: serviceId,
		auth_context: "interactive-login" as const,
		allowed_origins: [origin],
		allowed_login_paths: ["/login", "/RecruitmentManager/CandidatePortal"],
		vault_id: "vault-fixture",
		item_id: "item-fixture",
		allowed_auth_methods: ["password" as const],
		binding_revision: 1,
	};
}

function authenticatedStateProof(origin: string, targetId: string) {
	return {
		proven: true as const,
		proof: {
			target_id: targetId,
			page_id: "page-authenticated",
			frame_id: "frame-auth",
			origin,
			subject_reference: "subject-fixture",
			account_reference: "account-fixture",
			tenant_reference: "tenant-fixture",
			identity_basis_digest: "identity-basis-fixture",
		},
	};
}

async function presenceBlockedRunbookFixture(runId: string) {
	const cdp = startAuthCdpFixture({ initial: "ambiguous" });
	const store = await makeStore();
	const sourceRoot = await createPublicCatalogSource(
		store.base,
		authContextRunbook(cdp.origin),
	);
	const digest = await publicCatalogDigest(store.env, sourceRoot);
	const activated = await activatePublicCatalog({
		env: store.env,
		sourceRoot,
		digest,
		expectedEpoch: 0,
	});
	if (activated.exitCode !== 0) throw new Error(activated.stdout);
	const handoffPath = writeHandoff(store.base, "agent-browser", runId);
	const blockedRuntime = scriptedRuntime(store.env, [
		{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
		{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
		{ stdout: agentSuccess({ selected: true }) },
	]);
	blockedRuntime.runtime.authTokenRetrieval = authTokenPort(cdp.origin);
	blockedRuntime.runtime.runbookApprovedBindingResolver = async () =>
		approvedBinding(cdp.origin);
	blockedRuntime.runtime.runbookAuthTransport = () => cdp.transport;
	blockedRuntime.runtime.runbookAuthenticatedStateProof = async () => ({
		proven: false,
		cause: "human-identity-attestation-required",
	});
	const blocked = await runForTest(
		[
			"runbook", "run",
			"--service", "fixture-auth",
			"--flow", "business-after-login",
			"--handoff", handoffPath,
			"--tab", "t1",
			"--json",
		],
		blockedRuntime.runtime,
	);
	if (blocked.exitCode !== 0) throw new Error(blocked.stdout);
	return { cdp, store, handoffPath, blocked, blockedCalls: blockedRuntime.calls };
}

function presenceResumeRuntime(
	env: Record<string, string | undefined>,
	cdp: ReturnType<typeof startAuthCdpFixture>,
) {
	const resumed = scriptedRuntime(env, [
		{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
		{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
		{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
		{ stdout: agentSuccess({ selected: true }) },
		{ stdout: agentSuccess({ url: `${cdp.origin}/login` }) },
		{ stdout: agentSuccess({ snapshot: "@business heading", refs: { "@business": {} } }) },
	]);
	resumed.runtime.authTokenRetrieval = authTokenPort(cdp.origin);
	resumed.runtime.runbookApprovedBindingResolver = async () =>
		approvedBinding(cdp.origin);
	resumed.runtime.runbookAuthTransport = () => cdp.transport;
	resumed.runtime.runbookAuthenticatedStateProof = async () => ({
		proven: false,
		cause: "human-identity-attestation-required",
	});
	return resumed;
}

async function resumePresenceBlockedRunbook(input: {
	runtime: ReturnType<typeof scriptedRuntime>["runtime"];
	handoffPath: string;
	runId: string;
}) {
	return await runForTest(
		[
			"runbook", "run",
			"--service", "fixture-auth",
			"--flow", "business-after-login",
			"--handoff", input.handoffPath,
			"--tab", "t1",
			"--run", input.runId,
			"--json",
		],
		input.runtime,
	);
}

// =========================================================================
// chrome-devtools-mcp task-run dispatch (release contract R9, R21; F6)
// =========================================================================

describe("task run — chrome-devtools-mcp dispatch (U4 wiring)", () => {
	test("a debug intent compiles to console + network and confirms read-only", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-chrome-1");
		// The debug intent compiles (compileChromeOperationSet) to console-read +
		// network-read: list_pages (origin proof) then list_console_messages then
		// list_network_requests. Both reads are bounded native evidence, no artifact.
		const { runtime, calls } = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		const data = json.data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.shared-run");
		expect(data.selected_lane).toBe("chrome-devtools-mcp");
		expect(data.external_effect).toBe("none");
		const run = data.run as Record<string, unknown>;
		expect(run.state).toBe("confirmed");
		expect(run.adapter_id).toBe("chrome-devtools-mcp");
		// The executor drove the compiled chrome tool set, never the agent-browser CLI.
		expect(calls[0]?.join(" ")).toContain("list_pages");
		expect(calls[1]?.join(" ")).toContain("list_console_messages");
		expect(calls[2]?.join(" ")).toContain("list_network_requests");
		// debug is a two-op read set: no artifact-producing tool ran.
		expect(calls.some((c) => c.join(" ").includes("performance_start_trace"))).toBe(
			false,
		);
	});

	test("a non-integer --tab is refused before any chrome call AND before any run is created", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-chrome-2");
		const { runtime, calls } = scriptedRuntime(store.env, []);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "not-a-number",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_lane_refused",
		});
		expect(calls).toHaveLength(0);
		// The usage error must NOT have persisted a run keyed on the handoff's run
		// id: a stray `running` run here would poison the handoff, turning every
		// corrected retry into a store_record_conflict.
		const orphan = await loadSharedRun(store.deps, "run-chrome-2");
		expect(orphan.ok).toBe(false);
		// A corrected retry with the SAME handoff proceeds cleanly (no conflict).
		const retryRuntime = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		const retried = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			retryRuntime.runtime,
		);
		expect(retried.exitCode).toBe(0);
		const retriedRun = (parseJson(retried.stdout).data as Record<string, unknown>)
			.run as Record<string, unknown>;
		expect(retriedRun.run_id).toBe("run-chrome-2");
		expect(retriedRun.state).toBe("confirmed");
	});

	test("a performance-profile intent compiles to a trace and persists an artifact reference", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-chrome-3");
		// performance-profile compiles to a performance-trace op: list_pages
		// (origin proof) then performance_start_trace + performance_stop_trace. The
		// driver creates the artifact_dir before dispatch, so the trace op produces
		// a native artifact reference the run persists (R21).
		const { runtime, calls } = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeTraceStarted() },
			{ stdout: chromeTraceStopped() },
		]);
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "performance-profile",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const run = (parseJson(result.stdout).data as Record<string, unknown>)
			.run as Record<string, unknown>;
		expect(run.state).toBe("confirmed");
		// The compiled trace op drove start/stop and produced one export artifact.
		expect(calls[1]?.join(" ")).toContain("performance_start_trace");
		expect(calls[2]?.join(" ")).toContain("performance_stop_trace");
		const artifacts = run.artifacts as Array<Record<string, unknown>>;
		expect(Array.isArray(artifacts)).toBe(true);
		expect(artifacts).toHaveLength(1);
		const artifactId = artifacts[0]?.artifact_id as string;
		expect(artifactId).toContain("perf-trace");
		expect(artifacts[0]?.retention).toBe("export");
		// The artifact reference is not just a name: the executor WROTE the native
		// trace evidence to the derived path, so a file exists on disk carrying the
		// captured trace summary (closes finding #2 — no advertised-but-absent
		// evidence).
		const artifactPath = join(
			store.deps.paths.state.artifactDir("run-chrome-3"),
			artifactId,
		);
		const bytes = readFileSync(artifactPath, "utf-8");
		expect(bytes).toContain("trace captured");
		// The durable run reads back with the persisted artifact reference.
		const loaded = await loadSharedRun(store.deps, "run-chrome-3");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.artifacts).toHaveLength(1);
	});
});

// =========================================================================
// Runbook family — live list/show/run (platform plan U4)
// =========================================================================

describe("runbook family — live (U4 wiring)", () => {
	test("runbook run discovery advertises every target repair continuation", () => {
		const actionIds =
			browserUseContracts["runbook-run"].actionAffordances?.failure.map(
				(action) => action.id,
			) ?? [];
		expect(actionIds).toEqual(
			expect.arrayContaining([
				"prepare_unique_runbook_target",
				"refresh_runbook_handoff",
				"restore_bound_runbook_target",
			]),
		);
	});

	test("runbook list does not report the signed fill-week runbook as unpromoted", async () => {
		const store = await makeStore();
		const result = await withCommittedCatalogSource(store.base, async (gitEnv) =>
			await runForTest(
				["runbook", "list", "--json"],
				makeRuntime({ env: { ...store.env, ...gitEnv } }),
			),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.activation_blockers).not.toContainEqual(
			expect.objectContaining({
				id: "fasttrack/fill-week",
				code: "runbook_action_unpromoted",
			}),
		);
		expect(Array.isArray(data.separated)).toBe(true);
		const rows = data.runbooks as Array<Record<string, unknown>>;
		expect(rows.find((row) => row.service_id === "fasttrack" && row.flow_id === "fill-week")).toBeDefined();
	});

	test("runbook list projects the discovered catalog (no not-implemented)", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const result = await withCommittedCatalogSource(store.base, async (gitEnv) =>
			await runForTest(
				["runbook", "list", "--json"],
				makeRuntime({ env: { ...store.env, ...gitEnv } }),
			),
		);
		expect(result.exitCode).toBe(0);
		const json = parseJson(result.stdout);
		expect(JSON.stringify(json)).not.toContain("browser_use_not_implemented");
		const data = json.data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.runbook-catalog");
		const rows = data.runbooks as Array<Record<string, unknown>>;
		// The catalog merges the code-owned shipped seed with the seeded store
		// row; the seeded oncore/snapshot-verify must appear among them.
		const seeded = rows.find(
			(r) => r.service_id === "oncore" && r.flow_id === "snapshot-verify",
		);
		expect(seeded).toBeDefined();
		expect(data.runbook_count).toBe(rows.length);
		expect(data.activation_blockers).not.toContainEqual(
			expect.objectContaining({
				id: "fasttrack/fill-week",
				code: "runbook_action_unpromoted",
			}),
		);
	});

	test("runbook show returns one validated definition and health", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const result = await withCommittedCatalogSource(store.base, async (gitEnv) =>
			await runForTest(
				["runbook", "show", "--service", "oncore", "--flow", "snapshot-verify", "--json"],
				makeRuntime({ env: { ...store.env, ...gitEnv } }),
			),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.runbook-definition");
		expect(data.health).toBe("healthy");
		const runbook = data.runbook as Record<string, unknown>;
		expect(runbook.service_id).toBe("oncore");
		expect(data.separated).toBeNull();
	});

	test("runbook show returns the signed action-bearing definition", async () => {
		const store = await makeStore();
		const result = await withCommittedCatalogSource(store.base, async (gitEnv) =>
			await runForTest(
				["runbook", "show", "--service", "fasttrack", "--flow", "fill-week", "--json"],
				makeRuntime({ env: { ...store.env, ...gitEnv } }),
			),
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.runbook).toMatchObject({
			service_id: "fasttrack",
			flow_id: "fill-week",
		});
	});

	test("runbook show for a missing runbook fails closed with a typed refusal", async () => {
		const store = await makeStore();
		const result = await withCommittedCatalogSource(store.base, async (gitEnv) =>
			await runForTest(
				["runbook", "show", "--service", "oncore", "--flow", "absent", "--json"],
				makeRuntime({ env: { ...store.env, ...gitEnv } }),
			),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "runbook_not_found",
		});
	});

	test("runbook run dispatches the read-only runbook through agent-browser and confirms", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-1");
		// agent-browser executor sequence for open + snapshot: tab list, tab select,
		// open, get-url (open postcondition), snapshot.
		const { runtime } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [{ tabId: "t1", active: true, type: "page", url: "https://example.test/" }],
				}),
			},
			{
				stdout: agentSuccess({
					tabs: [{ tabId: "t1", active: true, type: "page", url: "https://example.test/" }],
				}),
			},
			{ stdout: agentSuccess({ selected: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ opened: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ snapshot: "@e1 button", refs: { "@e1": {} } }) },
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.contract).toBe("browser-use.shared-run");
		expect(data.selected_lane).toBe("agent-browser");
		const run = data.run as Record<string, unknown>;
		expect(run.task_intent).toBe("runbook-execution");
		expect(run.state).toBe("confirmed");
		// The run is durable and readable back as confirmed truth.
		const loaded = await loadSharedRun(store.deps, "run-runbook-1");
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.state).toBe("confirmed");
	});

	test("submit approval gate captures screenshot and blocks dispatch until exact approval", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, approvalGatedMutationRunbook());
		const runId = "run-approval-gated-submit";
		const handoffPath = writeHandoff(store.base, "agent-browser", runId);
		const calls: Array<readonly string[]> = [];
		const runtime = makeRuntime({
			env: store.env,
			now: () => 1_000,
			platformFs: createDefaultPlatformFs(),
			readTextFile: (path: string) =>
				import("node:fs/promises").then((module) =>
					module.readFile(path, "utf-8"),
				),
			ensureDirectory: (path: string) =>
				import("node:fs/promises").then((module) =>
					module.mkdir(path, { recursive: true, mode: 0o700 }).then(() => undefined),
				),
			runCommand: async (input) => {
				calls.push([input.command, ...input.args]);
				if (input.args.includes("screenshot")) {
					const artifactPath = input.args.find((argument) =>
						argument.endsWith(".png"),
					);
					if (artifactPath !== undefined) {
						writeFileSync(artifactPath, Buffer.from("approval-png"));
					}
				}
				const data = input.args.includes("tab") && input.args.includes("list")
					? {
							tabs: [
								{
									tabId: "t1",
									active: true,
									type: "page",
									url: "https://example.test/timesheet",
								},
							],
						}
					: input.args.includes("snapshot")
						? {
								snapshot: "@e1 button Submit",
								refs: { e1: { role: "button", name: "Submit" } },
							}
						: input.args.includes("get") && input.args.includes("url")
							? { url: "https://example.test/timesheet" }
							: input.args.includes("is") && input.args.includes("visible")
								? { visible: true }
								: {};
				return { exitCode: 0, stdout: agentSuccess(data), stderr: "" };
			},
		});
		const runArgs = [
			"runbook", "run",
			"--service", "fixture",
			"--flow", "approval-gated-submit",
			"--handoff", handoffPath,
			"--tab", "t1",
			"--json",
		] as const;

		const blocked = await runForTest(runArgs, runtime);
		expect(blocked.exitCode).toBe(0);
		const blockedEnvelope = parseJson(blocked.stdout);
		expect(blockedEnvelope.continuation).toEqual({
			next_action_id: "complete-submit-approval",
		});
		const blockedRun = (blockedEnvelope.data as { run: BrowserUseSharedRun }).run;
		expect(blockedRun).toMatchObject({
			state: "awaiting-approval",
			mutation_dispatched: true,
			continuation: { next_action_id: "complete-submit-approval" },
			artifacts: [
				{
					artifact_id: "submit-approval-2.png",
					sensitivity: "high",
					retention: "ephemeral",
				},
			],
		});
		expect(calls.some((call) => call.includes("screenshot"))).toBe(true);
		expect(calls.some((call) => call.includes("click"))).toBe(false);
		expect(
			readFileSync(
				join(
					store.deps.paths.state.artifactDir(runId),
					"submit-approval-2.png",
				),
				"utf-8",
			),
		).toBe("approval-png");

		const callsBeforeUnapprovedResume = calls.length;
		const stillBlocked = await runForTest(
			[...runArgs.slice(0, -1), "--run", runId, "--json"],
			runtime,
		);
		expect(stillBlocked.exitCode).toBe(0);
		expect(calls).toHaveLength(callsBeforeUnapprovedResume);
		expect(calls.some((call) => call.includes("click"))).toBe(false);

		const approved = await runForTest(
			[
				"run", "approve",
				"--run", runId,
				"--continuation", "complete-submit-approval",
				"--artifact", "submit-approval-2.png",
				"--json",
			],
			runtime,
		);
		expect(approved.exitCode).toBe(0);
		expect(parseJson(approved.stdout).continuation).toEqual({
			next_action_id: "resume_runbook_execution",
		});
		expect(calls).toHaveLength(callsBeforeUnapprovedResume);

		const completed = await runForTest(
			[...runArgs.slice(0, -1), "--run", runId, "--json"],
			runtime,
		);
		expect(completed.exitCode).toBe(0);
		expect(calls.some((call) => call.includes("click"))).toBe(true);
		const durable = await loadSharedRun(store.deps, runId);
		expect(durable.ok).toBe(true);
		if (durable.ok) {
			expect(durable.run.state).toBe("confirmed");
			expect(durable.run.approvals).toEqual([
				{
					continuation_id: "complete-submit-approval",
					artifact_id: "submit-approval-2.png",
					approved_at_epoch_ms: 1_000,
					dispatch_started_at_epoch_ms: 1_000,
				},
			]);
		}
	});

	test("submit approval gate returns a typed refusal when artifact hashing fails", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, approvalGatedMutationRunbook());
		const handoffPath = writeHandoff(
			store.base,
			"agent-browser",
			"run-approval-hash-failure",
		);
		const platformFs = createDefaultPlatformFs();
		const runtime = makeRuntime({
			env: store.env,
			platformFs: {
				...platformFs,
				hashFile: async (path) => {
					if (path.endsWith(".png")) {
						throw Object.assign(new Error("hash refused"), { code: "EIO" });
					}
					return await platformFs.hashFile(path);
				},
			},
			readTextFile: (path: string) =>
				import("node:fs/promises").then((module) =>
					module.readFile(path, "utf-8"),
				),
			ensureDirectory: (path: string) =>
				import("node:fs/promises").then((module) =>
					module.mkdir(path, { recursive: true, mode: 0o700 }).then(() => undefined),
				),
			runCommand: async (input) => {
				if (input.args.includes("screenshot")) {
					const artifactPath = input.args.find((argument) =>
						argument.endsWith(".png"),
					);
					if (artifactPath !== undefined) {
						writeFileSync(artifactPath, Buffer.from("approval-png"));
					}
				}
				const data = input.args.includes("tab") && input.args.includes("list")
					? {
							tabs: [
								{
									tabId: "t1",
									active: true,
									type: "page",
									url: "https://example.test/timesheet",
								},
							],
						}
					: input.args.includes("snapshot")
						? { snapshot: "@e1 button Submit", refs: { e1: {} } }
						: input.args.includes("get") && input.args.includes("url")
							? { url: "https://example.test/timesheet" }
							: input.args.includes("is") && input.args.includes("visible")
								? { visible: true }
								: {};
				return { exitCode: 0, stdout: agentSuccess(data), stderr: "" };
			},
		});

		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "fixture",
				"--flow", "approval-gated-submit",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "artifact_hash_failed",
		});
	});

	for (const scenario of [
		{ name: "confirms", submitFails: false, identityBasis: "session" },
		{
			name: "confirms after renewing human identity",
			submitFails: false,
			identityBasis: "human",
		},
		{
			name: "records unknown when submit dispatch fails",
			submitFails: true,
			identityBasis: "session",
		},
	] as const) {
		test(`approved FastTrack submit resume after auth expiry ${scenario.name} without redispatch`, async () => {
			const origin = "https://manpowergroup.fasttrack360.com.au";
			const timesheetUrl =
				`${origin}/RecruitmentManager/CandidatePortal#/VGltZUFuZEF0dGVuZGFuY2U00`;
			const cdp = startAuthCdpFixture({
				initial: "authenticated",
				origin,
			});
			try {
				const store = await makeStore();
				const runId = `run-fasttrack-submit-${scenario.identityBasis}-${scenario.submitFails ? "failure" : "confirmed"}`;
				const handoffPath = writeHandoff(
					store.base,
					"agent-browser",
					runId,
				);
				const privateInputRoot = join(
					store.deps.paths.resolution.roots.runtime,
					"private-inputs",
				);
				mkdirSync(privateInputRoot, { recursive: true, mode: 0o700 });
				const inputPath = join(privateInputRoot, "timesheet-submission.json");
				writeFileSync(
					inputPath,
					JSON.stringify({
						period_start: "2026-07-27",
						period_end: "2026-08-02",
						rows: [
							{
								date: "2026-07-27",
								day: "Mon",
								start_time: "09:00",
								end_time: "17:00",
								attendance_type: "Standard",
							},
						],
					}),
					{ mode: 0o600 },
				);
				chmodSync(inputPath, 0o600);
				let now = 1_000;
				let evalCalls = 0;
				let humanAttestationCalls = 0;
				let submitObservedDispatchMarker = false;
				const calls: Array<readonly string[]> = [];
				const runtime = makeRuntime({
					env: store.env,
					now: () => now,
					reviewedActionApprovalVerifier: {
						verify: () => ({ ok: true }),
					},
					platformFs: createDefaultPlatformFs(),
					readTextFile: (path: string) =>
						import("node:fs/promises").then((module) =>
							module.readFile(path, "utf-8"),
						),
					ensureDirectory: (path: string) =>
						import("node:fs/promises").then((module) =>
							module
								.mkdir(path, { recursive: true, mode: 0o700 })
								.then(() => undefined),
						),
					writeTextFile: (path: string, contents: string) =>
						import("node:fs/promises").then((module) =>
							module.writeFile(path, contents, { mode: 0o600 }),
						),
					runCommand: async (input) => {
						calls.push([input.command, ...input.args]);
						if (input.args.includes("screenshot")) {
							const artifactPath = input.args.find((argument) =>
								argument.endsWith(".png"),
							);
							if (artifactPath !== undefined) {
								writeFileSync(artifactPath, Buffer.from("approval-png"));
							}
						}
						if (input.args.includes("eval")) {
							evalCalls += 1;
							if (evalCalls === 3) {
								const beforeSubmit = await loadSharedRun(store.deps, runId);
								submitObservedDispatchMarker =
									beforeSubmit.ok &&
									beforeSubmit.run.approvals?.at(-1)
										?.dispatch_started_at_epoch_ms !== undefined;
							}
							if (scenario.submitFails && evalCalls === 3) {
								return { exitCode: 1, stdout: "", stderr: "submit failed" };
							}
							const result =
								evalCalls === 1
									? {
											ok: true,
											period_start: "2026-07-27",
											period_end: "2026-08-02",
											mode: "opened_from_available",
											target_start: "2026-07-27",
											target_end: "2026-08-02",
											row_count: 5,
										}
									: evalCalls === 2
										? {
												ok: true,
												period_start: "2026-07-27",
												period_end: "2026-08-02",
												results: [
													{
														dayIndex: 0,
														startMatches: true,
														endMatches: true,
														attendanceMatches: true,
														selectedText: "Standard",
													},
												],
											}
										: evalCalls === 3
											? {
												ok: true,
												mode: "exact-submit",
												controlText: "Submit",
												controlNgClick: "saveAndSubmit()",
												beforeUrl: timesheetUrl,
												beforeTitle: "Timesheet",
												afterUrl: timesheetUrl,
												afterTitle: "Timesheet",
											}
										: {
												proof_schema: "FastTrack360SubmittedProofV1",
												period_start: "2026-07-27",
												period_end: "2026-08-02",
												submitted: true,
												submitted_state: "submitted",
												submitted_state_source: "status-label",
												tab_text: "Submitted",
												row_summary: "Submitted timesheet",
												proof_observed_at: "2026-08-04T00:00:00.000Z",
											};
							return {
								exitCode: 0,
								stdout: agentSuccess({ result }),
								stderr: "",
							};
						}
						const data =
							input.args.includes("tab") && input.args.includes("list")
								? {
									tabs: [
										{
											tabId: "t1",
											active: true,
											type: "page",
											url: timesheetUrl,
										},
									],
								}
								: input.args.includes("get") && input.args.includes("url")
									? { url: timesheetUrl }
									: input.args.includes("is") &&
										input.args.includes("visible")
										? { visible: true }
									: input.args.includes("snapshot")
										? {
												snapshot: "@submit button Submit",
												refs: {
													submit: { role: "button", name: "Submit" },
												},
											}
										: {};
						return {
							exitCode: 0,
							stdout: agentSuccess(data),
							stderr: "",
						};
					},
				});
				runtime.authTokenRetrieval = authTokenPort(
					origin,
					"/RecruitmentManager/CandidatePortal",
				);
				runtime.runbookApprovedBindingResolver = async () =>
					approvedBinding(origin, "fasttrack");
				runtime.runbookAuthTransport = () => cdp.transport;
				if (scenario.identityBasis === "human") {
					runtime.runbookAuthenticatedStateProof = async () => ({
						proven: false,
						cause: "human-identity-attestation-required",
					});
					runtime.runbookHumanIdentityAttestation = async (input) => {
						humanAttestationCalls += 1;
						return {
							ok: true,
							attestation: humanIdentityAttestationFor(input, {
								observed_at_epoch_ms: now,
								fresh_until_epoch_ms: now + 30_000,
							}),
						};
					};
				} else {
					runtime.runbookAuthenticatedStateProof = async ({ target_id }) =>
						authenticatedStateProof(origin, target_id);
				}

				await withCommittedCatalogSource(store.base, async (gitEnv) => {
					Object.assign(runtime.env, gitEnv);
					runtime.sourceCheckoutRoot = gitEnv.GIT_WORK_TREE;
					const listed = await runForTest(["runbook", "list", "--json"], runtime);
					expect(listed.exitCode).toBe(0);
					const catalogDigest = (
						parseJson(listed.stdout).data as {
							source_catalog_digest: string;
						}
					).source_catalog_digest;
					const activated = await runForTest(
						[
							"runbook",
							"activate",
							"--catalog-digest",
							catalogDigest,
							"--expected-epoch",
							"0",
							"--json",
						],
						runtime,
					);
					expect(activated.exitCode).toBe(0);
					const runArgs = [
						"runbook",
						"run",
						"--service",
						"fasttrack",
						"--flow",
						"submit",
						"--input-file",
						`timesheet_submission=${inputPath}`,
						"--handoff",
						handoffPath,
						"--tab",
						"t1",
						"--json",
					] as const;
					const awaitingApproval = await runForTest(runArgs, runtime);
					expect(awaitingApproval.exitCode).toBe(0);
					const awaitingRun = (
						parseJson(awaitingApproval.stdout).data as {
							run: BrowserUseSharedRun;
						}
					).run;
					expect(awaitingRun.state).toBe("awaiting-approval");
					expect(evalCalls).toBe(2);
					expect(awaitingRun.mutation_dispatched).toBe(true);
					expect(humanAttestationCalls).toBe(
						scenario.identityBasis === "human" ? 1 : 0,
					);

					const evalsBeforeUnapprovedResume = evalCalls;
					const stillAwaiting = await runForTest(
						[...runArgs.slice(0, -1), "--run", runId, "--json"],
						runtime,
					);
					expect(stillAwaiting.exitCode).toBe(0);
					expect(evalCalls).toBe(evalsBeforeUnapprovedResume);

					now = 40_000;
					const approved = await runForTest(
						[
							"run",
							"approve",
							"--run",
							runId,
							"--continuation",
							"complete-submit-approval",
							"--artifact",
							"submit-approval-5.png",
							"--json",
						],
						runtime,
					);
					expect(approved.exitCode).toBe(0);
					const approvedRun = await loadSharedRun(store.deps, runId);
					expect(approvedRun.ok).toBe(true);
					if (approvedRun.ok) {
						expect(
							approvedRun.run.approvals?.at(-1)
								?.dispatch_started_at_epoch_ms,
						).toBeUndefined();
					}

					const resumed = await runForTest(
						[...runArgs.slice(0, -1), "--run", runId, "--json"],
						runtime,
					);
					expect(resumed.exitCode).toBe(scenario.submitFails ? 20 : 0);
					expect(humanAttestationCalls).toBe(
						scenario.identityBasis === "human" ? 2 : 0,
					);
					expect(submitObservedDispatchMarker).toBe(true);
					const durable = await loadSharedRun(store.deps, runId);
					expect(durable.ok).toBe(true);
					if (!durable.ok) return;
					expect(durable.run.approvals?.at(-1)).toMatchObject({
						continuation_id: "complete-submit-approval",
						dispatch_started_at_epoch_ms: 40_000,
					});
					expect(durable.run.auth_attestation?.fresh_until_epoch_ms).toBe(
						70_000,
					);
					if (scenario.submitFails) {
						expect(parseJson(resumed.stdout).error).toMatchObject({
							code: "task_run_effect_unknown",
							message: expect.stringContaining(
								"may have dispatched browser effects",
							),
						});
						expect(durable.run.state).toBe("unknown");
						expect(evalCalls).toBe(3);
					} else {
						expect(durable.run.state).toBe("confirmed");
						expect(durable.run.runbook_progress?.next_step).toBe(10);
						expect(evalCalls).toBe(4);
					}

					const evalsBeforeSecondResume = evalCalls;
					const secondResume = await runForTest(
						[...runArgs.slice(0, -1), "--run", runId, "--json"],
						runtime,
					);
					expect(secondResume.exitCode).toBe(
						scenario.submitFails ? 20 : 0,
					);
					expect(evalCalls).toBe(evalsBeforeSecondResume);
				}, { excludeRunbooks: ["oncore/fill/runbook.json"] });
			} finally {
				cdp.transport.close();
			}
		});
	}

	test("a fresh public run racing activation retries wholly against one generation", async () => {
		const store = await makeStore();
		const firstRunbook = readOnlyRunbook();
		const sourceRoot = await createPublicCatalogSource(store.base, firstRunbook);
		const firstDigest = await publicCatalogDigest(store.env, sourceRoot);
		expect((await activatePublicCatalog({
			env: store.env,
			sourceRoot,
			digest: firstDigest,
			expectedEpoch: 0,
		})).exitCode).toBe(0);

		const secondRunbook = {
			...firstRunbook,
			version: "3",
			summary: "Read-only snapshot verification after activation.",
		};
		await commitPublicCatalogRunbook(
			sourceRoot,
			secondRunbook,
			"second catalog",
		);
		const secondDigest = await publicCatalogDigest(store.env, sourceRoot);
		const runId = "run-generation-race";
		const handoffPath = writeHandoff(store.base, "agent-browser", runId);
		const browserCalls: Array<readonly string[]> = [];
		let activationResult:
			| Awaited<ReturnType<typeof activatePublicCatalog>>
			| undefined;
		let activationStarted = false;
		const runtime = makeRuntime({
			env: store.env,
			sourceCheckoutRoot: sourceRoot,
			platformFs: createDefaultPlatformFs(),
			readTextFile: (path: string) =>
				import("node:fs/promises").then((module) =>
					module.readFile(path, "utf-8"),
				),
			runCommand: async (input) => {
				const semantic = input.args.slice(4);
				browserCalls.push(semantic);
				if (!activationStarted) {
					activationStarted = true;
					activationResult = await activatePublicCatalog({
						env: store.env,
						sourceRoot,
						digest: secondDigest,
						expectedEpoch: 1,
					});
				}
				const data =
					semantic[0] === "tab" && semantic[1] === "list"
						? {
								tabs: [
									{
										tabId: "t1",
										active: true,
										type: "page",
										url: "https://example.test/",
									},
								],
							}
						: semantic[0] === "get" && semantic[1] === "url"
							? { url: "https://example.test/" }
							: semantic[0] === "snapshot"
								? { snapshot: "@e1 button", refs: { "@e1": {} } }
								: semantic[0] === "open"
									? { opened: true }
									: { selected: true };
				return { exitCode: 0, stdout: agentSuccess(data), stderr: "" };
			},
		});

		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--json",
			],
			runtime,
		);
		expect(activationResult?.exitCode).toBe(0);
		expect(result.exitCode).toBe(0);
		const payload = parseJson(result.stdout) as {
			data: {
				run: {
					run_id: string;
					state: string;
					run_execution_binding: {
						generation_id: string;
						activation_epoch: number;
						runbook_version: string;
					};
				};
			};
		};
		expect(payload.data.run).toMatchObject({
			run_id: runId,
			state: "confirmed",
			run_execution_binding: {
				generation_id: `gen-${secondDigest}`,
				activation_epoch: 2,
				runbook_version: "3",
			},
		});
		expect(browserCalls.length).toBeGreaterThan(0);
	});

	test("a retained public run never falls forward when its pinned generation is missing", async () => {
		const store = await makeStore();
		const firstRunbook = readOnlyRunbook();
		const sourceRoot = await createPublicCatalogSource(store.base, firstRunbook);
		const firstDigest = await publicCatalogDigest(store.env, sourceRoot);
		expect((await activatePublicCatalog({
			env: store.env,
			sourceRoot,
			digest: firstDigest,
			expectedEpoch: 0,
		})).exitCode).toBe(0);

		const templateRunId = "run-generation-template";
		const templateHandoff = writeHandoff(
			store.base,
			"agent-browser",
			templateRunId,
		);
		const templateRuntime = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{ stdout: agentSuccess({ selected: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ opened: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ snapshot: "@e1 button", refs: { "@e1": {} } }) },
		]);
		const templateResult = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", templateHandoff,
				"--tab", "t1",
				"--json",
			],
			templateRuntime.runtime,
		);
		expect(templateResult.exitCode).toBe(0);
		const templateRun = (
			parseJson(templateResult.stdout).data as {
				run: BrowserUseSharedRun;
			}
		).run;
		expect(templateRun).toMatchObject({
			state: "confirmed",
			run_execution_binding: {
				generation_id: `gen-${firstDigest}`,
				activation_epoch: 1,
			},
		});
		if (templateRun.run_execution_binding === undefined) {
			throw new Error("public run omitted generation binding");
		}

		const secondRunbook = {
			...firstRunbook,
			version: "3",
			summary: "Read-only replacement generation.",
		};
		await commitPublicCatalogRunbook(
			sourceRoot,
			secondRunbook,
			"replacement catalog",
		);
		const secondDigest = await publicCatalogDigest(store.env, sourceRoot);
		expect((await activatePublicCatalog({
			env: store.env,
			sourceRoot,
			digest: secondDigest,
			expectedEpoch: 1,
		})).exitCode).toBe(0);

		const retainedRunId = "run-retained-generation-missing";
		const retainedEnvelope = handoffEnvelope("agent-browser", retainedRunId);
		const retainedHandoff = join(store.base, "handoff-retained-generation.json");
		writeFileSync(retainedHandoff, JSON.stringify(retainedEnvelope), "utf-8");
		const parsedHandoff = parseHandoffFacts(JSON.stringify(retainedEnvelope));
		if (!parsedHandoff.ok || parsedHandoff.kind !== "verified") {
			throw new Error("retained handoff fixture invalid");
		}
		const targetEnvelopeId = targetEnvelopeIdOf({
			runId: retainedRunId,
			mode: "handoff-bound",
			adapter: "agent-browser",
			handoffEvidenceId: parsedHandoff.facts.handoffEvidenceId,
		});
		expect((await createSharedRun(store.deps, {
			run_id: retainedRunId,
			state: "needs-human",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: parsedHandoff.facts.handoffEvidenceId,
			runbook_target_binding: {
				schema_version: "1",
				mode: "exact",
				binding_id: candidateIdOf(targetEnvelopeId, ["adapter_page_id", "t1"]),
			},
			runbook_progress: {
				schema_version: "1",
				service_id: "oncore",
				flow_id: "snapshot-verify",
				runbook_version: "2",
				next_step: 1,
				total_steps: 2,
			},
			run_execution_binding: templateRun.run_execution_binding,
			continuation: {
				next_action_id: "runbook-resume:1",
				summary: "Resume the retained read-only generation.",
			},
			mutation_dispatched: false,
			artifacts: [],
		})).ok).toBe(true);

		await store.deps.fs.removeDirectoryRecursive(
			join(
				store.deps.paths.data.runbookGenerationsDir,
				`gen-${firstDigest}`,
			),
		);
		const activeProjection = await runForTest(
			["runbook", "list", "--json"],
			makeRuntime({ env: store.env, sourceCheckoutRoot: sourceRoot }),
		);
		expect(activeProjection.exitCode).toBe(0);
		expect(parseJson(activeProjection.stdout).data).toMatchObject({
			active_generation_id: `gen-${secondDigest}`,
			active_epoch: 2,
		});

		const resumed = scriptedRuntime(store.env, []);
		const refusal = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--run", retainedRunId,
				"--handoff", retainedHandoff,
				"--tab", "t1",
				"--json",
			],
			resumed.runtime,
		);
		expect(refusal.exitCode).toBe(20);
		expect(parseJson(refusal.stdout)).toMatchObject({
			error: { code: "activation_generation_corrupt" },
			continuation: { next_action_id: "activate_runbook_catalog" },
		});
		expect(resumed.calls).toEqual([]);
	});

	test("missing binding approval keeps one shared run and blocks before proof or business dispatch", async () => {
		const cdp = startAuthCdpFixture({ initial: "login" });
		try {
			const store = await makeStore();
			seedRunbook(store.dataRoot, authContextRunbook(cdp.origin));
			const runId = "run-runbook-auth-success";
			const handoffPath = writeHandoff(store.base, "agent-browser", runId);
			const { runtime, calls } = scriptedRuntime(store.env, [
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
				{ stdout: agentSuccess({ selected: true }) },
				{ stdout: agentSuccess({ url: `${cdp.origin}/login` }) },
				{ stdout: agentSuccess({ snapshot: "@business heading", refs: { "@business": {} } }) },
				]);
				const credentialDispatches = { fetches: 0, redeems: 0 };
				const managedPort = authTokenPort(
					cdp.origin,
					credentialDispatches,
				);
				let managedReleaseCalls = 0;
				runtime.authManagedAccess = async () => ({
					ok: true,
					lease: {
						access_path: "managed-service-token",
						required_vault_scope: "exactly-one-vault",
						expires_at_epoch_ms: 601_000,
						token_retrieval: managedPort,
						release: async () => {
							managedReleaseCalls += 1;
						},
					},
				});
			runtime.runbookAuthTransport = () => cdp.transport;
			let proofDispatches = 0;
			runtime.runbookAuthenticatedStateProof = async ({ target_id }) => {
				proofDispatches += 1;
				return authenticatedStateProof(cdp.origin, target_id);
			};

			const result = await runForTest(
				[
					"runbook", "run",
					"--service", "fixture-auth",
					"--flow", "business-after-login",
					"--handoff", handoffPath,
					"--tab", "t1",
					"--json",
				],
				runtime,
			);
			expect(result.exitCode).toBe(0);
				const data = parseJson(result.stdout).data as Record<string, unknown>;
				const run = data.run as Record<string, unknown>;
				expect(data.entry_mode).toBe("reviewed-runbook");
				expect(data.auth_access_path).toBe("managed-service-token");
			expect(run.run_id).toBe(runId);
			expect(run.handoff_evidence_id).toBeDefined();
			expect(run.state).toBe("awaiting-approval");
			expect(parseJson(result.stdout).continuation).toMatchObject({
				next_action_id: "request-binding-selection-grant",
			});
			expect(calls.filter((call) => call.includes("snapshot"))).toHaveLength(0);
				expect(credentialDispatches).toEqual({ fetches: 0, redeems: 0 });
				expect(managedReleaseCalls).toBe(1);
			expect(proofDispatches).toBe(0);
			const durable = await loadSharedRun(store.deps, runId);
			expect(durable.ok).toBe(true);
			if (durable.ok) {
				expect(durable.run.run_id).toBe(runId);
				expect(durable.run.state).toBe("awaiting-approval");
			}
		} finally {
			cdp.transport.close();
		}
	});

	test("neutral auth target bootstraps once, then binding approval blocks before proof or business open", async () => {
		const cdp = startAuthCdpFixture({ initial: "neutral" });
		try {
			const store = await makeStore();
			seedRunbook(store.dataRoot, authContextOpenRunbook(cdp.origin));
			const runId = "run-runbook-auth-neutral";
			const handoffPath = writeHandoff(store.base, "agent-browser", runId);
			const loginUrl = `${cdp.origin}/login`;
			const { runtime, calls } = scriptedRuntime(store.env, [
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: "about:blank" }] }) },
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: loginUrl }] }) },
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: loginUrl }] }) },
				{ stdout: agentSuccess({ selected: true }) },
				{ stdout: agentSuccess({ url: loginUrl }) },
				{ stdout: agentSuccess({ opened: true }) },
				{ stdout: agentSuccess({ url: loginUrl }) },
				{ stdout: agentSuccess({ snapshot: "@business heading", refs: { "@business": {} } }) },
			]);
			runtime.authTokenRetrieval = authTokenPort(cdp.origin);
			runtime.runbookAuthTransport = () => cdp.transport;
			let authenticatedStateProven = false;
			const runCommand = runtime.runCommand;
			runtime.runCommand = async (input) => {
				if (input.args.includes("open") || input.args.includes("snapshot")) {
					expect(authenticatedStateProven).toBe(true);
				}
				return await runCommand(input);
			};
			runtime.runbookAuthenticatedStateProof = async ({ target_id }) => {
				authenticatedStateProven = true;
				return authenticatedStateProof(cdp.origin, target_id);
			};

			const result = await runForTest(
				[
					"runbook", "run",
					"--service", "fixture-auth",
					"--flow", "business-after-login",
					"--handoff", handoffPath,
					"--tab", "t1",
					"--json",
				],
				runtime,
			);

			expect(result.exitCode).toBe(0);
			expect(cdp.navigations).toEqual([loginUrl]);
			expect(cdp.attachedTargetIds).not.toContain("t1");
			expect(cdp.attachedTargetIds).toContain(cdp.cdpTargetId);
			expect(calls.filter((call) => call.includes("open"))).toHaveLength(0);
			expect(calls.filter((call) => call.includes("snapshot"))).toHaveLength(0);
			const run = (parseJson(result.stdout).data as { run: { state: string } }).run;
			expect(run.state).toBe("awaiting-approval");
			expect(parseJson(result.stdout).continuation).toMatchObject({
				next_action_id: "request-binding-selection-grant",
			});
			expect(authenticatedStateProven).toBe(false);
		} finally {
			cdp.transport.close();
		}
	});

	test("protected opening navigation exposes an expired session before business dispatch", async () => {
		const origin = "http://127.0.0.1:45123";
		const protectedUrl = `${origin}/protected`;
		const cdp = startAuthCdpFixture({
			initial: "authenticated",
			origin,
			initialUrl: protectedUrl,
		});
		try {
			const store = await makeStore();
			seedRunbook(
				store.dataRoot,
				authContextOpenRunbook(origin, "/protected"),
			);
			const runId = "run-runbook-auth-expired-session";
			const handoffPath = writeHandoff(store.base, "agent-browser", runId);
			const targetList = {
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: protectedUrl,
						},
					],
				}),
			};
			const { runtime, calls } = scriptedRuntime(store.env, [
				targetList,
				targetList,
				targetList,
				{ stdout: agentSuccess({ selected: true }) },
				{ stdout: agentSuccess({ url: protectedUrl }) },
				{ stdout: agentSuccess({ opened: true }) },
				{ stdout: agentSuccess({ url: protectedUrl }) },
				{
					stdout: agentSuccess({
						snapshot: "@business heading Dashboard",
						refs: { business: {} },
					}),
				},
			]);
			runtime.authTokenRetrieval = authTokenPort(origin, "/protected");
			runtime.runbookApprovedBindingResolver = async () => ({
				...approvedBinding(origin),
				allowed_login_paths: ["/protected"],
			});
			runtime.runbookAuthTransport = () => cdp.transport;
			runtime.runbookAuthenticatedStateProof = async ({ target_id }) =>
				authenticatedStateProof(origin, target_id);

			const result = await runForTest(
				[
					"runbook", "run",
					"--service", "fixture-auth",
					"--flow", "business-after-login",
					"--handoff", handoffPath,
					"--tab", "t1",
					"--json",
				],
				runtime,
			);

			expect(result.exitCode).toBe(0);
			expect(cdp.navigations).toEqual([protectedUrl]);
			expect(calls.filter((call) => call.includes("open"))).toHaveLength(1);
			expect(calls.filter((call) => call.includes("snapshot"))).toHaveLength(1);
			expect(parseJson(result.stdout).data).toMatchObject({
				run: { state: "confirmed" },
			});
		} finally {
			cdp.transport.close();
		}
	});

	test("binding approval precedes ambiguous signed-in proof and business dispatch", async () => {
		const cdp = startAuthCdpFixture({ initial: "ambiguous" });
		try {
			const store = await makeStore();
			seedRunbook(store.dataRoot, authContextRunbook(cdp.origin));
			const runId = "run-runbook-auth-ambiguous";
			const handoffPath = writeHandoff(store.base, "agent-browser", runId);
			const { runtime, calls } = scriptedRuntime(store.env, [
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
				{ stdout: agentSuccess({ tabs: [{ tabId: "t1", active: true, type: "page", url: `${cdp.origin}/login` }] }) },
				{ stdout: agentSuccess({ selected: true }) },
			]);
			runtime.authTokenRetrieval = authTokenPort(cdp.origin);
			runtime.runbookAuthTransport = () => cdp.transport;
			let proofDispatches = 0;
			runtime.runbookAuthenticatedStateProof = async () => {
				proofDispatches += 1;
				return {
					proven: false,
					cause: "human-identity-attestation-required",
				};
			};

			const result = await runForTest(
				[
					"runbook", "run",
					"--service", "fixture-auth",
					"--flow", "business-after-login",
					"--handoff", handoffPath,
					"--tab", "t1",
					"--json",
				],
				runtime,
			);

			expect(result.exitCode).toBe(0);
			const parsed = parseJson(result.stdout);
			expect(parsed.continuation).toMatchObject({
				next_action_id: "request-binding-selection-grant",
			});
			const run = (parsed.data as Record<string, unknown>).run as Record<string, unknown>;
			expect(run.run_id).toBe(runId);
			expect(run.state).toBe("awaiting-approval");
			expect(calls.some((call) => call.includes("snapshot"))).toBe(false);
			expect(proofDispatches).toBe(0);
		} finally {
			cdp.transport.close();
		}
	});

	test("a presence-blocked run resumes through one attestation and dispatches the first business step once", async () => {
		const runId = "run-runbook-auth-ambiguous";
		const fixture = await presenceBlockedRunbookFixture(runId);
		try {
			const parsed = parseJson(fixture.blocked.stdout);
			expect(parsed.continuation).toMatchObject({
				next_action_id: "complete-human-identity-attestation",
			});
			const run = (parsed.data as Record<string, unknown>).run as Record<string, unknown>;
			expect(run.run_id).toBe(runId);
			expect(run.state).toBe("awaiting-user-presence");
			expect(fixture.blockedCalls.some((call) => call.includes("snapshot"))).toBe(false);

			let attestationCalls = 0;
			const resumed = presenceResumeRuntime(fixture.store.env, fixture.cdp);
			resumed.runtime.runbookHumanIdentityAttestation = async (input) => {
				attestationCalls += 1;
				return { ok: true, attestation: humanIdentityAttestationFor(input) };
			};

			const completed = await resumePresenceBlockedRunbook({
				runtime: resumed.runtime,
				handoffPath: fixture.handoffPath,
				runId,
			});
			expect(completed.exitCode).toBe(0);
			expect(attestationCalls).toBe(1);
			expect(resumed.calls.filter((call) => call.includes("snapshot"))).toHaveLength(1);
			const durable = await loadSharedRun(fixture.store.deps, runId);
			expect(durable.ok).toBe(true);
			if (durable.ok) {
				expect(durable.run.state).toBe("confirmed");
				expect(durable.run.auth_attestation).toMatchObject({
					attestation_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
					fresh_until_epoch_ms: 31_000,
				});
			}
		} finally {
			fixture.cdp.transport.close();
		}
	});

	test("a refused human attestation stays presence-blocked with one continuation and no business dispatch", async () => {
		const runId = "run-runbook-auth-refused";
		const fixture = await presenceBlockedRunbookFixture(runId);
		try {
			let attestationCalls = 0;
			const resumed = presenceResumeRuntime(fixture.store.env, fixture.cdp);
			resumed.runtime.runbookHumanIdentityAttestation = async () => {
				attestationCalls += 1;
				return {
					ok: false,
					code: "presence-cancelled",
					message: "presence was refused.",
				};
			};

			const refused = await resumePresenceBlockedRunbook({
				runtime: resumed.runtime,
				handoffPath: fixture.handoffPath,
				runId,
			});

			expect(refused.exitCode).toBe(0);
			expect(attestationCalls).toBe(1);
			expect(resumed.calls.some((call) => call.includes("snapshot"))).toBe(false);
			const parsed = parseJson(refused.stdout);
			expect(parsed.continuation).toEqual({
				next_action_id: "complete-human-identity-attestation",
			});
			const durable = await loadSharedRun(fixture.store.deps, runId);
			expect(durable.ok).toBe(true);
			if (durable.ok) {
				expect(durable.run.state).toBe("awaiting-user-presence");
				expect(durable.run.auth_attestation).toBeUndefined();
				expect(durable.run.continuation?.next_action_id).toBe(
					"complete-human-identity-attestation",
				);
			}
		} finally {
			fixture.cdp.transport.close();
		}
	});

	test("a binding-mismatched human attestation fails closed before business dispatch", async () => {
		const runId = "run-runbook-auth-binding-mismatch";
		const fixture = await presenceBlockedRunbookFixture(runId);
		try {
			let attestationCalls = 0;
			const resumed = presenceResumeRuntime(fixture.store.env, fixture.cdp);
			resumed.runtime.runbookHumanIdentityAttestation = async (input) => {
				attestationCalls += 1;
				return {
					ok: true,
					attestation: humanIdentityAttestationFor(input, {
						service_id: "different-service",
					}),
				};
			};

			const mismatched = await resumePresenceBlockedRunbook({
				runtime: resumed.runtime,
				handoffPath: fixture.handoffPath,
				runId,
			});

			expect(mismatched.exitCode).toBe(20);
			expect(attestationCalls).toBe(1);
			expect(resumed.calls.some((call) => call.includes("snapshot"))).toBe(false);
			expect(parseJson(mismatched.stdout).error).toMatchObject({
				code: "human_identity_attestation_binding_invalid",
			});
			const durable = await loadSharedRun(fixture.store.deps, runId);
			expect(durable.ok).toBe(true);
			if (durable.ok) {
				expect(durable.run.state).toBe("awaiting-user-presence");
				expect(durable.run.auth_attestation).toBeUndefined();
			}
		} finally {
			fixture.cdp.transport.close();
		}
	});

	test("unenrolled confidential runbook refusal chains through install-token and status", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, confidentialRunbook());
		const handoffPath = writeHandoff(
			store.base,
			"agent-browser",
			"run-runbook-unenrolled",
		);
		const { runtime } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "confidential-login",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "runbook_confidential_native_capability_absent",
		});
		expect(result.stdout).toContain("browser-use auth install-token");
		expect(result.stdout).toContain("browser-use auth status --json");
	});

	test("production-shaped CLI without a proof owner refuses before browser dispatch", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, authContextRunbook("https://fixture.test"));
		const runId = "run-runbook-auth-proof-absent";
		const handoffPath = writeHandoff(store.base, "agent-browser", runId);
		const { runtime, calls } = scriptedRuntime(store.env, []);
		runtime.authTokenRetrieval = authTokenPort("https://fixture.test");

		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "fixture-auth",
				"--flow", "business-after-login",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--json",
			],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "human-identity-attestation-required" },
			continuation: {
				next_action_id: "inspect_task_run_result",
			},
			data: { external_effect: "none" },
		});
		expect(calls).toEqual([]);
		expect((await loadSharedRun(store.deps, runId)).ok).toBe(false);
	});

	test("runbook run on a chrome handoff fails closed, never substitutes the lane (R11)", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-runbook-2");
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "task_run_handoff_lane_mismatch",
		});
	});

	test("a fresh runbook target failure creates no orphan run", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-blocked");
		const { runtime } = scriptedRuntime(store.env, [
			{ stdout: agentSuccess({ tabs: [] }) },
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "agent_browser_target_unavailable",
		});
		expect(
			(parseJson(result.stdout).continuation as Record<string, unknown>)
				.next_action_id,
		).toBe("prepare_unique_runbook_target");
		const loaded = await loadSharedRun(store.deps, "run-runbook-blocked");
		expect(loaded.ok).toBe(false);
	});

	test("a target-list transport failure requests a fresh handoff, not tab repair", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(
			store.base,
			"agent-browser",
			"run-runbook-transport",
		);
		const { runtime, calls } = scriptedRuntime(store.env, [
			{
				exitCode: 1,
				stdout: JSON.stringify({
					success: false,
					data: null,
					error: "CDP WebSocket connect failed",
				}),
			},
			{ stdout: agentSuccess({ cdpUrl: "ws://fixture" }) },
			{
				exitCode: 1,
				stdout: JSON.stringify({
					success: false,
					data: null,
					error: "CDP WebSocket connect failed",
				}),
			},
			{ stdout: agentSuccess({ cdpUrl: "ws://fixture" }) },
			{
				exitCode: 1,
				stdout: JSON.stringify({
					success: false,
					data: null,
					error: "CDP WebSocket connect failed",
				}),
			},
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "agent_browser_connection_unstable" },
			continuation: { next_action_id: "refresh_runbook_handoff" },
			data: { external_effect: "none" },
		});
		expect(calls).toHaveLength(5);
		expect(
			(await loadSharedRun(store.deps, "run-runbook-transport")).ok,
		).toBe(false);
	});

	test("multiple automatic runbook targets fail closed before run creation", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(
			store.base,
			"agent-browser",
			"run-runbook-ambiguous",
		);
		const { runtime } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [
						{ tabId: "t1", type: "page", url: "about:blank" },
						{ tabId: "t2", type: "page", url: "about:blank" },
					],
				}),
			},
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout).error).toMatchObject({
			code: "agent_browser_target_ambiguous",
		});
		const loaded = await loadSharedRun(store.deps, "run-runbook-ambiguous");
		expect(loaded.ok).toBe(false);
	});

	test("a legacy unbound nonterminal run refuses before target resolution", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-cursor");
		const seed: Omit<BrowserUseSharedRun, "revision"> = {
			run_id: "run-runbook-cursor",
			state: "needs-human",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: "seed-evidence",
			mutation_dispatched: false,
			artifacts: [],
			continuation: {
				next_action_id: "runbook-resume:1",
				summary: "connection dropped after the confirmed open step; resume from step 1.",
			},
		};
		const created = await createSharedRun(store.deps, seed);
		expect(created.ok).toBe(true);
		const { runtime, calls } = scriptedRuntime(store.env, []);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--run", "run-runbook-cursor",
				"--handoff", handoffPath,
				"--tab", "t1",
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "agent_browser_target_moved" },
			continuation: { next_action_id: "restore_bound_runbook_target" },
			data: { external_effect: "none" },
		});
		expect(calls).toHaveLength(0);
		const loaded = await loadSharedRun(store.deps, seed.run_id);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) {
			expect(loaded.run.runbook_target_binding).toBeUndefined();
			expect(loaded.run.revision).toBe(1);
		}
	});

	test("mutation-dispatched runbook restart returns unknown effect without browser calls", async () => {
		const store = await makeStore();
		const runId = "run-runbook-mutation-unknown";
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const handoffPath = writeHandoff(store.base, "agent-browser", runId);
		const parsedHandoff = parseHandoffFacts(readFileSync(handoffPath, "utf8"));
		if (!parsedHandoff.ok || parsedHandoff.kind !== "verified") {
			throw new Error("mutation restart handoff fixture invalid");
		}
		const targetEnvelopeId = targetEnvelopeIdOf({
			runId,
			mode: "handoff-bound",
			adapter: "agent-browser",
			handoffEvidenceId: parsedHandoff.facts.handoffEvidenceId,
		});
		const seed: Omit<BrowserUseSharedRun, "revision"> = {
			run_id: runId,
			state: "running",
			task_intent: "runbook-execution",
			environment_profile: {
				environment: "agent-chrome",
				profile: "default",
			},
			adapter_id: "agent-browser",
			handoff_evidence_id: parsedHandoff.facts.handoffEvidenceId,
			runbook_target_binding: {
				schema_version: "1",
				mode: "exact",
				binding_id: candidateIdOf(targetEnvelopeId, [
					"adapter_page_id",
					"t1",
				]),
			},
			runbook_progress: {
				schema_version: "1",
				service_id: "oncore",
				flow_id: "snapshot-verify",
				runbook_version: "2",
				next_step: 0,
				total_steps: 2,
			},
			mutation_dispatched: true,
			artifacts: [],
		};
		const created = await createSharedRun(store.deps, seed);
		expect(created).toMatchObject({ ok: true });
		const { runtime, calls } = scriptedRuntime(store.env, []);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--run", runId,
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(20);
		expect(parseJson(result.stdout)).toMatchObject({
			error: { code: "task_run_effect_unknown" },
			data: { external_effect: "unknown" },
			continuation: { next_action_id: "inspect_task_run_result" },
		});
		expect(calls).toEqual([]);
		const durable = await loadSharedRun(store.deps, runId);
		expect(durable.ok).toBe(true);
		if (durable.ok) {
			expect(durable.run).toMatchObject({
				run_id: runId,
				mutation_dispatched: true,
			});
		}
	});

	test("a bound resumed runbook starts at the persisted cursor", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const runId = "run-runbook-bound-cursor";
		const envelope = handoffEnvelope("agent-browser", runId);
		const handoffPath = join(store.base, "handoff-agent-browser.json");
		writeFileSync(handoffPath, JSON.stringify(envelope), "utf-8");
		const parsed = parseHandoffFacts(JSON.stringify(envelope));
		expect(parsed).toMatchObject({ ok: true, kind: "verified" });
		if (!parsed.ok || parsed.kind !== "verified") {
			throw new Error("fixture handoff invalid");
		}
		const targetEnvelopeId = targetEnvelopeIdOf({
			runId,
			mode: "handoff-bound",
			adapter: "agent-browser",
			handoffEvidenceId: parsed.facts.handoffEvidenceId,
		});
		const seed: Omit<BrowserUseSharedRun, "revision"> = {
			run_id: runId,
			state: "needs-human",
			task_intent: "runbook-execution",
			environment_profile: { environment: "agent-chrome", profile: "default" },
			adapter_id: "agent-browser",
			handoff_evidence_id: parsed.facts.handoffEvidenceId,
			runbook_target_binding: {
				schema_version: "1",
				mode: "automatic",
				binding_id: candidateIdOf(targetEnvelopeId, [
					"adapter_page_id",
					"t1",
				]),
			},
			runbook_progress: {
				schema_version: "1",
				service_id: "oncore",
				flow_id: "snapshot-verify",
				runbook_version: "2",
				next_step: 1,
				total_steps: 2,
			},
			continuation: {
				next_action_id: "runbook-resume:1",
				summary: "Resume from the first unproven step.",
			},
			mutation_dispatched: false,
			artifacts: [],
		};
		expect((await createSharedRun(store.deps, seed)).ok).toBe(true);
		const { runtime, calls } = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "https://example.test/",
						},
					],
				}),
			},
			{ stdout: agentSuccess({ selected: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ snapshot: "@e1 button", refs: { "@e1": {} } }) },
			{ stdout: agentSuccess({}) },
			{ stdout: agentSuccess({ sessions: [] }) },
		]);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--run", runId,
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(calls).toHaveLength(7);
		expect(calls.some((call) => call.includes("open"))).toBe(false);
		expect(calls.slice(-2)).toEqual([
			[
				"/opt/browser-connect/probe",
				"--session",
				"browser-use-run-runbook-bound-cursor",
				"close",
				"--json",
			],
			["/opt/browser-connect/probe", "session", "list", "--json"],
		]);
	});

	test("concurrent bound resumes produce one executor dispatch", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const runId = "run-runbook-concurrent";
		const envelope = handoffEnvelope("agent-browser", runId);
		const handoffPath = join(store.base, "handoff-agent-browser-concurrent.json");
		writeFileSync(handoffPath, JSON.stringify(envelope), "utf-8");
		const parsed = parseHandoffFacts(JSON.stringify(envelope));
		if (!parsed.ok || parsed.kind !== "verified") {
			throw new Error("fixture handoff invalid");
		}
		const targetEnvelopeId = targetEnvelopeIdOf({
			runId,
			mode: "handoff-bound",
			adapter: "agent-browser",
			handoffEvidenceId: parsed.facts.handoffEvidenceId,
		});
		expect(
			(
				await createSharedRun(store.deps, {
					run_id: runId,
					state: "needs-human",
					task_intent: "runbook-execution",
					environment_profile: {
						environment: "agent-chrome",
						profile: "default",
					},
					adapter_id: "agent-browser",
					handoff_evidence_id: parsed.facts.handoffEvidenceId,
					runbook_target_binding: {
						schema_version: "1",
						mode: "automatic",
						binding_id: candidateIdOf(targetEnvelopeId, [
							"adapter_page_id",
							"t1",
						]),
					},
					runbook_progress: {
						schema_version: "1",
						service_id: "oncore",
						flow_id: "snapshot-verify",
						runbook_version: "2",
						next_step: 1,
						total_steps: 2,
					},
					continuation: {
						next_action_id: "runbook-resume:1",
						summary: "Resume from the first unproven step.",
					},
					mutation_dispatched: false,
					artifacts: [],
				})
			).ok,
		).toBe(true);
		const calls: Array<readonly string[]> = [];
		let signalFirstSnapshotStarted: (() => void) | undefined;
		const firstSnapshotStarted = new Promise<void>((resolve) => {
			signalFirstSnapshotStarted = resolve;
		});
		let releaseFirstSnapshot: (() => void) | undefined;
		const firstSnapshotMayFinish = new Promise<void>((resolve) => {
			releaseFirstSnapshot = resolve;
		});
		let snapshotInvocationCount = 0;
		const runtime = makeRuntime({
			env: store.env,
			now: () => 1_000,
			platformFs: createDefaultPlatformFs(),
			readTextFile: (path: string) =>
				import("node:fs/promises").then((module) =>
					module.readFile(path, "utf-8"),
				),
			runCommand: async (input) => {
				const semantic = input.args.slice(4);
				calls.push(semantic);
				if (semantic[0] === "snapshot") {
					snapshotInvocationCount += 1;
					if (snapshotInvocationCount === 1) {
						signalFirstSnapshotStarted?.();
						await firstSnapshotMayFinish;
					}
					return {
						exitCode: 0,
						stdout: agentSuccess({ refs: {} }),
						stderr: "",
					};
				}
				const data =
					semantic[0] === "tab" && semantic[1] === "list"
						? {
								tabs: [
									{
										tabId: "t1",
										type: "page",
										url: "https://example.test/",
									},
								],
							}
						: semantic[0] === "get" && semantic[1] === "url"
							? { url: "https://example.test/" }
							: { selected: true };
				return { exitCode: 0, stdout: agentSuccess(data), stderr: "" };
			},
		});
		const argv = [
			"runbook", "run",
			"--service", "oncore",
			"--flow", "snapshot-verify",
			"--run", runId,
			"--handoff", handoffPath,
			"--json",
		] as const;
		const firstResultPromise = runForTest(argv, runtime);
		await firstSnapshotStarted;
		const secondResult = await runForTest(argv, runtime);
		releaseFirstSnapshot?.();
		const firstResult = await firstResultPromise;
		const results = [firstResult, secondResult];
		expect(
			results
				.map((result) => result.exitCode)
				.sort((left, right) => left - right),
		).toEqual([0, 20]);
		expect(calls.filter((call) => call[0] === "snapshot")).toHaveLength(1);
		const loaded = await loadSharedRun(store.deps, runId);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.state).toBe("confirmed");
	});

	test("a confirmed runbook resume is a no-op with no target or auth work", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const runId = "run-runbook-confirmed-noop";
		const handoffPath = writeHandoff(store.base, "agent-browser", runId);
		expect(
			(
				await createSharedRun(store.deps, {
					run_id: runId,
					state: "confirmed",
					task_intent: "runbook-execution",
					environment_profile: {
						environment: "agent-chrome",
						profile: "default",
					},
					adapter_id: "agent-browser",
					handoff_evidence_id: "legacy-confirmed-evidence",
					mutation_dispatched: false,
					artifacts: [],
				})
			).ok,
		).toBe(true);
		const { runtime, calls } = scriptedRuntime(store.env, []);
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--run", runId,
				"--handoff", handoffPath,
				"--json",
			],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(parseJson(result.stdout)).toMatchObject({
			data: {
				run: { state: "confirmed" },
				external_effect: "none",
				executed_steps: 0,
				resume: "confirmed-no-op",
			},
		});
		expect(calls).toHaveLength(0);
		const loaded = await loadSharedRun(store.deps, runId);
		expect(loaded.ok).toBe(true);
		if (loaded.ok) expect(loaded.run.revision).toBe(1);
	});

	test("runbook run without --service is a usage error", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "agent-browser", "run-runbook-3");
		const result = await runForTest(
			["runbook", "run", "--flow", "snapshot-verify", "--handoff", handoffPath, "--json"],
			makeRuntime({ env: store.env }),
		);
		expect(result.exitCode).toBe(2);
		expect(parseJson(result.stdout).error).toMatchObject({ code: "usage_error" });
	});
});

// =========================================================================
// Internal envelope mint (design brief D4,
// docs/plans/2026-07-27-agent-first-front-door-brief.md): a fresh
// `task run --intent` / `runbook run` without --handoff mints the Verified
// Handoff Envelope in-process through the runtime's mintHandoff seam and flows
// through the SAME parseHandoffFacts validation as a caller-supplied file.
// A mint failure is browser-connect's failure envelope surfaced VERBATIM.
// =========================================================================

describe("task run — internal envelope mint (D4)", () => {
	test("a fresh --intent run without --handoff mints for the intent's preferred adapter and confirms", async () => {
		const store = await makeStore();
		const scripted = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		const mintCalls: Array<{ adapterId: string; runId?: string }> = [];
		scripted.runtime.mintHandoff = async (input) => {
			mintCalls.push(input);
			return {
				exitCode: 0,
				stdout: JSON.stringify(
					handoffEnvelope(input.adapterId, input.runId ?? "run-minted"),
				),
				stderr: "",
			};
		};
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			scripted.runtime,
		);
		expect(result.exitCode).toBe(0);
		// debug's preferred lane is chrome-devtools-mcp; the mint attached it.
		expect(mintCalls).toHaveLength(1);
		expect(mintCalls[0]?.adapterId).toBe("chrome-devtools-mcp");
		const data = parseJson(result.stdout).data as Record<string, unknown>;
		expect(data.selected_lane).toBe("chrome-devtools-mcp");
		const run = data.run as Record<string, unknown>;
		expect(run.state).toBe("confirmed");
		// The minted envelope's run id became the durable shared run id.
		expect(run.run_id).toBe(mintCalls[0]?.runId);
	});

	test("a mint failure surfaces browser-connect's failure envelope verbatim with its exit code", async () => {
		const store = await makeStore();
		const scripted = scriptedRuntime(store.env, []);
		const failureEnvelope = JSON.stringify({
			status: "error",
			data: { outcome: "failed", failure_class: "environment-unavailable" },
			continuation: { next_action_id: "inspect_agent_chrome" },
		});
		const failureStderr =
			"Repair Path: runtime/browser-connect/REPAIR.md#v1-inspect_agent_chrome\n";
		scripted.runtime.mintHandoff = async () => ({
			exitCode: 20,
			stdout: failureEnvelope,
			stderr: failureStderr,
		});
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			scripted.runtime,
		);
		expect(result.exitCode).toBe(20);
		// Verbatim passthrough: browser-use never re-wraps the connect failure.
		expect(result.stdout).toBe(failureEnvelope);
		expect(result.stderr).toBe(failureStderr);
		// Fail closed: no adapter call, no run created.
		expect(scripted.calls).toHaveLength(0);
	});

	test("--handoff still wins over the mint (advanced caller-managed path)", async () => {
		const store = await makeStore();
		const handoffPath = writeHandoff(store.base, "chrome-devtools-mcp", "run-managed-1");
		const scripted = scriptedRuntime(store.env, [
			{ stdout: chromePagesListing() },
			{ stdout: chromeConsole() },
			{ stdout: chromeNetwork() },
		]);
		let minted = false;
		scripted.runtime.mintHandoff = async () => {
			minted = true;
			throw new Error("mint must not run when --handoff is supplied");
		};
		const result = await runForTest(
			[
				"task", "run",
				"--intent", "debug",
				"--handoff", handoffPath,
				"--tab", "0",
				"--allowed-origin", "https://example.test",
				"--json",
			],
			scripted.runtime,
		);
		expect(result.exitCode).toBe(0);
		expect(minted).toBe(false);
	});

	test("runbook run without --handoff mints for the agent-browser lane", async () => {
		const store = await makeStore();
		seedRunbook(store.dataRoot, readOnlyRunbook());
		const scripted = scriptedRuntime(store.env, [
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "about:blank",
						},
					],
				}),
			},
			{
				stdout: agentSuccess({
					tabs: [
						{
							tabId: "t1",
							active: true,
							type: "page",
							url: "about:blank",
						},
					],
				}),
			},
			{ stdout: agentSuccess({ selected: true }) },
			{ stdout: agentSuccess({ url: "about:blank" }) },
			{ stdout: agentSuccess({ opened: true }) },
			{ stdout: agentSuccess({ url: "https://example.test/" }) },
			{ stdout: agentSuccess({ snapshot: "- page snapshot" }) },
			{ stdout: agentSuccess({}) },
			{ stdout: agentSuccess({ sessions: [] }) },
		]);
		const mintCalls: Array<{ adapterId: string; runId?: string }> = [];
		scripted.runtime.mintHandoff = async (input) => {
			mintCalls.push(input);
			return {
				exitCode: 0,
				stdout: JSON.stringify(
					handoffEnvelope(input.adapterId, input.runId ?? "run-minted-rb"),
				),
				stderr: "",
			};
		};
		const result = await runForTest(
			[
				"runbook", "run",
				"--service", "oncore",
				"--flow", "snapshot-verify",
				"--json",
			],
			scripted.runtime,
		);
		expect(mintCalls).toHaveLength(1);
		expect(mintCalls[0]?.adapterId).toBe("agent-browser");
		const mintedRunId = mintCalls[0]?.runId;
		expect(typeof mintedRunId).toBe("string");
		if (typeof mintedRunId !== "string") {
			throw new Error("fixture mint did not receive a run id");
		}
		expect(result.exitCode).toBe(0);
		const payload = parseJson(result.stdout) as {
			data?: {
				run?: {
					state?: string;
					runbook_target_binding?: unknown;
					runbook_target?: {
						bound?: boolean;
						mode?: string;
						schema_version?: string;
					};
					runbook_progress?: { next_step?: number };
				};
			};
		};
		expect(payload.data?.run?.state).toBe("confirmed");
		expect(payload.data?.run?.runbook_target_binding).toBeUndefined();
		expect(payload.data?.run?.runbook_target).toEqual({
			bound: true,
			mode: "automatic",
			schema_version: "1",
		});
		expect(payload.data?.run?.runbook_progress?.next_step).toBe(2);
		expect(result.stdout).not.toContain("target_candidate_id");
		expect(result.stdout).not.toContain("binding_id");
		const plain = await runForTest(
			[
				"run", "status",
				"--run", mintedRunId,
				"--plain",
			],
			makeRuntime({
				env: store.env,
				platformFs: createDefaultPlatformFs(),
			}),
		);
		expect(plain.exitCode).toBe(0);
		expect(plain.stdout).toContain(
			"target_bound=true target_mode=automatic target_schema=1",
		);
		expect(plain.stdout).not.toContain("binding_id");
		expect(plain.stdout).not.toContain("target_candidate_id");
		expect(scripted.calls.slice(0, -2).map((call) => call.slice(5))).toEqual([
			["tab", "list", "--json"],
			["tab", "list", "--json"],
			["tab", "t1", "--json"],
			["get", "url", "--json"],
			["open", "https://example.test/", "--json"],
			["get", "url", "--json"],
			["snapshot", "-i", "--json"],
		]);
		expect(scripted.calls.slice(-2)).toEqual([
			[
				"/opt/browser-connect/probe",
				"--session",
				`browser-use-${mintedRunId}`,
				"close",
				"--json",
			],
			["/opt/browser-connect/probe", "session", "list", "--json"],
		]);
	});
});
