import type { VaultGitProcessResult } from "./ports.ts";

/** Safe-remote validation failure classifies policy refusal versus unavailable proof. */
export class VaultGitRemoteSafetyError extends Error {
	/** Construct a stable fail-closed remote-safety failure. */
	constructor(
		readonly kind: "unsafe" | "unavailable",
		message: string,
	) {
		super(message);
		this.name = "VaultGitRemoteSafetyError";
	}
}

/** Inputs for validating one Git remote before any network-capable command. */
export interface VaultGitRemoteSafetyOptions {
	readonly remote: string;
	readonly timeoutMs: number;
	readonly allowedRemoteHosts: ReadonlySet<string>;
	readonly runGit: (
		args: readonly string[],
		timeoutMs: number,
	) => Promise<VaultGitProcessResult>;
}

/**
 * Prove one configured remote is non-executable and targets an admitted endpoint.
 *
 * @returns The exact configured target safe for a subsequent network operation
 */
export async function assertVaultGitSafeRemoteTarget(
	options: VaultGitRemoteSafetyOptions,
): Promise<string> {
	assertSafeRemoteSpecifier(options.remote);
	await refuseConfiguredValue(
		options,
		["config", "--includes", "--get-regexp", "^url\\..*\\.insteadof$"],
		"configured insteadOf rewrites are not accepted",
	);
	await assertNoExecutableLocalGitConfig(options);

	let configuredTarget = options.remote;
	if (isRemoteName(options.remote)) {
		const configured = await options.runGit(
			["config", "--includes", "--get-all", `remote.${options.remote}.url`],
			options.timeoutMs,
		);
		assertAvailableResult(configured, "configured remote URL");
		const targets = configured.stdout.trim().split("\n").filter(Boolean);
		if (configured.exitCode !== 0 || targets.length !== 1) {
			throw unsafe("configured remote must have one exact URL");
		}
		configuredTarget = targets[0] ?? "";
	}
	assertNetworkUrlHasNoQueryOrFragment(configuredTarget);

	const effective = await options.runGit(
		["ls-remote", "--get-url", options.remote],
		options.timeoutMs,
	);
	assertAvailableResult(effective, "effective remote URL");
	const effectiveTargets = effective.stdout.trim().split("\n").filter(Boolean);
	if (effective.exitCode !== 0 || effectiveTargets.length !== 1) {
		throw unsafe("effective remote must resolve to one exact URL");
	}
	if ((effectiveTargets[0] ?? "") !== configuredTarget) {
		throw unsafe("effective remote URL differs from the configured target");
	}
	assertSafeRemoteEndpoint(configuredTarget, options.allowedRemoteHosts);
	return configuredTarget;
}

/** Normalize and validate the exact network-host admission set. */
export function normalizeVaultGitAllowedRemoteHosts(
	hosts: readonly string[],
): ReadonlySet<string> {
	const normalized = new Set<string>();
	for (const host of hosts) {
		const value = host.trim().toLowerCase();
		const labels = value.split(".");
		if (
			value.length > 253 ||
			labels.some(
				(label) =>
					!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
			)
		) {
			throw new Error("allowed remote hosts must be exact DNS names");
		}
		normalized.add(value);
	}
	return normalized;
}

async function assertNoExecutableLocalGitConfig(
	options: VaultGitRemoteSafetyOptions,
): Promise<void> {
	const configured = await options.runGit(
		["config", "--local", "--includes", "--name-only", "--list"],
		options.timeoutMs,
	);
	if (configured.timedOut || configured.exitCode === null) {
		throw unavailable("repository Git configuration");
	}
	if (configured.exitCode !== 0 && configured.exitCode !== 1) {
		throw unavailable("repository Git configuration");
	}
	const executableKeys = new Set([
		"core.askpass",
		"core.fsmonitor",
		"core.gitproxy",
		"core.sshcommand",
		"credential.helper",
		"protocol.ext.allow",
	]);
	for (const rawKey of configured.stdout.split("\n")) {
		const key = rawKey.trim().toLowerCase();
		if (
			executableKeys.has(key) ||
			/^http(?:\..+)?\.extraheader$/.test(key) ||
			/^remote\..*\.(proxy|receivepack|uploadpack|vcs)$/.test(key)
		) {
			throw unsafe(
				"repository Git configuration contains an executable transport helper",
			);
		}
	}
}

async function refuseConfiguredValue(
	options: VaultGitRemoteSafetyOptions,
	args: readonly string[],
	refusalMessage: string,
): Promise<void> {
	const configured = await options.runGit(args, options.timeoutMs);
	if (configured.timedOut || configured.exitCode === null) {
		throw unavailable("configured remote redirection");
	}
	if (configured.exitCode === 0 && configured.stdout.trim().length > 0) {
		throw unsafe(refusalMessage);
	}
	if (configured.exitCode !== 0 && configured.exitCode !== 1) {
		throw unavailable("configured remote redirection");
	}
}

function assertAvailableResult(
	result: VaultGitProcessResult,
	owner: string,
): void {
	if (result.timedOut || result.exitCode === null) throw unavailable(owner);
}

function assertSafeRemoteSpecifier(remote: string): void {
	assertNetworkUrlHasNoQueryOrFragment(remote);
	const safeRemoteName = isRemoteName(remote);
	const isApprovedUrl = /^(?:https?|ssh|git|file):\/\/[^\s]+$/.test(remote);
	const isAbsolutePath = /^\/[^\r\n\0]*$/.test(remote);
	const isScpLike = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:[^:\s][^\s]*$/.test(
		remote,
	);
	if (
		remote.trim().length === 0 ||
		remote.startsWith("-") ||
		/[\r\n\0]/.test(remote) ||
		!(safeRemoteName || isApprovedUrl || isAbsolutePath || isScpLike)
	) {
		throw unsafe("remote must be one safe Git remote name or URL");
	}
}

function assertNetworkUrlHasNoQueryOrFragment(target: string): void {
	if (/^(?:https?|ssh|git):\/\//.test(target) && /[?#]/.test(target)) {
		throw unsafe("network remote URL must not contain a query or fragment");
	}
}

function isRemoteName(remote: string): boolean {
	return /^[A-Za-z0-9._-]+$/.test(remote) && remote !== "." && remote !== "..";
}

function assertSafeRemoteEndpoint(
	target: string,
	allowedRemoteHosts: ReadonlySet<string>,
): void {
	if (/^\/[^\r\n\0]*$/.test(target)) return;
	if (
		!target.includes("://") &&
		/^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+:[^:\s][^\s]*$/.test(target)
	) {
		const authority = target.slice(0, target.indexOf(":"));
		assertAllowedRemoteHost(
			authority.split("@").at(-1) ?? "",
			allowedRemoteHosts,
		);
		return;
	}
	let parsed: URL;
	try {
		parsed = new URL(target);
	} catch {
		throw unsafe("remote URL uses an unsafe transport or path");
	}
	if (parsed.protocol === "file:") {
		if (
			parsed.username.length > 0 ||
			parsed.password.length > 0 ||
			(parsed.hostname.length > 0 && parsed.hostname !== "localhost")
		) {
			throw unsafe("remote URL uses an unsafe transport or embedded credentials");
		}
		return;
	}
	if (!["https:", "ssh:"].includes(parsed.protocol)) {
		throw unsafe("remote URL uses an unsafe transport or path");
	}
	if (
		parsed.password.length > 0 ||
		(parsed.protocol !== "ssh:" && parsed.username.length > 0)
	) {
		throw unsafe("remote URL uses an unsafe transport or embedded credentials");
	}
	assertAllowedRemoteHost(parsed.hostname, allowedRemoteHosts);
}

function assertAllowedRemoteHost(
	host: string,
	allowedRemoteHosts: ReadonlySet<string>,
): void {
	if (!allowedRemoteHosts.has(host.toLowerCase())) {
		throw unsafe("remote host is not admitted by adapter construction");
	}
}

function unsafe(message: string): VaultGitRemoteSafetyError {
	return new VaultGitRemoteSafetyError("unsafe", message);
}

function unavailable(owner: string): VaultGitRemoteSafetyError {
	return new VaultGitRemoteSafetyError(
		"unavailable",
		`could not validate ${owner}`,
	);
}
