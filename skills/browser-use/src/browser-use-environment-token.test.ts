import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	BROWSER_USE_ENVIRONMENT_TOKEN_CUSTODY_CAUSES,
	BROWSER_USE_ENVIRONMENT_TOKEN_CUSTODY_STATES,
	buildEnvironmentTokenCustodyInvocation,
	environmentTokenPathsFor,
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
		});
		expect(JSON.stringify(invocation)).not.toContain("OP_SERVICE_ACCOUNT_TOKEN");
		expect(invocation.argv.join(" ")).not.toContain("token=");
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
