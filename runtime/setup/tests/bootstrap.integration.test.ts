import { spawn, spawnSync } from "node:child_process";
import {
	chmod,
	copyFile,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

const repoRoot = resolve(import.meta.dir, "../../..");
const rootSetup = join(repoRoot, "setup");
const realBun = process.execPath;
const fixtureRoots: string[] = [];

interface BootstrapFixture {
	root: string;
	setupPath: string;
	binDir: string;
	bunInstall: string;
	bunLogDir: string;
	curlLog: string;
	env: NodeJS.ProcessEnv;
}

afterEach(async () => {
	await Promise.all(fixtureRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("root setup bootstrap", () => {
	test("uses an existing Bun, reconciles frozen dependencies, and reaches commands JSON", async () => {
		const fixture = await makeFixture({ bunPresent: true, realDelegate: true });
		const result = runSetup(fixture, ["commands", "--json"]);

		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout).status).toBe("ok");
		expect(await readBunCall(fixture, 1)).toEqual(["install", "--frozen-lockfile"]);
		expect(await readBunCall(fixture, 2)).toEqual([
			"run",
			join(repoRoot, "runtime/setup/src/cli.ts"),
			"commands",
			"--json",
		]);
	});

	test("refuses a non-interactive Bun install without explicit consent", async () => {
		const fixture = await makeFixture({ bunPresent: false });
		const result = runSetup(fixture, ["commands", "--json"]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("bootstrap.bun_consent_required");
		expect(await fileOrEmpty(fixture.curlLog)).toBe("");
	});

	test("installs Bun non-interactively with --yes and does not forward the bootstrap flag", async () => {
		const fixture = await makeFixture({ bunPresent: false });
		const result = runSetup(fixture, ["commands", "--yes", "--json"]);

		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toBe('{"fixture":"delegated"}\n');
		expect(await fileOrEmpty(fixture.curlLog)).toContain("https://bun.sh/install");
		expect(await readBunCall(fixture, 1)).toEqual(["install", "--frozen-lockfile"]);
		expect(await readBunCall(fixture, 2)).toEqual([
			"run",
			join(repoRoot, "runtime/setup/src/cli.ts"),
			"commands",
			"--json",
		]);
	});

	const interactiveTest = hasExpectUtility() ? test : test.skip;

	interactiveTest("installs Bun after interactive consent", async () => {
		const fixture = await makeFixture({ bunPresent: false });
		const result = await runInteractive(fixture, "y\n");

		expect(result.stdout + result.stderr).toContain("Install Bun now?");
		expect(await fileOrEmpty(fixture.curlLog)).toContain("https://bun.sh/install");
		expect(await readBunCall(fixture, 2)).toEqual([
			"run",
			join(repoRoot, "runtime/setup/src/cli.ts"),
			"commands",
			"--json",
		]);
	});

	interactiveTest("leaves the machine unchanged after interactive decline", async () => {
		const fixture = await makeFixture({ bunPresent: false });
		const result = await runInteractive(fixture, "n\n");

		expect(result.stdout + result.stderr).toContain("bootstrap.bun_declined");
		expect(await fileOrEmpty(fixture.curlLog)).toBe("");
		expect(await fileOrEmpty(join(fixture.bunInstall, "bin/bun"))).toBe("");
	});

	test("reports installer failure without reconciling dependencies", async () => {
		const fixture = await makeFixture({ bunPresent: false, installerExit: 47 });
		const result = runSetup(fixture, ["--yes", "commands", "--json"]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("bootstrap.bun_install_failed");
		expect(await fileOrEmpty(join(fixture.bunLogDir, "call-count"))).toBe("");
	});

	test("reports frozen dependency failure without delegating", async () => {
		const fixture = await makeFixture({ bunPresent: true, dependencyExit: 33 });
		const result = runSetup(fixture, ["commands", "--json"]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("bootstrap.dependencies_failed");
		expect(result.stderr).toContain("fixture dependency failure");
		expect(await readBunCall(fixture, 1)).toEqual(["install", "--frozen-lockfile"]);
		expect(await fileOrEmpty(join(fixture.bunLogDir, "call-2/count"))).toBe("");
	});

	test("preserves paths with spaces and every delegated argument", async () => {
		const fixture = await makeFixture({ bunPresent: true, copySetup: true });
		const argv = ["catalog", "", "two words", "*.md", "quo'te", "雪", "--json"];
		const result = runSetup(fixture, argv);

		expect(result.status, result.stderr).toBe(0);
		expect(await readBunCall(fixture, 2)).toEqual([
			"run",
			join(fixture.root, "runtime/setup/src/cli.ts"),
			...argv,
		]);
	});

	test("preserves the delegated non-zero exit", async () => {
		const fixture = await makeFixture({ bunPresent: true, delegateExit: 23 });
		const result = runSetup(fixture, ["status"]);

		expect(result.status).toBe(23);
		expect(result.stderr).toContain("fixture delegated failure");
	});

	test("preserves a delegated signal", async () => {
		const fixture = await makeFixture({ bunPresent: true, delegateSignal: "TERM" });
		const result = await runSetupAsync(fixture, ["status"]);

		expect(result.code).toBeNull();
		expect(result.signal).toBe("SIGTERM");
	});
});

async function makeFixture(options: {
	bunPresent: boolean;
	copySetup?: boolean;
	realDelegate?: boolean;
	installerExit?: number;
	dependencyExit?: number;
	delegateExit?: number;
	delegateSignal?: "TERM";
}): Promise<BootstrapFixture> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "setup bootstrap space ")));
	fixtureRoots.push(root);
	const binDir = join(root, "fixture bin");
	const home = join(root, "home space");
	const bunInstall = join(home, ".bun space");
	const bunLogDir = join(root, "bun calls");
	const curlLog = join(root, "curl.log");
	const bunTemplate = join(root, "fake bun template");
	await Promise.all([
		mkdir(binDir, { recursive: true }),
		mkdir(home, { recursive: true }),
		mkdir(bunLogDir, { recursive: true }),
	]);
	await writeExecutable(bunTemplate, fakeBunScript());
	await writeExecutable(join(binDir, "curl"), fakeCurlScript());
	if (options.bunPresent) await copyExecutable(bunTemplate, join(binDir, "bun"));

	let setupPath = rootSetup;
	if (options.copySetup) {
		setupPath = join(root, "setup");
		await mkdir(join(root, "runtime/setup/src"), { recursive: true });
		await copyExecutable(rootSetup, setupPath);
		await writeFile(join(root, "runtime/setup/src/cli.ts"), "// fixture entry\n");
	}

	const env: NodeJS.ProcessEnv = {
		HOME: home,
		PATH: `${binDir}:/usr/bin:/bin`,
		BUN_INSTALL: bunInstall,
		SETUP_TEST_BUN_LOG_DIR: bunLogDir,
		SETUP_TEST_BUN_TEMPLATE: bunTemplate,
		SETUP_TEST_CURL_LOG: curlLog,
		SETUP_TEST_INSTALLER_EXIT: String(options.installerExit ?? 0),
		SETUP_TEST_DEPENDENCY_EXIT: String(options.dependencyExit ?? 0),
		SETUP_TEST_DELEGATE_EXIT: String(options.delegateExit ?? 0),
		SETUP_TEST_DELEGATE_SIGNAL: options.delegateSignal ?? "",
		SETUP_TEST_REAL_BUN: options.realDelegate ? realBun : "",
	};
	const bunProbe = spawnSync("/bin/sh", ["-c", "command -v bun"], { env, encoding: "utf8" });
	if (options.bunPresent) expect(bunProbe.status).toBe(0);
	else expect(bunProbe.status).not.toBe(0);

	return { root, setupPath, binDir, bunInstall, bunLogDir, curlLog, env };
}

function runSetup(fixture: BootstrapFixture, argv: string[]) {
	const result = spawnSync(fixture.setupPath, argv, {
		cwd: fixture.root,
		env: fixture.env,
		encoding: "utf8",
		timeout: 15_000,
	});
	return {
		status: result.status,
		signal: result.signal,
		stdout: result.stdout ?? "",
		stderr: `${result.stderr ?? ""}${result.error?.message ?? ""}`,
	};
}

function runSetupAsync(fixture: BootstrapFixture, argv: string[]) {
	return new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, reject) => {
		const child = spawn(fixture.setupPath, argv, { cwd: fixture.root, env: fixture.env });
		child.once("error", reject);
		child.once("close", (code, signal) => resolveResult({ code, signal }));
	});
}

async function runInteractive(fixture: BootstrapFixture, input: string) {
	const driver = join(fixture.root, "interactive.exp");
	await writeFile(
		driver,
		[
			"set timeout 15",
			"spawn -noecho $env(SETUP_TEST_SETUP_PATH) commands --json",
			'expect -re "Install Bun now"',
			"send -- $env(SETUP_TEST_ANSWER)",
			"expect eof",
		].join("\n"),
	);
	const env = {
		...fixture.env,
		SETUP_TEST_SETUP_PATH: fixture.setupPath,
		SETUP_TEST_ANSWER: input.replace("\n", "\r"),
	};
	const result = spawnSync("expect", [driver], { env, encoding: "utf8", timeout: 15_000 });
	return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function hasExpectUtility(): boolean {
	return spawnSync("/usr/bin/env", ["sh", "-c", "command -v expect"], { encoding: "utf8" }).status === 0;
}

async function readBunCall(fixture: BootstrapFixture, call: number): Promise<string[]> {
	const callDir = join(fixture.bunLogDir, `call-${call}`);
	const count = Number(await readFile(join(callDir, "count"), "utf8"));
	return Promise.all(
		Array.from({ length: count }, (_, index) => readFile(join(callDir, `arg-${index + 1}`), "utf8")),
	);
}

async function fileOrEmpty(path: string): Promise<string> {
	try {
		return await readFile(path, "utf8");
	} catch {
		return "";
	}
}

async function copyExecutable(source: string, destination: string): Promise<void> {
	await mkdir(dirname(destination), { recursive: true });
	await copyFile(source, destination);
	await chmod(destination, 0o755);
}

async function writeExecutable(path: string, content: string): Promise<void> {
	await writeFile(path, content);
	await chmod(path, 0o755);
}

function fakeBunScript(): string {
	return `#!/bin/sh
set -eu
count_file="$SETUP_TEST_BUN_LOG_DIR/call-count"
count=0
if [ -f "$count_file" ]; then count=$(cat "$count_file"); fi
count=$((count + 1))
printf '%s' "$count" > "$count_file"
call_dir="$SETUP_TEST_BUN_LOG_DIR/call-$count"
mkdir -p "$call_dir"
printf '%s' "$#" > "$call_dir/count"
index=0
for arg in "$@"; do
	index=$((index + 1))
	printf '%s' "$arg" > "$call_dir/arg-$index"
done
if [ "\${1:-}" = install ]; then
	if [ "$SETUP_TEST_DEPENDENCY_EXIT" -ne 0 ]; then
		echo 'fixture dependency failure' >&2
		exit "$SETUP_TEST_DEPENDENCY_EXIT"
	fi
	echo 'fixture dependencies reconciled' >&2
	exit 0
fi
if [ "\${1:-}" = run ]; then
	if [ -n "$SETUP_TEST_DELEGATE_SIGNAL" ]; then kill -TERM "$$"; fi
	if [ -n "$SETUP_TEST_REAL_BUN" ]; then
		shift
		exec "$SETUP_TEST_REAL_BUN" run "$@"
	fi
	if [ "$SETUP_TEST_DELEGATE_EXIT" -ne 0 ]; then
		echo 'fixture delegated failure' >&2
		exit "$SETUP_TEST_DELEGATE_EXIT"
	fi
	printf '%s\n' '{"fixture":"delegated"}'
	exit 0
fi
exit 88
`;
}

function fakeCurlScript(): string {
	return `#!/bin/sh
set -eu
printf '%s\n' "$@" > "$SETUP_TEST_CURL_LOG"
cat <<'INSTALLER'
#!/bin/sh
set -eu
if [ "$SETUP_TEST_INSTALLER_EXIT" -ne 0 ]; then
	echo 'fixture installer failure' >&2
	exit "$SETUP_TEST_INSTALLER_EXIT"
fi
mkdir -p "$BUN_INSTALL/bin"
cp "$SETUP_TEST_BUN_TEMPLATE" "$BUN_INSTALL/bin/bun"
chmod +x "$BUN_INSTALL/bin/bun"
INSTALLER
`;
}
