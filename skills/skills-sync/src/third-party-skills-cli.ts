#!/usr/bin/env bun

import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { YAML } from "bun";

type Command = "check" | "lock" | "prune" | "restore";
type Scope = "all" | "global" | "project";

interface CliOptions {
	command?: Command;
	execute: boolean;
	json: boolean;
	repo: string;
	scope: Scope;
	scopeExplicit: boolean;
}

interface Diagnostic {
	code: string;
	message: string;
	path?: string;
	skill?: string;
	source?: string;
}

interface ProviderConfig {
	ref: string;
	skills: string[];
}

interface SourcesManifest {
	providers: Record<string, ProviderConfig>;
	version: 1;
}

interface LockEntry {
	computedHash: string;
	ref?: string;
	skillPath: string;
	source: string;
	sourceType: string;
}

interface SkillsLock {
	generatedFrom: string;
	skills: Record<string, LockEntry>;
	version: 1;
}

interface SourcePlan {
	ref: string;
	skills: string[];
	source: string;
}

interface ProjectionTarget {
	label: string;
	path: string;
}

interface PruneTarget extends ProjectionTarget {
	skill: string;
}

interface ResultEnvelope {
	changed_state: "lock" | "none" | "projections";
	command: Command;
	data: Record<string, unknown>;
	diagnostics: Diagnostic[];
	run_id: string;
	status: "error" | "ok";
}

const IMMUTABLE_COMMIT = /^[0-9a-f]{40}$/;
const CONTENT_HASH = /^[0-9a-f]{64}$/;
const LOCK_GENERATED_FROM =
	"skills-sources.yml via skills/skills-sync/src/third-party-skills-cli.ts";
const DEFAULT_PROCESS_TIMEOUT_MS = 120_000;

class ProcessTimeoutError extends Error {
	constructor(
		readonly executable: string,
		readonly timeoutMs: number,
	) {
		super(`${executable} exceeded ${timeoutMs}ms`);
		this.name = "ProcessTimeoutError";
	}
}

class LockRestoreError extends Error {
	constructor() {
		super("Canonical lock recovery failed");
		this.name = "LockRestoreError";
	}
}

function usage(): string {
	return `third-party-skills

Validate or restore lock-managed third-party skill projections.

Usage:
  third-party-skills check [--scope project|global|all] [--repo <path>] [--json]
  third-party-skills lock [--execute] [--repo <path>] [--json]
  third-party-skills prune [--scope project|global|all] [--execute] [--repo <path>] [--json]
  third-party-skills restore [--scope project|global|all] [--execute] [--repo <path>] [--json]

Behavior:
  check      Read-only manifest, lock, and projection integrity check.
  lock       Fetch exact commits and preview or generate skills-lock.json.
  prune      Preview removed selections. --execute requires an explicit --scope.
  restore    Preview by default. --execute performs project/global restore.

Exit codes:
  0 success
  2 invalid usage
  3 manifest or lock invalid
  4 runtime failure
  5 content integrity failure
`;
}

function parseArgs(args: string[]): CliOptions {
	const options: CliOptions = {
		execute: false,
		json: false,
		repo: process.cwd(),
		scope: "all",
		scopeExplicit: false,
	};

	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		process.stdout.write(usage());
		process.exit(0);
	}

	const command = args[0];
	if (command !== "check" && command !== "lock" && command !== "prune" && command !== "restore") {
		throw new Error(`Unknown command: ${command}`);
	}
	options.command = command;

	for (let index = 1; index < args.length; index += 1) {
		const argument = args[index];
		switch (argument) {
			case "--execute":
				options.execute = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--repo": {
				const value = args[index + 1];
				if (!value) throw new Error("--repo requires a path");
				options.repo = resolve(value);
				index += 1;
				break;
			}
			case "--scope": {
				const value = args[index + 1];
				if (value !== "all" && value !== "global" && value !== "project") {
					throw new Error("--scope requires project, global, or all");
				}
				options.scope = value;
				options.scopeExplicit = true;
				index += 1;
				break;
			}
			default:
				throw new Error(`Unknown argument: ${argument}`);
		}
	}

	if (options.command === "check" && options.execute) {
		throw new Error("--execute is valid only with lock, prune, or restore");
	}
	if (options.command === "prune" && options.execute && !options.scopeExplicit) {
		throw new Error("prune --execute requires an explicit --scope");
	}

	return options;
}

async function loadYaml(path: string): Promise<unknown> {
	return YAML.parse(await readFile(path, "utf8"));
}

async function loadJson(path: string): Promise<unknown> {
	return JSON.parse(await readFile(path, "utf8"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeSkillId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value === value.trim() &&
		value !== "." &&
		value !== ".." &&
		!value.includes("/") &&
		!value.includes("\\") &&
		!value.includes("\0")
	);
}

function validateManifest(value: unknown): {
	diagnostics: Diagnostic[];
	manifest?: SourcesManifest;
} {
	const diagnostics: Diagnostic[] = [];
	if (!isRecord(value) || value.version !== 1 || !isRecord(value.providers)) {
		return {
			diagnostics: [
				{
					code: "invalid_manifest",
					message: "skills-sources.yml must contain version: 1 and a providers map.",
				},
			],
		};
	}

	const providers: Record<string, ProviderConfig> = {};
	const selectedSkills = new Set<string>();
	for (const [source, rawProvider] of Object.entries(value.providers)) {
		if (!isRecord(rawProvider)) {
			diagnostics.push({
				code: "invalid_provider",
				message: "Provider configuration must be a mapping.",
				source,
			});
			continue;
		}

		const ref = rawProvider.ref;
		if (typeof ref !== "string" || !IMMUTABLE_COMMIT.test(ref)) {
			const skills = Array.isArray(rawProvider.skills)
				? rawProvider.skills.filter((skill): skill is string => typeof skill === "string")
				: [];
			diagnostics.push({
				code: "missing_immutable_ref",
				message: "Provider ref must be a full 40-character lowercase commit SHA.",
				skill: skills[0],
				source,
			});
			continue;
		}

		if (
			!Array.isArray(rawProvider.skills) ||
			rawProvider.skills.length === 0 ||
			rawProvider.skills.some((skill) => !isSafeSkillId(skill))
		) {
			diagnostics.push({
				code: "invalid_skill_allowlist",
				message: "Provider skills must be safe single-component ids in a non-empty list.",
				source,
			});
			continue;
		}

		const skills = [...new Set(rawProvider.skills as string[])].sort();
		if (skills.length !== rawProvider.skills.length) {
			diagnostics.push({
				code: "duplicate_provider_skill",
				message: "Provider allowlist contains duplicate skill ids.",
				source,
			});
			continue;
		}

		for (const skill of skills) {
			if (selectedSkills.has(skill)) {
				diagnostics.push({
					code: "duplicate_selected_skill",
					message: "A skill id may belong to only one provider.",
					skill,
					source,
				});
			}
			selectedSkills.add(skill);
		}
		providers[source] = { ref, skills };
	}

	if (diagnostics.length > 0) return { diagnostics };
	return { diagnostics, manifest: { providers, version: 1 } };
}

function parseLock(
	value: unknown,
	options: { allowLegacyGeneratedFrom?: boolean } = {},
): {
	diagnostics: Diagnostic[];
	lock?: SkillsLock;
} {
	if (
		!isRecord(value) ||
		value.version !== 1 ||
		(value.generatedFrom !== LOCK_GENERATED_FROM &&
			!(options.allowLegacyGeneratedFrom && value.generatedFrom === undefined)) ||
		!isRecord(value.skills)
	) {
		return {
			diagnostics: [
				{
					code: "invalid_lock",
					message:
						"skills-lock.json must name its generator and contain version 1 with a skills map.",
				},
			],
		};
	}

	const diagnostics: Diagnostic[] = [];
	const validatedEntries: Record<string, LockEntry> = {};
	for (const [skill, rawEntry] of Object.entries(value.skills)) {
		if (!isSafeSkillId(skill)) {
			diagnostics.push({
				code: "invalid_skill_id",
				message: "Lock skill id must be a safe single path component.",
				skill,
			});
			continue;
		}
		if (!isRecord(rawEntry)) {
			diagnostics.push({
				code: "invalid_lock_entry",
				message: "Lock entry must be a mapping.",
				skill,
			});
			continue;
		}

		if (typeof rawEntry.computedHash !== "string" || !CONTENT_HASH.test(rawEntry.computedHash)) {
			diagnostics.push({
				code: "invalid_content_hash",
				message: "Lock computedHash must be a lowercase SHA-256 value.",
				skill,
			});
		}
		if (
			typeof rawEntry.skillPath !== "string" ||
			!rawEntry.skillPath.endsWith("/SKILL.md") ||
			rawEntry.skillPath.split("/").includes("..")
		) {
			diagnostics.push({
				code: "invalid_skill_path",
				message: "Lock skillPath must be a safe path ending in /SKILL.md.",
				skill,
			});
		}

		if (
			typeof rawEntry.source === "string" &&
			typeof rawEntry.sourceType === "string" &&
			typeof rawEntry.skillPath === "string" &&
			typeof rawEntry.computedHash === "string"
		) {
			validatedEntries[skill] = {
				computedHash: rawEntry.computedHash,
				ref: typeof rawEntry.ref === "string" ? rawEntry.ref : undefined,
				skillPath: rawEntry.skillPath,
				source: rawEntry.source,
				sourceType: rawEntry.sourceType,
			};
		}
	}

	if (diagnostics.length > 0) return { diagnostics };
	return {
		diagnostics,
		lock: {
			generatedFrom: LOCK_GENERATED_FROM,
			skills: validatedEntries,
			version: 1,
		},
	};
}

function validateLock(value: unknown, manifest: SourcesManifest): {
	diagnostics: Diagnostic[];
	lock?: SkillsLock;
} {
	const parsed = parseLock(value);
	if (!parsed.lock) return parsed;

	const diagnostics: Diagnostic[] = [];
	const selected = new Map<string, { ref: string; source: string }>();
	for (const [source, provider] of Object.entries(manifest.providers)) {
		for (const skill of provider.skills) selected.set(skill, { ref: provider.ref, source });
	}

	const lockedIds = Object.keys(parsed.lock.skills).sort();
	const selectedIds = [...selected.keys()].sort();
	if (JSON.stringify(lockedIds) !== JSON.stringify(selectedIds)) {
		diagnostics.push({
			code: "lock_selection_mismatch",
			message: "skills-lock.json ids must exactly match skills-sources.yml allowlists.",
		});
	}

	for (const [skill, entry] of Object.entries(parsed.lock.skills)) {
		const expected = selected.get(skill);
		if (!expected) continue;
		if (entry.source !== expected.source) {
			diagnostics.push({
				code: "lock_source_mismatch",
				message: "Lock source does not match the provider allowlist.",
				skill,
				source: expected.source,
			});
		}
		if (entry.ref !== expected.ref) {
			diagnostics.push({
				code: "lock_ref_mismatch",
				message: "Lock ref does not match the provider commit.",
				skill,
				source: expected.source,
			});
		}
	}

	if (diagnostics.length > 0) return { diagnostics };
	return parsed;
}

async function computeSkillHash(skillDirectory: string): Promise<string> {
	const files: Array<{ content: Buffer; executableMode: number; path: string }> = [];

	async function collect(currentDirectory: string): Promise<void> {
		const entries = await readdir(currentDirectory, { withFileTypes: true });
		await Promise.all(
			entries.map(async (entry) => {
				if (entry.name === ".git" || entry.name === "node_modules") return;
				const entryPath = join(currentDirectory, entry.name);
				if (entry.isDirectory()) {
					await collect(entryPath);
				} else if (entry.isFile()) {
					const metadata = await lstat(entryPath);
					files.push({
						content: await readFile(entryPath),
						executableMode: metadata.mode & 0o111,
						path: relative(skillDirectory, entryPath).split("\\").join("/"),
					});
				}
			}),
		);
	}

	await collect(skillDirectory);
	files.sort((left, right) => left.path.localeCompare(right.path));
	const hash = createHash("sha256");
	hash.update("third-party-skill-tree-v2\0");
	for (const file of files) {
		const path = Buffer.from(file.path, "utf8");
		hash.update("file\0");
		hash.update(`${file.executableMode}\0${path.byteLength}\0`);
		hash.update(path);
		hash.update(`${file.content.byteLength}\0`);
		hash.update(file.content);
	}
	return hash.digest("hex");
}

async function runProcess(command: string[], cwd: string): Promise<string> {
	const configuredTimeout = Number(process.env.SKILLS_SYNC_PROCESS_TIMEOUT_MS);
	const timeoutMs =
		Number.isFinite(configuredTimeout) && configuredTimeout > 0
			? Math.min(configuredTimeout, 600_000)
			: DEFAULT_PROCESS_TIMEOUT_MS;
	const child = Bun.spawn(command, {
		cwd,
		env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
		stdout: "pipe",
		stderr: "pipe",
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		child.kill();
	}, timeoutMs);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	clearTimeout(timer);
	if (timedOut) throw new ProcessTimeoutError(command[0] ?? "process", timeoutMs);
	if (exitCode !== 0) {
		throw new Error(stderr.trim() || `${command[0]} exited ${exitCode}`);
	}
	return stdout.trim();
}

function sourceLocation(source: string): { sourceType: string; url: string } {
	if (/^[^./][^/]*\/[^/]+$/.test(source)) {
		return {
			sourceType: "github",
			url: `https://github.com/${source}.git`,
		};
	}
	return {
		sourceType: "git",
		url: resolve(source),
	};
}

async function checkoutSource(source: string, ref: string): Promise<string> {
	const checkout = await mkdtemp(join(tmpdir(), "skills-sync-source-"));
	const location = sourceLocation(source);
	try {
		await runProcess(["git", "init"], checkout);
		await runProcess(["git", "remote", "add", "origin", location.url], checkout);
		await runProcess(["git", "fetch", "--depth", "1", "origin", ref], checkout);
		await runProcess(["git", "checkout", "--detach", "FETCH_HEAD"], checkout);
		const resolvedRef = await runProcess(["git", "rev-parse", "HEAD"], checkout);
		if (resolvedRef !== ref) {
			throw new Error(`Fetched ${resolvedRef}, expected ${ref}`);
		}
		return checkout;
	} catch (error) {
		await rm(checkout, { recursive: true });
		throw error;
	}
}

async function discoverSkills(checkout: string): Promise<{
	diagnostics: Diagnostic[];
	paths: Map<string, string>;
}> {
	const diagnostics: Diagnostic[] = [];
	const paths = new Map<string, string>();

	async function scan(directory: string): Promise<void> {
		const entries = await readdir(directory, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name === ".git" || entry.name === "node_modules") continue;
			const entryPath = join(directory, entry.name);
			if (entry.isDirectory()) {
				await scan(entryPath);
				continue;
			}
			if (!entry.isFile() || entry.name !== "SKILL.md") continue;
			const content = await readFile(entryPath, "utf8");
			const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
			if (!frontmatterMatch) continue;
			let parsed: unknown;
			try {
				parsed = YAML.parse(frontmatterMatch[1] ?? "");
			} catch {
				continue;
			}
			if (!isRecord(parsed) || typeof parsed.name !== "string") continue;
			const existing = paths.get(parsed.name);
			if (existing) {
				diagnostics.push({
					code: "duplicate_discovered_skill",
					message: "Provider contains two skills with the same frontmatter name.",
					path: relative(checkout, entryPath),
					skill: parsed.name,
				});
				continue;
			}
			paths.set(parsed.name, relative(checkout, entryPath).split("\\").join("/"));
		}
	}

	await scan(checkout);
	return { diagnostics, paths };
}

async function generateLock(manifest: SourcesManifest): Promise<{
	diagnostics: Diagnostic[];
	lock?: SkillsLock;
}> {
	const diagnostics: Diagnostic[] = [];
	const skills: Record<string, LockEntry> = {};

	for (const [source, provider] of Object.entries(manifest.providers)) {
		let checkout: string | undefined;
		try {
			checkout = await checkoutSource(source, provider.ref);
			const discovery = await discoverSkills(checkout);
			diagnostics.push(...discovery.diagnostics);
			for (const skill of provider.skills) {
				const skillPath = discovery.paths.get(skill);
				if (!skillPath) {
					diagnostics.push({
						code: "selected_skill_missing",
						message: "Selected skill is absent from the exact provider commit.",
						skill,
						source,
					});
					continue;
				}
				skills[skill] = {
					computedHash: await computeSkillHash(join(checkout, dirname(skillPath))),
					ref: provider.ref,
					skillPath,
					source,
					sourceType: sourceLocation(source).sourceType,
				};
			}
		} finally {
			if (checkout) await rm(checkout, { recursive: true });
		}
	}

	if (diagnostics.length > 0) return { diagnostics };
	const sortedSkills = Object.fromEntries(
		Object.entries(skills).sort(([left], [right]) => left.localeCompare(right)),
	);
	return {
		diagnostics,
		lock: {
			generatedFrom: LOCK_GENERATED_FROM,
			skills: sortedSkills,
			version: 1,
		},
	};
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	await rename(temporaryPath, path);
}

async function writeTextAtomic(path: string, value: string): Promise<void> {
	const temporaryPath = `${path}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, value, { mode: 0o600 });
	await rename(temporaryPath, path);
}

async function checkProjection(
	baseDirectory: string,
	lock: SkillsLock,
	projection: string,
): Promise<Diagnostic[]> {
	const diagnostics: Diagnostic[] = [];
	for (const [skill, entry] of Object.entries(lock.skills)) {
		const skillDirectory = join(baseDirectory, skill);
		try {
			const actualHash = await computeSkillHash(skillDirectory);
			if (actualHash !== entry.computedHash) {
				diagnostics.push({
					code: "hash_mismatch",
					message: `${projection} projection differs from the reviewed content hash.`,
					path: skillDirectory,
					skill,
				});
			}
		} catch {
			diagnostics.push({
				code: "missing_projection",
				message: `${projection} projection is missing or unreadable.`,
				path: skillDirectory,
				skill,
			});
		}
	}
	return diagnostics;
}

async function checkCheckout(
	checkout: string,
	lock: SkillsLock,
	plan: SourcePlan,
): Promise<Diagnostic[]> {
	const diagnostics: Diagnostic[] = [];
	for (const skill of plan.skills) {
		const entry = lock.skills[skill];
		if (!entry) continue;
		const actualHash = await computeSkillHash(join(checkout, dirname(entry.skillPath)));
		if (actualHash !== entry.computedHash) {
			diagnostics.push({
				code: "source_hash_mismatch",
				message: "Exact provider commit does not match the generated lock hash.",
				path: entry.skillPath,
				skill,
				source: plan.source,
			});
		}
	}
	return diagnostics;
}

async function installCheckout(
	checkout: string,
	plan: SourcePlan,
	repo: string,
	global: boolean,
): Promise<void> {
	const command = [
		"bunx",
		"skills@1.5.14",
		"add",
		checkout,
		"--copy",
		"--skill",
		...plan.skills,
		"--agent",
		"claude-code",
		"codex",
		"-y",
	];
	if (global) command.splice(4, 0, "--global");
	await runProcess(command, repo);
}

async function executeRestore(
	options: CliOptions,
	manifest: SourcesManifest,
	lock: SkillsLock,
	lockPath: string,
): Promise<Diagnostic[]> {
	const checkedSources: Array<{ checkout: string; plan: SourcePlan }> = [];
	try {
		for (const plan of buildSourcePlans(manifest)) {
			const checkout = await checkoutSource(plan.source, plan.ref);
			checkedSources.push({ checkout, plan });
			const sourceDiagnostics = await checkCheckout(checkout, lock, plan);
			if (sourceDiagnostics.length > 0) return sourceDiagnostics;
		}

		const originalLock = await readFile(lockPath, "utf8");
		let installError: unknown;
		try {
			for (const source of checkedSources) {
				if (options.scope === "all" || options.scope === "project") {
					await installCheckout(source.checkout, source.plan, options.repo, false);
				}
				if (options.scope === "all" || options.scope === "global") {
					await installCheckout(source.checkout, source.plan, options.repo, true);
				}
			}
		} catch (error) {
			installError = error;
		}
		try {
			await writeTextAtomic(lockPath, originalLock);
			if ((await readFile(lockPath, "utf8")) !== originalLock) {
				throw new Error("Recovered lock bytes differ from the original.");
			}
		} catch {
			throw new LockRestoreError();
		}
		if (installError) throw installError;

		const projections = projectionTargets(options);
		return (
			await Promise.all(
				projections.map((projection) =>
					checkProjection(projection.path, lock, projection.label),
				),
			)
		).flat();
	} finally {
		await Promise.all(
			checkedSources.map((source) => rm(source.checkout, { recursive: true })),
		);
	}
}

function buildSourcePlans(manifest: SourcesManifest): SourcePlan[] {
	return Object.entries(manifest.providers)
		.map(([source, provider]) => ({
			ref: provider.ref,
			skills: [...provider.skills].sort(),
			source,
		}))
		.sort((left, right) => left.source.localeCompare(right.source));
}

function projectionTargets(options: CliOptions): ProjectionTarget[] {
	const targets: ProjectionTarget[] = [];
	if (options.scope === "all" || options.scope === "project") {
		targets.push({
			label: "project",
			path: join(options.repo, ".agents", "skills"),
		});
	}
	if (options.scope === "all" || options.scope === "global") {
		targets.push(
			{
				label: "global",
				path: join(homedir(), ".agents", "skills"),
			},
			{
				label: "claude-code",
				path: join(homedir(), ".claude", "skills"),
			},
		);
	}
	return targets;
}

function buildPrunePlan(
	options: CliOptions,
	manifest: SourcesManifest,
	lock: SkillsLock,
): { skills: string[]; targets: PruneTarget[] } {
	const selectedSkills = new Set(
		Object.values(manifest.providers).flatMap((provider) => provider.skills),
	);
	const skills = Object.keys(lock.skills)
		.filter((skill) => !selectedSkills.has(skill))
		.sort();
	const targets = projectionTargets(options).flatMap((projection) =>
		skills.map((skill) => {
			const root = resolve(projection.path);
			const path = resolve(root, skill);
			if (dirname(path) !== root) {
				throw new Error(`Unsafe prune target for skill: ${skill}`);
			}
			return {
				label: projection.label,
				path,
				skill,
			};
		}),
	);
	return { skills, targets };
}

async function findPendingPrune(
	options: CliOptions,
	manifest: SourcesManifest,
	lock: SkillsLock,
): Promise<Diagnostic[]> {
	const selectedSkills = new Set(
		Object.values(manifest.providers).flatMap((provider) => provider.skills),
	);
	const removedSkills = Object.keys(lock.skills).filter((skill) => !selectedSkills.has(skill));
	const diagnostics: Diagnostic[] = [];
	for (const projection of projectionTargets({ ...options, scope: "all" })) {
		const root = resolve(projection.path);
		for (const skill of removedSkills) {
			const path = resolve(root, skill);
			if (dirname(path) !== root) {
				diagnostics.push({
					code: "invalid_skill_id",
					message: "Lock skill id resolves outside a managed projection root.",
					skill,
				});
				continue;
			}
			try {
				await lstat(path);
				diagnostics.push({
					code: "pending_prune",
					message: "Remove the deselected projection before regenerating the lock.",
					path,
					skill,
				});
			} catch (error) {
				if (isRecord(error) && error.code === "ENOENT") continue;
				diagnostics.push({
					code: "pending_prune_unreadable",
					message: "Could not prove that a deselected projection is absent.",
					path,
					skill,
				});
			}
		}
	}
	return diagnostics;
}

async function executePrune(
	targets: PruneTarget[],
	lock: SkillsLock,
): Promise<{ diagnostics: Diagnostic[]; exitCode: 4 | 5; removedTargets: number }> {
	const diagnostics: Diagnostic[] = [];
	const existingTargets: PruneTarget[] = [];

	for (const target of targets) {
		try {
			await lstat(target.path);
		} catch (error) {
			if (isRecord(error) && error.code === "ENOENT") continue;
			diagnostics.push({
				code: "prune_target_unreadable",
				message: "Managed projection target could not be inspected.",
				path: target.path,
				skill: target.skill,
			});
			continue;
		}

		let actualHash: string;
		try {
			actualHash = await computeSkillHash(target.path);
		} catch {
			diagnostics.push({
				code: "prune_target_unreadable",
				message: "Managed projection target could not be hashed.",
				path: target.path,
				skill: target.skill,
			});
			continue;
		}
		if (actualHash !== lock.skills[target.skill]?.computedHash) {
			diagnostics.push({
				code: "prune_hash_mismatch",
				message: "Projection differs from the previous lock; refusing removal.",
				path: target.path,
				skill: target.skill,
			});
			continue;
		}
		existingTargets.push(target);
	}

	if (diagnostics.length > 0) return { diagnostics, exitCode: 5, removedTargets: 0 };
	let removedTargets = 0;
	for (const target of existingTargets) {
		let actualHash: string;
		try {
			actualHash = await computeSkillHash(target.path);
		} catch {
			diagnostics.push({
				code: "prune_target_unreadable",
				message: "Projection changed or became unreadable before removal.",
				path: target.path,
				skill: target.skill,
			});
			break;
		}
		if (actualHash !== lock.skills[target.skill]?.computedHash) {
			diagnostics.push({
				code: "prune_hash_changed",
				message: "Projection changed after preflight; refusing removal.",
				path: target.path,
				skill: target.skill,
			});
			break;
		}
		try {
			await rm(target.path, { recursive: true });
			removedTargets += 1;
		} catch {
			diagnostics.push({
				code: "prune_remove_failed",
				message: "Hash-matched projection could not be removed.",
				path: target.path,
				skill: target.skill,
			});
			return { diagnostics, exitCode: 4, removedTargets };
		}
	}
	return { diagnostics, exitCode: 5, removedTargets };
}

function emit(options: CliOptions, envelope: ResultEnvelope, exitCode: number): never {
	if (options.json) {
		process.stdout.write(`${JSON.stringify(envelope)}\n`);
	} else if (envelope.status === "ok") {
		process.stdout.write(
			`${envelope.command}: ok (${String(envelope.data.entries ?? 0)} skills)\n`,
		);
	} else {
		for (const diagnostic of envelope.diagnostics) {
			process.stderr.write(`${diagnostic.code}: ${diagnostic.message}\n`);
		}
	}
	process.exit(exitCode);
}

async function main(): Promise<never> {
	let options: CliOptions;
	try {
		options = parseArgs(Bun.argv.slice(2));
	} catch (error) {
		process.stderr.write(`${error instanceof Error ? error.message : "Invalid arguments"}\n\n${usage()}`);
		process.exit(2);
	}

	const command = options.command as Command;
	const runId = randomUUID();
	const manifestPath = join(options.repo, "skills-sources.yml");
	const lockPath = join(options.repo, "skills-lock.json");

	let rawManifest: unknown;
	try {
		rawManifest = await loadYaml(manifestPath);
	} catch {
		emit(
			options,
			{
				changed_state: "none",
				command,
				data: { manifest_path: manifestPath },
				diagnostics: [
					{
						code: "manifest_unreadable",
						message: "skills-sources.yml is missing, unreadable, or invalid YAML.",
						path: manifestPath,
					},
				],
				run_id: runId,
				status: "error",
			},
			3,
		);
	}

	const manifestResult = validateManifest(rawManifest);
	if (!manifestResult.manifest) {
		emit(
			options,
			{
				changed_state: "none",
				command,
				data: { manifest_path: manifestPath },
				diagnostics: manifestResult.diagnostics,
				run_id: runId,
				status: "error",
			},
			3,
		);
	}
	const manifest = manifestResult.manifest;

	if (command === "lock") {
		if (options.execute && (await Bun.file(lockPath).exists())) {
			let existingLockValue: unknown;
			try {
				existingLockValue = await loadJson(lockPath);
			} catch {
				emit(
					options,
					{
						changed_state: "none",
						command,
						data: { lock_path: lockPath },
						diagnostics: [
							{
								code: "lock_unreadable",
								message: "Existing skills-lock.json is unreadable or invalid JSON.",
								path: lockPath,
							},
						],
						run_id: runId,
						status: "error",
					},
					3,
				);
			}
			const existingLockResult = parseLock(existingLockValue, {
				allowLegacyGeneratedFrom: true,
			});
			if (!existingLockResult.lock) {
				emit(
					options,
					{
						changed_state: "none",
						command,
						data: { lock_path: lockPath },
						diagnostics: existingLockResult.diagnostics,
						run_id: runId,
						status: "error",
					},
					3,
				);
			}
			const pendingPrune = await findPendingPrune(options, manifest, existingLockResult.lock);
			if (pendingPrune.length > 0) {
				emit(
					options,
					{
						changed_state: "none",
						command,
						data: { execute: true, lock_path: lockPath },
						diagnostics: pendingPrune,
						run_id: runId,
						status: "error",
					},
					3,
				);
			}
		}
		let generated: Awaited<ReturnType<typeof generateLock>>;
		try {
			generated = await generateLock(manifest);
		} catch (error) {
			const diagnostic =
				error instanceof ProcessTimeoutError
					? {
							code: "process_timeout",
							message: `External process exceeded ${error.timeoutMs}ms while generating the lock.`,
						}
					: {
							code: "source_fetch_failed",
							message: "Could not fetch and verify an exact provider commit.",
						};
			emit(
				options,
				{
					changed_state: "none",
					command,
					data: { execute: options.execute, sources: buildSourcePlans(manifest) },
					diagnostics: [diagnostic],
					run_id: runId,
					status: "error",
				},
				4,
			);
		}
		if (!generated.lock) {
			emit(
				options,
				{
					changed_state: "none",
					command,
					data: { execute: options.execute, sources: buildSourcePlans(manifest) },
					diagnostics: generated.diagnostics,
					run_id: runId,
					status: "error",
				},
				3,
			);
		}
		if (options.execute) await writeJsonAtomic(lockPath, generated.lock);
		emit(
			options,
			{
				changed_state: options.execute ? "lock" : "none",
				command,
				data: {
					entries: Object.keys(generated.lock.skills).length,
					execute: options.execute,
					sources: buildSourcePlans(manifest),
				},
				diagnostics: [],
				run_id: runId,
				status: "ok",
			},
			0,
		);
	}

	let rawLock: unknown;
	try {
		rawLock = await loadJson(lockPath);
	} catch {
		emit(
			options,
			{
				changed_state: "none",
				command,
				data: { lock_path: lockPath },
				diagnostics: [
					{
						code: "lock_unreadable",
						message: "skills-lock.json is missing, unreadable, or invalid JSON.",
						path: lockPath,
					},
				],
				run_id: runId,
				status: "error",
			},
			3,
		);
	}

	if (command === "prune") {
		const previousLockResult = parseLock(rawLock);
		if (!previousLockResult.lock) {
			emit(
				options,
				{
					changed_state: "none",
					command,
					data: { lock_path: lockPath },
					diagnostics: previousLockResult.diagnostics,
					run_id: runId,
					status: "error",
				},
				3,
			);
		}
		const { skills, targets } = buildPrunePlan(options, manifest, previousLockResult.lock);
		if (options.execute) {
			let pruneResult: Awaited<ReturnType<typeof executePrune>>;
			try {
				pruneResult = await executePrune(targets, previousLockResult.lock);
			} catch {
				emit(
					options,
					{
						changed_state: "projections",
						command,
						data: { execute: true, scope: options.scope, skills, targets },
						diagnostics: [
							{
								code: "prune_failed",
								message: "Prune failed; projection state may be partial.",
							},
						],
						run_id: runId,
						status: "error",
					},
					4,
				);
			}
			if (pruneResult.diagnostics.length > 0) {
				emit(
					options,
					{
						changed_state:
							pruneResult.removedTargets > 0 ? "projections" : "none",
						command,
						data: {
							execute: true,
							removed_targets: pruneResult.removedTargets,
							scope: options.scope,
							skills,
							targets,
						},
						diagnostics: pruneResult.diagnostics,
						run_id: runId,
						status: "error",
					},
					pruneResult.exitCode,
				);
			}
			emit(
				options,
				{
					changed_state: pruneResult.removedTargets > 0 ? "projections" : "none",
					command,
					data: {
						entries: skills.length,
						execute: true,
						removed_targets: pruneResult.removedTargets,
						scope: options.scope,
						skills,
						targets,
					},
					diagnostics: [],
					run_id: runId,
					status: "ok",
				},
				0,
			);
		}
		emit(
			options,
			{
				changed_state: "none",
				command,
				data: {
					entries: skills.length,
					execute: false,
					scope: options.scope,
					skills,
					targets,
				},
				diagnostics: [],
				run_id: runId,
				status: "ok",
			},
			0,
		);
	}

	const lockResult = validateLock(rawLock, manifest);
	if (!lockResult.lock) {
		emit(
			options,
			{
				changed_state: "none",
				command,
				data: { lock_path: lockPath },
				diagnostics: lockResult.diagnostics,
				run_id: runId,
				status: "error",
			},
			3,
		);
	}
	const lock = lockResult.lock;

	if (command === "restore") {
		if (options.execute) {
			let restoreDiagnostics: Diagnostic[];
			try {
				restoreDiagnostics = await executeRestore(options, manifest, lock, lockPath);
			} catch (error) {
				const diagnostic =
					error instanceof LockRestoreError
						? {
								code: "lock_restore_failed",
								message:
									"Restore failed and canonical lock recovery failed; lock state is unknown.",
							}
						: error instanceof ProcessTimeoutError
							? {
									code: "process_timeout",
									message: `Restore process exceeded ${error.timeoutMs}ms; the canonical lock was preserved. Projection state may be partial.`,
								}
							: {
									code: "restore_failed",
									message:
										"Restore failed; the canonical lock was preserved. Projection state may be partial.",
								};
				emit(
					options,
					{
						changed_state: "projections",
						command,
						data: {
							execute: true,
							scope: options.scope,
							sources: buildSourcePlans(manifest),
						},
						diagnostics: [diagnostic],
						run_id: runId,
						status: "error",
					},
					4,
				);
			}
			if (restoreDiagnostics.length > 0) {
				emit(
					options,
					{
						changed_state: "projections",
						command,
						data: {
							execute: true,
							scope: options.scope,
							sources: buildSourcePlans(manifest),
						},
						diagnostics: restoreDiagnostics,
						run_id: runId,
						status: "error",
					},
					5,
				);
			}
			emit(
				options,
				{
					changed_state: "projections",
					command,
					data: {
						entries: Object.keys(lock.skills).length,
						execute: true,
						scope: options.scope,
						sources: buildSourcePlans(manifest),
					},
					diagnostics: [],
					run_id: runId,
					status: "ok",
				},
				0,
			);
		}
		emit(
			options,
			{
				changed_state: "none",
				command,
				data: {
					entries: Object.keys(lock.skills).length,
					execute: false,
					scope: options.scope,
					sources: buildSourcePlans(manifest),
					targets: projectionTargets(options),
				},
				diagnostics: [],
				run_id: runId,
				status: "ok",
			},
			0,
		);
	}

	const projections = projectionTargets(options);

	const projectionDiagnostics = (
		await Promise.all(
			projections.map((projection) =>
				checkProjection(projection.path, lock, projection.label),
			),
		)
	).flat();
	emit(
		options,
		{
			changed_state: "none",
			command,
			data: {
				entries: Object.keys(lock.skills).length,
				projections_checked: projections.length * Object.keys(lock.skills).length,
				sources: Object.keys(manifest.providers).length,
			},
			diagnostics: projectionDiagnostics,
			run_id: runId,
			status: projectionDiagnostics.length > 0 ? "error" : "ok",
		},
		projectionDiagnostics.length > 0 ? 5 : 0,
	);
}

await main();
