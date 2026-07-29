import { describe, expect, test } from "bun:test";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import {
	admitEnvironmentOpExecutable,
	buildEnvironmentOpMetadataInvocation,
	buildEnvironmentOpValidatorInvocation,
	createEnvironmentOpTokenRetrievalPort,
	parseEnvironmentOpMetadataResult,
} from "./browser-use-environment-op-executor";

const BINDING: BrowserUseItemBinding = {
	service_id: "oncore",
	auth_context: "interactive-login",
	allowed_origins: ["https://portal.example.com"],
	allowed_login_paths: ["/login"],
	vault_id: "vault-1",
	item_id: "item-1",
	allowed_auth_methods: ["password"],
	binding_revision: 1,
};

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
			env: {},
			inherited_fds: [9],
		});
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
	});
});

describe("environment OP native invocation", () => {
	test("contains only absolute paths, bounded operation coordinates, and no environment", () => {
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
			env: {},
			inherited_fds: [],
		});
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
