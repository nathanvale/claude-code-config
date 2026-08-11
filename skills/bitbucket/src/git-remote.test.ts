import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveRepository } from "./git-remote";

let temporaryDirectory: string;

beforeEach(() => {
	temporaryDirectory = mkdtempSync(join(tmpdir(), "bb-"));
});

afterEach(() => {
	rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("resolveRepository", () => {
	test("uses validated explicit coordinates", async () => {
		expect(await resolveRepository({
			workspace: "esol-monash",
			repo: "experience-sdk",
			environment: {},
			cwd: temporaryDirectory,
		})).toEqual({ workspace: "esol-monash", repo: "experience-sdk" });
	});

	test("requires both explicit coordinates", async () => {
		await expect(resolveRepository({ workspace: "esol-monash", environment: {}, cwd: temporaryDirectory })).rejects.toThrow("both --workspace and --repo");
	});

	test("detects an SSH Bitbucket remote", async () => {
		execFileSync("git", ["init", "--quiet"], { cwd: temporaryDirectory });
		execFileSync("git", ["remote", "add", "origin", "git@bitbucket.org:esol-monash/experience-sdk.git"], { cwd: temporaryDirectory });
		expect(await resolveRepository({ environment: {}, cwd: temporaryDirectory })).toEqual({ workspace: "esol-monash", repo: "experience-sdk" });
	});

	test("rejects unsafe environment coordinates", async () => {
		await expect(resolveRepository({
			environment: { BB_WORKSPACE: "../escape", BB_REPO_SLUG: "repo" },
			cwd: temporaryDirectory,
		})).rejects.toThrow("unsupported characters");
	});
});
