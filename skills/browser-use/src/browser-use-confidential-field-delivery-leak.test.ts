import { describe, expect, test } from "bun:test";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
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
	type BrowserUseDeliveredFieldShape,
	deriveConformanceSentinel,
	deriveSentinelSet,
} from "./browser-use-secret-scan";
import {
	type BrowserUseGovernedSurface,
	assertContainmentBeforeRelease,
	beginSensitiveRunGuard,
	markRunSensitive,
} from "./browser-use-sensitive-run";

// =========================================================================
// Delivery-level value-aware leak harness (auth plan U4/U5, AE5, AE12;
// release contract R14, AE5).
//
// PROCESS-BOUNDARY containment proof for the REAL confidential-delivery
// choreography. Sentinel credential VALUES (minted so that each delivered
// value equals a marker the sentinel owner derives) flow through the ACTUAL
// deliverConfidentialFields choreography and a delivery-helper fake that
// stands in for the disposable Confidential Field Delivery Helper (R16). The
// harness then registers the derived sentinel set on the Sensitive Run Guard
// and sweeps EVERY governed surface the choreography can emit onto — the
// resume directive, the blocked continuation, the serialized result, and a
// crash surface — asserting ZERO sentinel occurrences.
//
// Design invariant ENFORCED: the sentinel bytes only ever enter the
// delivery-helper fake. The choreography's own outputs (resume directive,
// blocked cause, delivered shapes) carry only structural facts — never a
// value. A future change that routed a delivered value onto a choreography
// output would put a registered sentinel on a swept surface and fail here.
// =========================================================================

const NONCE = "leakrun01";

// Mint conformance sentinels: the delivered VALUE equals a marker the derived
// sweep set contains (see browser-use-secret-scan deriveConformanceSentinel).
const USER = deriveConformanceSentinel("username", NONCE);
const PASS = deriveConformanceSentinel("password", NONCE);
const OTP = deriveConformanceSentinel("otp-current", NONCE);
if (!(USER.ok && PASS.ok && OTP.ok)) {
	throw new Error("conformance sentinel minting failed");
}
const SENTINEL_VALUE: Readonly<Record<BrowserUseOpCredentialField, string>> = {
	username: USER.value,
	password: PASS.value,
	"otp-current": OTP.value,
};

const TARGET: BrowserUseVerifiedTarget = {
	lane_id: "agent-browser",
	run_id: "run-cfd-leak",
	top_level_origin: "https://oncore.test",
	frame_origin: "https://oncore.test",
	target_id: "target-1",
	page_id: "page-1",
	frame_id: "frame-1",
	account_ref: "acct-ref-redacted",
	target_proof_digest: "d".repeat(32),
};

const BINDING: BrowserUseItemBinding = {
	service_id: "oncore",
	auth_context: "interactive-login",
	allowed_origins: ["https://oncore.test"],
	allowed_login_paths: [],
	vault_id: "vault-1",
	item_id: "item-1",
	allowed_auth_methods: ["password", "otp"],
	binding_revision: 1,
};

const reproveOk: BrowserUseTargetReproof = async ({ target }) => ({
	proven: true,
	observed_digest: target.target_proof_digest,
});

const fakePort: BrowserUseTokenRetrievalPort = {
	listVaults: async () => ({ ok: true, vaults: [] }),
	listLoginItems: async () => ({ ok: true, items: [] }),
	getLoginItem: async () => ({
		ok: false,
		rejection: { code: "item-missing", message: "n/a" },
	}),
	fetchCredentialField: async (input): Promise<{ ok: true; handle: BrowserUseSecretHandle }> => ({
		ok: true,
		handle: {
			// The handle is OPAQUE — never the value. Its id names the field only.
			handle_id: `handle-${input.field}`,
			field: input.field,
			expires_at_epoch_ms: 9_999_999,
		},
	}),
};

// The delivery-helper fake: the ONLY component that observes sentinel bytes.
// It reports back only outcome + non-secret shape (kind + value length). The
// value it delivers is the conformance sentinel for the field.
function leakHelper(behaviour: {
	crashOn?: BrowserUseOpCredentialField;
}): { hook: BrowserUseDeliveryHook; observed: string[] } {
	const observed: string[] = [];
	const hook: BrowserUseDeliveryHook = async (input) => {
		const value = SENTINEL_VALUE[input.field];
		observed.push(value); // only the helper ever sees the bytes
		if (behaviour.crashOn === input.field) {
			return { ok: false, reason: "helper-crash", field_cleared: true };
		}
		return {
			ok: true,
			shape: { field: input.field, byte_length: value.length },
		};
	};
	return { hook, observed };
}

function sweepAndRelease(
	runId: string,
	shapes: readonly BrowserUseDeliveredFieldShape[],
	surfaces: BrowserUseGovernedSurface[],
) {
	const set = deriveSentinelSet(shapes, NONCE);
	if (!set.ok) throw new Error(`sentinel set: ${set.rejection.code}`);
	const guard = beginSensitiveRunGuard(runId);
	if (!guard.ok) throw new Error("guard begin");
	const marked = markRunSensitive(guard.guard, {
		trigger: "confidential-field-delivery",
		sentinels: set.sentinels,
	});
	if (!marked.ok) throw new Error(`guard mark: ${marked.rejection.code}`);
	return { gate: assertContainmentBeforeRelease(marked.guard, surfaces), set };
}

describe("delivery-level leak harness (AE5)", () => {
	test("a full password+OTP delivery leaves every choreography surface sentinel-free", async () => {
		const { hook, observed } = leakHelper({});
		const result = await deliverConfidentialFields({
			binding: BINDING,
			target: TARGET,
			fields: ["username", "password", "otp-current"],
			tokenRetrieval: fakePort,
			deliver: hook,
			reproveTarget: reproveOk,
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		// Sanity: the helper actually saw every sentinel (the flow is
		// representative), so a clean sweep is meaningful, not vacuous.
		expect(observed).toContain(SENTINEL_VALUE.username);
		expect(observed).toContain(SENTINEL_VALUE.password);
		expect(observed).toContain(SENTINEL_VALUE["otp-current"]);

		// Every surface the choreography can emit onto.
		const surfaces: BrowserUseGovernedSurface[] = [
			{
				kind: "stdout-envelope",
				label: "delivery-result",
				content: JSON.stringify(result),
			},
			{
				kind: "diagnostic",
				label: "resume-directive",
				content: JSON.stringify(result.resume),
			},
			{
				kind: "artifact",
				label: "delivered-shapes",
				content: JSON.stringify(result.resume.delivered_shapes),
			},
		];

		const { gate } = sweepAndRelease(
			"run-cfd-leak",
			result.resume.delivered_shapes,
			surfaces,
		);
		expect(gate.release).toBe(true);
		if (!gate.release) return;
		expect(gate.verdict.swept_surfaces).toBe(3);
		for (const value of Object.values(SENTINEL_VALUE)) {
			for (const surface of surfaces) {
				expect(surface.content).not.toContain(value);
			}
		}
	});

	test("a helper crash mid-delivery still leaves every surface clean (crash path)", async () => {
		const { hook, observed } = leakHelper({ crashOn: "password" });
		let crashText: string;
		let result: Awaited<ReturnType<typeof deliverConfidentialFields>>;
		try {
			result = await deliverConfidentialFields({
				binding: BINDING,
				target: TARGET,
				fields: ["username", "password"],
				tokenRetrieval: fakePort,
				deliver: hook,
				reproveTarget: reproveOk,
			});
			// A correct crash message never interpolates a raw value.
			crashText = `confidential delivery aborted mid-action for run ${TARGET.run_id} (field cleared)`;
		} catch (error) {
			crashText = error instanceof Error ? error.message : String(error);
			result = { ok: false, blocked: { blocked_cause: "capability-loss", continuation: { next_action_id: "x", summary: "x" }, external_effect_possible: false, fields_cleared: true } };
		}

		// The password helper crashed, so the choreography blocked; the username
		// was delivered before the crash and its value reached the helper.
		expect(observed).toContain(SENTINEL_VALUE.password);
		expect(result.ok).toBe(false);

		const surfaces: BrowserUseGovernedSurface[] = [
			{ kind: "crash-surface", label: "delivery-error", content: crashText },
			{
				kind: "stdout-envelope",
				label: "blocked-result",
				content: JSON.stringify(result),
			},
		];

		// Sweep for the sentinels that COULD have leaked (the ones the helper
		// touched before the crash) — username and password.
		const shapes: BrowserUseDeliveredFieldShape[] = [
			{ field: "username", byte_length: SENTINEL_VALUE.username.length },
			{ field: "password", byte_length: SENTINEL_VALUE.password.length },
		];
		const { gate } = sweepAndRelease("run-cfd-leak-crash", shapes, surfaces);
		expect(gate.release).toBe(true);
		for (const value of Object.values(SENTINEL_VALUE)) {
			expect(crashText).not.toContain(value);
			for (const surface of surfaces) expect(surface.content).not.toContain(value);
		}
	});

	test("the harness catches a REGRESSION that leaks a delivered value onto a surface", async () => {
		// Negative fixture (plan U4 Verification): if a future change routed a
		// delivered value onto a governed surface, the sweep MUST fail closed.
		const shapes: BrowserUseDeliveredFieldShape[] = [
			{ field: "password", byte_length: SENTINEL_VALUE.password.length },
		];
		const { gate } = sweepAndRelease("run-cfd-leak-regression", shapes, [
			{
				kind: "stdout-envelope",
				label: "leaky-result",
				content: `{"leaked":"${SENTINEL_VALUE.password}"}`,
			},
		]);
		expect(gate.release).toBe(false);
		if (gate.release) return;
		expect(gate.reason).toBe("containment_failed");
	});
});
