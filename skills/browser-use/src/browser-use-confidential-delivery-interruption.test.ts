import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deriveConformanceSentinel } from "./browser-use-secret-scan";

const FIXTURE = join(
	import.meta.dir,
	"fixtures",
	"confidential-delivery-interruption-fixture.ts",
);
const NONCE = "interrupt01";

async function waitForFile(path: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		if ((await stat(path).catch(() => null))?.isFile()) return;
		await Bun.sleep(25);
	}
	throw new Error(`fixture signal did not appear: ${path}`);
}

async function filesUnder(root: string): Promise<string[]> {
	const entries = await readdir(root, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name));
}

describe("DDA-F18 confidential delivery interruption", () => {
	test("SIGKILL after the helper observes a secret leaves no secret-bearing durable state or process output", async () => {
		const root = await mkdtemp(join(tmpdir(), "browser-use-confidential-kill-"));
		const signalPath = join(root, "delivery-engaged.json");
		const sentinel = deriveConformanceSentinel("password", NONCE);
		expect(sentinel.ok).toBe(true);
		if (!sentinel.ok) return;

		try {
			const child = Bun.spawn(
				[process.execPath, FIXTURE, signalPath, NONCE],
				{
					cwd: root,
					env: {
						HOME: join(root, "home"),
						XDG_RUNTIME_DIR: join(root, "runtime"),
						XDG_STATE_HOME: join(root, "state"),
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);

			await waitForFile(signalPath);
			child.kill("SIGKILL");
			const [exitCode, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);

			expect(exitCode).not.toBe(0);
			expect(stdout).toContain("delivery-engaged");
			expect(`${stdout}\n${stderr}`).not.toContain(sentinel.value);

			const files = await filesUnder(root);
			expect(files).toContain(signalPath);
			for (const file of files) {
				const bytes = await readFile(file);
				expect(bytes.toString("utf8")).not.toContain(sentinel.value);
			}
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
