import { describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import {
	chmod,
	lstat,
	mkdtemp,
	rm,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import {
	type AdmissionRuntime,
	buildAdmittedManifest,
	createInMemoryAdmissionRuntime,
	createNativeAbsentRuntime,
} from "@side-quest/browser-use-security";
import {
	type BrowserUseSecuritySeam,
	createProductionBrowserUseRuntime,
	inspectBrowserUseAuthStatusExecutable,
	runForTest,
} from "./browser-use";
import type {
	BrowserUseOpCommandSpec,
	BrowserUseOpExecute,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";
import { createBrowserUseAdminAuthorityReceiptStore } from "./browser-use-admin-authority-receipt";
import {
	createDefaultPlatformFs,
	openBrowserUsePaths,
} from "./browser-use-paths";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";

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

type U4EnvironmentSeam = {
	inspectToken: () => Promise<{
		state: "ready" | "blocked";
		next_action: "validate-service-account" | "repair-token-custody";
		cause?: "token-unsafe";
	}>;
	createTokenRetrieval: () => BrowserUseTokenRetrievalPort;
};

type U4SecuritySeam = BrowserUseSecuritySeam & {
	environment: U4EnvironmentSeam;
};

type U4AdmissionSnapshot = {
	kind: string;
	cause?: { code: string };
	evidence: Record<string, unknown>;
	tokenRetrieval?: object;
};

function admissionOf(runtime: unknown): U4AdmissionSnapshot | undefined {
	return (runtime as { authAdmission?: U4AdmissionSnapshot }).authAdmission;
}

function u4Seam(input: {
	admission: AdmissionRuntime;
	nativePort?: object;
	environmentState?: Awaited<ReturnType<U4EnvironmentSeam["inspectToken"]>>;
	environmentPort?: BrowserUseTokenRetrievalPort;
	calls: { nativeExecutor: number; environmentProbe: number; environmentPort: number };
}): U4SecuritySeam {
	return {
		admission: input.admission,
		createTokenExecutor: () => {
			input.calls.nativeExecutor += 1;
			if (input.nativePort === undefined) {
				throw new Error("native executor unavailable");
			}
			return {
				execute: (input.nativePort as { execute: BrowserUseOpExecute }).execute,
				token_handle_id: "handle-native",
			};
		},
		environment: {
			inspectToken: async () => {
				input.calls.environmentProbe += 1;
				return (
					input.environmentState ?? {
						state: "blocked",
						cause: "token-unsafe",
						next_action: "repair-token-custody",
					}
				);
			},
			createTokenRetrieval: () => {
				input.calls.environmentPort += 1;
				if (input.environmentPort === undefined) {
					throw new Error("environment port unavailable");
				}
				return input.environmentPort;
			},
		},
	} as U4SecuritySeam;
}

describe("U4 three-state production lane admission", () => {
	test("auth status admits the installed fixed Homebrew OP symlink", async () => {
		const opPath =
			process.arch === "arm64"
				? "/opt/homebrew/bin/op"
				: "/usr/local/bin/op";
		const supervisorAlias = join(
			import.meta.dir,
			"..",
			"..",
			"..",
			"runtime",
			"browser-use-environment-auth",
			".build",
			"release",
			"browser-use-op-supervisor",
		);
		if (!existsSync(opPath) || !existsSync(supervisorAlias)) return;
		const supervisorPath = realpathSync(supervisorAlias);
		expect((await lstat(opPath)).isSymbolicLink()).toBe(true);
		expect(
			await inspectBrowserUseAuthStatusExecutable(opPath, {
				kind: "op",
				approved_path: opPath,
				supervisor_path: supervisorPath,
			}),
		).toBe("ready");
	});

	test("auth status rejects an executable without the owned native identity", async () => {
		const directory = await mkdtemp(
			join(import.meta.dir, ".auth-status-executable-"),
		);
		try {
			await chmod(directory, 0o700);
			const executable = join(directory, "browser-use-op-supervisor");
			await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });

			expect(
				await inspectBrowserUseAuthStatusExecutable(executable, {
					kind: "owned-native",
					approved_path: executable,
					expected_identifier: "browser-use-op-supervisor",
				}),
			).toBe(process.platform === "darwin" ? "unsafe" : "unproven");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("production wires bounded read-only support without inventing human or live-browser proof", async () => {
		const runtime = await createProductionBrowserUseRuntime({
			env: {},
			environmentTokenLifecycle: {
				inputIsTTY: () => false,
				execute: async () => ({
					state: "blocked",
					cause: "token-unsafe",
					next_action: "repair-token-custody",
				}),
			},
		});

		expect(runtime.authStatusSupport).toBeFunction();
		const evidence = (await runtime.authStatusSupport?.()) as {
			contract: string;
			schema_version: string;
			executables: Record<string, string>;
			admin_authority: string;
			profile: string;
			binding: string;
		};
		expect(evidence).toMatchObject({
			contract: "browser-use.auth-status-support",
			schema_version: "1",
			admin_authority: "missing",
			profile: "unproven",
			binding: "missing",
			proof: null,
		});
		expect(Object.keys(evidence.executables).sort()).toEqual([
			"helper",
			"op",
			"wrapper",
		]);
		for (const state of Object.values(evidence.executables)) {
			expect(["ready", "missing", "unsafe", "unproven"]).toContain(state);
		}
	});

	test("production support reuses preflight and admits the exact human authority receipt only after metadata binding", async () => {
		const xdg = makeTempXdgEnv();
		try {
			const fs = createDefaultPlatformFs();
			const opened = await openBrowserUsePaths(fs, xdg.env);
			if (!opened.ok) throw new Error("paths refused");
			const coordinates = {
				lane_digest: "1".repeat(64),
				principal_digest: "2".repeat(64),
				vault_digest: "3".repeat(64),
				profile_digest: "4".repeat(64),
			};
			const receipt = await createBrowserUseAdminAuthorityReceiptStore({
				fs,
				paths: opened.paths,
				clock: () => 1_000,
			}).record(coordinates);
			expect(receipt.ok).toBe(true);

			const runtime = await createProductionBrowserUseRuntime({
				env: xdg.env,
				platformFs: fs,
				environmentTokenLifecycle: {
					inputIsTTY: () => false,
					execute: async () => ({
						state: "blocked",
						cause: "token-unsafe",
						next_action: "repair-token-custody",
					}),
				},
			});
			const preflight = (await runtime.authStatusSupport?.()) as {
				admin_authority: string;
				executables: Record<string, string>;
			};
			const bound = (await runtime.authStatusSupport?.(coordinates)) as {
				admin_authority: string;
				executables: Record<string, string>;
				profile: string;
				binding: string;
				proof: unknown;
			};

			expect(preflight.admin_authority).toBe("missing");
			expect(bound).toMatchObject({
				admin_authority: "proven",
				profile: "unproven",
				binding: "missing",
				proof: null,
			});
			expect(bound.executables).toEqual(preflight.executables);
		} finally {
			xdg.dispose();
		}
	});

	test("signed admission wins without probing the environment lane", async () => {
		const captured = capturingExecutor();
		const calls = { nativeExecutor: 0, environmentProbe: 0, environmentPort: 0 };
		const seam = u4Seam({
			admission: createInMemoryAdmissionRuntime({ installed: MINTED }),
			nativePort: { execute: captured.execute },
			environmentState: {
				state: "ready",
				next_action: "validate-service-account",
			},
			environmentPort: {
				marker: "environment",
			} as unknown as BrowserUseTokenRetrievalPort,
			calls,
		});

		const runtime = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			seam,
		);

		expect(admissionOf(runtime)).toMatchObject({
			kind: "signed-admitted",
			evidence: {
				lane: "signed-native",
				assurance: "signed-native",
				native: { verdict: "admitted", product_version: "1.0.0" },
			},
		});
		expect(admissionOf(runtime)?.tokenRetrieval).toBe(runtime.authTokenRetrieval);
		expect(calls).toEqual({
			nativeExecutor: 1,
			environmentProbe: 0,
			environmentPort: 0,
		});
	});

	test("native absence plus ready token admits the lower-assurance environment lane", async () => {
		const calls = { nativeExecutor: 0, environmentProbe: 0, environmentPort: 0 };
		const environmentPort = {
			marker: "environment",
		} as unknown as BrowserUseTokenRetrievalPort;
		const seam = u4Seam({
			admission: createNativeAbsentRuntime(),
			environmentState: {
				state: "ready",
				next_action: "validate-service-account",
			},
			environmentPort,
			calls,
		});

		const runtime = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			seam,
		);

		expect(admissionOf(runtime)).toEqual({
			kind: "environment-admitted",
			evidence: {
				lane: "environment-injected-op",
				assurance: "lower-assurance",
				native: { verdict: "native-capability-absent" },
				environment: {
					state: "ready",
					next_action: "validate-service-account",
				},
			},
			tokenRetrieval: environmentPort,
		});
		expect(runtime.authTokenRetrieval).toBe(environmentPort);
		expect(calls).toEqual({
			nativeExecutor: 0,
			environmentProbe: 1,
			environmentPort: 1,
		});
	});

	test("the production default captures lifecycle readiness once and wires the environment port", async () => {
		let lifecycleCalls = 0;
		const runtime = await createProductionBrowserUseRuntime({
			env: {},
			environmentTokenLifecycle: {
				inputIsTTY: () => false,
				execute: async (request) => {
					lifecycleCalls += 1;
					expect(request).toEqual({ action: "status" });
					return {
						state: "ready",
						next_action: "validate-service-account",
					};
				},
			},
			authStatusSupport: async () => ({
				contract: "browser-use.auth-status-support",
				schema_version: "1",
				executables: {
					op: "missing",
					wrapper: "ready",
					helper: "ready",
				},
				admin_authority: "missing",
				profile: "unproven",
				binding: "missing",
				proof: null,
			}),
		});

		expect(runtime.authAdmission).toMatchObject({
			kind: "environment-admitted",
			evidence: {
				lane: "environment-injected-op",
				assurance: "lower-assurance",
				native: { verdict: "native-capability-absent" },
				environment: { state: "ready" },
			},
		});
		expect(runtime.authTokenRetrieval).toBe(
			runtime.authAdmission?.kind === "environment-admitted"
				? runtime.authAdmission.tokenRetrieval
				: undefined,
		);
		const status = await runForTest(["auth", "status", "--json"], runtime);
		expect(status.exitCode).toBe(20);
		const statusEnvelope = JSON.parse(status.stdout) as {
			data: {
				selected_lane: string;
				assurance: string;
				blocked_cause: string;
			};
		};
		expect(statusEnvelope.data).toMatchObject({
			selected_lane: "environment-injected-op",
			assurance: "lower-assurance",
			blocked_cause: "op-missing",
		});
		expect(lifecycleCalls).toBe(1);
	});

	test("native absence plus invalid token blocks with captured environment evidence", async () => {
		const calls = { nativeExecutor: 0, environmentProbe: 0, environmentPort: 0 };
		const seam = u4Seam({
			admission: createNativeAbsentRuntime(),
			environmentState: {
				state: "blocked",
				cause: "token-unsafe",
				next_action: "repair-token-custody",
			},
			calls,
		});

		const runtime = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			seam,
		);

		expect(admissionOf(runtime)).toEqual({
			kind: "blocked",
			cause: { code: "environment-token-not-ready" },
			evidence: {
				native: { verdict: "native-capability-absent" },
				environment: {
					state: "blocked",
					cause: "token-unsafe",
					next_action: "repair-token-custody",
				},
			},
		});
		expect(runtime.authTokenRetrieval).toBeUndefined();
		expect(calls).toEqual({
			nativeExecutor: 0,
			environmentProbe: 1,
			environmentPort: 0,
		});
	});

	test("present but non-admitted native capability blocks without environment fallback", async () => {
		const calls = { nativeExecutor: 0, environmentProbe: 0, environmentPort: 0 };
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
		const seam = u4Seam({ admission: notAdmitted, calls });

		const runtime = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			seam,
		);

		expect(admissionOf(runtime)).toEqual({
			kind: "blocked",
			cause: { code: "native-not-admitted" },
			evidence: {
				native: {
					verdict: "not-admitted",
					target_id: null,
					error_code: "unknown-target",
				},
			},
		});
		expect(runtime.authTokenRetrieval).toBeUndefined();
		expect(calls).toEqual({
			nativeExecutor: 0,
			environmentProbe: 0,
			environmentPort: 0,
		});
	});

	test("native probe failure blocks without environment fallback or error relay", async () => {
		const calls = { nativeExecutor: 0, environmentProbe: 0, environmentPort: 0 };
		const seam = u4Seam({
			admission: {
				verifyProduct: async () => {
					throw new Error("sentinel-native-probe-detail");
				},
				verifyTarget: async () => {
					throw new Error("sentinel-native-probe-detail");
				},
			},
			calls,
		});

		const runtime = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			seam,
		);

		expect(admissionOf(runtime)).toEqual({
			kind: "blocked",
			cause: { code: "native-probe-failed" },
			evidence: {},
		});
		expect(JSON.stringify(admissionOf(runtime))).not.toContain(
			"sentinel-native-probe-detail",
		);
		expect(runtime.authTokenRetrieval).toBeUndefined();
		expect(calls).toEqual({
			nativeExecutor: 0,
			environmentProbe: 0,
			environmentPort: 0,
		});
	});

	test("a later command switches from environment to signed without deleting the environment option", async () => {
		const captured = capturingExecutor();
		let productProbe = 0;
		const admission: AdmissionRuntime = {
			verifyProduct: async () => {
				productProbe += 1;
				return productProbe === 1
					? { verdict: "native-capability-absent" }
					: { verdict: "admitted", product_version: "2.0.0" };
			},
			verifyTarget: async () => ({ verdict: "native-capability-absent" }),
		};
		const calls = { nativeExecutor: 0, environmentProbe: 0, environmentPort: 0 };
		const environmentPort = {
			marker: "retained-environment-option",
		} as unknown as BrowserUseTokenRetrievalPort;
		const seam = u4Seam({
			admission,
			nativePort: { execute: captured.execute },
			environmentState: {
				state: "ready",
				next_action: "validate-service-account",
			},
			environmentPort,
			calls,
		});

		const firstCommand = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			seam,
		);
		const secondCommand = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			seam,
		);

		expect(admissionOf(firstCommand)?.kind).toBe("environment-admitted");
		expect(firstCommand.authTokenRetrieval).toBe(environmentPort);
		expect(admissionOf(secondCommand)).toMatchObject({
			kind: "signed-admitted",
			evidence: {
				lane: "signed-native",
				native: { verdict: "admitted", product_version: "2.0.0" },
			},
		});
		expect(secondCommand.authTokenRetrieval).not.toBe(environmentPort);
		expect(calls).toEqual({
			nativeExecutor: 1,
			environmentProbe: 1,
			environmentPort: 1,
		});
	});
});

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

	test("an admitted seam whose executor construction fails stays a typed native block", async () => {
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
		expect(runtime.authAdmission).toEqual({
			kind: "blocked",
			cause: { code: "native-executor-failed" },
			evidence: {
				native: { verdict: "admitted", product_version: "1.0.0" },
			},
		});
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

	test("an override cannot forge admission or bypass the production seam", async () => {
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
			{
				env: {},
				authAdmission: {
					kind: "environment-admitted",
					evidence: {
						lane: "environment-injected-op",
						assurance: "lower-assurance",
						native: { verdict: "native-capability-absent" },
						environment: {
							state: "ready",
							next_action: "validate-service-account",
						},
					},
					tokenRetrieval: explicitPort,
				},
			},
			seam,
		);
		expect(runtime.authAdmission).toEqual({
			kind: "blocked",
			cause: { code: "environment-probe-failed" },
			evidence: { native: { verdict: "native-capability-absent" } },
		});
		expect(runtime.authTokenRetrieval).toBeUndefined();
		expect(probed).toBe(true);
	});
});

describe("U4 public readiness consumes the captured admission", () => {
	test("environment executor failure stays a typed status failure", async () => {
		const calls = { nativeExecutor: 0, environmentProbe: 0, environmentPort: 0 };
		const runtime = await createProductionBrowserUseRuntime(
			EMPTY_OVERRIDES,
			u4Seam({
				admission: createNativeAbsentRuntime(),
				environmentState: {
					state: "ready",
					next_action: "validate-service-account",
				},
				calls,
			}),
		);
		expect(admissionOf(runtime)).toMatchObject({
			kind: "blocked",
			cause: { code: "environment-executor-failed" },
			evidence: {
				environment: {
					state: "ready",
					next_action: "validate-service-account",
				},
			},
		});

		const status = await runForTest(["auth", "status", "--json"], runtime);
		expect(status.exitCode).toBe(20);
		const envelope = JSON.parse(status.stdout) as {
			data: { blocked_cause: string; selected_lane: null };
		};
		expect(envelope.data).toMatchObject({
			blocked_cause: "environment-executor-failed",
			selected_lane: null,
		});
	});

	test("a blocked production probe reports its typed admission cause", async () => {
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
				evaluation: {
					status: string;
					blocked_cause: string;
					detail: { admission_code: string };
				};
			};
			continuation: { next_action_id: string };
		};
		expect(envelope.data.action).toBe("enroll-browser-automation-token");
		expect(envelope.data.evaluation).toEqual({
			status: "lane-admission-blocked",
			blocked_cause: "capability-loss",
			detail: { admission_code: "environment-probe-failed" },
		});
		expect(envelope.continuation.next_action_id).toBe(
			"inspect-auth-readiness",
		);

		const status = await runForTest(["auth", "status", "--json"], runtime);
		expect(status.exitCode).toBe(20);
		const statusEnvelope = JSON.parse(status.stdout) as {
			data: { blocked_cause: string; selected_lane: null };
		};
		expect(statusEnvelope.data).toMatchObject({
			blocked_cause: "environment-probe-failed",
			selected_lane: null,
		});
	});
});
