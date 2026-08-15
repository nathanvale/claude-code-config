import {
	cp,
	lstat,
	mkdtemp,
	mkdir,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "bun:test";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const INSTALLER = join(PACKAGE_ROOT, "app", "install.ts");
const LAUNCH_SERVICES_REGISTER =
	"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const temporaryRoots: string[] = [];

type CommandResult = {
	exitCode: number;
	stdout: string;
	stderr: string;
};

afterEach(async () => {
	for (const root of temporaryRoots) {
		for (const name of ["Agent Chrome.app", "Everyday Chrome.app"]) {
			const app = join(root, "Applications", name);
			if (await lstat(app).catch(() => null)) {
				Bun.spawnSync([LAUNCH_SERVICES_REGISTER, "-u", app], {
					stdin: "ignore",
					stdout: "ignore",
					stderr: "ignore",
				});
			}
		}
	}
	await Promise.all(
		temporaryRoots.splice(0).map((path) =>
			rm(path, { recursive: true, force: true }),
		),
	);
});

async function temporaryHome(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "agent-chrome-app-test-"));
	temporaryRoots.push(root);
	return root;
}

async function run(
	argv: readonly string[],
	options: { home: string },
): Promise<CommandResult> {
	const child = Bun.spawn([...argv], {
		cwd: PACKAGE_ROOT,
		env: {
			...process.env,
			HOME: options.home,
			PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
		},
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

describe("Agent Chrome native app installation", () => {
	test("preview is read-only and apply installs signed Agent and human-only Everyday actions", async () => {
		const home = await temporaryHome();
		const app = join(home, "Applications", "Agent Chrome.app");
		const everydayApp = join(home, "Applications", "Everyday Chrome.app");

		const preview = await run(
			[process.execPath, "run", INSTALLER, "--check", "--json"],
			{ home },
		);
		expect(preview.exitCode).toBe(0);
		expect(JSON.parse(preview.stdout)).toMatchObject({
			status: "preview",
			changed_state: "none",
			app,
			everyday_app: everydayApp,
			next_action: "apply_install",
		});
		expect(await lstat(app).catch(() => null)).toBeNull();
		expect(await lstat(everydayApp).catch(() => null)).toBeNull();

		const apply = await run(
			[process.execPath, "run", INSTALLER, "--apply", "--json"],
			{ home },
		);
		expect(apply.exitCode).toBe(0);
		expect(JSON.parse(apply.stdout)).toMatchObject({
			status: "installed",
			changed_state: "launcher_installed",
		});
		const installed = await lstat(app);
		expect(installed.isDirectory()).toBe(true);
		expect(installed.isSymbolicLink()).toBe(false);
		expect((await lstat(everydayApp)).isDirectory()).toBe(true);

		const signature = await run(
			["/usr/bin/codesign", "--verify", "--strict", "--all-architectures", app],
			{ home },
		);
		expect(signature.exitCode).toBe(0);
		const everydaySignature = await run(
			[
				"/usr/bin/codesign",
				"--verify",
				"--strict",
				"--all-architectures",
				everydayApp,
			],
			{ home },
		);
		expect(everydaySignature.exitCode).toBe(0);

		const executable = join(app, "Contents", "MacOS", "Agent Chrome");
		const verifier = await run([executable, "verifier"], { home });
		expect(verifier.exitCode).toBe(0);
		expect(JSON.parse(verifier.stdout)).toMatchObject({
			status: "verified",
			launcher: "native",
			helper: "embedded",
			profile_avatar: "embedded",
			chrome_launch: "launch_services",
		});
		const everydayVerifier = await run(
			[join(everydayApp, "Contents", "MacOS", "Everyday Chrome"), "verifier"],
			{ home },
		);
		expect(everydayVerifier.exitCode).toBe(0);
		expect(JSON.parse(everydayVerifier.stdout)).toMatchObject({
			status: "verified",
			launcher: "human_only",
			chrome_launch: "launch_services",
			automation: "none",
			arguments: "none",
		});
		expect(
			(await lstat(join(app, "Contents", "Helpers", "agent-chrome-profile-avatar"))).isFile(),
		).toBe(true);
		expect(
			(await lstat(join(app, "Contents", "Resources", "agent-chrome-avatar.png"))).isFile(),
		).toBe(true);
		const launchServicesHelper = join(
			app,
			"Contents",
			"Helpers",
			"chrome-launch-services",
		);
		expect((await lstat(launchServicesHelper)).isFile()).toBe(true);
		const launchServicesHelp = await run([launchServicesHelper, "--help"], {
			home,
		});
		expect(launchServicesHelp.exitCode).toBe(0);
		expect(launchServicesHelp.stdout).toContain(
			"Launch Google Chrome through macOS Launch Services",
		);
		for (const startupURL of ["-incognito", "relative/path", "file:///tmp"]) {
			const rejected = await run(
				[
					launchServicesHelper,
					"--chrome",
					"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
					"--port",
					"9222",
					"--profile",
					join(
						homedir(),
						"Library",
						"Application Support",
						"Agent Chrome",
						"Chrome User Data",
					),
					"--profile-directory",
					"Default",
					"--startup-url",
					startupURL,
				],
				{ home },
			);
			expect(rejected.exitCode).toBe(20);
			expect(JSON.parse(rejected.stdout)).toMatchObject({
				status: "blocked",
				code: "invalid_startup_url",
				changed_state: "none",
			});
		}

		const helper = join(app, "Contents", "Helpers", "warm-chrome");
		const help = await run([helper, "launch", "--help"], { home });
		expect(help.exitCode).toBe(0);
		expect(help.stdout).toContain("warm-chrome launch");
		expect(
			(await readdir(PACKAGE_ROOT)).filter((entry) => entry.endsWith(".bun-build")),
		).toEqual([]);

		const legacyRetained = join(
			home,
			"Applications",
			"Agent Chrome.retained-2026-08-14T00-00-00.000Z.app",
		);
		await cp(app, legacyRetained, { recursive: true });
		const replace = await run(
			[process.execPath, "run", INSTALLER, "--apply", "--json"],
			{ home },
		);
		expect(replace.exitCode).toBe(0);
		const replaced = JSON.parse(replace.stdout) as Record<string, unknown>;
		expect(replaced).toMatchObject({
			status: "installed",
			changed_state: "launcher_installed",
		});
		expect(String(replaced.retained_app)).toStartWith(
			join(
				home,
				"Library",
				"Application Support",
				"Agent Chrome",
				"Installer Backups",
			),
		);
		expect(String(replaced.retained_app)).not.toEndWith(".app");
		expect(String(replaced.retained_everyday_app)).toStartWith(
			join(
				home,
				"Library",
				"Application Support",
				"Agent Chrome",
				"Installer Backups",
			),
		);
		expect(String(replaced.retained_everyday_app)).not.toEndWith(".app");
		expect(
			(await readdir(join(home, "Applications"))).filter((entry) =>
				entry.startsWith("Agent Chrome.retained-"),
			),
		).toEqual([]);
		expect(await lstat(legacyRetained).catch(() => null)).toBeNull();
	}, 60_000);

	test("a foreign destination is preserved and blocks install before build", async () => {
		const home = await temporaryHome();
		const app = join(home, "Applications", "Agent Chrome.app");
		await mkdir(app, { recursive: true });
		await writeFile(join(app, "foreign.txt"), "preserve me\n");

		const apply = await run(
			[process.execPath, "run", INSTALLER, "--apply", "--json"],
			{ home },
		);
		expect(apply.exitCode).toBe(20);
		expect(JSON.parse(apply.stdout)).toMatchObject({
			status: "blocked",
			code: "foreign_launcher_preserved",
			changed_state: "none",
		});
		expect(await Bun.file(join(app, "foreign.txt")).text()).toBe(
			"preserve me\n",
		);
	});

	test("a foreign Everyday Chrome action blocks both installs before build", async () => {
		const home = await temporaryHome();
		const agentApp = join(home, "Applications", "Agent Chrome.app");
		const everydayApp = join(home, "Applications", "Everyday Chrome.app");
		await mkdir(everydayApp, { recursive: true });
		await writeFile(join(everydayApp, "foreign.txt"), "preserve me\n");

		const apply = await run(
			[process.execPath, "run", INSTALLER, "--apply", "--json"],
			{ home },
		);
		expect(apply.exitCode).toBe(20);
		expect(JSON.parse(apply.stdout)).toMatchObject({
			status: "blocked",
			code: "foreign_launcher_preserved",
			changed_state: "none",
			app: everydayApp,
		});
		expect(await Bun.file(join(everydayApp, "foreign.txt")).text()).toBe(
			"preserve me\n",
		);
		expect(await lstat(agentApp).catch(() => null)).toBeNull();
	});
});
