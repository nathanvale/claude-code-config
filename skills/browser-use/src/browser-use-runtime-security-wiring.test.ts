import { describe, expect, test } from "bun:test";
import {
	type AdmissionRuntime,
	buildAdmittedManifest,
	createInMemoryAdmissionRuntime,
	createNativeAbsentRuntime,
} from "@side-quest/browser-use-security";
import {
	type BrowserUseSecuritySeam,
	createProductionBrowserUseRuntime,
	runForTest,
} from "./browser-use";
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
	executorCalls: number;
} {
	const captured = capturingExecutor();
	let executorCalls = 0;
	const seam: BrowserUseSecuritySeam = {
		admission: createInMemoryAdmissionRuntime({ installed: MINTED }),
		createTokenExecutor: () => {
			executorCalls += 1;
			return { execute: captured.execute, token_handle_id: "handle-native" };
		},
	};
	return {
		seam,
		specs: captured.specs,
		get executorCalls() {
			return executorCalls;
		},
	};
}

// An empty env keeps every store-backed command refusing at XDG resolution, so
// the runtime never touches real disk; only the auth-readiness path (which
// reads authTokenRetrieval before any store I/O) matters here.
const EMPTY_OVERRIDES = { env: {} } as const;

describe("U10 native TokenRetrievalPort wiring", () => {
	test("absent seam (production default) leaves authTokenRetrieval undefined", async () => {
		const runtime = await createProductionBrowserUseRuntime(EMPTY_OVERRIDES);
		expect(runtime.authTokenRetrieval).toBeUndefined();
	});

	test("an explicitly native-absent seam leaves the port undefined", async () => {
		const seam: BrowserUseSecuritySeam = {
			admission: createNativeAbsentRuntime(),
			createTokenExecutor: () => {
				throw new Error("must not be reached when absent");
			},
		};
		const runtime = await createProductionBrowserUseRuntime(
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
		const runtime = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			seam,
		);
		expect(runtime.authTokenRetrieval).toBeUndefined();
		expect(executorAsked).toBe(false);
	});

	test("a seam probe that throws is treated as absence, never crashes", async () => {
		const throwingSeam: BrowserUseSecuritySeam = {
			admission: {
				verifyProduct: async () => {
					throw new Error("seam probe boom");
				},
				verifyTarget: async () => {
					throw new Error("seam probe boom");
				},
			},
			createTokenExecutor: () => {
				throw new Error("must not be reached");
			},
		};
		const runtime = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			throwingSeam,
		);
		expect(runtime.authTokenRetrieval).toBeUndefined();
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
		const runtime = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			seam,
		);
		expect(runtime.authTokenRetrieval).toBeUndefined();
	});

	test("admitted seam constructs a working Token Retrieval Port", async () => {
		const present = presentSeam();
		const runtime = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			present.seam,
		);
		expect(runtime.authTokenRetrieval).toBeDefined();
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

	test("an explicit override port is honored and the seam is not probed", async () => {
		let probed = false;
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
		};
		const explicitPort = { marker: "explicit" } as never;
		const runtime = await createProductionBrowserUseRuntime(
			{ env: {}, authTokenRetrieval: explicitPort },
			seam,
		);
		expect(runtime.authTokenRetrieval).toBe(explicitPort);
		expect(probed).toBe(false);
	});
});

describe("U10 byte-identical typed absence on this (unsigned) machine", () => {
	test("auth enroll-browser-automation-token --json still reports native-capability-absent", async () => {
		// Drive the REAL production runtime (default native-absent seam) through
		// the REAL CLI: the observable envelope must be the typed absence with the
		// acquire-native-capability continuation, exit 0, no crash.
		const runtime = await createProductionBrowserUseRuntime(EMPTY_OVERRIDES);
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
			"acquire-native-capability",
		);
	});
});
