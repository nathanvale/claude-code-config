import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI_PATH = join(import.meta.dir, "cli.ts");
const temporaryDirectories: string[] = [];

interface CliResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

async function makeFixture(options: { missingClient?: boolean } = {}): Promise<{
	root: string;
	configPath: string;
	argvPath: string;
}> {
	const root = await mkdtemp(join(tmpdir(), "gog-inbox-cleanup-"));
	temporaryDirectories.push(root);
	const bin = join(root, "bin");
	await Bun.write(join(root, ".keep"), "");
	await Bun.spawn(["mkdir", "-p", bin]).exited;
	const configPath = join(root, ".productivity.yml");
	const argvPath = join(root, "argv.json");
	await writeFile(
		configPath,
		options.missingClient
			? "connectors:\n  email-account: test-person@example.test\n"
			: "connectors:\n  email-account: test-person@example.test\n  email-client: test-personal\n",
	);
	await writeFile(
		join(bin, "gog"),
		`#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
writeFileSync(process.env.GOG_TEST_ARGV_PATH, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({
  threads: [
    { id: "private-1", from: "GitHub <notifications@github.com>", subject: "Review requested", date: "2026-08-15T02:00:00Z", labels: ["INBOX", "CATEGORY_UPDATES"], messageCount: 1 },
    { id: "private-2", from: "Account <security@example.test>", subject: "Security alert", date: "2026-08-14T02:00:00Z", labels: ["INBOX"], messageCount: 1 }
  ],
  nextPageToken: "private-next",
  externalContent: { warning: "private wrapper" }
}));
`,
	);
	await chmod(join(bin, "gog"), 0o755);
	return { root, configPath, argvPath };
}

async function runCli(args: string[], fixture: { root: string; argvPath: string }): Promise<CliResult> {
	const child = Bun.spawn([process.execPath, "run", CLI_PATH, ...args], {
		env: {
			...process.env,
			PATH: `${join(fixture.root, "bin")}:${process.env.PATH ?? ""}`,
			GOG_TEST_ARGV_PATH: fixture.argvPath,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("gog-inbox-cleanup public CLI", () => {
	test("executes only the exact read-only Gmail search command", async () => {
		const fixture = await makeFixture();
		const result = await runCli(
			[
				"audit",
				"--config",
				fixture.configPath,
				"--query",
				"in:inbox newer_than:30d",
				"--max",
				"2",
				"--json",
			],
			fixture,
		);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "completed",
			query: "in:inbox newer_than:30d",
			cap: { max: 2, returned: 2, reached: true, moreAvailable: true },
			proposals: [
				{
					decision: "label-candidate",
					scope: { type: "sender", value: "notifications@github.com" },
					intendedLabel: "GitHub",
				},
			],
			receipt: { changedState: "none", outcome: "completed" },
		});
		expect(JSON.parse(await readFile(fixture.argvPath, "utf8"))).toEqual([
			"--account",
			"test-person@example.test",
			"--client",
			"test-personal",
			"--enable-commands-exact",
			"gmail.search",
			"--readonly",
			"--gmail-no-send",
			"--no-input",
			"--wrap-untrusted",
			"--json",
			"gmail",
			"search",
			"in:inbox newer_than:30d",
			"--max",
			"2",
		]);
	});

	test("refuses missing client before starting gog", async () => {
		const fixture = await makeFixture({ missingClient: true });
		const result = await runCli(
			["audit", "--config", fixture.configPath, "--query", "newer_than:7d", "--max", "2", "--json"],
			fixture,
		);

		expect(result.exitCode).toBe(2);
		expect(result.stdout).toBe("");
		expect(result.stderr).toContain("email-client");
		await expect(readFile(fixture.argvPath, "utf8")).rejects.toThrow();
	});

	test("refuses unbounded queries and excessive caps", async () => {
		const fixture = await makeFixture();
		const unbounded = await runCli(
			["audit", "--config", fixture.configPath, "--query", "in:inbox", "--max", "2", "--json"],
			fixture,
		);
		const excessive = await runCli(
			["audit", "--config", fixture.configPath, "--query", "newer_than:7d", "--max", "101", "--json"],
			fixture,
		);

		expect(unbounded.exitCode).toBe(2);
		expect(unbounded.stderr).toContain("bounded");
		expect(excessive.exitCode).toBe(2);
		expect(excessive.stderr).toContain("between 1 and 100");
		await expect(readFile(fixture.argvPath, "utf8")).rejects.toThrow();
	});

	test("renders help without invoking gog", async () => {
		const fixture = await makeFixture();
		const result = await runCli(["--help"], fixture);

		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("gog-inbox-cleanup audit");
		expect(result.stdout).toContain("Read-only Gmail metadata audit");
		expect(result.stderr).toBe("");
		await expect(readFile(fixture.argvPath, "utf8")).rejects.toThrow();
	});
});
