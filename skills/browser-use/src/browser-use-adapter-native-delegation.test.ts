import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifiedHandoffEnvelope } from "./browser-connect-handoff-fixtures";
import { parseHandoffFacts } from "./browser-use-discovery";

const SOURCE_ROOT = dirname(fileURLToPath(import.meta.url));
const THIS_FILE = fileURLToPath(import.meta.url);
const MECHANICS_MODULES = new Set([
	resolve(SOURCE_ROOT, "browser-use-agent-browser"),
	resolve(SOURCE_ROOT, "browser-use-chrome-task"),
	resolve(SOURCE_ROOT, "browser-use-playwright-task"),
	resolve(SOURCE_ROOT, "browser-use-operations"),
]);
const FROZEN_IMPORTERS = [
	"browser-use-agent-browser-target.ts",
	"browser-use-agent-browser.test.ts",
	"browser-use-auth-provider.ts",
	"browser-use-chrome-task.test.ts",
	"browser-use-confidential-delivery-seam.test.ts",
	"browser-use-confidential-lane-conformance.test.ts",
	"browser-use-leak-harness.test.ts",
	"browser-use-playwright-task.test.ts",
	"browser-use-resume-continuity.test.ts",
	"browser-use-runbook-actions.ts",
	"browser-use-runbook-model.ts",
	"browser-use-runbook.test.ts",
	"browser-use-runbook.ts",
	"browser-use.ts",
	"fixtures/confidential-runbook-delivery-fixture.ts",
	"fixtures/fasttrack-login-runbook-fixture.ts",
	"prototypes/2026-08-11-adapter-session-lease/acceptance.ts",
];
const ADR_VIOLATION =
	"A new import of adapter mechanics violates ADR 0031. A new adapter must not require a Browser Use action executor or parser — add a new adapter, do not spread these modules.";

function typescriptFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return typescriptFiles(path);
		return extname(entry.name) === ".ts" ? [path] : [];
	});
}

function importSpecifiers(source: string): string[] {
	const code = source
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/\/\/.*$/gm, "");
	const staticImports = [
		...code.matchAll(/\b(?:import|export)\s+(?:type\s+)?[^;]*?\bfrom\s*["']([^"']+)["']/g),
	];
	const dynamicImports = [
		...code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
	];
	return [...staticImports, ...dynamicImports].map((match) => match[1] as string);
}

function mechanicsImporters(): string[] {
	return typescriptFiles(SOURCE_ROOT)
		.filter((path) => path !== THIS_FILE)
		.filter((path) =>
			importSpecifiers(readFileSync(path, "utf8")).some((specifier) => {
				if (!specifier.startsWith(".")) return false;
				const resolved = resolve(dirname(path), specifier).replace(/\.(?:tsx?|jsx?)$/, "");
				return MECHANICS_MODULES.has(resolved);
			}),
		)
		.map((path) => relative(SOURCE_ROOT, path))
		.sort();
}

describe("ADR 0031 adapter-native delegation", () => {
	test("freezes imports of adapter mechanics as migration debt", () => {
		expect(mechanicsImporters(), ADR_VIOLATION).toEqual(FROZEN_IMPORTERS);
	});

	test("keeps verified-handoff delegation metadata exposed", () => {
		const parsed = parseHandoffFacts(verifiedHandoffEnvelope());
		if (!parsed.ok || parsed.kind !== "verified") {
			throw new Error("valid verified handoff fixture did not parse as verified");
		}

		expect(parsed.facts.adapter.length).toBeGreaterThan(0);
		expect(parsed.facts.probeExecutable.length).toBeGreaterThan(0);
		expect(parsed.facts.endpointHttp.length).toBeGreaterThan(0);
		expect(parsed.facts.endpointWs.length).toBeGreaterThan(0);
	});
});
