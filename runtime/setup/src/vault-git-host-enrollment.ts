import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
	chmod,
	lstat,
	mkdir,
	open,
	readFile,
	realpath,
	rename,
	rm,
	symlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative } from "node:path";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HOST_HANDLE_PATTERN = /^host_[a-f0-9]{32}$/u;

/** Isolated owner roots for Vault Git Host Enrollment and Runtime Selection. */
export interface VaultGitHostEnrollmentRoots {
	readonly configRoot: string;
	readonly dataRoot: string;
	readonly selectorPath: string;
	readonly sourceRepoRoot?: string;
	readonly runtimeEntrypoint?: string;
	readonly inspectWorkState?: () => Promise<"clear" | "active" | "uncertain">;
}

export interface VaultGitHostEnrollmentInputField {
	readonly id:
		| "ssh_identity_file_path"
		| "ssh_public_key_path"
		| "ssh_known_hosts_path";
	readonly inputChannel: "private_stdin";
}

/** The one immutable private-input descriptor projected by inspect and preview. */
export const VAULT_GIT_HOST_ENROLLMENT_INPUT_FIELDS = [
	{ id: "ssh_identity_file_path", inputChannel: "private_stdin" },
	{ id: "ssh_public_key_path", inputChannel: "private_stdin" },
	{ id: "ssh_known_hosts_path", inputChannel: "private_stdin" },
] as const satisfies readonly VaultGitHostEnrollmentInputField[];

export interface VaultGitHostEnrollmentStatus {
	readonly state: "not_enrolled";
	readonly station: "vault_git.host_enrollment_inputs_required";
	readonly nextAction: {
		readonly kind: "needs_input";
		readonly actionId: "provide_host_enrollment_inputs";
		readonly inputContractId: "setup.vault-git.host-enrollment";
		readonly fields: readonly VaultGitHostEnrollmentInputField[];
	};
	readonly installedRuntime: null;
	readonly selectedRuntime: null;
	readonly priorRuntime: null;
}

export interface VaultGitHostEnrollmentEnrolledStatus {
	readonly state: "enrolled";
	readonly station: "vault_git.runtime_selected";
	readonly hostHandle: string;
	readonly installedRuntime: VaultGitRuntimeReference;
	readonly selectedRuntime: VaultGitRuntimeReference;
	readonly priorRuntime: VaultGitRuntimeReference | null;
}

export interface VaultGitHostEnrollmentInput {
	readonly sshIdentityFilePath: string;
	readonly sshPublicKeyPath: string;
	readonly sshKnownHostsPath: string;
}

export type VaultGitSshPrerequisite =
	| "ssh_identity_file"
	| "ssh_public_key"
	| "ssh_known_hosts";

export interface VaultGitHostEnrollmentPrerequisiteStatus {
	readonly state: "needs_human";
	readonly station: "vault_git.repository_ssh_prerequisite";
	readonly nextAction: {
		readonly kind: "needs_human";
		readonly actionId: "provision_repository_ssh";
		readonly owner: "repository_ssh_owner";
		readonly condition: "dedicated_identity_ready";
	};
	readonly missingPrerequisites: readonly VaultGitSshPrerequisite[];
	readonly installedRuntime: null;
	readonly selectedRuntime: null;
	readonly priorRuntime: null;
}

export interface VaultGitHostEnrollmentReadyStatus {
	readonly state: "ready";
	readonly station: "vault_git.host_enrollment_ready";
	readonly nextAction: {
		readonly kind: "needs_input";
		readonly actionId: "apply_host_enrollment";
		readonly inputContractId: "setup.vault-git.host-enrollment";
		readonly fields: readonly VaultGitHostEnrollmentInputField[];
	};
	readonly installedRuntime: null;
	readonly selectedRuntime: null;
	readonly priorRuntime: null;
}

export interface VaultGitRuntimeReference {
	readonly digest: string;
}

export interface VaultGitHostEnrollmentAppliedStatus {
	readonly state: "applied" | "noop";
	readonly station: "vault_git.runtime_selected";
	readonly hostHandle: string;
	readonly installedRuntime: VaultGitRuntimeReference;
	readonly selectedRuntime: VaultGitRuntimeReference;
	readonly priorRuntime: VaultGitRuntimeReference | null;
}

export interface VaultGitRuntimeSelectionBlockedStatus {
	readonly state: "blocked";
	readonly station: "vault_git.runtime_selection_blocked";
	readonly nextAction: {
		readonly kind: "needs_human";
		readonly actionId: "wait_for_vault_git_idle";
		readonly owner: "vault_git_operator";
		readonly condition: "no_active_or_uncertain_work";
	};
	readonly installedRuntime: VaultGitRuntimeReference;
	readonly selectedRuntime: null;
	readonly priorRuntime: null;
}

export interface VaultGitRuntimeRollbackStatus {
	readonly state: "changes" | "applied";
	readonly station: "vault_git.rollback_ready" | "vault_git.rollback_applied";
	readonly selectedRuntime: VaultGitRuntimeReference;
	readonly priorRuntime: VaultGitRuntimeReference;
}

export interface VaultGitRuntimeRollbackBlockedStatus {
	readonly state: "blocked";
	readonly station: "vault_git.rollback_blocked";
	readonly nextAction: {
		readonly kind: "needs_human";
		readonly actionId: "wait_for_vault_git_idle";
		readonly owner: "vault_git_operator";
		readonly condition: "no_active_or_uncertain_work";
	};
	readonly selectedRuntime: VaultGitRuntimeReference;
	readonly priorRuntime: VaultGitRuntimeReference;
}

export type VaultGitHostEnrollmentResult =
	| VaultGitHostEnrollmentStatus
	| VaultGitHostEnrollmentEnrolledStatus
	| VaultGitHostEnrollmentPrerequisiteStatus
	| VaultGitHostEnrollmentReadyStatus
	| VaultGitHostEnrollmentAppliedStatus
	| VaultGitRuntimeSelectionBlockedStatus
	| VaultGitRuntimeRollbackStatus
	| VaultGitRuntimeRollbackBlockedStatus;

export interface VaultGitHostEnrollment {
	inspect(): Promise<
		VaultGitHostEnrollmentStatus | VaultGitHostEnrollmentEnrolledStatus
	>;
	preview(
		input: VaultGitHostEnrollmentInput,
	): Promise<
		VaultGitHostEnrollmentPrerequisiteStatus | VaultGitHostEnrollmentReadyStatus
	>;
	apply(input: VaultGitHostEnrollmentInput): Promise<
		| VaultGitHostEnrollmentPrerequisiteStatus
		| VaultGitHostEnrollmentAppliedStatus
		| VaultGitRuntimeSelectionBlockedStatus
	>;
	rollback(
		check: boolean,
	): Promise<VaultGitRuntimeRollbackStatus | VaultGitRuntimeRollbackBlockedStatus>;
}

interface ValidatedEnrollmentInput {
	readonly sshIdentityFilePath: string;
	readonly sshPublicKeyPath: string;
	readonly sshKnownHostsPath: string;
}

interface ActivationConfiguration {
	readonly schema_version: 1;
	readonly host_handle: string;
	readonly ssh_identity_file_path: string;
	readonly ssh_public_key_path: string;
	readonly ssh_known_hosts_path: string;
}

interface RuntimeSelectionRecord {
	readonly schema_version: 1;
	readonly selected_digest: string;
	readonly prior_digest: string | null;
}

async function resolveRegularFile(path: string): Promise<string | undefined> {
	try {
		const configured = await lstat(path, { bigint: true });
		if (configured.isSymbolicLink() || !configured.isFile()) return undefined;
		const canonical = await realpath(path);
		const resolved = await lstat(canonical, { bigint: true });
		if (
			resolved.isSymbolicLink() ||
			!resolved.isFile() ||
			configured.dev !== resolved.dev ||
			configured.ino !== resolved.ino
		) {
			return undefined;
		}
		return canonical;
	} catch {
		return undefined;
	}
}

async function ownerOnlyFile(
	path: string,
	modeIsValid: (mode: bigint) => boolean,
): Promise<string | undefined> {
	const canonical = await resolveRegularFile(path);
	if (!canonical) return undefined;
	try {
		const metadata = await lstat(canonical, { bigint: true });
		const uid = process.getuid?.();
		if (!modeIsValid(metadata.mode) || (uid !== undefined && metadata.uid !== BigInt(uid))) {
			return undefined;
		}
		return canonical;
	} catch {
		return undefined;
	}
}

function publicKeyMaterial(value: string): string | undefined {
	const [algorithm, key] = value.trim().split(/\s+/u);
	return algorithm && key ? `${algorithm} ${key}` : undefined;
}

async function matchingPublicKey(
	privateKeyPath: string,
	publicKeyPath: string,
): Promise<boolean> {
	try {
		const generated = Bun.spawnSync(
			["/usr/bin/ssh-keygen", "-y", "-f", privateKeyPath],
			{
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
				env: { PATH: "/usr/bin:/bin", LC_ALL: "C" },
			},
		);
		if (generated.exitCode !== 0) return false;
		const [derived, configured] = await Promise.all([
			Promise.resolve(generated.stdout.toString()),
			readFile(publicKeyPath, "utf8"),
		]);
		return publicKeyMaterial(derived) === publicKeyMaterial(configured);
	} catch {
		return false;
	}
}

async function validateEnrollmentInput(input: VaultGitHostEnrollmentInput): Promise<{
	readonly validated?: ValidatedEnrollmentInput;
	readonly missingPrerequisites: readonly VaultGitSshPrerequisite[];
}> {
	const [privateKeyPath, publicKeyPath, knownHostsPath] = await Promise.all([
		ownerOnlyFile(
			input.sshIdentityFilePath,
			(mode) => (mode & 0o077n) === 0n && (mode & 0o400n) !== 0n,
		),
		resolveRegularFile(input.sshPublicKeyPath),
		ownerOnlyFile(
			input.sshKnownHostsPath,
			(mode) => (mode & 0o777n) === 0o600n,
		),
	]);
	let knownHostsReady = false;
	if (knownHostsPath) {
		try {
			knownHostsReady = (await readFile(knownHostsPath, "utf8")).trim() !== "";
		} catch {
			knownHostsReady = false;
		}
	}
	const checks = [
		privateKeyPath !== undefined,
		privateKeyPath !== undefined && publicKeyPath !== undefined
			? await matchingPublicKey(privateKeyPath, publicKeyPath)
			: false,
		knownHostsReady,
	];
	const prerequisiteNames: readonly VaultGitSshPrerequisite[] = [
		"ssh_identity_file",
		"ssh_public_key",
		"ssh_known_hosts",
	];
	const missingPrerequisites = prerequisiteNames.filter(
		(_prerequisite, index) => !checks[index],
	);
	return missingPrerequisites.length === 0 && privateKeyPath && publicKeyPath && knownHostsPath
		? {
			validated: {
				sshIdentityFilePath: privateKeyPath,
				sshPublicKeyPath: publicKeyPath,
				sshKnownHostsPath: knownHostsPath,
			},
			missingPrerequisites,
		}
		: { missingPrerequisites };
}

function prerequisiteStatus(
	missingPrerequisites: readonly VaultGitSshPrerequisite[],
): VaultGitHostEnrollmentPrerequisiteStatus {
	return {
		state: "needs_human",
		station: "vault_git.repository_ssh_prerequisite",
		nextAction: {
			kind: "needs_human",
			actionId: "provision_repository_ssh",
			owner: "repository_ssh_owner",
			condition: "dedicated_identity_ready",
		},
		missingPrerequisites,
		installedRuntime: null,
		selectedRuntime: null,
		priorRuntime: null,
	};
}

function runChecked(
	command: readonly string[],
	cwd: string,
): string {
	const result = Bun.spawnSync([...command], {
		cwd,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		env: {
			PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
			LC_ALL: "C",
		},
	});
	if (result.exitCode !== 0) {
		throw new Error("Vault Git runtime source or compilation is not ready");
	}
	return result.stdout.toString().trim();
}

async function cleanMergedSource(roots: VaultGitHostEnrollmentRoots): Promise<{
	readonly sourceRepoRoot: string;
	readonly runtimeEntrypoint: string;
}> {
	if (!roots.sourceRepoRoot || !roots.runtimeEntrypoint) {
		throw new Error("Vault Git runtime source is not configured");
	}
	const [sourceRepoRoot, runtimeEntrypoint] = await Promise.all([
		realpath(roots.sourceRepoRoot),
		realpath(roots.runtimeEntrypoint),
	]);
	const entryRelative = relative(sourceRepoRoot, runtimeEntrypoint);
	if (
		entryRelative === "" ||
		entryRelative === ".." ||
		entryRelative.startsWith("../") ||
		isAbsolute(entryRelative)
	) {
		throw new Error("Vault Git runtime entrypoint escapes its source repository");
	}
	const status = runChecked(
		["/usr/bin/git", "status", "--porcelain=v1", "--untracked-files=all"],
		sourceRepoRoot,
	);
	if (status !== "") throw new Error("Vault Git runtime source is not clean");
	const head = runChecked(["/usr/bin/git", "rev-parse", "HEAD"], sourceRepoRoot);
	const merged = runChecked(
		["/usr/bin/git", "rev-parse", "refs/remotes/origin/main"],
		sourceRepoRoot,
	);
	if (head !== merged) throw new Error("Vault Git runtime source is not merged to origin/main");
	return { sourceRepoRoot, runtimeEntrypoint };
}

async function ensurePrivateDirectory(path: string): Promise<void> {
	await mkdir(path, { recursive: true, mode: 0o700 });
	const entry = await lstat(path);
	if (entry.isSymbolicLink() || !entry.isDirectory()) {
		throw new Error("Vault Git private directory is unsafe");
	}
	await chmod(path, 0o700);
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, "r");
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function writeOwnerFile(path: string, bytes: string): Promise<void> {
	await ensurePrivateDirectory(dirname(path));
	const temporaryPath = join(dirname(path), `.${randomUUID()}.tmp`);
	try {
		const handle = await open(temporaryPath, "wx", 0o600);
		try {
			await handle.writeFile(bytes);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await chmod(temporaryPath, 0o600);
		await rename(temporaryPath, path);
		await syncDirectory(dirname(path));
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

async function compileRuntime(
	roots: VaultGitHostEnrollmentRoots,
): Promise<VaultGitRuntimeReference> {
	const source = await cleanMergedSource(roots);
	const runtimesRoot = join(roots.dataRoot, "runtimes");
	await ensurePrivateDirectory(roots.dataRoot);
	await ensurePrivateDirectory(runtimesRoot);
	const stagingRoot = join(runtimesRoot, `.staging-${randomUUID()}`);
	const stagedExecutable = join(stagingRoot, "vault-git");
	await ensurePrivateDirectory(stagingRoot);
	try {
		runChecked(
			[
				process.execPath,
				"build",
				source.runtimeEntrypoint,
				"--compile",
				"--outfile",
				stagedExecutable,
			],
			stagingRoot,
		);
		const bytes = await readFile(stagedExecutable);
		const digest = createHash("sha256").update(bytes).digest("hex");
		const runtimeRoot = join(runtimesRoot, digest);
		const runtimeExecutable = join(runtimeRoot, "vault-git");
		await chmod(stagedExecutable, 0o755);
		await symlink("vault-git", join(stagingRoot, "bun"));
		try {
			await rename(stagingRoot, runtimeRoot);
			await syncDirectory(runtimesRoot);
		} catch {
			if (!(await runtimeMatches(runtimeExecutable, digest))) {
				throw new Error("Installed Vault Git runtime digest mismatch");
			}
		}
		if (!(await runtimeMatches(runtimeExecutable, digest))) {
			throw new Error("Installed Vault Git runtime digest mismatch");
		}
		await ensureRuntimeBunAlias(runtimeRoot);
		return { digest };
	} finally {
		await rm(stagingRoot, { recursive: true, force: true });
	}
}

/**
 * The immutable Installed Runtime directory carries a `bun` alias to the
 * exact selected executable bytes so an isolated vault-check PATH can
 * resolve nested `bun` without ambient authority. Derive and realpath-verify
 * the alias rather than trusting another binary; a pre-alias runtime
 * directory installed by an earlier Setup is repaired here on reinstall.
 */
async function ensureRuntimeBunAlias(runtimeRoot: string): Promise<void> {
	const aliasPath = join(runtimeRoot, "bun");
	try {
		await symlink("vault-git", aliasPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	const [alias, executable] = await Promise.all([
		realpath(aliasPath),
		realpath(join(runtimeRoot, "vault-git")),
	]);
	if (alias !== executable) {
		throw new Error("Installed Vault Git runtime bun alias is invalid");
	}
}

async function runtimeMatches(path: string, digest: string): Promise<boolean> {
	try {
		const entry = await lstat(path);
		if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o111) === 0) {
			return false;
		}
		return createHash("sha256").update(await readFile(path)).digest("hex") === digest;
	} catch {
		return false;
	}
}

async function readJson(path: string): Promise<unknown | undefined> {
	try {
		const entry = await lstat(path);
		if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0) {
			return undefined;
		}
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

function parseActivationConfiguration(value: unknown): ActivationConfiguration | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const candidate = value as Record<string, unknown>;
	const keys = Object.keys(candidate).sort();
	if (
		keys.join("\0") !== [
			"host_handle",
			"schema_version",
			"ssh_identity_file_path",
			"ssh_known_hosts_path",
			"ssh_public_key_path",
		].sort().join("\0") ||
		candidate.schema_version !== 1 ||
		typeof candidate.host_handle !== "string" ||
		!HOST_HANDLE_PATTERN.test(candidate.host_handle) ||
		![
			candidate.ssh_identity_file_path,
			candidate.ssh_public_key_path,
			candidate.ssh_known_hosts_path,
		].every((path) => typeof path === "string" && isAbsolute(path))
	) {
		return undefined;
	}
	return candidate as unknown as ActivationConfiguration;
}

function parseRuntimeSelection(value: unknown): RuntimeSelectionRecord | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const candidate = value as Record<string, unknown>;
	if (
		Object.keys(candidate).sort().join("\0") !==
			["prior_digest", "schema_version", "selected_digest"].sort().join("\0") ||
		candidate.schema_version !== 1 ||
		typeof candidate.selected_digest !== "string" ||
		!SHA256_PATTERN.test(candidate.selected_digest) ||
		!(candidate.prior_digest === null ||
			(typeof candidate.prior_digest === "string" &&
				SHA256_PATTERN.test(candidate.prior_digest)))
	) {
		return undefined;
	}
	// A legacy record naming itself as its prior stays an enrolled selection,
	// but its meaningless self-rollback normalizes to null so rollback fails
	// closed instead of reselecting the same runtime.
	if (candidate.prior_digest === candidate.selected_digest) {
		return {
			schema_version: 1,
			selected_digest: candidate.selected_digest,
			prior_digest: null,
		};
	}
	return candidate as unknown as RuntimeSelectionRecord;
}

async function selectRuntime(
	roots: VaultGitHostEnrollmentRoots,
	digest: string,
): Promise<void> {
	const runtimeExecutable = join(roots.dataRoot, "runtimes", digest, "vault-git");
	if (!(await runtimeMatches(runtimeExecutable, digest))) {
		throw new Error("Refusing to select an invalid Vault Git runtime");
	}
	await mkdir(dirname(roots.selectorPath), { recursive: true });
	const temporaryPath = join(dirname(roots.selectorPath), `.vault-git.${randomUUID()}.tmp`);
	try {
		await symlink(runtimeExecutable, temporaryPath);
		await rename(temporaryPath, roots.selectorPath);
		await syncDirectory(dirname(roots.selectorPath));
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

/** Selector digest proven by real-path containment alone; bytes may be broken. */
async function managedSelectorPathDigest(
	roots: VaultGitHostEnrollmentRoots,
): Promise<string | undefined> {
	try {
		const entry = await lstat(roots.selectorPath);
		if (!entry.isSymbolicLink()) return undefined;
		const target = await realpath(roots.selectorPath);
		const runtimesRoot = await realpath(join(roots.dataRoot, "runtimes"));
		const targetRelative = relative(runtimesRoot, target);
		if (targetRelative.startsWith("..") || isAbsolute(targetRelative)) return undefined;
		const parts = targetRelative.split("/");
		const digest = parts.length === 2 && parts[1] === "vault-git" ? parts[0] : undefined;
		return digest && SHA256_PATTERN.test(digest) ? digest : undefined;
	} catch {
		return undefined;
	}
}

async function selectorDigest(
	roots: VaultGitHostEnrollmentRoots,
): Promise<string | undefined> {
	const digest = await managedSelectorPathDigest(roots);
	if (digest === undefined) return undefined;
	const target = join(roots.dataRoot, "runtimes", digest, "vault-git");
	return (await runtimeMatches(target, digest)) ? digest : undefined;
}

interface ReplaceableSelectorState {
	/** Containment-proven selected digest; undefined when no selector exists. */
	readonly pathDigest?: string;
	/** Digest additionally proven by exact executable bytes. */
	readonly verifiedDigest?: string;
}

async function replaceableSelectorState(
	roots: VaultGitHostEnrollmentRoots,
): Promise<ReplaceableSelectorState> {
	let entry: Awaited<ReturnType<typeof lstat>>;
	try {
		entry = await lstat(roots.selectorPath);
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ENOENT"
		) {
			return {};
		}
		throw error;
	}
	if (!entry.isSymbolicLink()) {
		throw new Error("Refusing to replace a foreign Vault Git selector");
	}
	const pathDigest = await managedSelectorPathDigest(roots);
	if (pathDigest !== undefined) {
		const verifiedDigest = (await selectorDigest(roots)) === pathDigest
			? pathDigest
			: undefined;
		return { pathDigest, ...(verifiedDigest ? { verifiedDigest } : {}) };
	}
	if (roots.runtimeEntrypoint) {
		try {
			if ((await realpath(roots.selectorPath)) === (await realpath(roots.runtimeEntrypoint))) {
				return {};
			}
		} catch {
			// A broken or racing link is not proven Setup ownership.
		}
	}
	throw new Error("Refusing to replace a foreign Vault Git selector");
}

/**
 * The prior may never equal the new selection — a stale record naming the same
 * digest would otherwise persist a meaningless self-rollback. The live selector
 * stays rollback-eligible on containment proof alone (rollback re-verifies its
 * bytes); a record-sourced candidate must byte-verify before it is trusted.
 */
async function distinctPriorDigest(
	roots: VaultGitHostEnrollmentRoots,
	selectedDigest: string,
	selectorState: ReplaceableSelectorState,
	existingSelection: RuntimeSelectionRecord | undefined,
): Promise<string | null> {
	const livePathDigest = selectorState.pathDigest;
	if (livePathDigest !== undefined && livePathDigest !== selectedDigest) {
		return livePathDigest;
	}
	for (const candidate of [
		existingSelection?.selected_digest,
		existingSelection?.prior_digest ?? undefined,
	]) {
		if (candidate === undefined || candidate === selectedDigest) continue;
		const executable = join(roots.dataRoot, "runtimes", candidate, "vault-git");
		if (await runtimeMatches(executable, candidate)) return candidate;
	}
	return null;
}

/** Create the Setup-owned Host Enrollment boundary for one isolated host state. */
export function createVaultGitHostEnrollment(
	roots: VaultGitHostEnrollmentRoots,
): VaultGitHostEnrollment {
	return {
		async inspect() {
			const activationPath = join(roots.configRoot, "activation.json");
			const selectionPath = join(roots.configRoot, "runtime-selection.json");
			const [activation, selection, selectedDigest] = await Promise.all([
				readJson(activationPath).then(parseActivationConfiguration),
				readJson(selectionPath).then(parseRuntimeSelection),
				selectorDigest(roots),
			]);
			if (
				activation &&
				selection &&
				selectedDigest === selection.selected_digest
			) {
				const selectedRuntime = { digest: selection.selected_digest };
				return {
					state: "enrolled",
					station: "vault_git.runtime_selected",
					hostHandle: activation.host_handle,
					installedRuntime: selectedRuntime,
					selectedRuntime,
					priorRuntime: selection.prior_digest
						? { digest: selection.prior_digest }
						: null,
				};
			}
			return {
				state: "not_enrolled",
				station: "vault_git.host_enrollment_inputs_required",
				nextAction: {
					kind: "needs_input",
					actionId: "provide_host_enrollment_inputs",
					inputContractId: "setup.vault-git.host-enrollment",
					fields: VAULT_GIT_HOST_ENROLLMENT_INPUT_FIELDS,
				},
				installedRuntime: null,
				selectedRuntime: null,
				priorRuntime: null,
			};
		},
		async preview(input) {
			const validation = await validateEnrollmentInput(input);
			if (validation.validated) {
				return {
					state: "ready",
					station: "vault_git.host_enrollment_ready",
					nextAction: {
						kind: "needs_input",
						actionId: "apply_host_enrollment",
						inputContractId: "setup.vault-git.host-enrollment",
						fields: VAULT_GIT_HOST_ENROLLMENT_INPUT_FIELDS,
					},
					installedRuntime: null,
					selectedRuntime: null,
					priorRuntime: null,
				};
			}
			return prerequisiteStatus(validation.missingPrerequisites);
		},
		async apply(input) {
			const validation = await validateEnrollmentInput(input);
			if (!validation.validated) {
				return prerequisiteStatus(validation.missingPrerequisites);
			}
			const installedRuntime = await compileRuntime(roots);
			const workState = await roots.inspectWorkState?.();
			if (workState !== "clear") {
				return {
					state: "blocked",
					station: "vault_git.runtime_selection_blocked",
					nextAction: {
						kind: "needs_human",
						actionId: "wait_for_vault_git_idle",
						owner: "vault_git_operator",
						condition: "no_active_or_uncertain_work",
					},
					installedRuntime,
					selectedRuntime: null,
					priorRuntime: null,
				};
			}
			const activationPath = join(roots.configRoot, "activation.json");
			const selectionPath = join(roots.configRoot, "runtime-selection.json");
			const [existingActivation, existingSelection, selectorState] = await Promise.all([
				readJson(activationPath).then(parseActivationConfiguration),
				readJson(selectionPath).then(parseRuntimeSelection),
				replaceableSelectorState(roots),
			]);
			const selectedDigest = selectorState.verifiedDigest;
			const hostHandle = existingActivation?.host_handle ?? `host_${randomBytes(16).toString("hex")}`;
			const activation: ActivationConfiguration = {
				schema_version: 1,
				host_handle: hostHandle,
				ssh_identity_file_path: validation.validated.sshIdentityFilePath,
				ssh_public_key_path: validation.validated.sshPublicKeyPath,
				ssh_known_hosts_path: validation.validated.sshKnownHostsPath,
			};
			const activationUnchanged = existingActivation !== undefined &&
				JSON.stringify(existingActivation) === JSON.stringify(activation);
			const selectionUnchanged =
				existingSelection?.selected_digest === installedRuntime.digest &&
				selectedDigest === installedRuntime.digest;
			if (!activationUnchanged) {
				await writeOwnerFile(activationPath, `${JSON.stringify(activation)}\n`);
			}
			if (!selectionUnchanged) {
				const priorDigest = await distinctPriorDigest(
					roots,
					installedRuntime.digest,
					selectorState,
					existingSelection,
				);
				await selectRuntime(roots, installedRuntime.digest);
				const selection: RuntimeSelectionRecord = {
					schema_version: 1,
					selected_digest: installedRuntime.digest,
					prior_digest: priorDigest,
				};
				await writeOwnerFile(selectionPath, `${JSON.stringify(selection)}\n`);
				return {
					state: "applied",
					station: "vault_git.runtime_selected",
					hostHandle,
					installedRuntime,
					selectedRuntime: installedRuntime,
					priorRuntime: selection.prior_digest
						? { digest: selection.prior_digest }
						: null,
				};
			}
			return {
				state: activationUnchanged ? "noop" : "applied",
				station: "vault_git.runtime_selected",
				hostHandle,
				installedRuntime,
				selectedRuntime: installedRuntime,
				priorRuntime: existingSelection?.prior_digest
					? { digest: existingSelection.prior_digest }
					: null,
			};
		},
		async rollback(check) {
			const selectionPath = join(roots.configRoot, "runtime-selection.json");
			const [selection, selectedPathDigest] = await Promise.all([
				readJson(selectionPath).then(parseRuntimeSelection),
				managedSelectorPathDigest(roots),
			]);
			if (!selection?.prior_digest) {
				throw new Error("Vault Git prior Runtime Selection is unavailable");
			}
			// Containment proof only: a selected runtime with broken bytes must
			// remain rollback-eligible, while a foreign or drifted selector is not.
			if (selection.selected_digest !== selectedPathDigest) {
				throw new Error("Refusing rollback from an unproven Vault Git selector");
			}
			const priorExecutable = join(
				roots.dataRoot,
				"runtimes",
				selection.prior_digest,
				"vault-git",
			);
			if (!(await runtimeMatches(priorExecutable, selection.prior_digest))) {
				throw new Error("Vault Git prior runtime is invalid");
			}
			const selectedRuntime = { digest: selection.selected_digest };
			const priorRuntime = { digest: selection.prior_digest };
			if (check) {
				return {
					state: "changes",
					station: "vault_git.rollback_ready",
					selectedRuntime,
					priorRuntime,
				};
			}
			if ((await roots.inspectWorkState?.()) !== "clear") {
				return {
					state: "blocked",
					station: "vault_git.rollback_blocked",
					nextAction: {
						kind: "needs_human",
						actionId: "wait_for_vault_git_idle",
						owner: "vault_git_operator",
						condition: "no_active_or_uncertain_work",
					},
					selectedRuntime,
					priorRuntime,
				};
			}
			await selectRuntime(roots, selection.prior_digest);
			await writeOwnerFile(
				selectionPath,
				`${JSON.stringify({
					schema_version: 1,
					selected_digest: selection.prior_digest,
					prior_digest: selection.selected_digest,
				} satisfies RuntimeSelectionRecord)}\n`,
			);
			return {
				state: "applied",
				station: "vault_git.rollback_applied",
				selectedRuntime: priorRuntime,
				priorRuntime: selectedRuntime,
			};
		},
	};
}
