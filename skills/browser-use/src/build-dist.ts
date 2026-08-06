#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const skillRoot = join(import.meta.dir, "..");
const distRoot = join(skillRoot, "dist");
const nativeAuthRoot = join(
	skillRoot,
	"..",
	"..",
	"runtime",
	"browser-use-environment-auth",
);
const nativeBinDist = join(distRoot, "bin");
const nativeSupervisorName = "browser-use-op-supervisor";
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

await verifyPrivatePayloadExclusion();

const nativeBuild = Bun.spawn(
	["swift", "build", "-c", "release", "--disable-sandbox"],
	{ cwd: nativeAuthRoot, stdout: "inherit", stderr: "inherit" },
);
if ((await nativeBuild.exited) !== 0) {
	throw new Error("Native environment-token proof build failed.");
}
await mkdir(nativeBinDist, { recursive: true });
await cp(
	join(nativeAuthRoot, ".build", "release", nativeSupervisorName),
	join(nativeBinDist, nativeSupervisorName),
);

await verifyDist();

async function collectFiles(root: string): Promise<readonly string[]> {
	const files: string[] = [];
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) files.push(...(await collectFiles(path)));
		else if (entry.isFile()) files.push(path);
	}
	return files;
}

async function verifyPrivatePayloadExclusion(): Promise<void> {
	const privateFiles = [
		...(await collectFiles(join(skillRoot, "runbooks"))),
		...(await collectFiles(join(skillRoot, "actions"))),
	];
	const payloadFiles = await collectFiles(distRoot);
	for (const privateFile of privateFiles) {
		const privateBytes = await readFile(privateFile);
		const digestBytes = Buffer.from(createHash("sha256").update(privateBytes).digest("hex"));
		for (const payloadFile of payloadFiles) {
			const payload = await readFile(payloadFile);
			if ((privateBytes.length > 0 && payload.indexOf(privateBytes) !== -1) || payload.indexOf(digestBytes) !== -1) {
				throw new Error("Browser Use payload embeds private catalog bytes or a known private digest.");
			}
		}
	}
}

async function verifyDist(): Promise<void> {
	const NATIVE_BIN_DIRNAME = "bin";
	const distEntries = await readdir(distRoot);
	const unexpected = distEntries.filter(
		(entry) =>
			!expectedDistFiles.has(entry) &&
			entry !== NATIVE_BIN_DIRNAME,
	);
	const missing = [...expectedDistFiles].filter(
		(entry) => !distEntries.includes(entry),
	);
	if (!distEntries.includes(NATIVE_BIN_DIRNAME)) {
		missing.push(NATIVE_BIN_DIRNAME);
	}

	if (missing.length > 0 || unexpected.length > 0) {
		throw new Error(
			`Unexpected browser-use dist payload. missing=${missing.join(",") || "none"} unexpected=${unexpected.join(",") || "none"}`,
		);
	}

	const nativeSupervisor = join(nativeBinDist, nativeSupervisorName);
	const nativeSupervisorStat = await stat(nativeSupervisor).catch(() => null);
	if (
		nativeSupervisorStat === null ||
		!nativeSupervisorStat.isFile() ||
		(nativeSupervisorStat.mode & 0o111) === 0
	) {
		throw new Error("Native environment-token proof executable is missing.");
	}

	for (const entry of distEntries) {
		if (
			entry === NATIVE_BIN_DIRNAME
		) {
			continue;
		}
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
