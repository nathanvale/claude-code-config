import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	type AdmissionRuntime,
	buildAdmittedManifest,
	createInMemoryAdmissionRuntime,
	createNativeAbsentRuntime,
} from "@side-quest/browser-use-security";
import {
	runForTest,
} from "./browser-use";
import {
	type BrowserUseSecuritySeam,
	createProductionBrowserUseRuntimeForTest,
} from "./browser-use-test-helpers";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import type {
	BrowserUseAccessibilityNode,
	BrowserUseAccessibilitySnapshot,
} from "./browser-use-cdp-observer";
import type { BrowserUseAuthenticatedStateProof } from "./browser-use-login-engine";
import type {
	BrowserUseOpCommandSpec,
	BrowserUseOpExecute,
} from "./browser-use-op";

// =========================================================================
// U10 — native TokenRetrievalPort wiring in createProductionBrowserUseRuntime.
//
// The runtime factory asks the native security seam whether the signed product
// is admitted. Only an `admitted` verdict yields a real Token Retrieval Port;
// every other verdict (including the default `native-capability-absent`) leaves
// `authTokenRetrieval` undefined so the public auth command keeps returning the
// typed absent evaluation. Two branches, both driven in-process against the
// real seam adapters — no signed product on disk, no real Chrome, no op(1).
// =========================================================================

// A minted admission manifest that clears the code-owned baseline: the earned
// in-memory fake adapter reports `admitted` when configured with this. Bundle
// ids/team/DR are the example fixtures the security package's own runtime test
// uses; none are real credentials.
const MINTED = buildAdmittedManifest({
	product_version: "1.0.0",
	targets: {
		"approval-broker": {
			bundle_id: "com.example.browser-use-security.approval-broker",
			team_identifier: "TEAMID0001",
			designated_requirement:
				'anchor apple generic and identifier "com.example.browser-use-security.approval-broker"',
		},
		"token-retrieval-launcher": {
			bundle_id: "com.example.browser-use-security.token-retrieval-launcher",
			team_identifier: "TEAMID0001",
			designated_requirement:
				'anchor apple generic and identifier "com.example.browser-use-security.token-retrieval-launcher"',
		},
		"confidential-field-delivery-xpc": {
			bundle_id:
				"com.example.browser-use-security.confidential-field-delivery-xpc",
			team_identifier: "TEAMID0001",
			designated_requirement:
				'anchor apple generic and identifier "com.example.browser-use-security.confidential-field-delivery-xpc"',
		},
	},
});

// A capturing op-executor: records every spec it is handed and answers the
// vault-list command with valid id-only json-evidence, so the constructed port
// is proven to actually drive the seam (not a dead object). Never returns or
// touches secret bytes.
function capturingExecutor(): {
	execute: BrowserUseOpExecute;
	specs: BrowserUseOpCommandSpec[];
} {
	const specs: BrowserUseOpCommandSpec[] = [];
	const execute: BrowserUseOpExecute = async (spec) => {
		specs.push(spec);
		return { kind: "json-evidence", value: [{ id: "vault-native-1" }] };
	};
	return { execute, specs };
}

// A seam that reports the product ADMITTED and yields the capturing executor.
// Models the future signed-product presence entirely in-process.
function presentSeam(): {
	seam: BrowserUseSecuritySeam;
	specs: BrowserUseOpCommandSpec[];
	admissionCalls: number;
	executorCalls: number;
} {
	const captured = capturingExecutor();
	const admission = createInMemoryAdmissionRuntime({ installed: MINTED });
	let admissionCalls = 0;
	let executorCalls = 0;
	const seam: BrowserUseSecuritySeam = {
		admission: {
			verifyProduct: async () => {
				admissionCalls += 1;
				return await admission.verifyProduct();
			},
			verifyTarget: admission.verifyTarget.bind(admission),
		},
		createTokenExecutor: () => {
			executorCalls += 1;
			return { execute: captured.execute, token_handle_id: "handle-native" };
		},
	};
	return {
		seam,
		specs: captured.specs,
		get admissionCalls() {
			return admissionCalls;
		},
		get executorCalls() {
			return executorCalls;
		},
	};
}

// An empty env keeps every store-backed command refusing at XDG resolution, so
// the runtime never touches real disk; only the auth-readiness path (which
// reads authTokenRetrieval before any store I/O) matters here.
const EMPTY_OVERRIDES = { env: {} } as const;

function nativeAbsentProofSeam(): BrowserUseSecuritySeam {
	return {
		admission: createNativeAbsentRuntime(),
		createTokenExecutor: () => {
			throw new Error("must not be reached when native capability is absent");
		},
	};
}

const PROOF_ORIGIN = "https://github.example";
const PROOF_TARGET = "target-freeform-proof";
const PROOF_BINDING: BrowserUseItemBinding = {
	service_id: "github",
	auth_context: "interactive-login",
	allowed_origins: [PROOF_ORIGIN],
	allowed_login_paths: ["/login"],
	vault_id: "vault-fixture",
	item_id: "item-fixture",
	allowed_auth_methods: ["password"],
	binding_revision: 1,
};

function proofNode(
	nodeId: string,
	role: string,
	accessibleName: string,
): BrowserUseAccessibilityNode {
	return {
		node_id: nodeId,
		role,
		accessible_name: accessibleName,
		ignored: false,
		properties: {},
	};
}

function proofSnapshot(
	nodes: readonly BrowserUseAccessibilityNode[],
	targetId = PROOF_TARGET,
): BrowserUseAccessibilitySnapshot {
	return { target_id: targetId, nodes };
}

function proofInput(
	overrides: Partial<Parameters<BrowserUseAuthenticatedStateProof>[0]> = {},
): Parameters<BrowserUseAuthenticatedStateProof>[0] {
	return {
		lane_id: "playwright-cdp",
		run_id: "freeform-proof-run",
		target_id: PROOF_TARGET,
		expected_url: `${PROOF_ORIGIN}/login`,
		allowed_origins: [PROOF_ORIGIN],
		binding: PROOF_BINDING,
		snapshot: proofSnapshot([
			proofNode("dashboard", "heading", "Dashboard"),
			proofNode("profile", "button", "Profile"),
		]),
		transition: "post-submit",
		...overrides,
	};
}

function referenceOf(label: string, binding: BrowserUseItemBinding): string {
	const canonical = JSON.stringify([
		label,
		binding.service_id,
		binding.auth_context,
		binding.vault_id,
		binding.item_id,
		binding.binding_revision,
	]);
	return `${label}:sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

async function productionProofOwner(): Promise<BrowserUseAuthenticatedStateProof> {
	const runtime = await createProductionBrowserUseRuntimeForTest(EMPTY_OVERRIDES);
	expect(runtime.authenticatedStateProof).toBeDefined();
	if (runtime.authenticatedStateProof === undefined) {
		throw new Error("production generic Session Identity Proof owner was absent");
	}
	return runtime.authenticatedStateProof;
}

describe("freeform Session Identity Proof production wiring", () => {
	test("native-absent production still wires the generic in-process proof owner", async () => {
		const runtime = await createProductionBrowserUseRuntimeForTest(EMPTY_OVERRIDES);
		expect(runtime.authenticatedStateProof).toBeDefined();
	});

	test("an override proof owner is wired into the production runtime", async () => {
		const supplied: BrowserUseAuthenticatedStateProof = async () => ({
			proven: false,
			cause: "session-identity-proof-unavailable",
		});
		const runtime = await createProductionBrowserUseRuntimeForTest(
			EMPTY_OVERRIDES,
			nativeAbsentProofSeam(),
			supplied,
		);
		expect(runtime.authenticatedStateProof).toBeDefined();
		expect(await runtime.authenticatedStateProof?.(proofInput())).toEqual({
			proven: false,
			cause: "session-identity-proof-unavailable",
		});
	});

	test("generic owner proves strong post-submit app structure with deterministic identity references", async () => {
		const owner = await productionProofOwner();
		const result = await owner(proofInput());
		expect(result.proven).toBe(true);
		if (!result.proven) return;
		expect(result.proof).toMatchObject({
			target_id: PROOF_TARGET,
			page_id: PROOF_TARGET,
			frame_id: PROOF_TARGET,
			origin: PROOF_ORIGIN,
			subject_reference: referenceOf("subject", PROOF_BINDING),
			account_reference: referenceOf("account", PROOF_BINDING),
			tenant_reference: referenceOf("tenant", PROOF_BINDING),
		});
		expect(result.proof.identity_basis_digest).toMatch(/^[a-f0-9]{64}$/);

		const reordered = await owner(
			proofInput({ snapshot: proofSnapshot([...proofInput().snapshot.nodes].reverse()) }),
		);
		expect(reordered).toMatchObject({
			proven: true,
			proof: { identity_basis_digest: result.proof.identity_basis_digest },
		});
	});

	test.each([
		{
			name: "expected origin is outside the allowlist",
			overrides: { expected_url: "https://evil.example/login" },
			cause: "origin-mismatch",
		},
		{
			name: "snapshot target differs from the proved target",
			overrides: {
				snapshot: proofSnapshot(
					[
						proofNode("dashboard", "heading", "Dashboard"),
						proofNode("profile", "button", "Profile"),
					],
					"target-hostile",
				),
			},
			cause: "origin-mismatch",
		},
		{
			name: "weak structural evidence",
			overrides: {
				snapshot: proofSnapshot([proofNode("dashboard", "heading", "Dashboard")]),
			},
			cause: "session-identity-proof-unavailable",
		},
		{
			name: "conflicting login controls remain",
			overrides: {
				snapshot: proofSnapshot([
					proofNode("signed-in", "heading", "Welcome, signed in"),
					proofNode("username", "textbox", "Username"),
					proofNode("continue", "button", "Continue"),
				]),
			},
			cause: "session-identity-proof-unavailable",
		},
		{
			name: "wrong-account or stale pre-existing session has no accepted marker",
			overrides: {
				transition: "pre-existing-session" as const,
				snapshot: proofSnapshot([
					proofNode("different-account", "heading", "Different account"),
					proofNode("switch-account", "button", "Switch account"),
				]),
			},
			cause: "session-identity-proof-unavailable",
		},
	] as const)("refuses $name with $cause and never requests human attestation", async ({ overrides, cause }) => {
		const owner = await productionProofOwner();
		const result = await owner(proofInput(overrides));
		expect(result).toEqual({ proven: false, cause });
		if (!result.proven) {
			expect(result.cause).not.toBe("human-identity-attestation-required");
		}
	});

	test("rejects a seam proof record bound to another target", async () => {
		const hostile: BrowserUseAuthenticatedStateProof = async () => ({
			proven: true,
			proof: {
				target_id: "target-hostile",
				page_id: "target-hostile",
				frame_id: "target-hostile",
				origin: PROOF_ORIGIN,
				subject_reference: "subject-hostile",
				account_reference: "account-hostile",
				tenant_reference: "tenant-hostile",
				identity_basis_digest: "0".repeat(64),
			},
		});
		const runtime = await createProductionBrowserUseRuntimeForTest(
			EMPTY_OVERRIDES,
			nativeAbsentProofSeam(),
			hostile,
		);
		const result = await runtime.authenticatedStateProof?.(proofInput());
		expect(result).toEqual({ proven: false, cause: "target-proof-invalid" });
		if (result?.proven === false) {
			expect(result.cause).not.toBe("human-identity-attestation-required");
		}
	});
});

describe("U10 native TokenRetrievalPort wiring", () => {
	test("absent seam (production default) leaves authTokenRetrieval undefined", async () => {
		const runtime = await createProductionBrowserUseRuntimeForTest(EMPTY_OVERRIDES);
		expect(runtime.authTokenRetrieval).toBeUndefined();
	});

	test("an explicitly native-absent seam leaves the port undefined", async () => {
		const seam: BrowserUseSecuritySeam = {
			admission: createNativeAbsentRuntime(),
			createTokenExecutor: () => {
				throw new Error("must not be reached when absent");
			},
		};
		const runtime = await createProductionBrowserUseRuntimeForTest(
			EMPTY_OVERRIDES,
			seam,
		);
		expect(runtime.authTokenRetrieval).toBeUndefined();
	});

	test("a not-admitted verdict also leaves the port undefined (fail closed)", async () => {
		// A verdict the seam can return that is neither admitted nor
		// native-capability-absent must still yield no port.
		const notAdmitted: AdmissionRuntime = {
			verifyProduct: async () => ({
				verdict: "not-admitted",
				target_id: null,
				error_code: "unknown-target",
			}),
			verifyTarget: async () => ({
				verdict: "not-admitted",
				target_id: null,
				error_code: "unknown-target",
			}),
		};
		let executorAsked = false;
		const seam: BrowserUseSecuritySeam = {
			admission: notAdmitted,
			createTokenExecutor: () => {
				executorAsked = true;
				throw new Error("must not be reached when not admitted");
			},
		};
		const runtime = await createProductionBrowserUseRuntimeForTest(
			EMPTY_OVERRIDES,
			seam,
		);
		expect(runtime.authTokenRetrieval).toBeUndefined();
		expect(executorAsked).toBe(false);
	});

	test("one throwing seam probe leaves every native auth surface absent", async () => {
		let admissionCalls = 0;
		let userPresentFactoryCalls = 0;
		const throwingSeam: BrowserUseSecuritySeam = {
			admission: {
				verifyProduct: async () => {
					admissionCalls += 1;
					throw new Error("seam probe boom");
				},
				verifyTarget: async () => {
					throw new Error("seam probe boom");
				},
			},
			createTokenExecutor: () => {
				throw new Error("must not be reached");
			},
			createUserPresentAccessProvider: () => {
				userPresentFactoryCalls += 1;
				return async () => ({ ok: false, cause: "authority-unavailable" });
			},
		};
		const runtime = await createProductionBrowserUseRuntimeForTest(
			EMPTY_OVERRIDES,
			throwingSeam,
		);
		expect(runtime.authTokenRetrieval).toBeUndefined();
		expect(runtime.authUserPresentAccess).toBeUndefined();
		expect(admissionCalls).toBe(1);
		expect(userPresentFactoryCalls).toBe(0);
	});

	test("an admitted seam whose createTokenExecutor throws yields absence, no unhandled rejection", async () => {
		// The miswiring the native-absent seam's typed throw is designed to
		// surface: admission reports `admitted`, but the executor factory throws.
		// Construction must stay inside the fail-closed guard so the runtime is
		// returned with authTokenRetrieval undefined — never a rejection that
		// escapes createProductionBrowserUseRuntime to the unguarded CLI await.
		const seam: BrowserUseSecuritySeam = {
			admission: createInMemoryAdmissionRuntime({ installed: MINTED }),
			createTokenExecutor: () => {
				throw new Error("executor miswired: native product absent");
			},
		};
		const runtime = await createProductionBrowserUseRuntimeForTest(
			EMPTY_OVERRIDES,
			seam,
		);
		expect(runtime.authTokenRetrieval).toBeUndefined();
	});

	test("admitted seam constructs a working Token Retrieval Port", async () => {
		const present = presentSeam();
		const runtime = await createProductionBrowserUseRuntimeForTest(
			EMPTY_OVERRIDES,
			present.seam,
		);
		expect(runtime.authTokenRetrieval).toBeDefined();
		expect(present.admissionCalls).toBe(1);
		expect(present.executorCalls).toBe(1);

		// The constructed port drives the injected executor and projects the
		// vault-list json-evidence to id-only refs.
		const port = runtime.authTokenRetrieval;
		if (port === undefined) throw new Error("port was undefined");
		const vaults = await port.listVaults();
		expect(vaults.ok).toBe(true);
		if (!vaults.ok) return;
		expect(vaults.vaults).toEqual([{ vault_id: "vault-native-1" }]);
		// The executor was actually invoked with the opaque token handle in the
		// env spec (no secret bytes; the handle is an id).
		expect(present.specs.length).toBe(1);
		expect(present.specs[0]?.env.token_handle_id).toBe("handle-native");
	});

	test("explicit auth surface overrides are honored and the seam is not probed", async () => {
		let probed = false;
		let userPresentFactoryAsked = false;
		const seam: BrowserUseSecuritySeam = {
			admission: {
				verifyProduct: async () => {
					probed = true;
					return { verdict: "native-capability-absent" };
				},
				verifyTarget: async () => ({ verdict: "native-capability-absent" }),
			},
			createTokenExecutor: () => {
				throw new Error("must not be reached");
			},
			createUserPresentAccessProvider: () => {
				userPresentFactoryAsked = true;
				throw new Error("must not be reached");
			},
		};
		const explicitPort = { marker: "explicit" } as never;
		const explicitUserPresentAccess = async () =>
			({ ok: false, cause: "authority-unavailable" }) as const;
		const runtime = await createProductionBrowserUseRuntimeForTest(
			{
				env: {},
				authTokenRetrieval: explicitPort,
				authUserPresentAccess: explicitUserPresentAccess,
			},
			seam,
		);
		expect(runtime.authTokenRetrieval).toBe(explicitPort);
		expect(runtime.authUserPresentAccess).toBe(explicitUserPresentAccess);
		expect(probed).toBe(false);
		expect(userPresentFactoryAsked).toBe(false);
	});

	test("an admitted security owner wires one bounded user-present access provider", async () => {
		const provider = async () =>
			({ ok: false, cause: "authority-unavailable" }) as const;
		const admission = createInMemoryAdmissionRuntime({ installed: MINTED });
		let admissionCalls = 0;
		let providerFactoryCalls = 0;
		const seam: BrowserUseSecuritySeam = {
			admission: {
				verifyProduct: async () => {
					admissionCalls += 1;
					return await admission.verifyProduct();
				},
				verifyTarget: admission.verifyTarget.bind(admission),
			},
			createTokenExecutor: () => {
				throw new Error("managed authority is unavailable");
			},
			createUserPresentAccessProvider: () => {
				providerFactoryCalls += 1;
				return provider;
			},
		};

		const runtime = await createProductionBrowserUseRuntimeForTest(
			EMPTY_OVERRIDES,
			seam,
		);

		expect(runtime.authTokenRetrieval).toBeUndefined();
		expect(runtime.authUserPresentAccess).toBe(provider);
		expect(admissionCalls).toBe(1);
		expect(providerFactoryCalls).toBe(1);
	});

	test("user-present provider factory stays unreachable without product admission", async () => {
		let providerFactoryCalls = 0;
		const seam: BrowserUseSecuritySeam = {
			admission: createNativeAbsentRuntime(),
			createTokenExecutor: () => {
				throw new Error("must not be reached when absent");
			},
			createUserPresentAccessProvider: () => {
				providerFactoryCalls += 1;
				return async () => ({ ok: false, cause: "authority-unavailable" });
			},
		};

		const runtime = await createProductionBrowserUseRuntimeForTest(
			EMPTY_OVERRIDES,
			seam,
		);

		expect(runtime.authUserPresentAccess).toBeUndefined();
		expect(providerFactoryCalls).toBe(0);
	});
});

describe("U10 byte-identical typed absence on this (unsigned) machine", () => {
	test("auth enroll-browser-automation-token --json still reports native-capability-absent", async () => {
		// Drive the REAL production runtime (default native-absent seam) through
		// the REAL CLI: the observable envelope must be the typed absence with the
		// install-token continuation, exit 0, no crash.
		const runtime = await createProductionBrowserUseRuntimeForTest(EMPTY_OVERRIDES);
		expect(runtime.authTokenRetrieval).toBeUndefined();

		const result = await runForTest(
			["auth", "enroll-browser-automation-token", "--json"],
			runtime,
		);
		expect(result.exitCode).toBe(0);
		const envelope = JSON.parse(result.stdout) as {
			data: {
				action: string;
				evaluation: { status: string; blocked_cause: string };
			};
			continuation: { next_action_id: string };
		};
		expect(envelope.data.action).toBe("enroll-browser-automation-token");
		expect(envelope.data.evaluation).toEqual({
			status: "native-capability-absent",
			blocked_cause: "missing-token",
		});
		expect(envelope.continuation.next_action_id).toBe(
			"install-token",
		);
	});
});
