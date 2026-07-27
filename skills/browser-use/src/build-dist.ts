#!/usr/bin/env bun

import { chmod, cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const skillRoot = join(import.meta.dir, "..");
const distRoot = join(skillRoot, "dist");
// The shipped runbook catalog. Published tarballs include only `dist/` (see
// package.json `files`), and the packaged bin runs from `dist/browser-use.js`,
// so the shipped catalog must travel INSIDE dist as `dist/runbooks/` — a
// sibling `<skill>/runbooks/` exists only in the repo checkout, never in an
// install. `shippedRunbooksRoot()` (browser-use-runbook.ts) probes the
// dist-adjacent copy first, then the repo-local `../runbooks` fallback.
const shippedRunbooksSource = join(skillRoot, "runbooks");
const shippedRunbooksDist = join(distRoot, "runbooks");
const entrypoints = [
	"browser-use.ts",
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
	// The internal envelope mint (design brief D4) reaches browser-connect
	// through a lazy dynamic import. Keep it EXTERNAL: bundling would inline the
	// private workspace package (and its workspace-only markers) into the public
	// payload. Repo-local runs resolve it through the workspace; an installation
	// without the module degrades to the typed "pass --handoff" failure the
	// runtime seam already owns.
	external: ["@side-quest/browser-connect/cli"],
});

if (!build.success) {
	for (const log of build.logs) {
		console.error(log);
	}
	process.exit(1);
}

// Copy the shipped runbook catalog into dist so it travels with the packaged
// bin. Fail closed if the source is missing — a build that dropped the seed
// catalog would ship a `browser-use` whose `runbook list` is silently empty.
const shippedSourceStat = await stat(shippedRunbooksSource).catch(() => null);
if (shippedSourceStat === null || !shippedSourceStat.isDirectory()) {
	throw new Error(
		`Shipped runbook catalog missing at ${relative(skillRoot, shippedRunbooksSource)}; expected a directory to copy into dist.`,
	);
}
await cp(shippedRunbooksSource, shippedRunbooksDist, { recursive: true });

await verifyDist();

async function verifyDist(): Promise<void> {
	// The compiled entrypoints plus the copied shipped-runbook catalog directory.
	const SHIPPED_RUNBOOKS_DIRNAME = "runbooks";
	const distEntries = await readdir(distRoot);
	const unexpected = distEntries.filter(
		(entry) =>
			!expectedDistFiles.has(entry) && entry !== SHIPPED_RUNBOOKS_DIRNAME,
	);
	const missing = [...expectedDistFiles].filter(
		(entry) => !distEntries.includes(entry),
	);
	if (!distEntries.includes(SHIPPED_RUNBOOKS_DIRNAME)) {
		missing.push(SHIPPED_RUNBOOKS_DIRNAME);
	}

	if (missing.length > 0 || unexpected.length > 0) {
		throw new Error(
			`Unexpected browser-use dist payload. missing=${missing.join(",") || "none"} unexpected=${unexpected.join(",") || "none"}`,
		);
	}

	// Prove the copied catalog actually carries the shipped seed runbook, so a
	// packaged `runbook list` finds it rather than scanning an empty directory.
	const seedRunbook = join(
		shippedRunbooksDist,
		"oncore",
		"timesheet-snapshot-verify",
		"runbook.json",
	);
	const seedStat = await stat(seedRunbook).catch(() => null);
	if (seedStat === null || !seedStat.isFile()) {
		throw new Error(
			`Shipped seed runbook missing from dist at ${relative(skillRoot, seedRunbook)}.`,
		);
	}

	for (const entry of distEntries) {
		if (entry === SHIPPED_RUNBOOKS_DIRNAME) continue;
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
