import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

/** Closed refusal vocabulary for an unusable admitted Installed Runtime. */
export type VaultGitInstalledRuntimeRunnerRefusal =
	| "runtime_unresolvable"
	| "runtime_not_executable"
	| "bun_alias_missing"
	| "bun_alias_redirected";

/** One truthful spawn contract for the admitted Installed Runtime bytes. */
export type VaultGitInstalledRuntimeRunner =
	| {
			readonly status: "resolved";
			/** Canonical admitted execution bytes; the only program spawned. */
			readonly command: string;
			/** Isolated environment whose nested `bun` is the same bytes. */
			readonly environment: Readonly<Record<string, string>>;
	  }
	| {
			readonly status: "unusable";
			readonly reason: VaultGitInstalledRuntimeRunnerRefusal;
	  };

/**
 * Resolve the single installed-runtime runner contract shared by Completion
 * Vault Check and the checker-admission execution lane.
 *
 * The admitted runtime is a `bun build --compile` executable, so a bare
 * `run check` argv would reach the embedded Vault Git program as ordinary
 * arguments and misreport invalid usage as a check verdict. `BUN_BE_BUN=1`
 * makes those exact bytes behave as the plain Bun CLI, and the sibling `bun`
 * alias Setup installs beside the runtime lets a package check script invoke
 * `bun` through the isolated PATH without ambient authority. The alias is
 * derived from the canonical runtime path and realpath-verified to the same
 * file rather than trusting another binary; an unresolvable, non-executable,
 * missing-alias, or redirected-alias runner is unusable and must classify as
 * a setup defect, never as vault content.
 *
 * Consumers must execute package scripts as `exec <script line>`, never
 * `run <script name>`: bun's run-script lane prepends the machine-shared
 * /tmp bun-node shim ahead of this isolated PATH, which hands nested `bun`
 * to ambient bytes even though the alias beside the runtime is verified.
 *
 * @param runtimeBinaryPath - Absolute activation-bound runtime executable
 * @returns The spawn contract, or a closed refusal reason
 *
 * @example
 * ```typescript
 * const runner = await resolveVaultGitInstalledRuntimeRunner(runtimePath)
 * if (runner.status === "resolved") {
 *   await processPort.run({ command: runner.command, args: ["run", "check"], env: runner.environment, ... })
 * }
 * ```
 */
export async function resolveVaultGitInstalledRuntimeRunner(
	runtimeBinaryPath: string,
): Promise<VaultGitInstalledRuntimeRunner> {
	if (!isAbsolute(runtimeBinaryPath)) {
		return { status: "unusable", reason: "runtime_unresolvable" };
	}
	let command: string;
	try {
		command = await realpath(runtimeBinaryPath);
	} catch {
		return { status: "unusable", reason: "runtime_unresolvable" };
	}
	try {
		const runtime = await lstat(command);
		if (!runtime.isFile() || (runtime.mode & 0o111) === 0) {
			return { status: "unusable", reason: "runtime_not_executable" };
		}
	} catch {
		return { status: "unusable", reason: "runtime_not_executable" };
	}
	let alias: string;
	try {
		alias = await realpath(join(dirname(command), "bun"));
	} catch {
		return { status: "unusable", reason: "bun_alias_missing" };
	}
	if (alias !== command) {
		return { status: "unusable", reason: "bun_alias_redirected" };
	}
	return {
		status: "resolved",
		command,
		environment: {
			LC_ALL: "C",
			BUN_BE_BUN: "1",
			PATH: `${dirname(command)}:/usr/bin:/bin:/usr/sbin:/sbin`,
		},
	};
}
