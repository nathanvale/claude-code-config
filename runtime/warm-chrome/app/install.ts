#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import {
	chmod,
	cp,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readFile,
	readdir,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const APP_IDENTIFIER = "com.side-quest.agent-chrome.launcher";
const EVERYDAY_APP_IDENTIFIER = "com.side-quest.everyday-chrome.launcher";
const HELPER_IDENTIFIER = "com.side-quest.agent-chrome.warm-chrome";
const AVATAR_HELPER_IDENTIFIER = "com.side-quest.agent-chrome.profile-avatar";
const LAUNCH_SERVICES_HELPER_IDENTIFIER =
	"com.side-quest.agent-chrome.launch-services";
const INSTALL_CONTRACT_VERSION = 1;
const EXIT_BLOCKED = 20;
const COMMAND_TIMEOUT_MS = 120_000;
const LAUNCH_SERVICES_REGISTER =
	"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

type OutputMode = "json" | "human";

type Invocation = {
	mode: "check" | "apply";
	output: OutputMode;
};

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type ExistingLauncher = "missing" | "owned" | "foreign";

type LauncherIdentity = {
	identifier: string;
	metadataFile: string;
	product: string;
};

const AGENT_LAUNCHER_IDENTITY: LauncherIdentity = {
	identifier: APP_IDENTIFIER,
	metadataFile: "agent-chrome-install.json",
	product: "agent-chrome",
};

const EVERYDAY_LAUNCHER_IDENTITY: LauncherIdentity = {
	identifier: EVERYDAY_APP_IDENTIFIER,
	metadataFile: "everyday-chrome-install.json",
	product: "everyday-chrome",
};

class InstallFailure extends Error {
	constructor(
		readonly code: string,
		readonly exitCode: number = EXIT_BLOCKED,
	) {
		super(code);
	}
}

function parseInvocation(argv: readonly string[]): Invocation | null {
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
		return null;
	}
	const check = argv.includes("--check");
	const apply = argv.includes("--apply");
	const known = new Set(["--check", "--apply", "--json"]);
	if (argv.some((arg) => !known.has(arg)) || check === apply) {
		throw new InstallFailure("invalid_usage", 2);
	}
	return {
		mode: apply ? "apply" : "check",
		output: argv.includes("--json") ? "json" : "human",
	};
}

function help(): string {
	return [
		"Usage: bun run app/install.ts (--check | --apply) [--json]",
		"",
		"Build and install the Agent Chrome and human-only Everyday Chrome launch actions.",
		"--check  Inspect the destination without building or writing.",
		"--apply  Build, sign, verify, and atomically install.",
		"--json   Emit one machine-readable result.",
	].join("\n");
}

async function runCommand(
	argv: readonly string[],
	cwd?: string,
): Promise<CommandResult> {
	const child = Bun.spawn([...argv], {
		...(cwd ? { cwd } : {}),
		env: {
			PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
			LANG: "C.UTF-8",
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: COMMAND_TIMEOUT_MS,
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function requireSuccess(
	argv: readonly string[],
	code: string,
	cwd?: string,
): Promise<CommandResult> {
	const result = await runCommand(argv, cwd);
	if (result.exitCode !== 0) throw new InstallFailure(code);
	return result;
}

async function inspectExisting(
	appPath: string,
	identity: LauncherIdentity = AGENT_LAUNCHER_IDENTITY,
): Promise<ExistingLauncher> {
	let info: Awaited<ReturnType<typeof lstat>>;
	try {
		info = await lstat(appPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
		throw error;
	}
	if (!info.isDirectory() || info.isSymbolicLink()) return "foreign";
	try {
		const [plist, metadata] = await Promise.all([
			readFile(join(appPath, "Contents", "Info.plist"), "utf8"),
			readFile(join(appPath, "Contents", "Resources", identity.metadataFile), "utf8"),
		]);
		const parsed = JSON.parse(metadata) as Record<string, unknown>;
		if (
			!plist.includes(`<string>${identity.identifier}</string>`) ||
			parsed.product !== identity.product ||
			parsed.contract_version !== INSTALL_CONTRACT_VERSION
		) {
			return "foreign";
		}
		const signature = await runCommand([
			"/usr/bin/codesign",
			"--verify",
			"--strict",
			"--all-architectures",
			appPath,
		]);
		return signature.exitCode === 0 ? "owned" : "foreign";
	} catch {
		return "foreign";
	}
}

async function durableDirectory(path: string): Promise<void> {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function retainedLauncherPath(backups: string, productName: string): string {
	const timestamp = new Date().toISOString().replaceAll(":", "-");
	return join(
		backups,
		`${productName}.${timestamp}-${randomUUID()}.app-backup`,
	);
}

async function migrateLegacyRetainedLaunchers(
	applications: string,
	backups: string,
): Promise<string[]> {
	const entries = await readdir(applications, { withFileTypes: true });
	const legacyPaths = entries
		.filter(
			(entry) =>
				entry.isDirectory() &&
				entry.name.startsWith("Agent Chrome.retained-") &&
				entry.name.endsWith(".app"),
		)
		.map((entry) => join(applications, entry.name))
		.sort();
	const migrated: string[] = [];
	for (const legacyPath of legacyPaths) {
		if ((await inspectExisting(legacyPath)) !== "owned") continue;
		// Launch Services returns non-zero when a copied rollback bundle was never
		// registered. Relocation out of the `.app` discovery shape is authoritative;
		// unregistering is best-effort cleanup for bundles that were indexed.
		await runCommand([LAUNCH_SERVICES_REGISTER, "-u", legacyPath]);
		const retained = retainedLauncherPath(backups, "Agent Chrome");
		await rename(legacyPath, retained);
		migrated.push(retained);
	}
	return migrated;
}

async function buildAgentBundle(
	packageRoot: string,
	scratch: string,
): Promise<string> {
	const appRoot = join(scratch, "Agent Chrome.app");
	const contents = join(appRoot, "Contents");
	const macOS = join(contents, "MacOS");
	const helpers = join(contents, "Helpers");
	const resources = join(contents, "Resources");
	await Promise.all([
		mkdir(macOS, { recursive: true, mode: 0o755 }),
		mkdir(helpers, { recursive: true, mode: 0o755 }),
		mkdir(resources, { recursive: true, mode: 0o755 }),
	]);

	const launcher = join(macOS, "Agent Chrome");
	const helper = join(helpers, "warm-chrome");
	const avatarHelper = join(helpers, "agent-chrome-profile-avatar");
	const launchServicesHelper = join(helpers, "chrome-launch-services");
	await requireSuccess(
		[
			process.execPath,
			"build",
			"--compile",
			join(packageRoot, "app", "native-runtime.ts"),
			"--outfile",
			helper,
		],
		"helper_build_failed",
		scratch,
	);
	await requireSuccess(
		[
			process.execPath,
			"build",
			"--compile",
			join(packageRoot, "app", "profile-avatar.ts"),
			"--outfile",
			avatarHelper,
		],
		"avatar_helper_build_failed",
		scratch,
	);
	await requireSuccess(
		[
			"/usr/bin/swiftc",
			"-parse-as-library",
			join(packageRoot, "app", "chrome-launch-services.swift"),
			"-o",
			launchServicesHelper,
		],
		"launch_services_helper_build_failed",
		packageRoot,
	);
	await requireSuccess(
		[
			"/usr/bin/swiftc",
			"-parse-as-library",
			join(packageRoot, "app", "agent-chrome.swift"),
			"-o",
			launcher,
		],
		"launcher_build_failed",
		packageRoot,
	);
	await Promise.all([
		cp(
			join(packageRoot, "app", "agent-chrome-info.plist"),
			join(contents, "Info.plist"),
		),
		cp(
			join(packageRoot, "app", "assets", "agent-chrome.icns"),
			join(resources, "AgentChrome.icns"),
		),
		cp(
			join(packageRoot, "app", "assets", "agent-chrome-icon.png"),
			join(resources, "agent-chrome-avatar.png"),
		),
		chmod(launcher, 0o755),
		chmod(helper, 0o755),
		chmod(avatarHelper, 0o755),
		chmod(launchServicesHelper, 0o755),
	]);
	await writeFile(
		join(resources, "agent-chrome-install.json"),
		`${JSON.stringify({
			product: "agent-chrome",
			contract_version: INSTALL_CONTRACT_VERSION,
			launcher: "native",
			helper: "embedded",
		})}\n`,
		{ mode: 0o644 },
	);

	await requireSuccess(
		[
			"/usr/bin/codesign",
			"--force",
			"--sign",
			"-",
			"--identifier",
			HELPER_IDENTIFIER,
			helper,
		],
		"helper_signing_failed",
	);
	await requireSuccess(
		[
			"/usr/bin/codesign",
			"--force",
			"--sign",
			"-",
			"--identifier",
			AVATAR_HELPER_IDENTIFIER,
			avatarHelper,
		],
		"avatar_helper_signing_failed",
	);
	await requireSuccess(
		[
			"/usr/bin/codesign",
			"--force",
			"--sign",
			"-",
			"--identifier",
			LAUNCH_SERVICES_HELPER_IDENTIFIER,
			launchServicesHelper,
		],
		"launch_services_helper_signing_failed",
	);
	await requireSuccess(
		[
			"/usr/bin/codesign",
			"--force",
			"--sign",
			"-",
			"--identifier",
			APP_IDENTIFIER,
			appRoot,
		],
		"launcher_signing_failed",
	);
	await requireSuccess(
		[
			"/usr/bin/codesign",
			"--verify",
			"--strict",
			"--all-architectures",
			appRoot,
		],
		"launcher_verification_failed",
	);
	return appRoot;
}

async function buildEverydayBundle(
	packageRoot: string,
	scratch: string,
): Promise<string> {
	const appRoot = join(scratch, "Everyday Chrome.app");
	const contents = join(appRoot, "Contents");
	const macOS = join(contents, "MacOS");
	const resources = join(contents, "Resources");
	await Promise.all([
		mkdir(macOS, { recursive: true, mode: 0o755 }),
		mkdir(resources, { recursive: true, mode: 0o755 }),
	]);

	const launcher = join(macOS, "Everyday Chrome");
	await requireSuccess(
		[
			"/usr/bin/swiftc",
			"-parse-as-library",
			join(packageRoot, "app", "everyday-chrome.swift"),
			"-o",
			launcher,
		],
		"everyday_launcher_build_failed",
		packageRoot,
	);
	await Promise.all([
		cp(
			join(packageRoot, "app", "everyday-chrome-info.plist"),
			join(contents, "Info.plist"),
		),
		cp(
			"/Applications/Google Chrome.app/Contents/Resources/app.icns",
			join(resources, "EverydayChrome.icns"),
		),
		chmod(launcher, 0o755),
	]);
	await writeFile(
		join(resources, "everyday-chrome-install.json"),
		`${JSON.stringify({
			product: "everyday-chrome",
			contract_version: INSTALL_CONTRACT_VERSION,
			launcher: "human_only",
			automation: "none",
		})}\n`,
		{ mode: 0o644 },
	);
	await requireSuccess(
		[
			"/usr/bin/codesign",
			"--force",
			"--sign",
			"-",
			"--identifier",
			EVERYDAY_APP_IDENTIFIER,
			appRoot,
		],
		"everyday_launcher_signing_failed",
	);
	await requireSuccess(
		[
			"/usr/bin/codesign",
			"--verify",
			"--strict",
			"--all-architectures",
			appRoot,
		],
		"everyday_launcher_verification_failed",
	);
	return appRoot;
}

async function install(
	packageRoot: string,
	applications: string,
	destinations: { agent: string; everyday: string },
	existing: { agent: ExistingLauncher; everyday: ExistingLauncher },
): Promise<{
	retainedAgent?: string;
	retainedEveryday?: string;
	migratedLegacy: string[];
}> {
	const scratch = await mkdtemp(join(tmpdir(), "agent-chrome-install-"));
	await chmod(scratch, 0o700);
	try {
		const [agentBundle, everydayBundle] = await Promise.all([
			buildAgentBundle(packageRoot, scratch),
			buildEverydayBundle(packageRoot, scratch),
		]);
		await mkdir(applications, { recursive: true, mode: 0o755 });
		const backups = join(
			applications,
			"..",
			"Library",
			"Application Support",
			"Agent Chrome",
			"Installer Backups",
		);
		await mkdir(backups, { recursive: true, mode: 0o700 });
		await chmod(backups, 0o700);
		const migratedLegacy = await migrateLegacyRetainedLaunchers(
			applications,
			backups,
		);
		const agentNext = join(
			applications,
			`.Agent Chrome.next-${randomUUID()}.app`,
		);
		const everydayNext = join(
			applications,
			`.Everyday Chrome.next-${randomUUID()}.app`,
		);
		await requireSuccess(
			["/usr/bin/ditto", agentBundle, agentNext],
			"launcher_copy_failed",
		);
		await requireSuccess(
			["/usr/bin/ditto", everydayBundle, everydayNext],
			"everyday_launcher_copy_failed",
		);
		let retainedAgent: string | undefined;
		let retainedEveryday: string | undefined;
		let agentInstalled = false;
		let everydayInstalled = false;
		try {
			if (existing.agent === "owned") {
				const retained = retainedLauncherPath(backups, "Agent Chrome");
				await rename(destinations.agent, retained);
				retainedAgent = retained;
			}
			if (existing.everyday === "owned") {
				const retained = retainedLauncherPath(backups, "Everyday Chrome");
				await rename(destinations.everyday, retained);
				retainedEveryday = retained;
			}
			await rename(agentNext, destinations.agent);
			agentInstalled = true;
			await rename(everydayNext, destinations.everyday);
			everydayInstalled = true;
			await durableDirectory(applications);
			await durableDirectory(backups);
			await requireSuccess(
				[LAUNCH_SERVICES_REGISTER, "-f", destinations.agent],
				"launcher_registration_failed",
			);
			await requireSuccess(
				[LAUNCH_SERVICES_REGISTER, "-f", destinations.everyday],
				"everyday_launcher_registration_failed",
			);
		} catch (error) {
			await runCommand([LAUNCH_SERVICES_REGISTER, "-u", destinations.everyday]);
			await runCommand([LAUNCH_SERVICES_REGISTER, "-u", destinations.agent]);
			if (everydayInstalled) {
				await rename(
					destinations.everyday,
					join(scratch, "failed-Everyday-Chrome.app"),
				);
			}
			if (agentInstalled) {
				await rename(destinations.agent, join(scratch, "failed-Agent-Chrome.app"));
			}
			if (retainedEveryday) {
				await rename(retainedEveryday, destinations.everyday);
				await runCommand([LAUNCH_SERVICES_REGISTER, "-f", destinations.everyday]);
			}
			if (retainedAgent) {
				await rename(retainedAgent, destinations.agent);
				await runCommand([LAUNCH_SERVICES_REGISTER, "-f", destinations.agent]);
			}
			throw error;
		}
		return {
			...(retainedAgent ? { retainedAgent } : {}),
			...(retainedEveryday ? { retainedEveryday } : {}),
			migratedLegacy,
		};
	} finally {
		await rm(scratch, { recursive: true, force: true }).catch(() => {});
	}
}

function emit(
	mode: OutputMode,
	payload: Record<string, unknown>,
): void {
	if (mode === "json") {
		process.stdout.write(`${JSON.stringify(payload)}\n`);
		return;
	}
	process.stdout.write(`${String(payload.status)}: ${String(payload.app ?? "")}\n`);
}

async function main(argv: readonly string[]): Promise<number> {
	let invocation: Invocation | null;
	try {
		invocation = parseInvocation(argv);
	} catch (error) {
		const failure = error as InstallFailure;
		emit(argv.includes("--json") ? "json" : "human", {
			status: "blocked",
			code: failure.code,
			changed_state: "none",
		});
		return failure.exitCode;
	}
	if (!invocation) {
		process.stdout.write(`${help()}\n`);
		return 0;
	}
	if (process.platform !== "darwin") {
		emit(invocation.output, {
			status: "blocked",
			code: "unsupported_platform",
			changed_state: "none",
		});
		return EXIT_BLOCKED;
	}
	const home = process.env.HOME;
	if (!home?.startsWith("/")) {
		emit(invocation.output, {
			status: "blocked",
			code: "home_unavailable",
			changed_state: "none",
		});
		return EXIT_BLOCKED;
	}
	const packageRoot = resolve(import.meta.dir, "..");
	const applications = join(home, "Applications");
	const destinations = {
		agent: join(applications, "Agent Chrome.app"),
		everyday: join(applications, "Everyday Chrome.app"),
	};
	const existing = {
		agent: await inspectExisting(destinations.agent),
		everyday: await inspectExisting(
			destinations.everyday,
			EVERYDAY_LAUNCHER_IDENTITY,
		),
	};
	const foreignDestination =
		existing.agent === "foreign"
			? destinations.agent
			: existing.everyday === "foreign"
				? destinations.everyday
				: null;
	if (foreignDestination) {
		emit(invocation.output, {
			status: "blocked",
			code: "foreign_launcher_preserved",
			changed_state: "none",
			app: foreignDestination,
			next_action: "inspect_destination",
		});
		return EXIT_BLOCKED;
	}
	if (invocation.mode === "check") {
		emit(invocation.output, {
			status: "preview",
			changed_state: "none",
			app: destinations.agent,
			everyday_app: destinations.everyday,
			existing: existing.agent,
			everyday_existing: existing.everyday,
			next_action: "apply_install",
		});
		return 0;
	}
	try {
		const result = await install(
			packageRoot,
			applications,
			destinations,
			existing,
		);
		emit(invocation.output, {
			status: "installed",
			changed_state: "launcher_installed",
			app: destinations.agent,
			everyday_app: destinations.everyday,
			...(result.retainedAgent
				? { retained_app: result.retainedAgent }
				: {}),
			...(result.retainedEveryday
				? { retained_everyday_app: result.retainedEveryday }
				: {}),
			...(result.migratedLegacy.length > 0
				? { migrated_legacy_apps: result.migratedLegacy }
				: {}),
			next_action: "run_verifier",
		});
		return 0;
	} catch (error) {
		const code = error instanceof InstallFailure ? error.code : "install_failed";
		emit(invocation.output, {
			status: "blocked",
			code,
			changed_state: "none",
			app: destinations.agent,
			everyday_app: destinations.everyday,
			next_action: "inspect_diagnostics",
		});
		return error instanceof InstallFailure ? error.exitCode : EXIT_BLOCKED;
	}
}

process.exitCode = await main(process.argv.slice(2));
