import { describe, expect, test } from "bun:test";
import {
	CliUsageError,
	type CommandFacadeContract,
	composeAliasArgv,
	formatEnumFlagError,
	helpRequested,
	parseEnumFlag,
	projectUsagesToRoute,
	renderCommandUsage,
	requireValue,
	usageError,
} from "@side-quest/cli-command-facade";

const inspectContract = {
	script: "tools/inspect.ts",
	summary: "Inspect command state.",
	usage: ["inspect [--json]"],
	json: true,
	audience: "agent",
	mutation: "read-only",
	sideEffects: ["read"],
	flags: {
		"--json": { type: "boolean", description: "Emit JSON." },
	},
	exitCodes: {
		"0": "status returned",
		"1": "inspection failed",
		"2": "usage error",
	},
} satisfies CommandFacadeContract<"inspect">;

describe("CLI command facade usage helpers", () => {
	test("renders usage and route projections without package-specific policy", () => {
		expect(renderCommandUsage(inspectContract)).toContain(
			"Usage: inspect [--json]",
		);
		expect(projectUsagesToRoute(inspectContract.usage, "example inspect")).toEqual(
			["example inspect [--json]"],
		);
		expect(
			projectUsagesToRoute(
				["inspect [--json] [--verbose]"],
				"example inspect",
				["--json"],
			),
		).toEqual(["example inspect [--verbose]"]);
	});

	test("composes alias argv without mutating caller input", () => {
		const argv = ["--verbose"];

		expect(composeAliasArgv(["--json"], argv)).toEqual(["--json", "--verbose"]);
		expect(argv).toEqual(["--verbose"]);
	});

	test("uses typed usage errors for invalid enum flags", () => {
		expect(() => parseEnumFlag("--format", "xml", ["json", "human"])).toThrow(
			CliUsageError,
		);
		expect(formatEnumFlagError("--format", "xml", ["json", "human"])).toBe(
			'--format must be one of: json, human (got: "xml")',
		);
		expect(usageError("bad").options.exitCode).toBe(2);
		expect(helpRequested(2).options).toEqual({
			exitCode: 2,
			showMessage: false,
		});
		expect(requireValue(["--path", "here"], 0, "--path")).toBe("here");
		expect(() => requireValue(["--path"], 0, "--path")).toThrow(CliUsageError);
	});
});
