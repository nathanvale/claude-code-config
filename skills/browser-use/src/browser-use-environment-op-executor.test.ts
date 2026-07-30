import { describe, expect, test } from "bun:test";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import {
	admitEnvironmentOpExecutable,
	buildEnvironmentOpAdmissionInvocation,
	buildEnvironmentOpMetadataInvocation,
	buildEnvironmentOpValidatorInvocation,
	createEnvironmentOpTokenRetrievalPort,
	parseEnvironmentOpAdmissionResult,
	parseEnvironmentOpMetadataResult,
} from "./browser-use-environment-op-executor";

const BINDING: BrowserUseItemBinding = {
	service_id: "oncore",
	service_account_id: "service-account-1",
	auth_context: "interactive-login",
	allowed_origins: ["https://portal.example.com"],
	allowed_login_paths: ["/login"],
	vault_id: "vault-1",
	item_id: "item-1",
	item_revision: 7,
	allowed_auth_methods: ["password"],
	binding_revision: 1,
};

function portReturningBindingEvidence(value: unknown) {
	return createEnvironmentOpTokenRetrievalPort({
		executeMetadata: async () => ({ ok: true, value }),
		mintCapability: () => {
			throw new Error("capability mint was not expected");
		},
	});
}

describe("environment OP executable admission", () => {
	test("admits only one absolute supported official OP executable", () => {
		expect(
			admitEnvironmentOpExecutable({
				executable_path: "/opt/homebrew/bin/op",
				version_stdout: "2.31.0\n",
			}),
		).toEqual({
			ok: true,
			executable_path: "/opt/homebrew/bin/op",
			version: "2.31.0",
		});
		expect(
			admitEnvironmentOpExecutable({
				executable_path: "op",
				version_stdout: "2.31.0\n",
			}),
		).toMatchObject({ ok: false, cause: "op-path-not-absolute" });
		expect(
			admitEnvironmentOpExecutable({
				executable_path: "/opt/homebrew/bin/op",
				version_stdout: "2.17.0\n",
			}),
		).toMatchObject({ ok: false, cause: "op-version-unsupported" });
	});

	test("builds the bounded validator service around one inherited socket", () => {
		expect(
			buildEnvironmentOpValidatorInvocation({
				supervisor_path: "/opt/browser-use/bin/browser-use-op-supervisor",
				op_path: "/opt/homebrew/bin/op",
				staging_root: "/safe/config/browser-use",
				validator_fd: 9,
			}),
		).toEqual({
			executable_path: "/opt/browser-use/bin/browser-use-op-supervisor",
			argv: [
				"validate",
				"--validator-fd",
				"9",
				"--op-path",
				"/opt/homebrew/bin/op",
			],
			env: { TMPDIR: "/safe/config/browser-use" },
			inherited_fds: [9],
		});
	});

	test("builds and parses the secret-free native admission contract exactly", () => {
		expect(
			buildEnvironmentOpAdmissionInvocation({
				supervisor_path: "/opt/browser-use/bin/browser-use-op-supervisor",
				op_path: "/opt/homebrew/bin/op",
				staging_root: "/safe/config/browser-use",
			}),
		).toEqual({
			executable_path: "/opt/browser-use/bin/browser-use-op-supervisor",
			argv: ["admit", "--op-path", "/opt/homebrew/bin/op"],
			env: { TMPDIR: "/safe/config/browser-use" },
			inherited_fds: [],
		});
		expect(
			parseEnvironmentOpAdmissionResult({
				schema_version: 1,
				ok: true,
				state: "ready",
			}),
		).toBe("ready");
		expect(
			parseEnvironmentOpAdmissionResult({
				schema_version: 1,
				ok: false,
				state: "unsafe",
				rejection: { code: "op-binary-untrusted" },
			}),
		).toBe("unsafe");
	});

	test("rejects admission envelopes with unknown or secret-shaped fields", () => {
		expect(
			parseEnvironmentOpAdmissionResult({
				schema_version: 1,
				ok: true,
				state: "ready",
				token: "ops_SECRET_SENTINEL",
			}),
		).toBe("unproven");
		expect(
			parseEnvironmentOpAdmissionResult({
				schema_version: 1,
				ok: false,
				state: "unsafe",
				rejection: {
					code: "op-binary-untrusted",
					message: "ops_SECRET_SENTINEL",
				},
			}),
		).toBe("unproven");
	});

	test("parses versioned native results without relaying native messages", () => {
		expect(
			parseEnvironmentOpMetadataResult({
				schema_version: 1,
				ok: true,
				value: [{ id: "vault-1" }],
			}),
		).toEqual({ ok: true, value: [{ id: "vault-1" }] });
		expect(
			parseEnvironmentOpMetadataResult({
				schema_version: 1,
				ok: false,
				rejection: {
					code: "process-signalled",
					message: "ops_SECRET_STDERR_SENTINEL",
				},
			}),
		).toEqual({
			ok: false,
			rejection: {
				code: "io-failure",
				message: "native OP execution was refused; inspect the typed code.",
			},
		});
		expect(
			parseEnvironmentOpMetadataResult({
				schema_version: 1,
				ok: false,
				rejection: {
					code: "item-missing",
					message: "untrusted native detail",
				},
			}),
		).toEqual({
			ok: false,
			rejection: {
				code: "item-missing",
				message: "native OP execution was refused; inspect the typed code.",
			},
		});
	});
});

describe("environment OP native invocation", () => {
	test("contains only absolute paths, bounded coordinates, and the private staging root", () => {
		expect(
			buildEnvironmentOpMetadataInvocation({
				supervisor_path: "/opt/browser-use/bin/browser-use-op-supervisor",
				op_path: "/opt/homebrew/bin/op",
				config_root: "/safe/config/browser-use",
				operation: { kind: "item-list", vault_id: "vault-1" },
			}),
		).toEqual({
			executable_path: "/opt/browser-use/bin/browser-use-op-supervisor",
			argv: [
				"metadata",
				"--config-root",
				"/safe/config/browser-use",
				"--op-path",
				"/opt/homebrew/bin/op",
				"--operation",
				"item-list",
				"--vault-id",
				"vault-1",
			],
			env: { TMPDIR: "/safe/config/browser-use" },
			inherited_fds: [],
		});
		expect(
			buildEnvironmentOpMetadataInvocation({
				supervisor_path: "/opt/browser-use/bin/browser-use-op-supervisor",
				op_path: "/opt/homebrew/bin/op",
				config_root: "/safe/config/browser-use",
				operation: {
					kind: "binding-evidence",
					expected_vault_id: "vault-1",
					item_id: "item-1",
				},
			}).argv,
		).toEqual([
			"metadata",
			"--config-root",
			"/safe/config/browser-use",
			"--op-path",
			"/opt/homebrew/bin/op",
			"--operation",
			"binding-evidence",
			"--item-id",
			"item-1",
			"--expected-vault-id",
			"vault-1",
		]);
	});

	test("projects one principal-bound binding evidence envelope", async () => {
		const operations: unknown[] = [];
		const port = createEnvironmentOpTokenRetrievalPort({
			executeMetadata: async (operation) => {
				operations.push(operation);
				return {
					ok: true,
					value: {
						identity: {
							id: "service-account-1",
							state: "ACTIVE",
							type: "SERVICE_ACCOUNT",
						},
						vaults: [{ id: "vault-1" }],
						item_evidence: {
							kind: "exact",
							item: {
								id: "item-1",
								version: 7,
								vault: { id: "vault-1" },
								category: "LOGIN",
								urls: [{ href: "https://portal.example.com/login" }],
							},
						},
					},
				};
			},
			mintCapability: () => {
				throw new Error("capability mint was not expected");
			},
		});

		expect(
			await port.getBindingEvidence?.({
				expected_vault_id: "vault-1",
				item_id: "item-1",
			}),
		).toMatchObject({
			ok: true,
			evidence: {
				identity: { service_account_id: "service-account-1" },
				vaults: [{ vault_id: "vault-1" }],
				item_evidence: {
					kind: "exact",
					item: { item_id: "item-1", vault_id: "vault-1" },
				},
			},
		});
		expect(operations).toEqual([
			{
				kind: "binding-evidence",
				expected_vault_id: "vault-1",
				item_id: "item-1",
			},
		]);
	});

	test("projects list evidence from one principal-bound environment envelope", async () => {
		const port = portReturningBindingEvidence({
			identity: {
				id: "service-account-1",
				state: "ACTIVE",
				type: "SERVICE_ACCOUNT",
			},
			vaults: [{ id: "vault-1" }],
			item_evidence: {
				kind: "list",
				items: [
					{
						id: "item-1",
						version: 7,
						vault: { id: "vault-1" },
						category: "LOGIN",
						urls: [{ href: "https://portal.example.com/login" }],
					},
				],
			},
		});

		expect(
			await port.getBindingEvidence?.({
				expected_vault_id: "vault-1",
				item_id: null,
			}),
		).toEqual({
			ok: true,
			evidence: {
				identity: {
					service_account_id: "service-account-1",
					state: "ACTIVE",
					type: "SERVICE_ACCOUNT",
				},
				vaults: [{ vault_id: "vault-1" }],
				item_evidence: {
					kind: "list",
					items: [
						{
							item_id: "item-1",
							vault_id: "vault-1",
							item_revision: 7,
							origins: ["https://portal.example.com"],
							login_paths: [],
							supported_methods: ["password", "otp"],
							state: "active",
						},
					],
				},
			},
		});
	});

	test.each([
		["zero-vault scope", []],
		["multi-vault scope", [{ id: "vault-1" }, { id: "vault-2" }]],
		["mismatched vault", [{ id: "vault-2" }]],
	] as const)(
		"preserves null item evidence for %s",
		async (_label, vaults) => {
			const port = portReturningBindingEvidence({
				identity: {
					id: "service-account-1",
					state: "ACTIVE",
					type: "SERVICE_ACCOUNT",
				},
				vaults,
				item_evidence: null,
			});

			expect(
				await port.getBindingEvidence?.({
					expected_vault_id: "vault-1",
					item_id: "item-1",
				}),
			).toEqual({
				ok: true,
				evidence: {
					identity: {
						service_account_id: "service-account-1",
						state: "ACTIVE",
						type: "SERVICE_ACCOUNT",
					},
					vaults: vaults.map(({ id }) => ({ vault_id: id })),
					item_evidence: null,
				},
			});
		},
	);

	test.each([
		[
			"malformed revision",
			{
				id: "item-1",
				version: 0,
				vault: { id: "vault-1" },
				category: "LOGIN",
				urls: [{ href: "https://portal.example.com/login" }],
			},
		],
		[
			"secret-shaped item row",
			{
				id: "item-1",
				version: 7,
				vault: { id: "vault-1" },
				category: "LOGIN",
				urls: [{ href: "op://vault/item" }],
			},
		],
	] as const)("rejects %s without partial evidence", async (_label, item) => {
		const port = portReturningBindingEvidence({
			identity: {
				id: "service-account-1",
				state: "ACTIVE",
				type: "SERVICE_ACCOUNT",
			},
			vaults: [{ id: "vault-1" }],
			item_evidence: { kind: "list", items: [item] },
		});

		expect(
			await port.getBindingEvidence?.({
				expected_vault_id: "vault-1",
				item_id: null,
			}),
		).toEqual({
			ok: false,
			rejection: {
				code: "output-shape-invalid",
				message: "native principal-bound binding evidence was invalid.",
			},
		});
	});

	test("service-account identity uses user-get and strips display metadata", async () => {
		const operations: unknown[] = [];
		const port = createEnvironmentOpTokenRetrievalPort({
			executeMetadata: async (operation) => {
				operations.push(operation);
				return {
					ok: true,
					value: {
						id: "service-account-1",
						state: "ACTIVE",
						type: "SERVICE_ACCOUNT",
						email: "not-projected@example.com",
					},
				};
			},
			mintCapability: () => {
				throw new Error("capability mint was not expected");
			},
		});

		expect(await port.getServiceAccountIdentity()).toEqual({
			ok: true,
			identity: {
				service_account_id: "service-account-1",
				state: "ACTIVE",
				type: "SERVICE_ACCOUNT",
			},
		});
		expect(operations).toEqual([{ kind: "user-get" }]);
	});

	test("credential fetch mints a deferred capability with zero OP execution", async () => {
		let executions = 0;
		const port = createEnvironmentOpTokenRetrievalPort({
			executeMetadata: async () => {
				executions += 1;
				return { ok: true, value: [] };
			},
			mintCapability: ({ binding, field }) => ({
				handle_id: `deferred:${binding.vault_id}:${binding.item_id}:${field}`,
				field,
				expires_at_epoch_ms: 5_000,
			}),
		});

		const fetched = await port.fetchCredentialField({
			binding: BINDING,
			field: "password",
		});

		expect(fetched).toEqual({
			ok: true,
			handle: {
				handle_id: "deferred:vault-1:item-1:password",
				field: "password",
				expires_at_epoch_ms: 5_000,
			},
		});
		expect(executions).toBe(0);
	});
});
