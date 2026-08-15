#!/usr/bin/env bun

import { createHash, randomUUID } from "node:crypto";
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, normalize } from "node:path";

import { createDefaultRuntime } from "../src/runtime.ts";

const EXIT_BLOCKED = 20;
const PROFILE_JSON_MAX_BYTES = 8 * 1_048_576;
const AVATAR_MAX_BYTES = 8 * 1_048_576;
const PROFILE_DIRECTORY = "Default";
const CHROME_AVATAR_INDEX = 8;
const CHROME_AVATAR_FILE_NAME = "Google Profile Picture.png";
const CHROME_AVATAR_ICON_URL = `chrome://theme/IDR_PROFILE_AVATAR_${CHROME_AVATAR_INDEX}`;
const AGENT_CHROME_PROFILE_COLOR_SEED = -33536;
const PRODUCT_NAME = "Agent Chrome";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Invocation = {
	mode: "check" | "apply";
	profileDir: string;
	avatarPath: string;
	json: boolean;
};

type JsonObject = Record<string, unknown>;

class AvatarFailure extends Error {
	constructor(
		readonly code: string,
		readonly nextAction: string,
		readonly exitCode = EXIT_BLOCKED,
	) {
		super(code);
	}
}

function help(): string {
	return [
		"Usage: bun run app/profile-avatar.ts (--check | --apply) --profile <path> --avatar <png> [--json]",
		"",
		"Install the Agent Chrome artwork as the dedicated Chrome profile avatar.",
		"--check    Inspect only; report whether branding is already applied.",
		"--apply    Apply branding while the dedicated Browser is stopped.",
		"--profile  Exact Agent Chrome user-data directory.",
		"--avatar   Agent Chrome PNG source.",
		"--json     Emit one machine-readable result.",
	].join("\n");
}

function parseInvocation(argv: readonly string[]): Invocation | null {
	if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
		return null;
	}
	const values = new Map<string, string>();
	let mode: Invocation["mode"] | null = null;
	let json = false;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--check" || argument === "--apply") {
			if (mode !== null) throw new AvatarFailure("invalid_usage", "inspect_help", 2);
			mode = argument === "--apply" ? "apply" : "check";
			continue;
		}
		if (argument === "--json") {
			json = true;
			continue;
		}
		if (argument === "--profile" || argument === "--avatar") {
			const value = argv[index + 1];
			if (!value || value.startsWith("--")) {
				throw new AvatarFailure("invalid_usage", "inspect_help", 2);
			}
			values.set(argument, value);
			index += 1;
			continue;
		}
		throw new AvatarFailure("invalid_usage", "inspect_help", 2);
	}
	const profileDir = values.get("--profile");
	const avatarPath = values.get("--avatar");
	if (mode === null || !profileDir || !avatarPath) {
		throw new AvatarFailure("invalid_usage", "inspect_help", 2);
	}
	return { mode, profileDir, avatarPath, json };
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nestedObject(value: unknown): JsonObject {
	return isJsonObject(value) ? value : {};
}

function expectedProfilePath(): string {
	const home = process.env.HOME?.replace(/\/+$/, "");
	if (!home?.startsWith("/")) {
		throw new AvatarFailure("home_unavailable", "set_home");
	}
	return join(
		home,
		"Library",
		"Application Support",
		PRODUCT_NAME,
		"Chrome User Data",
	);
}

function requireExactPath(actual: string, expected: string, code: string): void {
	if (
		!isAbsolute(actual) ||
		actual.includes("\0") ||
		normalize(actual) !== actual ||
		actual !== expected
	) {
		throw new AvatarFailure(code, "use_agent_chrome_path");
	}
}

async function readRegularFile(path: string, maxBytes: number): Promise<Buffer> {
	let info: Awaited<ReturnType<typeof lstat>>;
	try {
		info = await lstat(path);
	} catch {
		throw new AvatarFailure("required_file_missing", "restore_owned_file");
	}
	if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) {
		throw new AvatarFailure("required_file_unsafe", "inspect_owned_file");
	}
	return readFile(path);
}

async function readJsonFile(path: string): Promise<{ object: JsonObject; source: string }> {
	const bytes = await readRegularFile(path, PROFILE_JSON_MAX_BYTES);
	try {
		const source = bytes.toString("utf8");
		const parsed: unknown = JSON.parse(source);
		if (!isJsonObject(parsed)) throw new Error("not an object");
		return { object: parsed, source };
	} catch {
		throw new AvatarFailure("profile_json_invalid", "inspect_profile_json");
	}
}

function serializeJson(object: JsonObject, source: string): string {
	const indent = source.match(/\n([\t ]+)"/)?.[1] ?? "";
	const trailingNewline = source.endsWith("\n") ? "\n" : "";
	return `${JSON.stringify(object, null, indent)}${trailingNewline}`;
}

function sha256(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

async function writeAtomically(path: string, content: Uint8Array): Promise<void> {
	const tempPath = join(dirname(path), `.${PRODUCT_NAME}.${process.pid}.${randomUUID()}.tmp`);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(tempPath, "wx", 0o600);
		await handle.writeFile(content);
		await handle.sync();
		await handle.close();
		handle = null;
		await rename(tempPath, path);
		await chmod(path, 0o600);
	} finally {
		await handle?.close().catch(() => undefined);
		await unlink(tempPath).catch(() => undefined);
	}
}

function mergedPreferences(preferences: JsonObject): JsonObject {
	return {
		...preferences,
		profile: {
			...nestedObject(preferences.profile),
			name: PRODUCT_NAME,
			avatar_index: CHROME_AVATAR_INDEX,
			using_default_avatar: false,
			using_gaia_avatar: true,
		},
	};
}

function mergedLocalState(localState: JsonObject): JsonObject {
	const profile = nestedObject(localState.profile);
	const infoCache = nestedObject(profile.info_cache);
	const defaultProfile = nestedObject(infoCache[PROFILE_DIRECTORY]);
	return {
		...localState,
		profile: {
			...profile,
			info_cache: {
				...infoCache,
				[PROFILE_DIRECTORY]: {
					...defaultProfile,
					name: PRODUCT_NAME,
					profile_color_seed: AGENT_CHROME_PROFILE_COLOR_SEED,
					avatar_icon: CHROME_AVATAR_ICON_URL,
					is_using_default_name: false,
					is_using_default_avatar: false,
					gaia_picture_file_name: CHROME_AVATAR_FILE_NAME,
					use_gaia_picture: true,
				},
			},
		},
	};
}

function browserAccountIsSignedIn(localState: JsonObject): boolean {
	const cache = nestedObject(nestedObject(localState.profile).info_cache);
	const profile = nestedObject(cache[PROFILE_DIRECTORY]);
	return (
		(typeof profile.gaia_id === "string" && profile.gaia_id.length > 0) ||
		(typeof profile.user_name === "string" && profile.user_name.length > 0) ||
		profile.is_consented_primary_account === true
	);
}

function profileMetadataIsBranded(
	localState: JsonObject,
	preferences: JsonObject,
): boolean {
	const cache = nestedObject(nestedObject(localState.profile).info_cache);
	const cachedProfile = nestedObject(cache[PROFILE_DIRECTORY]);
	const preferenceProfile = nestedObject(preferences.profile);
	return (
		cachedProfile.name === PRODUCT_NAME &&
		cachedProfile.profile_color_seed === AGENT_CHROME_PROFILE_COLOR_SEED &&
		cachedProfile.avatar_icon === CHROME_AVATAR_ICON_URL &&
		cachedProfile.is_using_default_avatar === false &&
		cachedProfile.use_gaia_picture === true &&
		preferenceProfile.name === PRODUCT_NAME &&
		preferenceProfile.using_default_avatar === false &&
		preferenceProfile.using_gaia_avatar === true
	);
}

async function profileIsLocked(profileDir: string): Promise<boolean> {
	const runtime = createDefaultRuntime();
	const lock = await runtime.readSingletonLock(profileDir);
	if (lock === null) return false;
	if (lock.pid === null) return true;
	return runtime.isProcessAlive(lock.pid);
}

async function ensureProfileDirectories(profileDir: string): Promise<void> {
	await mkdir(join(profileDir, PROFILE_DIRECTORY), {
		recursive: true,
		mode: 0o700,
	});
	if ((await realpath(profileDir)) !== profileDir) {
		throw new AvatarFailure("profile_path_symlink", "use_agent_chrome_path");
	}
	const profileInfo = await lstat(profileDir);
	if (!profileInfo.isDirectory() || profileInfo.isSymbolicLink()) {
		throw new AvatarFailure("profile_path_unsafe", "inspect_profile_path");
	}
	await Promise.all([
		chmod(profileDir, 0o700),
		chmod(join(profileDir, PROFILE_DIRECTORY), 0o700),
	]);
}

function emit(json: boolean, payload: JsonObject): void {
	if (json) {
		process.stdout.write(`${JSON.stringify(payload)}\n`);
		return;
	}
	process.stdout.write(`${String(payload.status)}: ${String(payload.profile_avatar)}\n`);
}

async function main(argv: readonly string[]): Promise<number> {
	let invocation: Invocation | null;
	try {
		invocation = parseInvocation(argv);
	} catch (error) {
		const failure = error as AvatarFailure;
		emit(argv.includes("--json"), {
			status: "blocked",
			code: failure.code,
			changed_state: "none",
			next_action: failure.nextAction,
		});
		return failure.exitCode;
	}
	if (invocation === null) {
		process.stdout.write(`${help()}\n`);
		return 0;
	}
	try {
		const expectedProfile = expectedProfilePath();
		requireExactPath(invocation.profileDir, expectedProfile, "profile_path_invalid");
		requireExactPath(
			invocation.avatarPath,
			normalize(invocation.avatarPath),
			"avatar_path_invalid",
		);
		const avatar = await readRegularFile(invocation.avatarPath, AVATAR_MAX_BYTES);
		if (!avatar.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
			throw new AvatarFailure("avatar_not_png", "restore_owned_avatar");
		}

		const localStatePath = join(expectedProfile, "Local State");
		const preferencesPath = join(expectedProfile, PROFILE_DIRECTORY, "Preferences");
		const installedAvatarPath = join(
			expectedProfile,
			PROFILE_DIRECTORY,
			CHROME_AVATAR_FILE_NAME,
		);
		let localStateSource = "{}\n";
		let preferencesSource = "{}\n";
		let localState: JsonObject = {};
		let preferences: JsonObject = {};
		try {
			({ object: localState, source: localStateSource } = await readJsonFile(localStatePath));
		} catch (error) {
			if ((error as AvatarFailure).code !== "required_file_missing") throw error;
		}
		try {
			({ object: preferences, source: preferencesSource } = await readJsonFile(preferencesPath));
		} catch (error) {
			if ((error as AvatarFailure).code !== "required_file_missing") throw error;
		}
		if (browserAccountIsSignedIn(localState)) {
			emit(invocation.json, {
				status: "verified",
				profile_avatar: "browser_account_preserved",
				changed_state: "none",
				next_action: "launch_agent_chrome",
			});
			return 0;
		}

		const nextLocalState = mergedLocalState(localState);
		const nextPreferences = mergedPreferences(preferences);
		const installedAvatar = await readFile(installedAvatarPath).catch(() => null);
		const branded =
			installedAvatar !== null &&
			sha256(installedAvatar) === sha256(avatar) &&
			JSON.stringify(nextLocalState) === JSON.stringify(localState) &&
			JSON.stringify(nextPreferences) === JSON.stringify(preferences);
		if (branded) {
			emit(invocation.json, {
				status: "verified",
				profile_avatar: "agent_chrome",
				changed_state: "none",
				next_action: "launch_agent_chrome",
			});
			return 0;
		}
		const locked = await profileIsLocked(expectedProfile);
		if (locked && profileMetadataIsBranded(localState, preferences)) {
			emit(invocation.json, {
				status: "verified",
				profile_avatar: "agent_chrome",
				changed_state: "none",
				next_action: "reuse_running_agent_chrome",
			});
			return 0;
		}
		if (invocation.mode === "check") {
			emit(invocation.json, {
				status: "preview",
				profile_avatar: "agent_chrome",
				changed_state: "none",
				next_action: "apply_while_stopped",
			});
			return 0;
		}
		if (locked) {
			throw new AvatarFailure("profile_running", "close_agent_chrome");
		}

		await ensureProfileDirectories(expectedProfile);
		await writeAtomically(installedAvatarPath, avatar);
		await writeAtomically(
			preferencesPath,
			Buffer.from(serializeJson(nextPreferences, preferencesSource)),
		);
		await writeAtomically(
			localStatePath,
			Buffer.from(serializeJson(nextLocalState, localStateSource)),
		);
		emit(invocation.json, {
			status: "branded",
			profile_avatar: "agent_chrome",
			changed_state: "profile_avatar_installed",
			next_action: "launch_agent_chrome",
		});
		return 0;
	} catch (error) {
		const failure =
			error instanceof AvatarFailure
				? error
				: new AvatarFailure("avatar_install_failed", "inspect_diagnostics");
		emit(invocation.json, {
			status: "blocked",
			code: failure.code,
			profile_avatar: "agent_chrome",
			changed_state: "none",
			next_action: failure.nextAction,
		});
		return failure.exitCode;
	}
}

process.exitCode = await main(process.argv.slice(2));
