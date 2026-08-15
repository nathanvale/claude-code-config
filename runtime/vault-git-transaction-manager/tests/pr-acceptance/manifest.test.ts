import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import {
	VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS,
	extractJUnitTestNames,
	validateVaultGitPrAcceptanceManifest,
	validateVaultGitPrAcceptanceSources,
	vaultGitPrAcceptancePattern,
} from "./manifest.ts";

const packageRoot = resolve(import.meta.dir, "../..");

describe("Vault Git hosted PR acceptance manifest", () => {
	test("accepts the exact unique nonempty workflow set", () => {
		expect(
			validateVaultGitPrAcceptanceManifest(
				VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS,
			),
		).toEqual(VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS);
	});

	test("refuses a missing row owner", () => {
		const first = VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS[0];
		expect(() =>
			validateVaultGitPrAcceptanceManifest([
				{ ...first, rows: first.rows.slice(1) },
				...VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS.slice(1),
			]),
		).toThrow("row count mismatch");
	});

	test("refuses duplicate row ownership", () => {
		const first = VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS[0];
		expect(() =>
			validateVaultGitPrAcceptanceManifest([
				first,
				{
					...VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS[1],
					rows: [first.rows[0]],
				},
				...VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS.slice(2),
			]),
		).toThrow("duplicate PR acceptance row");
	});

	test("declared rows exist exactly once in their owned source files", async () => {
		await expect(
			validateVaultGitPrAcceptanceSources(
				packageRoot,
				VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS,
			),
		).resolves.toBeUndefined();
	});

	test("escapes selectors and reads exact JUnit row names", () => {
		const pattern = vaultGitPrAcceptancePattern(
			VAULT_GIT_PR_ACCEPTANCE_WORKFLOWS[0],
		);
		expect(pattern).toContain("public begin changes no private transaction");
		expect(
			extractJUnitTestNames(
				'<testsuite tests="2"><testcase name="owned row"/><testcase name="filtered row"><skipped /></testcase></testsuite>',
			),
		).toEqual(["owned row"]);
	});
});
