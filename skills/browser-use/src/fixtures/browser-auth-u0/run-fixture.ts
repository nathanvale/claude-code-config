import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const scenarioIndex = args.indexOf("--scenario");
const scenario = scenarioIndex >= 0 ? args[scenarioIndex + 1] : undefined;
const allowedScenarios = new Set([
	"deliver",
	"origin-drift",
	"submit",
	"failure-cleanup",
]);

if (!scenario || !allowedScenarios.has(scenario)) {
	console.error("expected --scenario deliver|origin-drift|submit|failure-cleanup");
	process.exit(64);
}

const fixtureRoot = import.meta.dir;
const buildRoot = await mkdtemp(join(tmpdir(), "browser-auth-u0-"));
const hostBundlePath = join(buildRoot, "BrowserAuthU0Host.app");
const hostContentsPath = join(hostBundlePath, "Contents");
const hostMacOSPath = join(hostContentsPath, "MacOS");
const hostXPCServicesPath = join(hostContentsPath, "XPCServices");
const helperBundlePath = join(
	hostXPCServicesPath,
	"BrowserAuthU0Delivery.xpc",
);
const helperContentsPath = join(helperBundlePath, "Contents");
const helperMacOSPath = join(helperContentsPath, "MacOS");
const helperPath = join(helperMacOSPath, "delivery-helper");
const retrievalPath = join(buildRoot, "retrieval-helper");
const hostPath = join(hostMacOSPath, "xpc-host");
const unrelatedPath = join(buildRoot, "unrelated.txt");
const receiptPath = join(buildRoot, "receipt.json");
const marker = "U0S-";

async function run(
	command: string[],
	options: { env?: Record<string, string | undefined> } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn(command, {
		cwd: fixtureRoot,
		env: options.env ?? {
			PATH: process.env.PATH,
			TMPDIR: process.env.TMPDIR,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { exitCode, stdout, stderr };
}

async function runChecked(command: string[]): Promise<void> {
	const result = await run(command);
	if (result.exitCode !== 0) {
		throw new Error(
			`command failed (${command[0]}): ${result.stderr || result.stdout}`,
		);
	}
}

try {
	await writeFile(unrelatedPath, "fixture-private\n", { mode: 0o600 });
	await chmod(unrelatedPath, 0o600);
	await mkdir(helperMacOSPath, { recursive: true });
	await mkdir(hostMacOSPath, { recursive: true });
	await copyFile(join(fixtureRoot, "Info.plist"), join(helperContentsPath, "Info.plist"));
	await copyFile(
		join(fixtureRoot, "Host-Info.plist"),
		join(hostContentsPath, "Info.plist"),
	);
	await runChecked([
		"/usr/bin/swiftc",
		join(fixtureRoot, "delivery-helper.swift"),
		"-o",
		helperPath,
	]);
	await runChecked([
		"/usr/bin/swiftc",
		join(fixtureRoot, "retrieval-helper.swift"),
		"-o",
		retrievalPath,
	]);
	await runChecked([
		"/usr/bin/swiftc",
		join(fixtureRoot, "xpc-host.swift"),
		"-o",
		hostPath,
	]);
	await runChecked([
		"/usr/bin/codesign",
		"--force",
		"--sign",
		"-",
		"--entitlements",
		join(fixtureRoot, "delivery-helper.entitlements"),
		helperBundlePath,
	]);
	await runChecked([
		"/usr/bin/codesign",
		"--verify",
		"--strict",
		helperBundlePath,
	]);
	await runChecked([
		"/usr/bin/codesign",
		"--force",
		"--sign",
		"-",
		hostBundlePath,
	]);
	await runChecked([
		"/usr/bin/codesign",
		"--verify",
		"--strict",
		hostBundlePath,
	]);
	const entitlements = await run([
		"/usr/bin/codesign",
		"--display",
		"--entitlements",
		":-",
		helperBundlePath,
	]);
	const appSandboxEntitlement =
		entitlements.stdout.includes("com.apple.security.app-sandbox") ||
		entitlements.stderr.includes("com.apple.security.app-sandbox");

	const result = await run(
		[
			"/usr/bin/open",
			"-W",
			"-n",
			hostBundlePath,
			"--args",
			retrievalPath,
			scenario,
			unrelatedPath,
			receiptPath,
		],
		{ env: {} },
	);
	const receiptText =
		result.exitCode === 0 ? await readFile(receiptPath, "utf8") : "";
	if (
		result.stdout.includes(marker) ||
		result.stderr.includes(marker) ||
		receiptText.includes(marker)
	) {
		throw new Error("sentinel marker escaped into fixture output");
	}
	if (result.exitCode !== 0) {
		throw new Error(`fixture failed: ${result.stderr || result.stdout}`);
	}
	const receipt = JSON.parse(receiptText) as Record<string, unknown>;
	process.stdout.write(
		`${JSON.stringify({
			...receipt,
			signed: true,
			app_sandbox_entitlement: appSandboxEntitlement,
		})}\n`,
	);
} finally {
	await rm(buildRoot, { recursive: true, force: true });
}
