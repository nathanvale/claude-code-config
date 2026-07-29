#!/usr/bin/env bun

import { createHash } from "node:crypto";
import {
	chmod,
	cp,
	lstat,
	mkdir,
	readdir,
	readFile,
	rm,
} from "node:fs/promises";
import { basename, join, relative } from "node:path";
import {
	type BrowserUseCatalogDigestPort,
	shippedCatalogDigestFromFiles,
	shippedCatalogFiles,
} from "./browser-use-catalog-digest";
import {
	parseRunbookRecord,
	validateRunbook,
} from "./browser-use-runbook-model";

const defaultSkillRoot = join(import.meta.dir, "..");
const NATIVE_EXECUTABLES = [
	"browser-use-token-custody",
	"browser-use-op-supervisor",
] as const;
const ownedNativeBinaryRoot = join(
	defaultSkillRoot,
	"..",
	"..",
	"runtime",
	"browser-use-environment-auth",
	".build",
	"release",
);
const SHIPPED_RUNBOOK_PATH =
	/^([a-z0-9][a-z0-9-]{0,63})\/([a-z0-9][a-z0-9-]{0,63})\/runbook\.json$/;

const nodeCatalogPort: BrowserUseCatalogDigestPort = {
	async lstat(path) {
		try {
			const stats = await lstat(path);
			return {
				kind: stats.isFile()
					? "file"
					: stats.isDirectory()
						? "directory"
						: stats.isSymbolicLink()
							? "symlink"
							: "other",
			};
		} catch (error) {
			const code = (error as { code?: string }).code;
			if (code === "ENOENT" || code === "ENOTDIR") return undefined;
			throw error;
		}
	},
	async readDirectory(path) {
		return await readdir(path);
	},
	async hashFile(path) {
		return createHash("sha256").update(await readFile(path)).digest("hex");
	},
};

/**
 * Result of validating one complete shipped Browser Runbook catalog.
 */
export type ShippedRunbookCatalogValidation = {
	/** Deterministic digest over every shipped file path and exact byte hash. */
	digest: string;
	/** Number of validated runbooks in the catalog. */
	runbookCount: number;
	/** Sorted catalog-relative runbook paths bound by the digest. */
	relativePaths: readonly string[];
};

/**
 * Validate every file in a shipped catalog against the Browser Runbook model.
 *
 * The catalog is closed: each regular file must occupy the exact
 * `<service>/<flow>/runbook.json` path, its declared ids must match that path,
 * and the complete parsed record must pass v2 model validation.
 *
 * @param catalogRoot - Filesystem root containing shipped runbooks
 * @returns Validated count, sorted paths, and deterministic catalog digest
 * @throws When the root is empty, contains a non-runbook entry, or any runbook
 * fails parsing, model validation, or path identity
 *
 * @example
 * ```typescript
 * const proof = await validateShippedRunbookCatalog("./runbooks");
 * ```
 */
export async function validateShippedRunbookCatalog(
	catalogRoot: string,
): Promise<ShippedRunbookCatalogValidation> {
	const files = await shippedCatalogFiles(catalogRoot, nodeCatalogPort);
	if (files.length === 0) {
		throw new Error("Shipped runbook catalog is empty.");
	}

	for (const { relativePath } of files) {
		const pathMatch = SHIPPED_RUNBOOK_PATH.exec(relativePath);
		if (pathMatch === null) {
			throw new Error(
				`Unexpected shipped catalog file ${relativePath}; expected <service>/<flow>/runbook.json.`,
			);
		}
		const [, serviceId, flowId] = pathMatch;
		let parsed: unknown;
		try {
			parsed = JSON.parse(
				await readFile(
					join(catalogRoot, ...relativePath.split("/")),
					"utf8",
				),
			);
		} catch {
			throw new Error(
				`Invalid shipped runbook ${relativePath}: runbook_record_corrupt.`,
			);
		}
		const shaped = parseRunbookRecord(parsed);
		if (!shaped.ok) {
			throw new Error(
				`Invalid shipped runbook ${relativePath}: ${shaped.issue.code}.`,
			);
		}
		const issues = validateRunbook(shaped.runbook);
		if (issues.length > 0) {
			throw new Error(
				`Invalid shipped runbook ${relativePath}: ${issues
					.map(({ code }) => code)
					.join(",")}.`,
			);
		}
		if (
			shaped.runbook.service_id !== serviceId ||
			shaped.runbook.flow_id !== flowId
		) {
			throw new Error(
				`Invalid shipped runbook ${relativePath}: declared service_id/flow_id must match its catalog path.`,
			);
		}
	}

	return {
		digest: shippedCatalogDigestFromFiles(files),
		runbookCount: files.length,
		relativePaths: files.map(({ relativePath }) => relativePath),
	};
}

/**
 * Optional roots and logger for the Browser Use dist build.
 */
export type BrowserUseDistBuildOptions = {
	/** Source package root. @defaultValue the parent of this source directory */
	skillRoot?: string;
	/** Output directory. @defaultValue `<skillRoot>/dist` */
	distRoot?: string;
	/** Build receipt logger. @defaultValue `console.log` */
	log?: (message: string) => void;
};

/** Prove one owned release artifact is the expected linker-signed Mach-O. */
export async function validateBrowserUseNativeExecutable(
	path: string,
	expectedIdentifier: string,
): Promise<void> {
	const stats = await lstat(path);
	if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o111) === 0) {
		throw new Error(
			`Native Browser Use executable is not a regular executable file: ${path}`,
		);
	}
	const bytes = await readFile(path);
	const magic = bytes.subarray(0, 4).toString("hex");
	if (!["cffaedfe", "cafebabe", "bebafeca"].includes(magic)) {
		throw new Error(`Native Browser Use executable is not Mach-O: ${path}`);
	}
	const inspection = Bun.spawn(
		["/usr/bin/codesign", "-d", "--verbose=4", path],
		{ env: {}, stdout: "pipe", stderr: "pipe" },
	);
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(inspection.stdout).text(),
		new Response(inspection.stderr).text(),
		inspection.exited,
	]);
	const receipt = `${stdout}\n${stderr}`;
	if (
		exitCode !== 0 ||
		!receipt.includes(`Identifier=${expectedIdentifier}`) ||
		!receipt.includes("Signature=adhoc")
	) {
		throw new Error(
			`Native Browser Use executable identity is invalid: ${path}`,
		);
	}
}

/**
 * Build and prove the complete Browser Use package payload.
 *
 * Validates the source catalog before copying it, rebuilds the executable,
 * validates the copied dist catalog, and requires source/dist catalog digests
 * to match exactly.
 *
 * @param options - Optional source root, output root, and receipt logger
 * @returns Dist root plus the shipped catalog closure proof
 * @throws When bundling or any package-closure check fails
 *
 * @example
 * ```typescript
 * const proof = await buildBrowserUseDist({ distRoot: "/tmp/package/dist" });
 * ```
 */
export async function buildBrowserUseDist(
	options: BrowserUseDistBuildOptions = {},
): Promise<ShippedRunbookCatalogValidation & { distRoot: string }> {
	const skillRoot = options.skillRoot ?? defaultSkillRoot;
	const distRoot = options.distRoot ?? join(skillRoot, "dist");
	const nativeBinaryRoot = ownedNativeBinaryRoot;
	const log = options.log ?? console.log;
	const shippedRunbooksSource = join(skillRoot, "runbooks");
	const shippedRunbooksDist = join(distRoot, "runbooks");
	const nativeDist = join(distRoot, "bin");
	const entrypoints = ["browser-use.ts"].map((entrypoint) =>
		join(skillRoot, "src", entrypoint),
	);
	const expectedDistFiles = new Set(
		entrypoints.map(
			(entrypoint) => `${basename(entrypoint, ".ts")}.js`,
		),
	);

	for (const executable of NATIVE_EXECUTABLES) {
		const source = join(nativeBinaryRoot, executable);
		await validateBrowserUseNativeExecutable(source, executable);
	}

	const sourceCatalog = await validateShippedRunbookCatalog(
		shippedRunbooksSource,
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
		// Keep the private workspace package outside the public bundle. An
		// installation without it degrades through the typed handoff route.
		external: ["@side-quest/browser-connect/cli"],
	});

	if (!build.success) {
		throw new Error(
			`Browser Use dist bundle failed:\n${build.logs.map(String).join("\n")}`,
		);
	}

	await cp(shippedRunbooksSource, shippedRunbooksDist, {
		recursive: true,
	});
	await mkdir(nativeDist, { recursive: false });
	for (const executable of NATIVE_EXECUTABLES) {
		const destination = join(nativeDist, executable);
		await cp(join(nativeBinaryRoot, executable), destination);
		await chmod(destination, 0o755);
	}
	const distCatalog = await validateShippedRunbookCatalog(
		shippedRunbooksDist,
	);
	if (distCatalog.digest !== sourceCatalog.digest) {
		throw new Error(
			`Shipped runbook catalog digest changed during dist copy. source=${sourceCatalog.digest} dist=${distCatalog.digest}`,
		);
	}

	const distEntries = await readdir(distRoot);
	const unexpected = distEntries.filter(
		(entry) =>
			!expectedDistFiles.has(entry) &&
			entry !== "runbooks" &&
			entry !== "bin",
	);
	const missing = [...expectedDistFiles].filter(
		(entry) => !distEntries.includes(entry),
	);
	if (!distEntries.includes("runbooks")) missing.push("runbooks");
	if (!distEntries.includes("bin")) missing.push("bin");
	if (missing.length > 0 || unexpected.length > 0) {
		throw new Error(
			`Unexpected browser-use dist payload. missing=${missing.join(",") || "none"} unexpected=${unexpected.join(",") || "none"}`,
		);
	}

	for (const entry of distEntries) {
		if (entry === "runbooks" || entry === "bin") continue;
		const distPath = join(distRoot, entry);
		const stats = await lstat(distPath);
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
			throw new Error(
				`${entry} includes source-only test, fixture, or workspace markers.`,
			);
		}
		await chmod(distPath, 0o755);
	}
	const nativeEntries = await readdir(nativeDist);
	if (
		nativeEntries.length !== NATIVE_EXECUTABLES.length ||
		NATIVE_EXECUTABLES.some((entry) => !nativeEntries.includes(entry))
	) {
		throw new Error(
			`Unexpected native Browser Use payload: ${nativeEntries.sort().join(",")}`,
		);
	}
	for (const executable of nativeEntries) {
		await validateBrowserUseNativeExecutable(
			join(nativeDist, executable),
			executable,
		);
	}

	log(
		`Built browser-use dist: ${[...expectedDistFiles]
			.map((entry) => relative(skillRoot, join(distRoot, entry)))
			.join(", ")} native=${NATIVE_EXECUTABLES.join(",")} runbooks=${distCatalog.runbookCount} catalog_sha256=${distCatalog.digest}`,
	);
	return { ...distCatalog, distRoot };
}

if (import.meta.main) {
	try {
		await buildBrowserUseDist();
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	}
}
