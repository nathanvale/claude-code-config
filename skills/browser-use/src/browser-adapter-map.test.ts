import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	CLI_DIAGNOSTIC_FLAGS,
	parseCommandFacadeContract,
} from "@side-quest/cli-command-facade";
import {
	assertCommandHelpFlagSurface,
	runCommandSurfaceCases,
} from "@side-quest/cli-command-facade/testing";
import {
	BROWSER_ADAPTER_MAP_ADAPTERS,
	BROWSER_ADAPTER_MAP_CONTRACT_ID,
	BROWSER_ADAPTER_MAP_SCHEMA_VERSION,
	browserAdapterMapContracts,
} from "./command-contract";
import {
	checkRecoveryMapCoverage,
	checkRequiredSections,
	createDefaultBrowserAdapterMapRuntime,
	runForTest,
} from "./browser-adapter-map";

const CHROME_DEVTOOLS_ADAPTER_MAP_PATH = new URL(
	"../references/browser-adapter-chrome-devtools.md",
	import.meta.url,
);

function expectNoUnknownOption(result: {
	stdout: string;
	stderr: string;
}): void {
	expect(`${result.stdout}\n${result.stderr}`).not.toContain("unknown option");
}

describe("Browser Adapter Map command contract", () => {
	test("declares cli-author facade contract for check and status", () => {
		expect(BROWSER_ADAPTER_MAP_ADAPTERS).toEqual(["chrome-devtools"]);
		expect(browserAdapterMapContracts.check.sideEffects).toEqual(["check"]);
		expect(browserAdapterMapContracts.status.alias).toEqual({
			command: "check",
			defaultArgs: ["--plain"],
		});
		expect(browserAdapterMapContracts.check.flags["--adapter"]).toMatchObject({
			type: "enum",
			values: ["chrome-devtools"],
			required: true,
		});
		expect(browserAdapterMapContracts.check.resultContract?.id).toBe(
			BROWSER_ADAPTER_MAP_CONTRACT_ID,
		);
		expect(browserAdapterMapContracts.check.resultContract?.schema_version).toBe(
			BROWSER_ADAPTER_MAP_SCHEMA_VERSION,
		);
	});

	test("validates against facade package without declaring reserved diagnostics", () => {
		const parsed = parseCommandFacadeContract(browserAdapterMapContracts, {
			path: "skills/browser-use/src/command-contract.ts",
			writeImplyingMutations: new Set(["write", "browser"]),
		});

		expect(parsed.ok).toBe(true);
		for (const contract of Object.values(browserAdapterMapContracts)) {
			for (const flag of CLI_DIAGNOSTIC_FLAGS) {
				expect(contract.flags).not.toHaveProperty(flag);
			}
		}
	});

	test("keeps map commands read-only", () => {
		for (const contract of Object.values(browserAdapterMapContracts)) {
			expect(contract.mutation).toBe("check");
			expect(contract.sideEffects).not.toContain("write");
			expect(contract.sideEffects).not.toContain("browser");
			expect(contract.sideEffects).not.toContain("network");
		}
	});

	test("Command Surface Alignment Proof keeps help and public argv aligned", async () => {
		const checkHelp = await runForTest(["help", "check"]);
		const statusHelp = await runForTest(["help", "status"]);

		assertCommandHelpFlagSurface({
			command: "check",
			contract: browserAdapterMapContracts.check,
			help: checkHelp.stdout,
		});
		assertCommandHelpFlagSurface({
			command: "status",
			contract: browserAdapterMapContracts.status,
			help: statusHelp.stdout,
		});

		await runCommandSurfaceCases({
			runner: (argv) => runForTest(argv),
			cases: [
				{
					label: "check accepts adapter JSON",
					argv: ["check", "--adapter", "chrome-devtools", "--json"],
					assert: (result) => {
						expectNoUnknownOption(result);
						expect(result.exitCode).toBe(0);
						const envelope = JSON.parse(result.stdout);
						expect(envelope.data.action).toBe("map_valid");
						expect(envelope.data.adapter).toBe("chrome-devtools");
					},
				},
				{
					label: "status accepts adapter plain",
					argv: ["status", "--adapter", "chrome-devtools", "--plain"],
					assert: (result) => {
						expectNoUnknownOption(result);
						expect(result.exitCode).toBe(0);
						expect(result.stdout).toContain("map_valid command=status");
						expect(result.stderr).toBe("");
					},
				},
				{
					label: "check rejects unknown adapter semantically",
					argv: ["check", "--adapter", "agent-browser", "--json"],
					assert: (result) => {
						expectNoUnknownOption(result);
						expect(result.exitCode).toBe(2);
						const envelope = JSON.parse(result.stdout);
						expect(envelope.error.code).toBe("usage_error");
						expect(envelope.error.message).toContain("chrome-devtools");
					},
				},
			],
		});
	});
});

describe("Browser Adapter Map runtime", () => {
	test("chrome-devtools map has required sections", async () => {
		const markdown = await readFile(CHROME_DEVTOOLS_ADAPTER_MAP_PATH, "utf-8");
		const result = checkRequiredSections(markdown);

		expect(result.missing).toEqual([]);
	});

	test("section check reports missing required sections", () => {
		const markdown = `
## Owners

## Recovery Map
`;
		const result = checkRequiredSections(markdown);

		expect(result.missing).toEqual(["Rules", "Verify"]);
	});

	test("chrome-devtools Recovery Map avoids copied Browser Adapter Proof vocabulary", async () => {
		const markdown = await readFile(CHROME_DEVTOOLS_ADAPTER_MAP_PATH, "utf-8");
		const result = checkRecoveryMapCoverage(markdown);

		expect(result.missing).toEqual([]);
		expect(result.extra).toEqual([]);
	});

	test("coverage check reports copied recovery keys as extras", () => {
		const markdown = `
## Recovery Map

- \`configure_adapter_dependency\`: read \`Dependency\`.
`;
		const result = checkRecoveryMapCoverage(markdown);

		expect(result.missing).toEqual([]);
		expect(result.extra).toEqual(["configure_adapter_dependency"]);
	});

	test("CLI exits 20 for an invalid map", async () => {
		const runtime = createDefaultBrowserAdapterMapRuntime({
			readTextFile: async () => `
## Owners

## Recovery Map

- \`configure_adapter_dependency\`: read \`Dependency\`.
`,
		});
		const result = await runForTest(
			["check", "--adapter", "chrome-devtools", "--json"],
			runtime,
		);

		expect(result.exitCode).toBe(20);
		expect(result.stderr).toBe("");
		const envelope = JSON.parse(result.stdout);
		expect(envelope.error.code).toBe("browser_adapter_map_invalid");
		expect(envelope.data.sections.missing).toEqual(["Rules", "Verify"]);
		expect(envelope.data.recovery_map.extra).toEqual([
			"configure_adapter_dependency",
		]);
	});
});

describe("Browser Adapter Map CLI front door", () => {
	test("prints help without reading the map", async () => {
		let readCount = 0;
		const runtime = createDefaultBrowserAdapterMapRuntime({
			readTextFile: async () => {
				readCount += 1;
				return "";
			},
		});
		const result = await runForTest(["--help"], runtime);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("Usage: browser-adapter-map");
		expect(readCount).toBe(0);
	});

	test("prints version without reading the map", async () => {
		const result = await runForTest(["--version"]);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toMatch(/^browser-adapter-map 0\.1\.0\n$/);
		expect(result.stderr).toBe("");
	});

	test("Bun entrypoint passes through --version", async () => {
		const proc = Bun.spawn(
			[join(import.meta.dir, "browser-adapter-map.ts"), "--version"],
			{
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);

		expect(exitCode).toBe(0);
		expect(stdout).toMatch(/^browser-adapter-map 0\.1\.0\n$/);
		expect(stderr).toBe("");
	});
});
