import { randomUUID } from "node:crypto";
import {
	access,
	chmod,
	cp,
	mkdir,
	open,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION } from "../src/binding-selection-capability.ts";

const MAXIMUM_COMMAND_OUTPUT_BYTES = 4 * 1_048_576;
const COMMAND_TIMEOUT_MS = 10 * 60_000;

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

async function run(
	argv: readonly string[],
	options: { cwd?: string } = {},
): Promise<CommandResult> {
	const child = Bun.spawn([...argv], {
		cwd: options.cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
			LANG: "C.UTF-8",
		},
		timeout: COMMAND_TIMEOUT_MS,
		maxBuffer: MAXIMUM_COMMAND_OUTPUT_BYTES,
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
	options: { cwd?: string; code: string } = { code: "command-failed" },
) {
	const result = await run(argv, options);
	if (result.exitCode !== 0) {
		throw new Error(options.code);
	}
	return result;
}

async function durableDirectory(path: string) {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function failureCode(error: unknown): string {
	return error instanceof Error && /^[a-z0-9-]+$/.test(error.message)
		? error.message
		: "install-failed";
}

async function main(): Promise<number> {
	const home = process.env.HOME;
	if (home === undefined || !home.startsWith("/")) {
		throw new Error("home-unavailable");
	}
	const packageRoot = resolve(import.meta.dir, "..");
	const repositoryRoot = resolve(packageRoot, "..", "..");
	const environmentAuthRoot = join(
		repositoryRoot,
		"runtime",
		"browser-use-environment-auth",
	);
	const productRoot = join(home, ".local", "browser-use-security");
	const installedApp = join(productRoot, "ApprovalBroker.app");
	try {
		await access(join(installedApp, "Contents", "embedded.provisionprofile"));
	} catch {
		throw new Error("installed-provisioning-profile-unavailable");
	}

	const scratchRoot = join(
		"/tmp",
		`browser-use-binding-selection-install-${randomUUID()}`,
	);
	await mkdir(scratchRoot, { recursive: false, mode: 0o700 });
	try {
		const derivedData = join(scratchRoot, "derived-data");
		const stagedApp = join(scratchRoot, "ApprovalBroker.app");
		const admittedEntitlements = join(
			scratchRoot,
			"ApprovalBroker.entitlements.plist",
		);
		const entitlements = await requireSuccess(
			["/usr/bin/codesign", "-d", "--entitlements", ":-", installedApp],
			{ code: "installed-entitlements-unavailable" },
		);
		if (!entitlements.stdout.includes("com.apple.application-identifier")) {
			throw new Error("installed-entitlements-invalid");
		}
		await writeFile(admittedEntitlements, entitlements.stdout, { mode: 0o600 });
		for (const key of [
			"com.apple.security.app-sandbox",
			"com.apple.security.get-task-allow",
			"com.apple.security.network.client",
			"com.apple.security.network.server",
		]) {
			await run([
				"/usr/libexec/PlistBuddy",
				"-c",
				`Delete :${key}`,
				admittedEntitlements,
			]);
		}
		const reducedEntitlements = await requireSuccess(
			["/usr/bin/plutil", "-convert", "xml1", "-o", "-", admittedEntitlements],
			{ code: "approval-broker-entitlements-invalid" },
		);
		if (
			[
				"com.apple.security.app-sandbox",
				"com.apple.security.get-task-allow",
				"com.apple.security.network.client",
				"com.apple.security.network.server",
			].some((key) => reducedEntitlements.stdout.includes(key)) ||
			!reducedEntitlements.stdout.includes("keychain-access-groups")
		) {
			throw new Error("approval-broker-entitlements-invalid");
		}

		await requireSuccess(
			[
				"/usr/bin/xcodebuild",
				"-project",
				join(packageRoot, "BrowserUseSecurity.xcodeproj"),
				"-scheme",
				"ApprovalBroker",
				"-configuration",
				"Release",
				"-destination",
				"platform=macOS,arch=arm64",
				"-derivedDataPath",
				derivedData,
				"CODE_SIGNING_ALLOWED=NO",
				"build",
			],
			{ code: "approval-broker-build-failed" },
		);
		await requireSuccess(
			["/usr/bin/swift", "build", "-c", "release", "--disable-sandbox"],
			{ cwd: environmentAuthRoot, code: "environment-supervisor-build-failed" },
		);

		const unsignedApp = join(
			derivedData,
			"Build",
			"Products",
			"Release",
			"ApprovalBroker.app",
		);
		const unsignedBroker = join(
			unsignedApp,
			"Contents",
			"MacOS",
			"ApprovalBroker",
		);
		const builtInfo = join(unsignedApp, "Contents", "Info.plist");
		const builtSupervisor = join(
			environmentAuthRoot,
			".build",
			"release",
			"browser-use-op-supervisor",
		);
		await cp(installedApp, stagedApp, {
			recursive: true,
			preserveTimestamps: true,
		});
		await cp(
			unsignedBroker,
			join(stagedApp, "Contents", "MacOS", "ApprovalBroker"),
		);
		await cp(builtInfo, join(stagedApp, "Contents", "Info.plist"));
		const helperDirectory = join(stagedApp, "Contents", "Helpers");
		await mkdir(helperDirectory, { recursive: true, mode: 0o755 });
		const stagedSupervisor = join(helperDirectory, "browser-use-op-supervisor");
		await cp(builtSupervisor, stagedSupervisor);
		await chmod(stagedSupervisor, 0o755);

		await requireSuccess(
			[
				"/usr/bin/codesign",
				"--force",
				"--options",
				"runtime",
				"--identifier",
				BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.environmentSupervisorIdentifier,
				"--sign",
				"Apple Development",
				stagedSupervisor,
			],
			{ code: "environment-supervisor-signing-failed" },
		);
		await requireSuccess(
			[
				"/usr/bin/codesign",
				"--force",
				"--options",
				"runtime",
				"--identifier",
				BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.approvalBrokerIdentifier,
				"--entitlements",
				admittedEntitlements,
				"--sign",
				"Apple Development",
				stagedApp,
			],
			{ code: "approval-broker-signing-failed" },
		);

		const brokerRequirement = `anchor apple generic and identifier "${BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.approvalBrokerIdentifier}" and certificate leaf[subject.OU] = "${BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.signingTeamIdentifier}"`;
		const supervisorRequirement = `anchor apple generic and identifier "${BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.environmentSupervisorIdentifier}" and certificate leaf[subject.OU] = "${BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.signingTeamIdentifier}"`;
		await requireSuccess(
			[
				"/usr/bin/codesign",
				"--verify",
				"--strict",
				"--all-architectures",
				`-R=${brokerRequirement}`,
				stagedApp,
			],
			{ code: "approval-broker-verification-failed" },
		);
		await requireSuccess(
			[
				"/usr/bin/codesign",
				"--verify",
				"--strict",
				"--all-architectures",
				`-R=${supervisorRequirement}`,
				stagedSupervisor,
			],
			{ code: "environment-supervisor-verification-failed" },
		);
		const version = await requireSuccess(
			[
				"/usr/bin/plutil",
				"-extract",
				"CFBundleShortVersionString",
				"raw",
				join(stagedApp, "Contents", "Info.plist"),
			],
			{ code: "approval-broker-version-unavailable" },
		);
		if (
			version.stdout.trim() !==
			BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.productVersion
		) {
			throw new Error("approval-broker-version-incompatible");
		}
		await requireSuccess(
			[join(stagedApp, "Contents", "MacOS", "ApprovalBroker"), "verifier"],
			{ code: "approval-broker-verifier-unavailable" },
		);

		await mkdir(productRoot, { recursive: true, mode: 0o755 });
		const installationID = randomUUID();
		const nextApp = join(
			productRoot,
			`.ApprovalBroker.next-${installationID}.app`,
		);
		const retainedApp = join(
			productRoot,
			`ApprovalBroker.retained-${new Date().toISOString().replaceAll(":", "-")}.app`,
		);
		await cp(stagedApp, nextApp, { recursive: true, preserveTimestamps: true });
		await rename(installedApp, retainedApp);
		try {
			await rename(nextApp, installedApp);
		} catch (error) {
			await rename(retainedApp, installedApp);
			throw error;
		}
		await durableDirectory(productRoot);
		const canonicalInstalledApp = await realpath(installedApp);
		process.stdout.write(
			`${JSON.stringify({
				status: "installed",
				product_version:
					BROWSER_USE_BINDING_SELECTION_NATIVE_ADMISSION.productVersion,
				app: canonicalInstalledApp,
				retained_app: retainedApp,
			})}\n`,
		);
		return 0;
	} finally {
		await rm(scratchRoot, { recursive: true, force: true }).catch(() => {});
	}
}

try {
	process.exitCode = await main();
} catch (error) {
	process.stderr.write(
		`${JSON.stringify({
			status: "blocked",
			code: failureCode(error),
		})}\n`,
	);
	process.exitCode = 20;
}
