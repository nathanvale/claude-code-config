import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	describeCliProcessRun,
	parseCliProcessJson,
	runCliProcess,
} from "@side-quest/cli-command-facade/testing";

const cleanupPaths: string[] = [];
const bun = process.execPath;

afterEach(async () => {
	const roots = cleanupPaths.splice(0);
	await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function makeRoot(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "facade-process-testing-"));
	cleanupPaths.push(root);
	return root;
}

async function writeFixture(
	root: string,
	name: string,
	source: string,
): Promise<string> {
	const path = join(root, name);
	await writeFile(path, source, "utf8");
	return path;
}

describe("CLI process testing helpers", () => {
	test("running a successful subprocess returns command context and captured streams", async () => {
		const root = await makeRoot();
		const script = await writeFixture(
			root,
			"success.ts",
			'console.log("ok stdout");\nconsole.error("note stderr");\n',
		);
		const argv = [bun, "run", script];

		const result = await runCliProcess({
			label: "success fixture",
			argv,
			cwd: root,
		});

		expect(result.label).toBe("success fixture");
		expect(result.argv).toEqual(argv);
		expect(result.cwd).toBe(root);
		expect(result.exitCode, describeCliProcessRun(result)).toBe(0);
		expect(result.timedOut).toBe(false);
		expect(result.stdout).toBe("ok stdout\n");
		expect(result.stderr).toBe("note stderr\n");
	});

	test("running a failing subprocess captures stderr without throwing", async () => {
		const root = await makeRoot();
		const script = await writeFixture(
			root,
			"failure.ts",
			'console.error("expected failure");\nprocess.exit(7);\n',
		);

		const result = await runCliProcess({
			label: "failure fixture",
			argv: [bun, "run", script],
			cwd: root,
		});

		expect(result.exitCode, describeCliProcessRun(result)).toBe(7);
		expect(result.timedOut).toBe(false);
		expect(result.stderr).toContain("expected failure");
	});

	test("a timed-out subprocess is killed and returned as data", async () => {
		const root = await makeRoot();
		const script = await writeFixture(
			root,
			"timeout.ts",
			'console.log("started");\nawait new Promise((resolve) => setTimeout(resolve, 1_000));\n',
		);
		const startedAt = Date.now();

		const result = await runCliProcess({
			label: "timeout fixture",
			argv: [bun, "run", script],
			cwd: root,
			timeoutMs: 50,
		});

		expect(result.timedOut).toBe(true);
		expect(result.exitCode).toBeNull();
		expect(Date.now() - startedAt).toBeLessThan(900);
		expect(describeCliProcessRun(result)).toContain("timedOut=true");
	});

	test("a stdin-fed subprocess receives stdin and awaits process exit", async () => {
		const root = await makeRoot();
		const script = await writeFixture(
			root,
			"stdin.ts",
			'const text = await new Response(Bun.stdin.stream()).text();\nconsole.log(JSON.stringify({ text }));\n',
		);

		const result = await runCliProcess({
			label: "stdin fixture",
			argv: [bun, "run", script],
			cwd: root,
			stdin: "hello from stdin\n",
		});

		expect(result.exitCode, describeCliProcessRun(result)).toBe(0);
		expect(parseCliProcessJson<{ text: string }>(result)).toEqual({
			text: "hello from stdin\n",
		});
	});

	test("JSON parsing returns caller-typed envelopes for valid stdout", async () => {
		const root = await makeRoot();
		const script = await writeFixture(
			root,
			"json.ts",
			'console.log(JSON.stringify({ status: "ok", data: { count: 1 } }));\n',
		);

		const result = await runCliProcess({
			label: "json fixture",
			argv: [bun, "run", script],
			cwd: root,
		});
		const envelope = parseCliProcessJson<{
			status: "ok";
			data: { count: number };
		}>(result);

		expect(envelope.data.count).toBe(1);
	});

	test("JSON parsing failures include process context and parse error", async () => {
		const root = await makeRoot();
		const script = await writeFixture(
			root,
			"bad-json.ts",
			'console.log("{not-json");\nconsole.error("bad json stderr");\n',
		);

		const result = await runCliProcess({
			label: "bad json fixture",
			argv: [bun, "run", script],
			cwd: root,
		});

		expect(() => parseCliProcessJson(result)).toThrow(/label=bad json fixture/);
		expect(() => parseCliProcessJson(result)).toThrow(/stdout="\{not-json"/);
		expect(() => parseCliProcessJson(result)).toThrow(/stderr="bad json stderr"/);
		expect(() => parseCliProcessJson(result)).toThrow(/parseError=/);
	});

	test("empty argv is rejected before spawning", async () => {
		await expect(
			runCliProcess({
				label: "empty",
				argv: [],
				cwd: await makeRoot(),
			}),
		).rejects.toThrow(/argv must include an executable/);
	});
});
