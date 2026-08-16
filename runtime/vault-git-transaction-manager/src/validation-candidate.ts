import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
	chmod,
	lstat,
	mkdir,
	open,
	readdir,
	readFile,
	rename,
	rm,
	unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";

import {
	findVaultGitCheckScript,
	findVaultGitDependencySurface,
	isVaultGitOwnedPathLeaf,
	parseVaultGitManifest,
	VAULT_GIT_VALIDATION_STAGES,
} from "./model.ts";
import { CONTROLLED_GIT_ENVIRONMENT } from "./git-adapter.ts";
import { resolveVaultGitInstalledRuntimeRunner } from "./installed-runtime-runner.ts";
import type {
	VaultGitCheckPort,
	VaultGitCheckRequest,
	VaultGitCheckResult,
	VaultGitOwnedPathContentHash,
	VaultGitProcessPort,
	VaultGitProcessResult,
	VaultGitValidationStage,
} from "./ports.ts";

/**
 * Product-owned Validation Stage Budgets.
 *
 * Conservative initial product budgets derived from the prior 15s whole-check
 * bound (DEFAULT_TIMEOUTS.localMs): setup keeps that bound for one local clone
 * plus a bounded leaf overlay, the vault check takes double it as headroom,
 * and cleanup is one recursive removal. No production-shaped measurement of
 * the individual stages is retained yet; revising these values requires that
 * evidence. Callers get no timeout flag; cleanup always draws a fresh budget.
 */
export const VAULT_GIT_VALIDATION_STAGE_BUDGETS_MS = {
	candidate_setup: 15_000,
	vault_check: 30_000,
	candidate_cleanup: 10_000,
} as const;

const CANDIDATES_DIRECTORY = "validation-candidates";

/** Options for the candidate-backed vault-owned check adapter. */
export interface VaultGitValidationCandidateOptions {
	/** Canonical vault root supplying baseline objects and frozen owned bytes. */
	readonly repositoryPath: string;
	/** Owner-private state root holding candidates and Candidate Residue. */
	readonly privateStateRoot: string;
	/** Injectable bounded subprocess runner. */
	readonly process: VaultGitProcessPort;
	/**
	 * Absolute activation-bound runtime executable; never resolved via PATH.
	 * Executed only through the installed-runtime runner contract (canonical
	 * real path plus realpath-verified sibling `bun` alias). Null means no
	 * admitted runtime binding exists; null and an unusable runner both fail
	 * closed as `candidate_setup` before any process or filesystem effect.
	 */
	readonly runtimeBinaryPath: string | null;
	/** Git executable override. @defaultValue "git" */
	readonly gitBinary?: string;
	/** Wall clock for Candidate Residue age metadata. @defaultValue system clock */
	readonly now?: () => Date;
	/** Monotonic clock for stage budgets. @defaultValue performance.now @internal */
	readonly monotonicNow?: () => number;
	/** Candidate removal seam for deterministic cleanup proof. @internal */
	readonly removeCandidate?: (candidateRoot: string) => Promise<void>;
}

/** Bounded owner-private Candidate Residue record; one file per candidate. */
interface VaultGitCandidateResidueRecord {
	readonly schemaVersion: 1;
	readonly candidateId: string;
	readonly candidatePath: string;
	/** Owning transaction selector, or null when admission carried none. */
	readonly transactionId: string | null;
	readonly baselineHead: string;
	readonly createdAt: string;
	readonly updatedAt: string;
	readonly stage: VaultGitValidationStage;
	readonly failureClass: "candidate_cleanup" | null;
}

class StageBudget {
	private readonly startedAt: number;
	constructor(
		private readonly budgetMs: number,
		private readonly monotonicNow: () => number,
	) {
		this.startedAt = monotonicNow();
	}
	remainingMs(): number {
		return Math.max(0, this.budgetMs - (this.monotonicNow() - this.startedAt));
	}
	exceeded(): boolean {
		return this.remainingMs() === 0;
	}
}

class CandidateSetupError extends Error {}
class StageBudgetExceededError extends Error {
	constructor(
		readonly stage: VaultGitValidationStage,
		/** True when the abandoned work may still be running when this throws. */
		readonly workUnsettled = false,
	) {
		super(`validation stage budget exceeded: ${stage}`);
	}
}

const BUDGET_WATCH_INTERVAL_MS = 25;

/**
 * Bound one awaited stage step by its budget owner. A held-open filesystem or
 * process promise must not stall classification past the stage budget, so the
 * budget is watched on the same monotonic clock while the work settles; on
 * breach the step classifies and the abandoned work is left to the operating
 * system.
 */
function raceStageBudget<T>(
	stage: VaultGitValidationStage,
	budget: StageBudget,
	work: Promise<T>,
): Promise<T> {
	if (budget.exceeded()) {
		work.catch(() => undefined);
		return Promise.reject(new StageBudgetExceededError(stage, true));
	}
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const watcher = setInterval(() => {
			if (settled || !budget.exceeded()) return;
			settled = true;
			clearInterval(watcher);
			reject(new StageBudgetExceededError(stage, true));
		}, BUDGET_WATCH_INTERVAL_MS);
		watcher.unref?.();
		work.then(
			(value) => {
				if (settled) return;
				settled = true;
				clearInterval(watcher);
				resolve(value);
			},
			(error: unknown) => {
				if (settled) return;
				settled = true;
				clearInterval(watcher);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

/**
 * Create the Validation Candidate default for the vault-owned check port.
 *
 * Composes one private candidate from the exact Admitted Baseline plus the
 * frozen Owned Paths, runs the vault's own check inside it with the
 * activation-bound runtime and an isolated environment, and classifies every
 * failure into one stable Validation Failure Class.
 *
 * @param options - Canonical root, private state root, process boundary, and
 * the activation-bound runtime executable
 * @returns The deep check port consumed by the transaction engine
 * @throws {Error} When the runtime executable path is not absolute
 *
 * @example
 * ```typescript
 * const check = createVaultOwnedCheckPort({
 *   repositoryPath: "/srv/vault",
 *   privateStateRoot: "/var/lib/vault-git/repository-id",
 *   process: createNodeProcessPort(),
 *   runtimeBinaryPath: "/opt/bun/bin/bun",
 * })
 * ```
 */
export function createVaultOwnedCheckPort(
	options: VaultGitValidationCandidateOptions,
): VaultGitCheckPort {
	const runtimeBinaryPath = options.runtimeBinaryPath;
	if (runtimeBinaryPath !== null && !isAbsolute(runtimeBinaryPath)) {
		throw new Error(
			"validation candidate runtime executable must be an absolute path",
		);
	}
	const monotonicNow = options.monotonicNow ?? (() => performance.now());
	const now = options.now ?? (() => new Date());
	const removeCandidate =
		options.removeCandidate ??
		((candidateRoot: string) =>
			rm(candidateRoot, { recursive: true, force: true }));
	const gitBinary = options.gitBinary ?? "git";
	const candidatesRoot = join(options.privateStateRoot, CANDIDATES_DIRECTORY);

	const runProcess = async (
		stage: "candidate_setup" | "vault_check",
		budget: StageBudget,
		request: {
			readonly command: string;
			readonly args: readonly string[];
			readonly cwd: string;
			readonly env?: Readonly<Record<string, string>>;
			readonly environmentMode?: "scrubbed" | "isolated";
		},
	): Promise<VaultGitProcessResult> => {
		const timeoutMs = budget.remainingMs();
		if (timeoutMs === 0) throw new StageBudgetExceededError(stage);
		const result = await raceStageBudget(
			stage,
			budget,
			options.process.run({ ...request, timeoutMs }),
		);
		if (result.timedOut || budget.exceeded()) {
			throw new StageBudgetExceededError(stage);
		}
		return result;
	};

	// Durable-Exclusive-Publish ordering (staged temp, file sync, overwrite
	// rename, directory sync): the record must survive a crash that follows,
	// because it is what makes an abandoned candidate clone owned rather than
	// orphaned. Single writer per candidate id, so overwrite is the race policy.
	const writeResidueRecord = async (
		record: VaultGitCandidateResidueRecord,
		metadataPath: string,
	): Promise<void> => {
		const directory = dirname(metadataPath);
		const staged = join(directory, `${record.candidateId}.staged`);
		const handle = await open(
			staged,
			fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC,
			0o600,
		);
		try {
			await handle.writeFile(`${JSON.stringify(record)}\n`);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(staged, metadataPath);
		const directoryHandle = await open(directory, fsConstants.O_RDONLY);
		try {
			await directoryHandle.sync();
		} finally {
			await directoryHandle.close();
		}
	};

	const freezeLeaf = async (
		budget: StageBudget,
		candidateRoot: string,
		path: string,
	): Promise<VaultGitOwnedPathContentHash> => {
		if (!isVaultGitOwnedPathLeaf(path)) {
			throw new CandidateSetupError(`unsafe owned path: ${path}`);
		}
		const sourcePath = join(options.repositoryPath, path);
		const source = await open(
			sourcePath,
			fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
		).catch((error: unknown) => {
			if (isMissingEntry(error)) return null;
			throw new CandidateSetupError(`unreadable owned leaf: ${path}`);
		});
		let bytes: Buffer | null = null;
		let executable = false;
		if (source !== null) {
			try {
				const metadata = await source.stat();
				if (!metadata.isFile()) {
					throw new CandidateSetupError(`owned path is not a file: ${path}`);
				}
				executable = (metadata.mode & 0o111) !== 0;
				bytes = await source.readFile();
			} finally {
				await source.close();
			}
		}
		const destination = await resolveOverlayDestination(candidateRoot, path);
		if (bytes === null) {
			return { path, contentHash: null, fileMode: null };
		}
		const mode = executable ? 0o755 : 0o644;
		const handle = await open(
			destination,
			fsConstants.O_WRONLY |
				fsConstants.O_CREAT |
				fsConstants.O_EXCL |
				fsConstants.O_NOFOLLOW,
			mode,
		);
		try {
			await handle.writeFile(bytes);
		} finally {
			await handle.close();
		}
		await chmod(destination, mode);
		const hashed = await runProcess("candidate_setup", budget, {
			command: gitBinary,
			args: ["hash-object", "--", path],
			cwd: candidateRoot,
			env: CONTROLLED_GIT_ENVIRONMENT,
		});
		const contentHash = hashed.stdout.trim();
		if (hashed.exitCode !== 0 || !/^[0-9a-f]{40,64}$/.test(contentHash)) {
			throw new CandidateSetupError(`could not hash frozen leaf: ${path}`);
		}
		return { path, contentHash, fileMode: executable ? "100755" : "100644" };
	};

	return {
		async run(request: VaultGitCheckRequest): Promise<VaultGitCheckResult> {
			if (runtimeBinaryPath === null) {
				return {
					status: "failed",
					failureClass: "candidate_setup",
					stage: "candidate_setup",
				};
			}
			// A missing, redirected, or unusable admitted runner proves nothing
			// about vault content; refuse before any process or filesystem effect
			// so no candidate, residue, or repair posture can exist for it.
			const runner = await resolveVaultGitInstalledRuntimeRunner(
				runtimeBinaryPath,
			);
			if (runner.status !== "resolved") {
				return {
					status: "failed",
					failureClass: "candidate_setup",
					stage: "candidate_setup",
				};
			}
			let candidateRoot: string | null = null;
			let metadataPath: string | null = null;
			let record: VaultGitCandidateResidueRecord | null = null;
			let outcome: VaultGitCheckResult;
			let abandonedUnsettledWork = false;
			try {
				const budget = new StageBudget(
					VAULT_GIT_VALIDATION_STAGE_BUDGETS_MS.candidate_setup,
					monotonicNow,
				);
				await raceStageBudget(
					"candidate_setup",
					budget,
					(async () => {
						await mkdir(candidatesRoot, { recursive: true, mode: 0o700 });
						const rootMetadata = await lstat(candidatesRoot);
						if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
							throw new CandidateSetupError(
								"candidates root is not a directory",
							);
						}
						await chmod(candidatesRoot, 0o700);
					})(),
				);
				const candidateId = `candidate-${randomUUID()}`;
				candidateRoot = join(candidatesRoot, candidateId);
				metadataPath = join(candidatesRoot, `${candidateId}.json`);
				const createdAt = now().toISOString();
				record = {
					schemaVersion: 1,
					candidateId,
					candidatePath: candidateRoot,
					transactionId: request.transactionId ?? null,
					baselineHead: request.baselineHead,
					createdAt,
					updatedAt: createdAt,
					stage: "candidate_setup",
					failureClass: null,
				};
				try {
					await raceStageBudget(
						"candidate_setup",
						budget,
						writeResidueRecord(record, metadataPath),
					);
				} catch (error) {
					if (error instanceof StageBudgetExceededError) throw error;
					throw new CandidateSetupError("could not record candidate residue");
				}
				const cloned = await runProcess("candidate_setup", budget, {
					command: gitBinary,
					args: [
						"clone",
						"--no-checkout",
						"--no-hardlinks",
						"--local",
						options.repositoryPath,
						candidateRoot,
					],
					cwd: candidatesRoot,
					env: CONTROLLED_GIT_ENVIRONMENT,
				});
				if (cloned.exitCode !== 0) {
					throw new CandidateSetupError("candidate clone failed");
				}
				const checkedOut = await runProcess("candidate_setup", budget, {
					command: gitBinary,
					args: ["checkout", "--detach", request.baselineHead],
					cwd: candidateRoot,
					env: CONTROLLED_GIT_ENVIRONMENT,
				});
				if (checkedOut.exitCode !== 0) {
					throw new CandidateSetupError("baseline checkout failed");
				}
				const checkedPaths: VaultGitOwnedPathContentHash[] = [];
				for (const ownedPath of request.ownedPaths) {
					if (budget.exceeded()) {
						throw new StageBudgetExceededError("candidate_setup");
					}
					checkedPaths.push(
						await raceStageBudget(
							"candidate_setup",
							budget,
							freezeLeaf(budget, candidateRoot, ownedPath.path),
						),
					);
				}
				if (budget.exceeded()) {
					throw new StageBudgetExceededError("candidate_setup");
				}
				// An isolated candidate has no materialized dependencies, and Bun
				// auto-install would otherwise reach the ambient cache or network.
				// A dependency-bearing frozen manifest is therefore not executable
				// here and must refuse as candidate_setup, never as vault content.
				const frozenCheck = await raceStageBudget(
					"candidate_setup",
					budget,
					readFrozenCheckContract(candidateRoot),
				);
				if (frozenCheck.dependencySurface !== undefined) {
					throw new CandidateSetupError(
						`dependency-bearing vault is not executable in an isolated candidate: ${frozenCheck.dependencySurface}`,
					);
				}
				// Advance the durable stage before the check spawns so a crash
				// during the check leaves a record naming vault_check, not a false
				// candidate_setup.
				record = { ...record, updatedAt: now().toISOString(), stage: "vault_check" };
				try {
					await raceStageBudget(
						"candidate_setup",
						budget,
						writeResidueRecord(record, metadataPath),
					);
				} catch (error) {
					if (error instanceof StageBudgetExceededError) throw error;
					throw new CandidateSetupError("could not update candidate residue");
				}
				const checkBudget = new StageBudget(
					VAULT_GIT_VALIDATION_STAGE_BUDGETS_MS.vault_check,
					monotonicNow,
				);
				// Never dispatch through `run check`: bun's run-script lane prepends
				// the machine-shared /tmp bun-node shim ahead of the isolated PATH,
				// handing nested `bun` to ambient bytes instead of the verified
				// alias. `exec` runs the frozen script line with exactly this
				// environment.
				const checked = await runProcess("vault_check", checkBudget, {
					command: runner.command,
					args: ["exec", frozenCheck.checkScript],
					cwd: candidateRoot,
					env: runner.environment,
					environmentMode: "isolated",
				});
				outcome =
					checked.exitCode === 0
						? { status: "passed", checkedPaths }
						: {
								status: "failed",
								failureClass: "vault_content",
								stage: "vault_check",
							};
			} catch (error) {
				if (error instanceof StageBudgetExceededError) {
					abandonedUnsettledWork = error.workUnsettled;
					outcome = {
						status: "failed",
						failureClass: "stage_budget_exceeded",
						stage: error.stage,
					};
				} else {
					outcome = {
						status: "failed",
						failureClass: "candidate_setup",
						stage: "candidate_setup",
					};
				}
			}
			if (candidateRoot === null || metadataPath === null) return outcome;
			if (abandonedUnsettledWork) {
				// The abandoned operation may still be mutating the candidate.
				// Racing cleanup against it could delete state mid-write and let
				// the stray work recreate an unrecorded clone, so the candidate
				// and its record are retained as owned Candidate Residue; the
				// age- and ownership-gated removal seam owns later deletion.
				return outcome;
			}
			const cleanupBudget = new StageBudget(
				VAULT_GIT_VALIDATION_STAGE_BUDGETS_MS.candidate_cleanup,
				monotonicNow,
			);
			let cleanupFailed = false;
			try {
				const removalTarget = candidateRoot;
				await raceStageBudget(
					"candidate_cleanup",
					cleanupBudget,
					Promise.resolve().then(() => removeCandidate(removalTarget)),
				);
			} catch {
				cleanupFailed = true;
			}
			if (cleanupBudget.exceeded()) cleanupFailed = true;
			if (!cleanupFailed) {
				// Removing the residue record is part of cleanup: a record that
				// cannot be removed is retained residue, so the run must classify
				// candidate_cleanup instead of reporting a clean completion.
				try {
					await raceStageBudget(
						"candidate_cleanup",
						cleanupBudget,
						unlink(metadataPath),
					);
				} catch (error) {
					if (!isMissingEntry(error)) cleanupFailed = true;
				}
			}
			if (cleanupFailed) {
				if (record !== null && !cleanupBudget.exceeded()) {
					// Best-effort durable rewrite inside the remaining cleanup
					// budget; with no time left, or on failure, the earlier record
					// remains on disk, still binding owner and age.
					await raceStageBudget(
						"candidate_cleanup",
						cleanupBudget,
						writeResidueRecord(
							{
								...record,
								updatedAt: now().toISOString(),
								stage: "candidate_cleanup",
								failureClass: "candidate_cleanup",
							},
							metadataPath,
						),
					).catch(() => undefined);
				}
				// Cleanup owns the public classification whenever it cannot settle:
				// an earlier setup, budget, or content failure must not hide the
				// retained residue from the closed cleanup routing rows.
				return {
					status: "failed",
					failureClass: "candidate_cleanup",
					stage: "candidate_cleanup",
				};
			}
			return outcome;
		},
	};
}

function isMissingEntry(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

/**
 * Read the frozen candidate's check contract through the shared manifest and
 * dependency-eligibility owner. The exec spawn needs the exact check script
 * line, so an unreadable or unparseable manifest and a missing check script
 * are candidate-composition defects, never a vault-content verdict.
 */
async function readFrozenCheckContract(candidateRoot: string): Promise<{
	readonly checkScript: string;
	readonly dependencySurface: string | undefined;
}> {
	const manifestBytes = await readFile(
		join(candidateRoot, "package.json"),
	).catch(() => {
		throw new CandidateSetupError("unreadable candidate manifest");
	});
	let manifest: Record<string, unknown>;
	try {
		manifest = parseVaultGitManifest(manifestBytes);
	} catch {
		throw new CandidateSetupError("invalid candidate manifest");
	}
	const checkScript = findVaultGitCheckScript(manifest);
	if (checkScript === undefined) {
		throw new CandidateSetupError("candidate check script unavailable");
	}
	return {
		checkScript,
		dependencySurface: findVaultGitDependencySurface(manifest),
	};
}

/** Residue becomes removal-eligible one hour after its last evidence write. */
export const VAULT_GIT_CANDIDATE_RESIDUE_ELIGIBLE_AFTER_MS = 60 * 60_000;

const CANDIDATE_ID_PATTERN =
	/^candidate-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RESIDUE_RECORD_KEYS = [
	"baselineHead",
	"candidateId",
	"candidatePath",
	"createdAt",
	"failureClass",
	"schemaVersion",
	"stage",
	"transactionId",
	"updatedAt",
] as const;
const RESIDUE_STAGES: readonly VaultGitValidationStage[] =
	VAULT_GIT_VALIDATION_STAGES;

/** Completion Task ownership evidence for one residue transaction. */
export type VaultGitCandidateResidueOwnership =
	| "active"
	| "inactive"
	| "unknown";

/** Injected Completion Task ownership proof; heuristics never substitute. */
export interface VaultGitCandidateResidueOwnershipPort {
	/** Prove whether an active Completion Task owns the transaction. */
	isTransactionActivelyOwned(
		transactionId: string,
	): Promise<VaultGitCandidateResidueOwnership>;
}

/** One validated residue record with age- and ownership-gated eligibility. */
export interface VaultGitCandidateResidueRecordObservation {
	readonly kind: "record";
	readonly candidateId: string;
	readonly candidatePath: string;
	readonly transactionId: string | null;
	readonly stage: VaultGitValidationStage;
	/** Proven clone state; "unknown" carries an evidence read failure. */
	readonly candidatePresence: "present" | "absent" | "unknown";
	/** Instant the age gate opens for this record. */
	readonly eligibleAfter: string;
	readonly eligibility:
		| "active_owned"
		| "young"
		| "unknown_owner"
		| "unknown_evidence"
		| "eligible"
		| "already_removed";
}

/** Evidence that failed validation or pairing; content is never echoed. */
export interface VaultGitCandidateResidueAnomalyObservation {
	readonly kind: "corrupt_evidence" | "unrecorded_candidate";
	/** Directory entry name only, for operator escalation. */
	readonly entryName: string;
}

/** One residue evidence state; every entry has an owner or stop condition. */
export type VaultGitCandidateResidueObservation =
	| VaultGitCandidateResidueRecordObservation
	| VaultGitCandidateResidueAnomalyObservation;

/** Complete observation result; an unreadable root fails closed. */
export type VaultGitCandidateResidueObserveResult =
	| {
			readonly status: "observed";
			readonly observations: readonly VaultGitCandidateResidueObservation[];
	  }
	| { readonly status: "failed"; readonly reason: "residue_root_unreadable" };

/** Removal outcome; every refusal names its gate for closed Doctor routing. */
export type VaultGitCandidateResidueRemoval =
	| "removed"
	| "refused_active_owner"
	| "refused_young"
	| "refused_unknown_owner"
	| "refused_unknown_evidence"
	| "already_removed"
	| "unknown_record";

/** Deep Candidate Residue evidence, eligibility, and removal seam. */
export interface VaultGitCandidateResidueStore {
	/** List every residue evidence state with gated eligibility. */
	observe(): Promise<VaultGitCandidateResidueObserveResult>;
	/** Remove one old proven-unowned clone; bounded metadata is retained. */
	remove(candidateId: string): Promise<VaultGitCandidateResidueRemoval>;
}

/** Options for the owner-private Candidate Residue store. */
export interface VaultGitCandidateResidueStoreOptions {
	/** Owner-private state root holding candidates and residue records. */
	readonly privateStateRoot: string;
	/** Completion Task ownership proof for residue transactions. */
	readonly ownership: VaultGitCandidateResidueOwnershipPort;
	/** Wall clock for the age gate. @defaultValue system clock */
	readonly now?: () => Date;
}

/**
 * Create the deep Candidate Residue seam later routing consumes.
 *
 * Removal deletes only the full candidate clone of residue that is older than
 * the eligibility window and proven unowned by any active Completion Task;
 * the bounded owner-private record is always retained, and unreadable or
 * unowned-unknown evidence refuses rather than guessing.
 *
 * @param options - Private state root, ownership proof, and clock
 * @returns Observation and gated removal operations
 *
 * @example
 * ```typescript
 * const residue = createVaultGitCandidateResidueStore({
 *   privateStateRoot,
 *   ownership: { isTransactionActivelyOwned: async () => "inactive" },
 * })
 * for (const observed of await residue.observe()) {
 *   if (observed.eligibility === "eligible") await residue.remove(observed.candidateId)
 * }
 * ```
 */
export function createVaultGitCandidateResidueStore(
	options: VaultGitCandidateResidueStoreOptions,
): VaultGitCandidateResidueStore {
	const now = options.now ?? (() => new Date());
	const candidatesRoot = join(options.privateStateRoot, CANDIDATES_DIRECTORY);

	type RecordRead =
		| { readonly status: "ok"; readonly record: VaultGitCandidateResidueRecord }
		| { readonly status: "missing" }
		| { readonly status: "corrupt" };

	const isValidRecord = (
		candidateId: string,
		value: unknown,
	): value is VaultGitCandidateResidueRecord => {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			return false;
		}
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record).sort();
		if (
			keys.length !== RESIDUE_RECORD_KEYS.length ||
			keys.some((key, index) => key !== RESIDUE_RECORD_KEYS[index])
		) {
			return false;
		}
		return (
			record.schemaVersion === 1 &&
			record.candidateId === candidateId &&
			CANDIDATE_ID_PATTERN.test(candidateId) &&
			record.candidatePath === join(candidatesRoot, candidateId) &&
			(record.transactionId === null ||
				(typeof record.transactionId === "string" &&
					record.transactionId.length > 0)) &&
			typeof record.baselineHead === "string" &&
			/^[0-9a-f]{40,64}$/.test(record.baselineHead) &&
			typeof record.createdAt === "string" &&
			Number.isFinite(Date.parse(record.createdAt)) &&
			typeof record.updatedAt === "string" &&
			Number.isFinite(Date.parse(record.updatedAt)) &&
			RESIDUE_STAGES.includes(record.stage as VaultGitValidationStage) &&
			(record.failureClass === null || record.failureClass === "candidate_cleanup")
		);
	};

	const readRecord = async (candidateId: string): Promise<RecordRead> => {
		if (!CANDIDATE_ID_PATTERN.test(candidateId)) return { status: "corrupt" };
		const recordPath = join(candidatesRoot, `${candidateId}.json`);
		let text: string;
		try {
			text = await readFile(recordPath, "utf8");
		} catch (error) {
			return isMissingEntry(error)
				? { status: "missing" }
				: { status: "corrupt" };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return { status: "corrupt" };
		}
		if (!isValidRecord(candidateId, parsed)) return { status: "corrupt" };
		return { status: "ok", record: parsed as VaultGitCandidateResidueRecord };
	};

	const classify = async (
		record: VaultGitCandidateResidueRecord,
	): Promise<VaultGitCandidateResidueRecordObservation> => {
		// Only ENOENT proves absence; a permission or IO failure is unknown
		// evidence and must stop, never read as an already-removed clone.
		const metadata = await lstat(record.candidatePath).then(
			(value) => ({ status: "ok" as const, value }),
			(error: unknown) =>
				isMissingEntry(error)
					? { status: "absent" as const }
					: { status: "error" as const },
		);
		const evidenceAt = Date.parse(record.updatedAt);
		const eligibleAfterMs =
			evidenceAt + VAULT_GIT_CANDIDATE_RESIDUE_ELIGIBLE_AFTER_MS;
		const base = {
			kind: "record" as const,
			candidateId: record.candidateId,
			candidatePath: record.candidatePath,
			transactionId: record.transactionId,
			stage: record.stage,
			eligibleAfter: new Date(eligibleAfterMs).toISOString(),
		};
		if (metadata.status === "error") {
			return {
				...base,
				candidatePresence: "unknown",
				eligibility: "unknown_evidence",
			};
		}
		if (metadata.status === "absent") {
			return {
				...base,
				candidatePresence: "absent",
				eligibility: "already_removed",
			};
		}
		if (
			metadata.value.isSymbolicLink() ||
			!metadata.value.isDirectory()
		) {
			return {
				...base,
				candidatePresence: "unknown",
				eligibility: "unknown_evidence",
			};
		}
		const present = { ...base, candidatePresence: "present" as const };
		if (record.transactionId === null) {
			return { ...present, eligibility: "unknown_owner" };
		}
		const ownership = await options.ownership
			.isTransactionActivelyOwned(record.transactionId)
			.catch((): VaultGitCandidateResidueOwnership => "unknown");
		if (ownership === "active") {
			return { ...present, eligibility: "active_owned" };
		}
		if (ownership === "unknown") {
			return { ...present, eligibility: "unknown_owner" };
		}
		if (now().getTime() < eligibleAfterMs) {
			return { ...present, eligibility: "young" };
		}
		return { ...present, eligibility: "eligible" };
	};

	return {
		async observe() {
			let entries: string[];
			try {
				entries = await readdir(candidatesRoot);
			} catch (error) {
				if (isMissingEntry(error)) return { status: "observed", observations: [] };
				return { status: "failed", reason: "residue_root_unreadable" };
			}
			const observations: VaultGitCandidateResidueObservation[] = [];
			const validRecordIds = new Set<string>();
			for (const entry of [...entries].sort()) {
				if (!entry.endsWith(".json")) continue;
				const candidateId = entry.slice(0, -".json".length);
				const read = await readRecord(candidateId);
				if (read.status !== "ok") {
					observations.push({ kind: "corrupt_evidence", entryName: entry });
					continue;
				}
				validRecordIds.add(candidateId);
				observations.push(await classify(read.record));
			}
			for (const entry of [...entries].sort()) {
				if (entry.endsWith(".json")) continue;
				if (validRecordIds.has(entry)) continue;
				observations.push({
					kind: CANDIDATE_ID_PATTERN.test(entry)
						? "unrecorded_candidate"
						: "corrupt_evidence",
					entryName: entry,
				});
			}
			return { status: "observed", observations };
		},
		async remove(candidateId) {
			// Fresh read and classification immediately before any removal so
			// evidence that changed after an earlier observation re-gates here.
			const read = await readRecord(candidateId);
			if (read.status === "missing") return "unknown_record";
			if (read.status !== "ok") return "refused_unknown_evidence";
			const observed = await classify(read.record);
			switch (observed.eligibility) {
				case "already_removed":
					return "already_removed";
				case "active_owned":
					return "refused_active_owner";
				case "unknown_owner":
					return "refused_unknown_owner";
				case "unknown_evidence":
					return "refused_unknown_evidence";
				case "young":
					return "refused_young";
				case "eligible":
					break;
			}
			// Re-prove the root and the derived target right before deletion:
			// removal only ever deletes the exact directory the validated id
			// names beneath the non-symlink owner root.
			const rootMetadata = await lstat(candidatesRoot).catch(() => null);
			if (
				rootMetadata === null ||
				rootMetadata.isSymbolicLink() ||
				!rootMetadata.isDirectory()
			) {
				return "refused_unknown_evidence";
			}
			const target = join(candidatesRoot, candidateId);
			const targetMetadata = await lstat(target).then(
				(value) => ({ status: "ok" as const, value }),
				(error: unknown) =>
					isMissingEntry(error)
						? { status: "absent" as const }
						: { status: "error" as const },
			);
			if (targetMetadata.status === "absent") return "already_removed";
			if (
				targetMetadata.status === "error" ||
				targetMetadata.value.isSymbolicLink() ||
				!targetMetadata.value.isDirectory()
			) {
				return "refused_unknown_evidence";
			}
			await rm(target, { recursive: true, force: true });
			return "removed";
		},
	};
}

/**
 * Prove every ancestor of the overlay destination is a real directory beneath
 * the candidate root, then clear the leaf. A baseline symlink ancestor or leaf
 * must refuse before any overlay write so candidate writes can never escape
 * the private candidate root.
 */
async function resolveOverlayDestination(
	candidateRoot: string,
	path: string,
): Promise<string> {
	const segments = path.split("/");
	const leaf = segments.pop();
	if (!leaf) throw new CandidateSetupError(`invalid owned path: ${path}`);
	let current = candidateRoot;
	for (const segment of segments) {
		current = join(current, segment);
		const metadata = await lstat(current).catch((error: unknown) => {
			if (isMissingEntry(error)) return null;
			throw new CandidateSetupError(`unreadable overlay ancestor: ${path}`);
		});
		if (metadata === null) {
			await mkdir(current, { mode: 0o700 });
			continue;
		}
		if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
			throw new CandidateSetupError(`overlay ancestor escape: ${path}`);
		}
	}
	const destination = join(current, leaf);
	const existing = await lstat(destination).catch((error: unknown) => {
		if (isMissingEntry(error)) return null;
		throw new CandidateSetupError(`unreadable overlay leaf: ${path}`);
	});
	if (existing !== null) {
		if (existing.isDirectory() && !existing.isSymbolicLink()) {
			await rm(destination, { recursive: true, force: true });
		} else {
			await unlink(destination);
		}
	}
	return destination;
}
