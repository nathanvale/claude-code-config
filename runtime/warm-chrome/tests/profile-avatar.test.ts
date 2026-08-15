import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	unlink,
	writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test } from "bun:test";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const INSTALLER = join(PACKAGE_ROOT, "app", "profile-avatar.ts");
const PNG = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x41, 0x67, 0x65, 0x6e,
	0x74,
]);
const AGENT_CHROME_PROFILE_COLOR_SEED = -33536;
const temporaryRoots: string[] = [];

type Fixture = {
	home: string;
	profile: string;
	avatar: string;
	everydaySentinel: string;
};

afterEach(async () => {
	await Promise.all(
		temporaryRoots.splice(0).map((path) =>
			rm(path, { recursive: true, force: true }),
		),
	);
});

async function fixture(): Promise<Fixture> {
	const createdHome = await mkdtemp(join(tmpdir(), "agent-chrome-avatar-test-"));
	temporaryRoots.push(createdHome);
	const home = await realpath(createdHome);
	const profile = join(
		home,
		"Library",
		"Application Support",
		"Agent Chrome",
		"Chrome User Data",
	);
	const avatar = join(home, "agent-chrome.png");
	const everydaySentinel = join(
		home,
		"Library",
		"Application Support",
		"Google",
		"Chrome",
		"preserve.txt",
	);
	await mkdir(join(profile, "Default"), { recursive: true, mode: 0o700 });
	await mkdir(join(home, "Library", "Application Support", "Google", "Chrome"), {
		recursive: true,
	});
	await Promise.all([
		writeFile(
			join(profile, "Local State"),
			`${JSON.stringify({
				profile: {
					info_cache: {
						Default: {
							name: "Your Chrome",
							avatar_icon: "chrome://theme/IDR_PROFILE_AVATAR_26",
							is_using_default_avatar: true,
						},
					},
				},
				unrelated: { preserve: true },
			})}\n`,
			{ mode: 0o600 },
		),
		writeFile(
			join(profile, "Default", "Preferences"),
			`${JSON.stringify({
				profile: { name: "Your Chrome", avatar_index: 26 },
				unrelated: { preserve: true },
			})}\n`,
			{ mode: 0o600 },
		),
		writeFile(avatar, PNG, { mode: 0o600 }),
		writeFile(everydaySentinel, "preserve\n", { mode: 0o600 }),
	]);
	return { home, profile, avatar, everydaySentinel };
}

async function run(
	state: Fixture,
	mode: "--check" | "--apply",
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	const child = Bun.spawn(
		[
			process.execPath,
			"run",
			INSTALLER,
			mode,
			"--profile",
			state.profile,
			"--avatar",
			state.avatar,
			"--json",
		],
		{
			cwd: PACKAGE_ROOT,
			env: {
				...process.env,
				HOME: state.home,
				PATH: "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin",
			},
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	return { exitCode, stdout, stderr };
}

async function expectProfileBytes(
	state: Fixture,
	localState: Buffer,
	preferences: Buffer,
): Promise<void> {
	expect(
		Buffer.compare(await readFile(join(state.profile, "Local State")), localState),
	).toBe(0);
	expect(
		Buffer.compare(
			await readFile(join(state.profile, "Default", "Preferences")),
			preferences,
		),
	).toBe(0);
}

async function expectNoInstalledAvatar(state: Fixture): Promise<void> {
	expect(
		await lstat(
			join(state.profile, "Default", "Google Profile Picture.png"),
		).catch(() => null),
	).toBeNull();
}

async function changeFlags(flag: "uchg" | "nouchg", path: string): Promise<void> {
	const child = Bun.spawn(["/usr/bin/chflags", flag, path], {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	expect(await child.exited).toBe(0);
}

describe("Agent Chrome profile avatar", () => {
	test("rejects an out-of-scope profile before reading or writing it", async () => {
		const state = await fixture();
		const localStateBefore = await readFile(join(state.profile, "Local State"));
		const preferencesBefore = await readFile(
			join(state.profile, "Default", "Preferences"),
		);
		const result = await run(
			{ ...state, profile: join(state.home, "out-of-scope-profile") },
			"--apply",
		);

		expect(result.exitCode).toBe(20);
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "blocked",
			code: "profile_path_invalid",
			changed_state: "none",
			next_action: "use_agent_chrome_path",
		});
		await expectProfileBytes(state, localStateBefore, preferencesBefore);
		await expectNoInstalledAvatar(state);
	});

	test("rejects relative and non-normalized avatar paths", async () => {
		const state = await fixture();
		const localStateBefore = await readFile(join(state.profile, "Local State"));
		const preferencesBefore = await readFile(
			join(state.profile, "Default", "Preferences"),
		);

		for (const avatar of [
			"agent-chrome.png",
			`${state.home}/nested/../agent-chrome.png`,
		]) {
			const result = await run({ ...state, avatar }, "--apply");
			expect(result.exitCode).toBe(20);
			expect(JSON.parse(result.stdout)).toMatchObject({
				status: "blocked",
				code: "avatar_path_invalid",
				changed_state: "none",
				next_action: "use_agent_chrome_path",
			});
		}

		await expectProfileBytes(state, localStateBefore, preferencesBefore);
		await expectNoInstalledAvatar(state);
	});

	test("rejects a non-PNG avatar without changing profile state", async () => {
		const state = await fixture();
		const localStateBefore = await readFile(join(state.profile, "Local State"));
		const preferencesBefore = await readFile(
			join(state.profile, "Default", "Preferences"),
		);
		await writeFile(state.avatar, "not a png\n", { mode: 0o600 });

		const result = await run(state, "--apply");
		expect(result.exitCode).toBe(20);
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "blocked",
			code: "avatar_not_png",
			changed_state: "none",
			next_action: "restore_owned_avatar",
		});
		await expectProfileBytes(state, localStateBefore, preferencesBefore);
		await expectNoInstalledAvatar(state);
	});

	test("rejects a symlinked profile root before creating its Default directory", async () => {
		const state = await fixture();
		const foreignRoot = join(state.home, "foreign-profile-root");
		await rm(state.profile, { recursive: true });
		await mkdir(foreignRoot, { mode: 0o700 });
		await symlink(foreignRoot, state.profile);

		const result = await run(state, "--apply");
		expect(result.exitCode).toBe(20);
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "blocked",
			code: "profile_path_symlink",
			changed_state: "none",
			next_action: "use_agent_chrome_path",
		});
		expect(await lstat(join(foreignRoot, "Default")).catch(() => null)).toBeNull();
	});

	test("preview is read-only and apply installs the generated artwork without touching Everyday Chrome", async () => {
		const state = await fixture();
		const localStateBefore = await readFile(join(state.profile, "Local State"));
		const preferencesBefore = await readFile(
			join(state.profile, "Default", "Preferences"),
		);

		const preview = await run(state, "--check");
		expect(preview.exitCode).toBe(0);
		expect(JSON.parse(preview.stdout)).toMatchObject({
			status: "preview",
			changed_state: "none",
			next_action: "apply_while_stopped",
		});
		expect(await readFile(join(state.profile, "Local State"))).toEqual(
			localStateBefore,
		);
		expect(
			await readFile(join(state.profile, "Default", "Preferences")),
		).toEqual(preferencesBefore);

		const apply = await run(state, "--apply");
		expect(apply.exitCode).toBe(0);
		expect(JSON.parse(apply.stdout)).toMatchObject({
			status: "branded",
			profile_avatar: "agent_chrome",
			changed_state: "profile_avatar_installed",
		});
		expect(
			await readFile(
				join(state.profile, "Default", "Google Profile Picture.png"),
			),
		).toEqual(PNG);
		const localState = JSON.parse(
			await readFile(join(state.profile, "Local State"), "utf8"),
		);
		expect(localState).toMatchObject({
			profile: {
				info_cache: {
					Default: {
						name: "Agent Chrome",
						profile_color_seed: AGENT_CHROME_PROFILE_COLOR_SEED,
						is_using_default_avatar: false,
						gaia_picture_file_name: "Google Profile Picture.png",
						use_gaia_picture: true,
					},
				},
			},
			unrelated: { preserve: true },
		});
		const preferences = JSON.parse(
			await readFile(join(state.profile, "Default", "Preferences"), "utf8"),
		);
		expect(preferences).toMatchObject({
			profile: {
				name: "Agent Chrome",
				using_default_avatar: false,
				using_gaia_avatar: true,
			},
			unrelated: { preserve: true },
		});
		expect(await readFile(state.everydaySentinel, "utf8")).toBe("preserve\n");

		const converged = await run(state, "--apply");
		expect(converged.exitCode).toBe(0);
		expect(JSON.parse(converged.stdout)).toMatchObject({
			status: "verified",
			changed_state: "none",
		});
	});

	test("a live Agent Chrome lock blocks an unapplied avatar", async () => {
		const state = await fixture();
		const lock = join(state.profile, "SingletonLock");
		await symlink(`${hostname()}-${process.pid}`, lock);

		const result = await run(state, "--apply");
		expect(result.exitCode).toBe(20);
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "blocked",
			code: "profile_running",
			changed_state: "none",
			next_action: "close_agent_chrome",
		});
		expect(await readlink(lock)).toBe(`${hostname()}-${process.pid}`);
		await expectNoInstalledAvatar(state);
	});

	test("a live local lock remains authoritative after the Mac hostname changes", async () => {
		const state = await fixture();
		const lock = join(state.profile, "SingletonLock");
		const localStateBefore = await readFile(join(state.profile, "Local State"));
		const preferencesBefore = await readFile(
			join(state.profile, "Default", "Preferences"),
		);
		await symlink(`previous-hostname-${process.pid}`, lock);

		const result = await run(state, "--apply");
		expect(result.exitCode).toBe(20);
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "blocked",
			code: "profile_running",
			changed_state: "none",
			next_action: "close_agent_chrome",
		});
		await expectProfileBytes(state, localStateBefore, preferencesBefore);
		await expectNoInstalledAvatar(state);
	});

	test("an already-branded running session remains reusable after Chrome consumes the backing file", async () => {
		const state = await fixture();
		const applied = await run(state, "--apply");
		expect(applied.exitCode).toBe(0);

		const localStatePath = join(state.profile, "Local State");
		const localState = JSON.parse(await readFile(localStatePath, "utf8"));
		localState.profile.info_cache.Default.gaia_picture_file_name = "";
		await writeFile(localStatePath, `${JSON.stringify(localState)}\n`, {
			mode: 0o600,
		});
		await unlink(
			join(state.profile, "Default", "Google Profile Picture.png"),
		);
		await symlink(
			`${hostname()}-${process.pid}`,
			join(state.profile, "SingletonLock"),
		);

		const result = await run(state, "--apply");
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "verified",
			profile_avatar: "agent_chrome",
			changed_state: "none",
			next_action: "reuse_running_agent_chrome",
		});
		expect(
			await lstat(
				join(state.profile, "Default", "Google Profile Picture.png"),
			).catch(() => null),
		).toBeNull();
	});

	test("browser-level Google sign-in preserves the account avatar and leaks no identity", async () => {
		const state = await fixture();
		await writeFile(
			join(state.profile, "Local State"),
			`${JSON.stringify({
				profile: {
					info_cache: {
						Default: { gaia_id: "private-account-id" },
					},
				},
			})}\n`,
			{ mode: 0o600 },
		);
		const localStateBefore = await readFile(join(state.profile, "Local State"));
		const preferencesBefore = await readFile(
			join(state.profile, "Default", "Preferences"),
		);

		const result = await run(state, "--apply");
		expect(result.exitCode).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "verified",
			profile_avatar: "browser_account_preserved",
			changed_state: "none",
			next_action: "launch_agent_chrome",
		});
		await expectProfileBytes(state, localStateBefore, preferencesBefore);
		await expectNoInstalledAvatar(state);
		expect(result.stdout).not.toContain("private-account-id");
		expect(result.stderr).not.toContain("private-account-id");
	});

	test("rejects an unsafe installed avatar instead of following it", async () => {
		const state = await fixture();
		const foreignAvatar = join(state.home, "foreign-avatar.png");
		const installedAvatar = join(
			state.profile,
			"Default",
			"Google Profile Picture.png",
		);
		await writeFile(foreignAvatar, PNG, { mode: 0o600 });
		await symlink(foreignAvatar, installedAvatar);

		const result = await run(state, "--check");
		expect(result.exitCode).toBe(20);
		expect(JSON.parse(result.stdout)).toMatchObject({
			status: "blocked",
			code: "required_file_unsafe",
			changed_state: "none",
			next_action: "inspect_owned_file",
		});
		expect(await readlink(installedAvatar)).toBe(foreignAvatar);
	});

	test.skipIf(process.platform !== "darwin")(
		"reports the last completed mutation when a later profile write is blocked",
		async () => {
			const state = await fixture();
			const preferencesPath = join(state.profile, "Default", "Preferences");
			await changeFlags("uchg", preferencesPath);
			try {
				const result = await run(state, "--apply");
				expect(result.exitCode).toBe(20);
				expect(JSON.parse(result.stdout)).toMatchObject({
					status: "blocked",
					code: "avatar_install_failed",
					changed_state: "profile_avatar_written",
					next_action: "inspect_diagnostics",
				});
				expect(
					await readFile(
						join(state.profile, "Default", "Google Profile Picture.png"),
					),
				).toEqual(PNG);
			} finally {
				await changeFlags("nouchg", preferencesPath);
			}
		},
	);
});
