import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as facade from "@side-quest/cli-command-facade";

const testDir = dirname(fileURLToPath(import.meta.url));
const facadePackageRoot = resolve(testDir, "..");
const repoRoot = resolve(facadePackageRoot, "../..");
const facadeSrcRoot = resolve(facadePackageRoot, "src");

describe("CLI command facade package boundary", () => {
	test("keeps the package export map limited to the root and testing subpath", () => {
		const manifest = JSON.parse(
			readFileSync(resolve(facadePackageRoot, "package.json"), "utf8"),
		) as { exports?: Record<string, string> };

		expect(manifest.exports).toEqual({
			".": "./src/index.ts",
			"./testing": "./src/testing.ts",
		});
	});

	test("keeps the public root value export inventory stable", () => {
		expect(Object.keys(facade).sort()).toEqual([
			"AGENT_HINT_ACTIONS",
			"BRANCH_STATION_CLASSIFICATIONS",
			"BRANCH_STATION_EVIDENCE_STATUSES",
			"CLI_DIAGNOSTIC_FLAGS",
			"CLI_WRITER_CONTRACT_EXIT_CODE",
			"COMMAND_FACADE_AUDIENCES",
			"COMMAND_FACADE_BASELINE_EXIT_CODES",
			"COMMAND_FACADE_CAPABILITY_ROLES",
			"COMMAND_FACADE_EXECUTION_MODES",
			"COMMAND_FACADE_INTERACTIVITY",
			"COMMAND_FACADE_OUTPUT_MODES",
			"COMMAND_FACADE_SIDE_EFFECTS",
			"CliRuntimeContractError",
			"CliUsageError",
			"CliWriterContractError",
			"DIAGNOSTIC_TRAIL_SURFACE_KINDS",
			"RUNTIME_ERROR_RECOVERABILITIES",
			"RUNTIME_ERROR_SEVERITIES",
			"STATION_MAP_COMPLETENESS_CLAIM",
			"cliWriterContractErrorProperties",
			"composeAliasArgv",
			"configureCliDiagnostics",
			"createCliDiagnosticContext",
			"createCliRuntimeErrorEnvelope",
			"createCliRuntimeSuccessEnvelope",
			"defineCommandFacadeContract",
			"emitCliDiagnostic",
			"findBranchStationCatalogDrift",
			"findCommandDiscoveryTreeDrift",
			"findCommandFacadeMetadataDrift",
			"formatEnumFlagError",
			"getCliDiagnosticDurationMs",
			"getCurrentCliDiagnosticContext",
			"helpRequested",
			"matchSensitiveEnvVarName",
			"parseCliDiagnosticArgv",
			"parseCliDiagnosticFallbackArgv",
			"parseCommandFacadeContract",
			"parseEnumFlag",
			"projectCommandDiscoveryActionAffordances",
			"projectCommandDiscoveryFlag",
			"projectCommandDiscoveryResultContract",
			"projectCommandDiscoveryTree",
			"projectStationMap",
			"projectUsageToRoute",
			"projectUsagesToRoute",
			"recordCliDomainRunId",
			"redactGenericCliDiagnosticRecord",
			"renderCommandUsage",
			"requireValue",
			"resetCliDiagnostics",
			"usageError",
			"validateAgentHint",
			"validateStructuredRuntimeError",
			"withCliDiagnosticContext",
			"writeJson",
			"writeJsonEnvelope",
		]);
	});

	test("keeps the facade implementation package-agnostic", () => {
		const findings = listTypeScriptFiles(facadeSrcRoot).flatMap((file) => {
			const source = readFileSync(file, "utf8");
			return listImportSpecifiers(source)
				.filter((specifier) => specifier.includes("plugins/"))
				.map(
					(specifier) =>
						`${toPosixRelative(repoRoot, file)} imports ${specifier}`,
				);
		});

		expect(findings).toEqual([]);
	});

	test("keeps facade consumers on the public package root or testing subpath", () => {
		const findings = listTypeScriptFiles(repoRoot).flatMap((file) => {
			const relativePath = toPosixRelative(repoRoot, file);
			if (relativePath.startsWith("runtime/cli-command-facade/")) {
				return [];
			}
			const source = readFileSync(file, "utf8");
			return listImportSpecifiers(source)
				.filter(
					(specifier) =>
						specifier.startsWith("@side-quest/cli-command-facade/") &&
						specifier !== "@side-quest/cli-command-facade/testing",
				)
				.map((specifier) => `${relativePath} imports ${specifier}`);
		});

		expect(findings).toEqual([]);
	});
});

function listTypeScriptFiles(root: string): string[] {
	return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const path = resolve(root, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules" || entry.name === "dist") return [];
			return listTypeScriptFiles(path);
		}
		return entry.isFile() && path.endsWith(".ts") ? [path] : [];
	});
}

function listImportSpecifiers(source: string): string[] {
	return [
		...source.matchAll(
			/import(?:\s+type)?[\s\S]*?from\s+["']([^"']+)["']|import\s+["']([^"']+)["']/g,
		),
	].map((match) => match[1] ?? match[2] ?? "");
}

function toPosixRelative(from: string, to: string): string {
	return relative(from, to).split("/").join("/");
}
