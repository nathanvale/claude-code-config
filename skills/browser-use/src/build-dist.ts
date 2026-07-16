#!/usr/bin/env bun

import { chmod, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const skillRoot = join(import.meta.dir, "..");
const distRoot = join(skillRoot, "dist");
const entrypoints = [
	"browser-use.ts",
	"preflight-warm-chrome.ts",
].map((entrypoint) => join(import.meta.dir, entrypoint));
const expectedDistFiles = new Set(
	entrypoints.map((entrypoint) => `${basename(entrypoint, ".ts")}.js`),
);

await rm(distRoot, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });

const build = await Bun.build({
	entrypoints,
	outdir: distRoot,
	target: "bun",
	splitting: false,
	minify: false,
	sourcemap: "none",
});

if (!build.success) {
	for (const log of build.logs) {
		console.error(log);
	}
	process.exit(1);
}

await verifyDist();

async function verifyDist(): Promise<void> {
	const distEntries = await readdir(distRoot);
	const unexpected = distEntries.filter((entry) => !expectedDistFiles.has(entry));
	const missing = [...expectedDistFiles].filter(
		(entry) => !distEntries.includes(entry),
	);

	if (missing.length > 0 || unexpected.length > 0) {
		throw new Error(
			`Unexpected browser-use dist payload. missing=${missing.join(",") || "none"} unexpected=${unexpected.join(",") || "none"}`,
		);
	}

	for (const entry of distEntries) {
		const distPath = join(distRoot, entry);
		const stats = await stat(distPath);

		if (!stats.isFile()) {
			throw new Error(`Dist payload entry is not a file: ${entry}`);
		}

		const text = await readFile(distPath, "utf8");
		const firstLine = text.split(/\r?\n/, 1)[0] ?? "";

		if (firstLine !== "#!/usr/bin/env bun") {
			throw new Error(`${entry} must keep a Bun shebang.`);
		}

		if (
			text.includes("@side-quest/cli-command-facade") ||
			text.includes("bun:test") ||
			text.includes(".test.ts") ||
			text.includes("/fixtures/")
		) {
			throw new Error(`${entry} includes source-only test, fixture, or workspace markers.`);
		}

		await chmod(distPath, 0o755);
	}

	console.log(
		`Built browser-use dist: ${[...expectedDistFiles]
			.map((entry) => relative(skillRoot, join(distRoot, entry)))
			.join(", ")}`,
	);
}
