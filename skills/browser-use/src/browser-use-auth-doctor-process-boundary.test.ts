import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WORKSPACE_ROOT = resolve(import.meta.dir, "../../..");
const BROWSER_USE_CLI = join(import.meta.dir, "browser-use.ts");
const WARM_CHROME_CLI = join(
	WORKSPACE_ROOT,
	"runtime",
	"warm-chrome",
	"src",
	"cli.ts",
);
const SUPERVISOR = join(
	WORKSPACE_ROOT,
	"runtime",
	"browser-use-environment-auth",
	".build",
	"release",
	"browser-use-op-supervisor",
);
const DARWIN = process.platform === "darwin";
const OP_PATHS =
	process.arch === "arm64"
		? ["/opt/homebrew/bin/op", "/usr/local/bin/op"]
		: ["/usr/local/bin/op", "/opt/homebrew/bin/op"];
const OP_PATH = OP_PATHS.find((path) => existsSync(path));
const TOKEN_SOURCE = "op://Browser Automation/Service Account/credential";
const CHILD_TIMEOUT_MS = 30_000;
const TEST_TIMEOUT_MS = CHILD_TIMEOUT_MS + 15_000;
const FORBIDDEN_ENV_KEYS = [
	"OP_SERVICE_ACCOUNT_TOKEN",
	"OP_CONNECT_HOST",
	"OP_CONNECT_TOKEN",
	"BROWSER_USE_TOKEN",
	"BROWSER_USE_OP_TOKEN",
] as const;

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

type Scratch = {
	root: string;
	home: string;
	configRoot: string;
	env: Record<string, string>;
};

type JsonRecord = Record<string, unknown>;

const temporaryRoots: string[] = [];

function scrubbedOperatorEnv(): Record<string, string> {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	);
	for (const key of FORBIDDEN_ENV_KEYS) delete env[key];
	return env;
}

const OP_AUTHENTICATED =
	DARWIN &&
	OP_PATH !== undefined &&
	spawnSync(OP_PATH, ["whoami"], {
		env: scrubbedOperatorEnv(),
		stdio: "ignore",
		timeout: 10_000,
	}).status === 0;

beforeAll(() => {
	if (DARWIN && !existsSync(SUPERVISOR)) {
		throw new Error(
			`real supervisor binary missing; build it first: bun --cwd runtime/browser-use-environment-auth run build:release (${SUPERVISOR})`,
		);
	}
});

afterAll(() => {
	for (const root of temporaryRoots) {
		rmSync(root, { recursive: true, force: true });
	}
});

function scratch(
	label: string,
	options: { operatorContext?: boolean } = {},
): Scratch {
	const root = realpathSync(mkdtempSync(join(tmpdir(), `browser-use-u6-${label}-`)));
	temporaryRoots.push(root);
	const home = join(root, "home");
	const configBase = join(root, "config");
	const configRoot = join(configBase, "browser-use");
	for (const path of [home, configBase, configRoot]) {
		mkdirSync(path, { recursive: true, mode: 0o700 });
	}
	return {
		root,
		home,
		configRoot,
		env: {
			...(options.operatorContext
				? Object.fromEntries(
						Object.entries(scrubbedOperatorEnv()).filter(
							([key]) => key === "OP_ACCOUNT" || key.startsWith("OP_SESSION_"),
						),
					)
				: {}),
			HOME:
				options.operatorContext && process.env.HOME !== undefined
					? process.env.HOME
					: home,
			XDG_CONFIG_HOME: configBase,
			XDG_DATA_HOME: join(root, "data"),
			XDG_STATE_HOME: join(root, "state"),
			XDG_CACHE_HOME: join(root, "cache"),
			TMPDIR: root,
			PATH: process.env.PATH ?? "/usr/bin:/bin",
			LANG: "C.UTF-8",
		},
	};
}

async function run(
	entrypoint: string,
	args: readonly string[],
	env: Record<string, string>,
	cwd: string,
): Promise<CommandResult> {
	const child = spawn(process.execPath, [entrypoint, ...args], {
		cwd,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (!(child.stdout && child.stderr)) {
		child.kill("SIGKILL");
		throw new Error("CLI output pipes unavailable");
	}
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr.on("data", (chunk) => {
		stderr += chunk;
	});
	const exitCode = await new Promise<number>((resolveExit, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error(`CLI timeout: ${entrypoint} ${args.join(" ")}`));
		}, CHILD_TIMEOUT_MS);
		child.once("error", reject);
		child.once("exit", (code) => {
			clearTimeout(timeout);
			resolveExit(code ?? -1);
		});
	});
	return { exitCode, stdout, stderr };
}

function json(stdout: string): JsonRecord {
	return JSON.parse(stdout) as JsonRecord;
}

function detail(result: CommandResult): JsonRecord {
	const envelope = json(result.stdout);
	return ((envelope.data as JsonRecord).evaluation as JsonRecord).detail as JsonRecord;
}

function checks(result: CommandResult): JsonRecord {
	return detail(result).checks as JsonRecord;
}

function checkStatus(result: CommandResult, gate: string): string | undefined {
	return (checks(result)[gate] as JsonRecord | undefined)?.status as
		| string
		| undefined;
}

function profileCause(result: CommandResult): string | undefined {
	return (checks(result).profile_policy as JsonRecord | undefined)?.cause as
		| string
		| undefined;
}

async function runBrowserUse(
	scratchRoot: Scratch,
	args: readonly string[],
	profilePath?: string,
): Promise<CommandResult> {
	return run(
		BROWSER_USE_CLI,
		args,
		{
			...scratchRoot.env,
			...(profilePath === undefined
				? {}
				: { WARM_CHROME_PROFILE_DIR: profilePath }),
		},
		scratchRoot.root,
	);
}

async function runWarmChrome(
	scratchRoot: Scratch,
	profilePath: string,
): Promise<CommandResult> {
	return run(
		WARM_CHROME_CLI,
		["repair", "--profile-only", "--profile", profilePath, "--json", "--quiet"],
		scratchRoot.env,
		scratchRoot.root,
	);
}

async function writeStoredSource(scratchRoot: Scratch): Promise<void> {
	const custody = join(scratchRoot.configRoot, "auth.nosync");
	await mkdir(custody, { recursive: true, mode: 0o700 });
	writeFileSync(
		join(custody, "token-source.json"),
		`${JSON.stringify({ schema_version: 1, source: TOKEN_SOURCE })}\n`,
		{ mode: 0o600 },
	);
}

describe.skipIf(!DARWIN)("auth doctor real process boundary", () => {
	test(
		"AE5: a shipped CLI with no bundled supervisor renders the exact cold runtime gate",
		async () => {
			const fixture = scratch("cold");
			const dist = join(fixture.root, "dist");
			const build = await Bun.build({
				entrypoints: [BROWSER_USE_CLI],
				outdir: dist,
				target: "bun",
				splitting: false,
				minify: false,
				external: ["@side-quest/browser-connect/cli"],
			});
			expect(build.success).toBe(true);
			const coldCli = join(dist, "browser-use.js");
			expect(existsSync(join(dist, "bin", "browser-use-op-supervisor"))).toBe(
				false,
			);

			const result = await run(coldCli, ["auth", "doctor"], fixture.env, fixture.root);

			expect(result.exitCode).toBe(0);
			expect(result.stderr).toBe("");
			expect(result.stdout).toBe(
				[
					"browser-use auth doctor",
					"lane: unknown",
					"gate            verdict  state",
					"runtime         red      blocked cause=token-supervisor-unavailable",
					"  repair: bun --cwd runtime/browser-use-environment-auth run build:release",
					"token_file      unknown  unknown",
					"op              unknown  unknown",
					"token           unknown  unknown",
					"vault_scope     unknown  unknown",
					"profile_policy  unknown  unknown",
					"summary: 1 red, 5 unknown",
					"",
				].join("\n"),
			);
		},
		TEST_TIMEOUT_MS,
	);

	describe.skipIf(!OP_AUTHENTICATED)(
		"authenticated-op gate: real custody, vault, and profile predicates",
		() => {
			const fixture = scratch("authenticated", { operatorContext: true });
			let reload: CommandResult;

			beforeAll(async () => {
				await writeStoredSource(fixture);
				reload = await runBrowserUse(fixture, ["auth", "reload", "--json"]);
			});

			test(
				"AE3: stored source reload drives the real fetch pipe and makes the token gate green",
				async () => {
					expect(reload.exitCode).toBe(0);
					expect(reload.stderr).toBe("");
					expect(detail(reload).source_present).toBe(true);
					const status = await runBrowserUse(
						fixture,
						["auth", "status", "--json"],
						join(fixture.root, "ae3-profile"),
					);
					expect(checkStatus(status, "token_file")).toBe("ready");
					expect(checkStatus(status, "op")).toBe("ready");
					expect(checkStatus(status, "token")).toBe("ready");
				},
				TEST_TIMEOUT_MS,
			);

			test(
				"AE2: dirty profile is red, real owner repair runs, and re-check is 5/5 green",
				async () => {
					const profile = join(fixture.root, "dirty-profile");
					await mkdir(profile, { mode: 0o755 });
					const before = await runBrowserUse(
						fixture,
						["auth", "doctor", "--json"],
						profile,
					);
					expect(before.exitCode).toBe(20);
					expect(profileCause(before)).toBe("profile-policy-unproven");

					const fixed = await runBrowserUse(
						fixture,
						["auth", "doctor", "--fix", "profile", "--plain"],
						profile,
					);
					expect(fixed.exitCode).toBe(0);
					expect(fixed.stderr).toBe("");
					expect(fixed.stdout).toContain("fix profile_policy: delegated");
					expect(fixed.stdout).toContain("summary: 5 green, 0 red");
					const recheck = await runBrowserUse(
						fixture,
						["auth", "doctor", "--json"],
						profile,
					);
					expect(recheck.exitCode).toBe(0);
					expect(
						["token_file", "op", "token", "vault_scope", "profile_policy"].map(
							(gate) => checkStatus(recheck, gate),
						),
					).toEqual(["ready", "ready", "ready", "ready", "ready"]);
					expect(statSync(profile).mode & 0o777).toBe(0o700);
					expect(
						json(readFileSync(join(profile, "Default", "Preferences"), "utf8")),
					).toMatchObject({
						credentials_enable_service: false,
						profile: { password_manager_enabled: false },
						autofill: { profile_enabled: false, credit_card_enabled: false },
						sync: { requested: false },
					});
				},
				TEST_TIMEOUT_MS,
			);

			test(
				"AE2 refusal: non-empty Login Data stays intact end-to-end",
				async () => {
					const profile = join(fixture.root, "unsafe-profile");
					const defaultDir = join(profile, "Default");
					await mkdir(defaultDir, { recursive: true, mode: 0o700 });
					chmodSync(profile, 0o700);
					const loginData = join(defaultDir, "Login Data");
					writeFileSync(loginData, "saved-login", { mode: 0o600 });
					const beforeEntries = readdirSync(defaultDir);

					const doctor = await runBrowserUse(
						fixture,
						["auth", "doctor", "--json"],
						profile,
					);
					expect(doctor.exitCode).toBe(20);
					expect(profileCause(doctor)).toBe("profile-policy-unsafe");
					const fixed = await runBrowserUse(
						fixture,
						["auth", "doctor", "--fix", "profile", "--plain"],
						profile,
					);

					expect(fixed.exitCode).toBe(20);
					expect(fixed.stdout).toContain("fix profile_policy: refused");
					expect(readFileSync(loginData, "utf8")).toBe("saved-login");
					expect(readdirSync(defaultDir)).toEqual(beforeEntries);
				},
				TEST_TIMEOUT_MS,
			);

			test(
				"symlinked profile makes doctor and warm-chrome agree on refusal without writes",
				async () => {
					const target = join(fixture.root, "symlink-target");
					const profile = join(fixture.root, "symlink-profile");
					await mkdir(target, { mode: 0o700 });
					writeFileSync(join(target, "marker"), "unchanged", { mode: 0o600 });
					symlinkSync(target, profile, "dir");

					const doctor = await runBrowserUse(
						fixture,
						["auth", "doctor", "--json"],
						profile,
					);
					expect(doctor.exitCode).toBe(20);
					expect(profileCause(doctor)).toBe("profile-policy-unproven");
					const fixed = await runBrowserUse(
						fixture,
						["auth", "doctor", "--fix", "profile", "--plain"],
						profile,
					);
					const owner = await runWarmChrome(fixture, profile);

					expect(fixed.exitCode).toBe(20);
					expect(fixed.stdout).toContain(
						"fix profile_policy: owner_failed reason=unrepairable",
					);
					expect(owner.exitCode).toBe(20);
					expect((json(owner.stdout).data as JsonRecord).reason).toBe(
						"profile_path_symlink",
					);
					expect(readdirSync(target)).toEqual(["marker"]);
					expect(readFileSync(join(target, "marker"), "utf8")).toBe("unchanged");
				},
				TEST_TIMEOUT_MS,
			);

			test(
				"trailing-slash profile makes doctor and warm-chrome agree on refusal without writes",
				async () => {
					const canonical = join(fixture.root, "trailing-profile");
					const profile = `${canonical}/`;
					const beforeEntries = readdirSync(fixture.root);

					const doctor = await runBrowserUse(
						fixture,
						["auth", "doctor", "--json"],
						profile,
					);
					expect(doctor.exitCode).toBe(20);
					expect(profileCause(doctor)).toBe("profile-policy-unsafe");
					const fixed = await runBrowserUse(
						fixture,
						["auth", "doctor", "--fix", "profile", "--plain"],
						profile,
					);
					const owner = await runWarmChrome(fixture, profile);

					expect(fixed.exitCode).toBe(20);
					expect(fixed.stdout).toContain("fix profile_policy: refused");
					expect(owner.exitCode).toBe(20);
					expect((json(owner.stdout).data as JsonRecord).reason).toBe(
						"profile_path_noncanonical",
					);
					expect(existsSync(canonical)).toBe(false);
					expect(readdirSync(fixture.root)).toEqual(beforeEntries);
				},
				TEST_TIMEOUT_MS,
			);
		},
	);
});
