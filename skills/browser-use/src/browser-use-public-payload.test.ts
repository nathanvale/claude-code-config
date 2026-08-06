import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cleanup = new Set<string>();
afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

async function files(root: string): Promise<string[]> {
	const found: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) found.push(...(await files(path)));
		else if (entry.isFile()) found.push(path);
	}
	return found;
}

describe("AE8 public Browser Use payload", () => {
	test("compiled dist and declared pack payload contain no private Runbook, action, registry, or receipt bytes", async () => {
		const packageRoot = join(import.meta.dir, "..");
		const outputRoot = await mkdtemp(join(tmpdir(), "browser-use-public-payload-"));
		cleanup.add(outputRoot);
		const build = await Bun.build({
			entrypoints: [join(import.meta.dir, "browser-use.ts")],
			outdir: outputRoot,
			target: "bun",
			splitting: false,
			minify: false,
			sourcemap: "none",
			external: ["@side-quest/browser-connect/cli"],
		});
		expect(build.success).toBe(true);
		const packageJson = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
		expect(packageJson.files).toEqual(["dist"]);
		const privatePaths = [
			...(await files(join(packageRoot, "runbooks"))),
			...(await files(join(packageRoot, "actions"))),
		];
		const payload = Buffer.concat(await Promise.all((await files(outputRoot)).map((path) => readFile(path))));
		for (const path of privatePaths) {
			const privateBytes = await readFile(path);
			const digest = Buffer.from(createHash("sha256").update(privateBytes).digest("hex"));
			expect(payload.indexOf(privateBytes), path).toBe(-1);
			expect(payload.indexOf(digest), `${path} digest`).toBe(-1);
		}
		const unifiBytes = await readFile(join(packageRoot, "runbooks/unifi/login-screen-verify/runbook.json"));
		expect(createHash("sha256").update(unifiBytes).digest("hex")).toBe("8c3bdcdeaa9a4a4e31ec0b7cc926967e1734fc0c823730e225f5b879ae98727f");
	});
});
