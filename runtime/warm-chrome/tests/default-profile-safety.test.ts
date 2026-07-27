import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { isDefaultChromeProfilePath } from "../src/runtime.ts";

// ===========================================================================
// DDA-F26 default-profile safety invariant.
//
// Browser Use must never enable remote debugging on the user's real default
// Chrome profile, nor attach/verify/launch/repair against it — the automation
// surface is confined to the dedicated WARM_CHROME_DEFAULT_PROFILE_DIR.
//
// The attach/verify/launch/repair half is enforced by isDefaultChromeProfilePath
// (proof.ts, launch.ts, repair.ts) and proven in check-stations.test.ts and
// runtime.test.ts. This file pins the ENABLE half, traced from the 2026-07-27
// incident: a Human-Chrome operator recovery (enable_human_chrome_remote_debugging)
// toggled Chrome's PERSISTENT devtools.remote_debugging.user-enabled setting on
// the user's real logged-in profile, so remote debugging re-enabled on every
// restart. The guarantee: no shipping warm-chrome code programmatically writes
// that persistent setting. Remote debugging is requested ONLY via a transient
// --remote-debugging-port launch flag against the dedicated profile; the
// persistent Chrome setting is never mutated by this package. The day an
// implementation slips a persistent enable in, this test goes red.
// ===========================================================================

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

type SourceFixture = {
	file: string;
	source: string;
};

type AllowedMutation = {
	file: string;
	api: string;
	callee: string;
	firstArgument: string;
};

type MutationPolicyViolation = {
	file: string;
	line: number;
	api: string;
	callee: string;
	reason: "unapproved" | "allowlisted-site-missing";
};

const FILE_MUTATION_APIS = new Set([
	"appendFile",
	"appendFileSync",
	"copyFile",
	"copyFileSync",
	"createWriteStream",
	"rename",
	"renameSync",
	"truncate",
	"truncateSync",
	"writeFile",
	"writeFileSync",
	"writeTextFile",
	"writeTextFileSync",
]);

// Every shipping file-content mutation is named here by exact call shape. This
// is deliberately an allowlist of sites, not target-path text matching:
// dynamic/split-line Chrome config paths and alternate/aliased write APIs still
// surface as unapproved mutations.
const ALLOWED_SHIPPING_MUTATIONS: readonly AllowedMutation[] = [
	{
		file: "repair.ts",
		api: "writeTextFile",
		callee: "runtime.writeTextFile",
		firstArgument: "activePortPath",
	},
	{
		file: "runtime.ts",
		api: "writeFile",
		callee: "writeFile",
		firstArgument: "path",
	},
];

async function sourceFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await sourceFiles(path)));
			continue;
		}
		if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			files.push(path);
		}
	}
	return files;
}

function propertyName(node: ts.Expression): string | null {
	if (ts.isPropertyAccessExpression(node)) {
		return node.name.text;
	}
	if (
		ts.isElementAccessExpression(node) &&
		node.argumentExpression &&
		(ts.isStringLiteral(node.argumentExpression) ||
			ts.isNoSubstitutionTemplateLiteral(node.argumentExpression))
	) {
		return node.argumentExpression.text;
	}
	return null;
}

function findMutationPolicyViolations(
	fixtures: readonly SourceFixture[],
	allowlist: readonly AllowedMutation[] = [],
): MutationPolicyViolation[] {
	const remainingAllowed = [...allowlist];
	const violations: MutationPolicyViolation[] = [];

	for (const fixture of fixtures) {
		const sourceFile = ts.createSourceFile(
			fixture.file,
			fixture.source,
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);
		const mutationBindings = new Map<string, string>();

		for (const statement of sourceFile.statements) {
			const namedBindings = ts.isImportDeclaration(statement)
				? statement.importClause?.namedBindings
				: undefined;
			if (
				!namedBindings ||
				!ts.isNamedImports(namedBindings)
			) {
				continue;
			}
			for (const element of namedBindings.elements) {
				const importedName = element.propertyName?.text ?? element.name.text;
				if (FILE_MUTATION_APIS.has(importedName)) {
					mutationBindings.set(element.name.text, importedName);
				}
			}
		}

		const mutationApi = (expression: ts.Expression): string | null => {
			if (ts.isIdentifier(expression)) {
				return mutationBindings.get(expression.text) ?? null;
			}
			const name = propertyName(expression);
			if (name && FILE_MUTATION_APIS.has(name)) {
				return name;
			}
			if (
				name === "write" &&
				ts.isPropertyAccessExpression(expression) &&
				ts.isIdentifier(expression.expression) &&
				expression.expression.text === "Bun"
			) {
				return "Bun.write";
			}
			return null;
		};

		// Resolve direct aliases before inspecting calls, including destructured
		// aliases such as `const { appendFile: persist } = fs.promises`.
		let discoveredAlias = true;
		while (discoveredAlias) {
			discoveredAlias = false;
			const visitAliases = (node: ts.Node): void => {
				if (ts.isVariableDeclaration(node) && node.initializer) {
					if (ts.isIdentifier(node.name)) {
						const api = mutationApi(node.initializer);
						if (api && mutationBindings.get(node.name.text) !== api) {
							mutationBindings.set(node.name.text, api);
							discoveredAlias = true;
						}
					} else if (ts.isObjectBindingPattern(node.name)) {
						for (const element of node.name.elements) {
							// Renamed destructure (`{ appendFile: persist }`) keys the API off
							// propertyName; a plain destructure (`{ appendFile }`) carries the API
							// name in `element.name`, so fall back to it or the binding escapes.
							const name =
								element.propertyName?.getText(sourceFile) ??
								(ts.isIdentifier(element.name) ? element.name.text : undefined);
							if (
								name &&
								FILE_MUTATION_APIS.has(name) &&
								ts.isIdentifier(element.name) &&
								mutationBindings.get(element.name.text) !== name
							) {
								mutationBindings.set(element.name.text, name);
								discoveredAlias = true;
							}
						}
					}
				}
				ts.forEachChild(node, visitAliases);
			};
			visitAliases(sourceFile);
		}

		const visitCalls = (node: ts.Node): void => {
			if (ts.isCallExpression(node)) {
				const api = mutationApi(node.expression);
				if (api) {
					const callee = node.expression.getText(sourceFile);
					const firstArgument = node.arguments[0]?.getText(sourceFile) ?? "";
					const allowedIndex = remainingAllowed.findIndex(
						(allowed) =>
							allowed.file === fixture.file &&
							allowed.api === api &&
							allowed.callee === callee &&
							allowed.firstArgument === firstArgument,
					);
					if (allowedIndex >= 0) {
						remainingAllowed.splice(allowedIndex, 1);
					} else {
						const { line } = sourceFile.getLineAndCharacterOfPosition(
							node.getStart(sourceFile),
						);
						violations.push({
							file: fixture.file,
							line: line + 1,
							api,
							callee,
							reason: "unapproved",
						});
					}
				}
			}
			ts.forEachChild(node, visitCalls);
		};
		visitCalls(sourceFile);
	}

	for (const missing of remainingAllowed) {
		violations.push({
			file: missing.file,
			line: 0,
			api: missing.api,
			callee: missing.callee,
			reason: "allowlisted-site-missing",
		});
	}

	return violations;
}

describe("DDA-F26 default-profile safety: the persistent remote-debugging setting is never enabled", () => {
	test("no shipping source writes Chrome's persistent devtools.remote_debugging.user-enabled setting", async () => {
		const files = await sourceFiles(SRC_DIR);
		expect(files.length).toBeGreaterThan(0);

		// A programmatic enable would touch Chrome's Local State / Preferences and
		// set the persistent user-enabled flag. Remote debugging is legitimately
		// requested only via the transient --remote-debugging-port launch flag, so
		// none of these persistent-setting tokens may appear in shipping source.
		const forbidden = [
			"remote_debugging",
			"user-enabled",
			"user_enabled",
			"remote-debugging-enabled",
		];

		const offenders: Array<{ file: string; token: string; line: number }> = [];
		for (const file of files) {
			const lines = (await readFile(file, "utf8")).split("\n");
			lines.forEach((text, index) => {
				for (const token of forbidden) {
					if (text.includes(token)) {
						offenders.push({ file, token, line: index + 1 });
					}
				}
			});
		}

		expect(offenders).toEqual([]);
	});

	test("Local State / Preferences writes are absent from shipping source (no persistent Chrome-settings mutation)", async () => {
		const files = await sourceFiles(SRC_DIR);
		const fixtures = await Promise.all(
			files.map(async (file) => ({
				file: file.slice(SRC_DIR.length + 1),
				source: await readFile(file, "utf8"),
			})),
		);

		expect(
			findMutationPolicyViolations(fixtures, ALLOWED_SHIPPING_MUTATIONS),
		).toEqual([]);
	});

	test("the mutation scan rejects split-line and dynamic Chrome config writes through alternate APIs", () => {
		const fixtures: SourceFixture[] = [
			{
				file: "split-line.ts",
				source: `
					import { writeFile } from "node:fs/promises";
					const chromeConfig = join(profileDir, "Local State");
					await writeFile(
						chromeConfig,
						JSON.stringify(settings),
					);
				`,
			},
			{
				file: "aliased-dynamic.ts",
				source: `
					import { appendFile as persist } from "node:fs/promises";
					const configName = ["Prefer", "ences"].join("");
					await persist(join(profileDir, configName), payload);
				`,
			},
			{
				file: "bun-write.ts",
				source: `
					const configName = ["Local", " State"].join("");
					await Bun.write(join(profileDir, configName), payload);
				`,
			},
			{
				file: "plain-destructure.ts",
				source: `
					const { appendFile } = fs.promises;
					await appendFile(chromeConfigPath, payload);
				`,
			},
		];

		expect(findMutationPolicyViolations(fixtures)).toEqual([
			{
				file: "split-line.ts",
				line: 4,
				api: "writeFile",
				callee: "writeFile",
				reason: "unapproved",
			},
			{
				file: "aliased-dynamic.ts",
				line: 4,
				api: "appendFile",
				callee: "persist",
				reason: "unapproved",
			},
			{
				file: "bun-write.ts",
				line: 3,
				api: "Bun.write",
				callee: "Bun.write",
				reason: "unapproved",
			},
			{
				file: "plain-destructure.ts",
				line: 3,
				api: "appendFile",
				callee: "appendFile",
				reason: "unapproved",
			},
		]);
	});

	test("the mutation scan accepts legitimate Chrome config reads", () => {
		const fixtures: SourceFixture[] = [
			{
				file: "read-only.ts",
				source: `
					import { readFile as load } from "node:fs/promises";
					const localState = await load(join(profileDir, "Local State"), "utf8");
					const preferences = await load(
						join(profileDir, "Preferences"),
						"utf8",
					);
				`,
			},
		];

		expect(findMutationPolicyViolations(fixtures)).toEqual([]);
	});

	test("the matcher confines automation to the dedicated profile: the real default profile is rejected", () => {
		const env = { HOME: "/Users/example" };
		// The user's real logged-in profile and its Default sub-profile are default.
		expect(
			isDefaultChromeProfilePath(
				"/Users/example/Library/Application Support/Google/Chrome",
				env,
			),
		).toBe(true);
		expect(
			isDefaultChromeProfilePath(
				"/Users/example/Library/Application Support/Google/Chrome/Default",
				env,
			),
		).toBe(true);
		// The dedicated warm profile is the ONLY sanctioned automation target.
		expect(
			isDefaultChromeProfilePath("/Users/example/.agent-warm-profile", env),
		).toBe(false);
	});
});
