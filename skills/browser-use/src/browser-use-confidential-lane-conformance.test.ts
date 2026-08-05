import { describe, expect, test } from "bun:test";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import { __confidentialDeliveryDriverForTest } from "./browser-use";
import {
	type ChromeTask,
	compileChromeOperationSet,
	executeChromeTask,
} from "./browser-use-chrome-task";
import {
	type BrowserUseDeliveryHook,
	type BrowserUseTargetReproof,
	type BrowserUseVerifiedTarget,
	deliverConfidentialFields,
} from "./browser-use-confidential-field-delivery";
import type {
	BrowserUseOpCredentialField,
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";
import {
	executePlaywrightTask,
	type PlaywrightTask,
} from "./browser-use-playwright-task";
import type { BrowserUseRuntime } from "./browser-use-runtime";
import {
	type BrowserUseDeliveredFieldShape,
	deriveConformanceSentinel,
	deriveSentinelSet,
} from "./browser-use-secret-scan";
import {
	assertContainmentBeforeRelease,
	beginSensitiveRunGuard,
	type BrowserUseGovernedSurface,
	markRunSensitive,
} from "./browser-use-sensitive-run";
import type {
	McporterCommandInput,
	McporterCommandResult,
} from "./mcporter-transport";

// =========================================================================
// Per-lane sentinel conformance (U7; R2/R12). Hook-level proof that the
// NON-agent-browser lanes leak nothing while a confidential delivery
// completes: each lane's executor fake runs ALONGSIDE the REAL
// deliverConfidentialFields choreography (the delivery-helper fake being the
// only component that observes sentinel bytes), and the harness asserts:
//   * the lane's recorded runCommand argv and adapter stdout never contain
//     the delivered sentinel value,
//   * the lane never dispatches a fill-shaped command — confidential bytes
//     have NO native-input path on these lanes,
//   * the mechanical containment gate (assertContainmentBeforeRelease over
//     the derived sentinel set) releases the clean lane surfaces AND — the
//     non-vacuity flip — withholds when a lane surface DOES carry the value.
//
// Sentinels are minted with deriveConformanceSentinel under the run driver's
// OWN runScopedSentinelNonce, so the delivered value equals the marker the
// derived sweep set hunts for (the same value==sentinel posture as the
// delivery-level leak harness).
// =========================================================================

const { runScopedSentinelNonce } = __confidentialDeliveryDriverForTest;

// The fill-shaped command vocabulary NO conformance lane may ever dispatch: a
// token containing any of these fragments would be a native secret-input path.
const FILL_VOCABULARY = [
	"fill",
	"type",
	"press",
	"insert",
	"keys",
	"set-value",
	"setvalue",
] as const;

/** Every recorded argv token that matches the fill vocabulary (expect: none). */
function fillVocabularyIn(calls: readonly (readonly string[])[]): string[] {
	const matched: string[] = [];
	for (const call of calls) {
		for (const token of call) {
			const lower = token.toLowerCase();
			if (FILL_VOCABULARY.some((word) => lower.includes(word))) {
				matched.push(token);
			}
		}
	}
	return matched;
}

function mintSentinels(runId: string): {
	nonce: string;
	value: Readonly<Record<BrowserUseOpCredentialField, string>>;
} {
	const nonce = runScopedSentinelNonce(runId);
	const user = deriveConformanceSentinel("username", nonce);
	const pass = deriveConformanceSentinel("password", nonce);
	const otp = deriveConformanceSentinel("otp-current", nonce);
	if (!(user.ok && pass.ok && otp.ok)) {
		throw new Error("conformance sentinel minting failed");
	}
	return {
		nonce,
		value: {
			username: user.value,
			password: pass.value,
			"otp-current": otp.value,
		},
	};
}

// The delivery-helper fake: the ONLY component that observes sentinel bytes.
function leakHelper(
	sentinelValue: Readonly<Record<BrowserUseOpCredentialField, string>>,
): { hook: BrowserUseDeliveryHook; observed: string[] } {
	const observed: string[] = [];
	const hook: BrowserUseDeliveryHook = async (input) => {
		const value = sentinelValue[input.field];
		observed.push(value);
		return { ok: true, shape: { field: input.field, byte_length: value.length } };
	};
	return { hook, observed };
}

const fakePort: BrowserUseTokenRetrievalPort = {
	listVaults: async () => ({ ok: true, vaults: [] }),
	listLoginItems: async () => ({ ok: true, items: [] }),
	getLoginItem: async () => ({
		ok: false,
		rejection: { code: "item-missing", message: "n/a" },
	}),
	fetchCredentialField: async (
		input,
	): Promise<{ ok: true; handle: BrowserUseSecretHandle }> => ({
		ok: true,
		handle: {
			handle_id: `handle-${input.field}`,
			field: input.field,
			expires_at_epoch_ms: 9_999_999,
		},
	}),
};

const reproveOk: BrowserUseTargetReproof = async ({ target }) => ({
	proven: true,
	observed_digest: target.target_proof_digest,
});

const BINDING: BrowserUseItemBinding = {
	service_id: "oncore",
	auth_context: "interactive-login",
	allowed_origins: ["https://example.test"],
	allowed_login_paths: [],
	vault_id: "vault-1",
	item_id: "item-1",
	allowed_auth_methods: ["password", "otp"],
	binding_revision: 1,
};

function verifiedTarget(laneId: string, runId: string): BrowserUseVerifiedTarget {
	return {
		lane_id: laneId,
		run_id: runId,
		top_level_origin: "https://example.test",
		frame_origin: "https://example.test",
		target_id: "target-1",
		page_id: "page-1",
		frame_id: "frame-1",
		account_ref: "acct-ref-redacted",
		target_proof_digest: "d".repeat(32),
	};
}

function handoffFor(adapterId: string, probe: string): BrowserConnectHandoffPayload & {
	contract_id: string;
	schema_version: string;
} {
	return {
		outcome: "verified",
		environment: { name: "agent-chrome", profile: "default" },
		browser_entry_mode: "explicit-cdp",
		attachment: {
			adapter_id: adapterId,
			route: "explicit-cdp",
			probe_executable: probe,
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
	} as BrowserConnectHandoffPayload & {
		contract_id: string;
		schema_version: string;
	};
}

/** Register the derived sentinel set and gate the given surfaces. */
function sweep(
	guardRunId: string,
	shapes: readonly BrowserUseDeliveredFieldShape[],
	nonce: string,
	surfaces: readonly BrowserUseGovernedSurface[],
): ReturnType<typeof assertContainmentBeforeRelease> {
	const set = deriveSentinelSet(shapes, nonce);
	if (!set.ok) throw new Error(`sentinel set: ${set.rejection.code}`);
	const guard = beginSensitiveRunGuard(guardRunId);
	if (!guard.ok) throw new Error("guard begin refused");
	const marked = markRunSensitive(guard.guard, {
		trigger: "confidential-field-delivery",
		sentinels: set.sentinels,
	});
	if (!marked.ok) throw new Error(`guard mark: ${marked.rejection.code}`);
	return assertContainmentBeforeRelease(marked.guard, surfaces);
}

// --- chrome-devtools-mcp envelope fakes (verbatim live shapes, 2026-07-27) ---

function mcpText(text: string): string {
	return JSON.stringify({ content: [{ type: "text", text }] });
}

function pagesListing(): string {
	return mcpText(
		["## Pages", "1: portal (https://example.test/login) [selected]"].join("\n"),
	);
}

function chromeRuntimeFor(responses: readonly string[]): {
	runtime: BrowserUseRuntime;
	calls: Array<readonly string[]>;
	stdouts: string[];
} {
	const calls: Array<readonly string[]> = [];
	const stdouts: string[] = [];
	let index = 0;
	const runtime: BrowserUseRuntime = {
		env: {},
		now: () => 0,
		runCommand: async (
			input: McporterCommandInput,
		): Promise<McporterCommandResult> => {
			calls.push([input.command, ...input.args]);
			const stdout = responses[index++] ?? mcpText("");
			stdouts.push(stdout);
			return { exitCode: 0, stdout, stderr: "" };
		},
		readTextFile: async () => "",
		writeTextFile: async () => {},
		ensureDirectory: async () => {},
		readStdin: async () => "",
		platformFs: {} as BrowserUseRuntime["platformFs"],
		mintHandoff: async () => {
			throw new Error("mintHandoff must not run in lane-conformance tests");
		},
	};
	return { runtime, calls, stdouts };
}

function chromeTask(runId: string): ChromeTask {
	return {
		handoff: handoffFor(
			"chrome-devtools-mcp",
			"/opt/browser-connect/chrome-devtools-mcp",
		),
		run_id: runId,
		target_page_id: 1,
		allowed_origins: ["https://example.test"],
		operations: compileChromeOperationSet("debug"),
	};
}

describe("per-lane sentinel conformance (U7, R2/R12)", () => {
	test("playwright-cdp: recorded argv/output sweeps clean while a delivery completes, and no fill-shaped command is dispatched", async () => {
		const RUN = "run-lane-conf-playwright";
		const { nonce, value } = mintSentinels(RUN);
		const { hook, observed } = leakHelper(value);

		const calls: Array<readonly string[]> = [];
		const stdouts: string[] = [];
		const laneRuntime = {
			runCommand: async (
				input: McporterCommandInput,
			): Promise<McporterCommandResult> => {
				calls.push([input.command, ...input.args]);
				const stdout =
					input.args.at(-1) === "snapshot"
						? '### Page\n- Page URL: https://example.test/login\n### Snapshot\n- textbox "Password" [ref=e2]\n'
						: "";
				stdouts.push(stdout);
				return { exitCode: 0, stdout, stderr: "" };
			},
		};
		const task: PlaywrightTask = {
			handoff: handoffFor("playwright-cdp", "/opt/adapters/playwright-cli"),
			run_id: RUN,
			target_tab_index: 1,
			allowed_origins: ["https://example.test"],
			intent: "frontend-test",
		};

		// The lane task runs ALONGSIDE a completing delivery.
		const [delivery, lane] = await Promise.all([
			deliverConfidentialFields({
				binding: BINDING,
				target: verifiedTarget("playwright-cdp", RUN),
				fields: ["password"],
				tokenRetrieval: fakePort,
				deliver: hook,
				reproveTarget: reproveOk,
			}),
			executePlaywrightTask(laneRuntime, task),
		]);

		// The delivery genuinely completed: the helper (the only secret holder)
		// saw the bytes, so a clean lane sweep is meaningful, not vacuous.
		expect(delivery.ok).toBe(true);
		if (!delivery.ok) return;
		expect(observed).toContain(value.password);
		expect(lane).toMatchObject({ ok: true, executed_commands: 4 });

		// Zero fill vocabulary dispatched on this lane.
		expect(fillVocabularyIn(calls)).toEqual([]);

		// Direct byte assertion over every recorded lane surface.
		const surfaces: BrowserUseGovernedSurface[] = [
			{ kind: "log", label: "playwright-argv", content: JSON.stringify(calls) },
			{
				kind: "stdout-envelope",
				label: "playwright-adapter-stdout",
				content: stdouts.join("\n"),
			},
			{
				kind: "stdout-envelope",
				label: "playwright-result",
				content: JSON.stringify(lane),
			},
		];
		for (const surface of surfaces) {
			expect(surface.content).not.toContain(value.password);
		}

		// Mechanical gate over the clean lane surfaces: releases.
		const clean = sweep(
			"run-lane-conf-playwright-clean",
			delivery.resume.delivered_shapes,
			nonce,
			surfaces,
		);
		expect(clean.release).toBe(true);

		// Non-vacuity flip: the SAME sweep withholds when a lane surface carries
		// the delivered value.
		const planted = sweep(
			"run-lane-conf-playwright-plant",
			delivery.resume.delivered_shapes,
			nonce,
			[
				...surfaces,
				{
					kind: "stdout-envelope",
					label: "planted-lane-stdout",
					content: `- textbox "Password": ${value.password}\n`,
				},
			],
		);
		expect(planted.release).toBe(false);
		if (planted.release) return;
		expect(planted.reason).toBe("containment_failed");
	});

	test("chrome-devtools-mcp: recorded argv/output sweeps clean while a delivery completes, no fill-shaped tool is dispatched, and an echoing page is CAUGHT", async () => {
		const RUN = "run-lane-conf-chrome";
		const { nonce, value } = mintSentinels(RUN);
		const { hook, observed } = leakHelper(value);

		const clean = chromeRuntimeFor([
			pagesListing(),
			mcpText("## Console messages\n<no console messages found>"),
			mcpText("GET https://example.test/api 200"),
		]);
		const [delivery, lane] = await Promise.all([
			deliverConfidentialFields({
				binding: BINDING,
				target: verifiedTarget("chrome-devtools-mcp", RUN),
				fields: ["password"],
				tokenRetrieval: fakePort,
				deliver: hook,
				reproveTarget: reproveOk,
			}),
			executeChromeTask(clean.runtime, chromeTask(RUN)),
		]);

		expect(delivery.ok).toBe(true);
		if (!delivery.ok) return;
		expect(observed).toContain(value.password);
		expect(lane).toMatchObject({ ok: true, executed_operations: 2 });

		// Zero fill vocabulary dispatched (this lane is read-only by contract).
		expect(fillVocabularyIn(clean.calls)).toEqual([]);

		const surfaces: BrowserUseGovernedSurface[] = [
			{
				kind: "log",
				label: "chrome-argv",
				content: JSON.stringify(clean.calls),
			},
			{
				kind: "stdout-envelope",
				label: "chrome-adapter-stdout",
				content: clean.stdouts.join("\n"),
			},
			{
				kind: "stdout-envelope",
				label: "chrome-result",
				content: JSON.stringify(lane),
			},
		];
		for (const surface of surfaces) {
			expect(surface.content).not.toContain(value.password);
		}
		const cleanGate = sweep(
			"run-lane-conf-chrome-clean",
			delivery.resume.delivered_shapes,
			nonce,
			surfaces,
		);
		expect(cleanGate.release).toBe(true);

		// Non-vacuity flip THROUGH the SUT: a page whose console echoed the typed
		// value flows into the lane's captured evidence (the auth scrubber redacts
		// credential PATTERNS, not arbitrary page text), so the harness must catch
		// the delivered value on the lane's OWN result surface.
		const leaky = chromeRuntimeFor([
			pagesListing(),
			mcpText(
				`## Console messages\n[log] password field now holds ${value.password}`,
			),
			mcpText("GET https://example.test/api 200"),
		]);
		const leakyLane = await executeChromeTask(leaky.runtime, chromeTask(RUN));
		expect(leakyLane.ok).toBe(true);
		const leakySurface: BrowserUseGovernedSurface = {
			kind: "stdout-envelope",
			label: "chrome-result-leaky",
			content: JSON.stringify(leakyLane),
		};
		// The regression is real: the value reached the SUT-produced result.
		expect(leakySurface.content).toContain(value.password);
		const plantedGate = sweep(
			"run-lane-conf-chrome-plant",
			delivery.resume.delivered_shapes,
			nonce,
			[leakySurface],
		);
		expect(plantedGate.release).toBe(false);
		if (plantedGate.release) return;
		expect(plantedGate.reason).toBe("containment_failed");
	});
});
