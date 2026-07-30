import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BROWSER_USE_ENVIRONMENT_TOKEN_CUSTODY_CAUSES,
	BROWSER_USE_ENVIRONMENT_TOKEN_CUSTODY_STATES,
	buildEnvironmentTokenCustodyInvocation,
	environmentTokenPathsFor,
	parseEnvironmentTokenCustodyState,
} from "./browser-use-environment-token";

function nativeEnumValues(source: string, enumName: string): string[] {
	const match = source.match(
		new RegExp(
			`public enum ${enumName}:[\\s\\S]*?\\{([\\s\\S]*?)\\n\\}`,
		),
	);
	if (!match?.[1]) throw new Error(`missing native enum ${enumName}`);
	return [...match[1].matchAll(/case\s+(\w+)(?:\s*=\s*"([^"]+)")?/g)].map(
		([, identifier, rawValue]) => rawValue ?? identifier,
	);
}

describe("environment token custody control model", () => {
	test("derives one fixed token path below the admitted config root", () => {
		expect(environmentTokenPathsFor("/safe/config/browser-use")).toEqual({
			custody_dir: "/safe/config/browser-use/auth.nosync",
			token_file:
				"/safe/config/browser-use/auth.nosync/op-service-account-token",
			staging_prefix:
				"/safe/config/browser-use/auth.nosync/.op-service-account-token.stage.",
		});
	});

	test("builds a secret-free inherited-fd install invocation", () => {
		const invocation = buildEnvironmentTokenCustodyInvocation({
			executable_path: "/opt/browser-use/bin/browser-use-token-custody",
			action: "install",
			config_root: "/safe/config/browser-use",
			input: { kind: "stdin", fd: 7 },
			validator_fd: 9,
		});

		expect(invocation).toEqual({
			executable_path: "/opt/browser-use/bin/browser-use-token-custody",
			argv: [
				"install",
				"--config-root",
				"/safe/config/browser-use",
				"--input-fd",
				"7",
				"--validator-fd",
				"9",
			],
			inherited_fds: [7, 9],
			timeout_ms: 30_000,
		});
		expect(JSON.stringify(invocation)).not.toContain("OP_SERVICE_ACCOUNT_TOKEN");
		expect(invocation.argv.join(" ")).not.toContain("token=");
	});

	test("builds the production validator-process install invocation", () => {
		const invocation = buildEnvironmentTokenCustodyInvocation({
				executable_path: "/opt/browser-use/bin/browser-use-token-custody",
				action: "replace",
				config_root: "/safe/config/browser-use",
				input: { kind: "tty" },
				validator_executable_path:
					"/opt/browser-use/bin/browser-use-op-supervisor",
				op_executable_path: "/opt/homebrew/bin/op",
			});
		expect(invocation).toEqual({
			executable_path: "/opt/browser-use/bin/browser-use-token-custody",
			argv: [
				"replace",
				"--config-root",
				"/safe/config/browser-use",
				"--hidden-tty",
				"--validator-executable",
				"/opt/browser-use/bin/browser-use-op-supervisor",
				"--op-path",
				"/opt/homebrew/bin/op",
			],
			inherited_fds: [],
			timeout_ms: 330_000,
		});
		expect(invocation.timeout_ms).toBe(330_000);
	});

	test("parses every exact secret-free native lifecycle projection", () => {
		const valid = [
			{ state: "missing", next_action: "install-local-token" },
			{ state: "ready", next_action: "validate-service-account" },
			{ state: "installed", next_action: "validate-service-account" },
			{ state: "replaced", next_action: "validate-service-account" },
			{
				state: "cleanup-required",
				cause: "staging-residue",
				next_action: "cleanup-token-staging",
			},
			{
				state: "cleanup-required",
				cause: "removal-residue",
				remote_authority: "may-remain-live",
				next_action: "complete-local-token-removal",
			},
			{
				state: "blocked",
				cause: "token-unsafe",
				next_action: "repair-token-custody",
			},
			{
				state: "blocked",
				cause: "staging-residue",
				next_action: "cleanup-token-staging",
			},
			{
				state: "blocked",
				cause: "removal-residue",
				remote_authority: "may-remain-live",
				next_action: "complete-local-token-removal",
			},
			{
				state: "removed",
				remote_authority: "may-remain-live",
				next_action: "revoke-service-account-token-remotely",
			},
			{
				state: "removed-sync-unproven",
				cause: "parent-sync-failed",
				remote_authority: "may-remain-live",
				next_action: "revoke-service-account-token-remotely",
			},
			{ state: "cleaned", next_action: "inspect-token-status" },
			{
				state: "cleaned",
				remote_authority: "may-remain-live",
				next_action: "revoke-service-account-token-remotely",
			},
		] as const;

		for (const value of valid) {
			expect(parseEnvironmentTokenCustodyState(value)).toEqual(value);
		}
	});

	test("rejects required, forbidden, or mismatched lifecycle fields", () => {
		const invalid = [
			{ state: "ready", next_action: "install-local-token" },
			{
				state: "blocked",
				cause: "made-up",
				next_action: "repair-token-custody",
			},
			{
				state: "missing",
				cause: "token-missing",
				next_action: "install-local-token",
			},
			{
				state: "ready",
				remote_authority: "may-remain-live",
				next_action: "validate-service-account",
			},
			{
				state: "installed",
				cause: undefined,
				next_action: "validate-service-account",
			},
			{
				state: "cleanup-required",
				cause: "staging-residue",
				remote_authority: "may-remain-live",
				next_action: "cleanup-token-staging",
			},
			{
				state: "cleanup-required",
				cause: "removal-residue",
				next_action: "complete-local-token-removal",
			},
			{
				state: "cleanup-required",
				cause: "staging-residue",
				next_action: "complete-local-token-removal",
			},
			{ state: "blocked", next_action: "repair-token-custody" },
			{
				state: "blocked",
				cause: "token-unsafe",
				remote_authority: "may-remain-live",
				next_action: "repair-token-custody",
			},
			{
				state: "blocked",
				cause: "staging-residue",
				next_action: "repair-token-custody",
			},
			{
				state: "blocked",
				cause: "removal-residue",
				remote_authority: "may-remain-live",
				next_action: "repair-token-custody",
			},
			{
				state: "removed",
				cause: "parent-sync-failed",
				remote_authority: "may-remain-live",
				next_action: "revoke-service-account-token-remotely",
			},
			{
				state: "removed-sync-unproven",
				remote_authority: "may-remain-live",
				next_action: "revoke-service-account-token-remotely",
			},
			{
				state: "cleaned",
				remote_authority: "may-remain-live",
				next_action: "inspect-token-status",
			},
			{
				state: "cleaned",
				next_action: "revoke-service-account-token-remotely",
			},
			{
				state: "missing",
				next_action: "install-local-token",
				message: "untrusted native text",
			},
		];

		for (const value of invalid) {
			expect(() => parseEnvironmentTokenCustodyState(value)).toThrow();
		}
	});

	test("rejects token-bearing argv and environment options", () => {
		expect(() =>
			buildEnvironmentTokenCustodyInvocation({
				executable_path: "/opt/browser-use/bin/browser-use-token-custody",
				action: "install",
				config_root: "/safe/config/browser-use",
				input: { kind: "stdin", fd: 7 },
				validator_fd: 9,
				token: "forbidden",
			} as never),
		).toThrow("unsupported token-bearing option");
		expect(() =>
			buildEnvironmentTokenCustodyInvocation({
				executable_path: "/opt/browser-use/bin/browser-use-token-custody",
				action: "status",
				config_root: "/safe/config/browser-use",
				env: { OP_SERVICE_ACCOUNT_TOKEN: "forbidden" },
			} as never),
		).toThrow("unsupported token-bearing option");
	});

	test("keeps native lifecycle states and causes in exact parity", () => {
		const nativeSource = readFileSync(
			join(
				import.meta.dir,
				"..",
				"..",
				"..",
				"runtime",
				"browser-use-environment-auth",
				"Sources",
				"BrowserUseEnvironmentAuth",
				"TokenCustody.swift",
			),
			"utf8",
		);
		expect(
			nativeEnumValues(nativeSource, "TokenCustodyState").sort(),
		).toEqual([...BROWSER_USE_ENVIRONMENT_TOKEN_CUSTODY_STATES].sort());
		expect(
			nativeEnumValues(nativeSource, "TokenCustodyCause").sort(),
		).toEqual([...BROWSER_USE_ENVIRONMENT_TOKEN_CUSTODY_CAUSES].sort());
	});
});
