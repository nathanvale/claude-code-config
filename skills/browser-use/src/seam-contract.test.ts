import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, test } from "bun:test";
import { SEAM as adapterSeam } from "./adapter";
import { SEAM as coreSeam } from "./core";
import { SEAM as facadeSeam } from "./facade";
import { SEAM as oracleSeam } from "./oracle";
import { SEAM as perceptionSeam } from "./perception";
import { SEAM as redactionSeam } from "./redaction";
import { SEAM as routerSeam } from "./router";
import { SEAM as verifySeam } from "./verify";
import {
	SEAM_DIRECTION,
	SEAM_NAMES,
	type Seam,
	type SeamName,
	type SeamStatus,
} from "./seam-contract";

const EXPECTED_STATUS = {
	facade: "earned",
	adapter: "earned",
	oracle: "earned",
	router: "earned",
	perception: "provisional",
	verify: "provisional",
	redaction: "provisional",
	core: "provisional",
} as const satisfies Record<SeamName, SeamStatus>;

const EXPECTED_PATTERN = {
	facade: "Facade",
	adapter: "Adapter",
	oracle: "N-version programming",
	router: "evidence-first selection",
	perception: null,
	verify: null,
	redaction: null,
	core: null,
} as const satisfies Record<SeamName, string | null>;

const SEAMS = [
	facadeSeam,
	adapterSeam,
	oracleSeam,
	routerSeam,
	perceptionSeam,
	verifySeam,
	redactionSeam,
	coreSeam,
] as const satisfies readonly Seam[];

type Header = {
	name: SeamName;
	status: SeamStatus;
	pattern: string | null;
	deletionTest: string;
	text: string;
};

function seamEntryPath(name: SeamName): string {
	return join(import.meta.dir, name, "index.ts");
}

async function readHeader(name: SeamName): Promise<Header> {
	const text = await readFile(seamEntryPath(name), "utf-8");
	const firstLine = text.split("\n")[0] ?? "";
	const match = firstLine.match(
		/^\/\/ SEAM: (?<name>[a-z-]+) \| (?<status>earned|provisional) \| pattern: (?<pattern>.+?) \| deletion-test: (?<deletionTest>.+)$/,
	);
	expect(match?.groups).toBeDefined();
	const groups = match?.groups as {
		name: SeamName;
		status: SeamStatus;
		pattern: string;
		deletionTest: string;
	};
	return {
		name: groups.name,
		status: groups.status,
		pattern: groups.pattern === "none" ? null : groups.pattern,
		deletionTest: groups.deletionTest,
		text: firstLine,
	};
}

function contextArchitecturePatternsSection(context: string): string {
	const start = context.indexOf("### Architecture patterns");
	expect(start).toBeGreaterThanOrEqual(0);
	const next = context.indexOf("\n### ", start + 1);
	return context.slice(start, next === -1 ? undefined : next);
}

function parseAvoidAliasesByPattern(context: string): Map<string, readonly string[]> {
	const section = contextArchitecturePatternsSection(context);
	const aliases = new Map<string, readonly string[]>();
	const entryPattern =
		/\*\*(?<pattern>[^*]+)\*\*:[\s\S]*?_Avoid_: (?<avoid>[^\n]+)/g;
	for (const match of section.matchAll(entryPattern)) {
		const pattern = match.groups?.pattern.trim();
		const avoid = match.groups?.avoid
			.split(",")
			.map((alias) => alias.trim())
			.filter(Boolean);
		if (pattern && avoid) aliases.set(pattern, avoid);
	}
	return aliases;
}

function normalizedImportTarget(
	source: SeamName,
	specifier: string,
): SeamName | undefined {
	if (!specifier.startsWith(".")) return undefined;
	const sourceDir = join(import.meta.dir, source);
	const resolved = join(sourceDir, specifier);
	const target = relative(import.meta.dir, resolved).split("/")[0] as
		| SeamName
		| undefined;
	if (target === source) return undefined;
	return SEAM_NAMES.includes(target as SeamName) ? target : undefined;
}

function importSpecifiers(sourceText: string): readonly string[] {
	return [
		...sourceText.matchAll(
			/(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["'](?<specifier>[^"']+)["']/g,
		),
	].flatMap((match) => match.groups?.specifier ?? []);
}

function containsAlias(text: string, alias: string): boolean {
	return text.toLocaleLowerCase().includes(alias.toLocaleLowerCase());
}

function isAllowedSeamImport(source: SeamName, target: SeamName): boolean {
	return (SEAM_DIRECTION[source] as readonly SeamName[]).includes(target);
}

describe("browser-use seam contract", () => {
	test("declares the scaffold seam set without speculative pattern directories", () => {
		expect(SEAM_NAMES).toEqual([
			"facade",
			"adapter",
			"oracle",
			"router",
			"perception",
			"verify",
			"redaction",
			"core",
		]);
		expect(new Set(SEAMS.map((seam) => seam.name))).toEqual(new Set(SEAM_NAMES));
		expect(existsSync(join(import.meta.dir, "template-method"))).toBe(false);
		expect(existsSync(join(import.meta.dir, "abstract-factory"))).toBe(false);
	});

	test("keeps earned status and patterns aligned with the naming decision log", () => {
		for (const seam of SEAMS) {
			expect(seam.status).toBe(EXPECTED_STATUS[seam.name]);
			expect(seam.pattern).toBe(EXPECTED_PATTERN[seam.name]);
			if (seam.status === "earned") {
				expect(seam.pattern).not.toBeNull();
			} else {
				expect(seam.pattern).toBeNull();
			}
		}
	});

	test("keeps header status and deletion test aligned with the SEAM marker", async () => {
		for (const seam of SEAMS) {
			const header = await readHeader(seam.name);
			expect(header.name).toBe(seam.name);
			expect(header.status).toBe(seam.status);
			expect(header.pattern).toBe(seam.pattern);
			expect(header.deletionTest).toBe(seam.deletionTest);
		}
	});

	test("guards the one-way seam import direction", async () => {
		const violations: string[] = [];
		for (const seam of SEAMS) {
			const text = await readFile(seamEntryPath(seam.name), "utf-8");
			for (const specifier of importSpecifiers(text)) {
				const target = normalizedImportTarget(seam.name, specifier);
				if (!target) continue;
				if (!isAllowedSeamImport(seam.name, target)) {
					violations.push(
						`${seam.name}/index.ts imports ${target}; allowed: ${SEAM_DIRECTION[
							seam.name
						].join(", ") || "none"}`,
					);
				}
			}
		}

		expect(violations).toEqual([]);
	});

	test("documents all seams in the architecture map", async () => {
		const architecture = await readFile(
			join(import.meta.dir, "ARCHITECTURE.md"),
			"utf-8",
		);
		for (const seam of SEAM_NAMES) {
			expect(architecture).toContain(`\`${seam}/\``);
		}
		expect(architecture).toContain("core/` is the keystone leaf");
		expect(architecture).toContain("facade/");
		expect(architecture).toContain("adapter/");
		expect(architecture).toContain("oracle/");
	});

	test("sources rejected seam names from scoped CONTEXT.md avoid aliases", async () => {
		const context = await readFile(join(import.meta.dir, "../CONTEXT.md"), "utf-8");
		const avoidAliasesByPattern = parseAvoidAliasesByPattern(context);
		const contextPatternBySeam = {
			facade: "Browser Facade",
			adapter: "Adapter (pattern sense)",
			oracle: "Differential Oracle",
			router: "Evidence-First Selection",
		} as const satisfies Partial<Record<SeamName, string>>;

		expect(avoidAliasesByPattern.get("Differential Oracle")).toContain("facade");
		expect(avoidAliasesByPattern.get("Evidence-First Selection")).toContain(
			"Strategy",
		);

		const violations: string[] = [];
		for (const seam of SEAMS) {
			const contextPattern =
				contextPatternBySeam[seam.name as keyof typeof contextPatternBySeam];
			if (!contextPattern) continue;
			const avoidAliases = avoidAliasesByPattern.get(contextPattern) ?? [];
			const header = await readHeader(seam.name);
			const searchable = [seam.pattern ?? "", header.text].join("\n");
			for (const alias of avoidAliases) {
				if (containsAlias(searchable, alias)) {
					violations.push(
						`${seam.name}/index.ts uses avoided alias "${alias}" from CONTEXT.md`,
					);
				}
			}
		}

		expect(violations).toEqual([]);
	});
});
