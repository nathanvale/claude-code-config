import type { VaultGitDoctorResult } from "./doctor.ts";
import type { VaultGitEngineResult } from "./engine.ts";
import type {
	VaultGitBlockerId,
	VaultGitCheckerAdmissionRecord,
	VaultGitDoctorFinding,
	VaultGitHygieneVaultPosture,
	VaultGitHygieneWorkerTrigger,
	VaultGitNextAction,
	VaultGitPrivateHygieneResult,
} from "./model.ts";
import type {
	VaultGitCheckerPort,
	VaultGitCheckerProcessResult,
	VaultGitCheckerRepairRequest,
} from "./ports.ts";
import { evaluateVaultGitWorkerPolicy } from "./worker-policy.ts";

/** Read-only engine proof required before any unattended Janitor mutation. */
export type VaultGitJanitorPreflight =
	| {
			readonly status: "eligible";
			readonly doctor: VaultGitDoctorResult;
	  }
	| {
			readonly status: "refused";
			readonly blocker: VaultGitBlockerId;
			readonly doctor: VaultGitDoctorResult;
	  };

/** One engine-owned hygiene transaction request. */
export interface VaultGitHygieneTransactionRequest {
	/** Exact checker-owned files grouped into the transaction. */
	readonly paths: readonly string[];
	/** Named remote re-proved by the transaction engine. */
	readonly remote: string;
	/** Fresh hygiene lease duration. */
	readonly leaseDurationMs: number;
	/** Deterministic manager-owned commit subject. */
	readonly summary: string;
	/** Observer invoked once the fresh hygiene lease is held. */
	readonly onLeaseAcquired?: () => void;
	/** Checker mutation invoked only after the new lease is held. */
	readonly apply: () => Promise<boolean>;
}

/** Narrow engine surface consumed by Janitor; no Git or store access leaks out. */
export interface VaultGitJanitorEnginePort {
	/** Prove remote, current main, whole-tree cleanliness, and global recovery state. */
	inspectJanitorPreflight(remote: string): Promise<VaultGitJanitorPreflight>;
	/** Read checker admission through engine-owned private state custody. */
	readCheckerAdmission(): Promise<VaultGitCheckerAdmissionRecord | null>;
	/** Prune deterministic manager-owned private hygiene through the engine. */
	prunePrivateHygiene(): Promise<VaultGitPrivateHygieneResult>;
	/** Persist one bounded report under owner-only private state. */
	recordJanitorReport(reportJson: string): Promise<void>;
	/** Acquire, mutate, check, commit, publish, and close one fresh transaction. */
	runHygieneTransaction(
		request: VaultGitHygieneTransactionRequest,
	): Promise<VaultGitEngineResult>;
}

/** Janitor construction dependencies. */
export interface VaultGitJanitorOptions {
	/** Sole transaction and private-state engine caller. */
	readonly engine: VaultGitJanitorEnginePort;
	/** External structured checker boundary. */
	readonly checker: VaultGitCheckerPort;
	/** Named remote used for fresh hygiene transactions. */
	readonly remote: string;
	/** Fresh hygiene transaction lease duration. */
	readonly leaseDurationMs: number;
}

/** One admitted invocation of the bounded Janitor. */
export interface VaultGitJanitorInput {
	/** Settled worker trigger selected by the caller. */
	readonly trigger: VaultGitHygieneWorkerTrigger | string;
}

/** One checker repair skipped without changing canonical vault bytes. */
export interface VaultGitJanitorSkippedRepair {
	/** Repair owner whose action stayed preview-only. */
	readonly owner: "checker" | "manager";
	/** Stable finding id when checker output supplied one. */
	readonly findingId?: string;
	/** Stable repair id when checker output supplied one. */
	readonly repairId?: string;
	/** Closed reason vocabulary; never derived from human checker messages. */
	readonly reason:
		| "checker_unadmitted"
		| "checker_changed"
		| "checker_output_invalid"
		| "preview_only"
		| "secret_like"
		| "unsafe_file"
		| "unknown_repair"
		| "repair_refused"
		| "private_hygiene_failed";
}

/** One proposed one-commit checker transaction group. */
export interface VaultGitJanitorTransactionGroup {
	/** Sorted repository-relative files. */
	readonly files: readonly string[];
	/** Sorted checker registry repair ids. */
	readonly repairIds: readonly string[];
}

/** Complete bounded R30 Janitor report. */
export interface VaultGitJanitorReport {
	/** Run disposition. */
	readonly status: "preview" | "repaired" | "refused";
	/** Admitted worker trigger, when one exists. */
	readonly trigger?: VaultGitHygieneWorkerTrigger;
	/** Closed doctor findings indicating stale local work. */
	readonly staleReceipts: readonly string[];
	/** Closed doctor findings or blockers indicating lease anomalies. */
	readonly leaseAnomalies: readonly string[];
	/** Whether manager recovery reports uncertain publication. */
	readonly pushPending: boolean;
	/** Deterministic checker changes grouped for one hygiene transaction. */
	readonly proposedTransactionGroups: readonly VaultGitJanitorTransactionGroup[];
	/** Repairs deliberately left preview-only. */
	readonly skippedRepairs: readonly VaultGitJanitorSkippedRepair[];
	/** Private manager-owned material pruned without touching the vault. */
	readonly privateHygiene: VaultGitPrivateHygieneResult;
	/** Stable blocker naming the refusal cause, when one applies. */
	readonly blocker?: VaultGitBlockerId;
	/** Mutation extent reported by the hygiene transaction engine, when one ran. */
	readonly changedState?: VaultGitEngineResult["changedState"];
	/** Cooperative posture; read_only while a hygiene lease stays held. */
	readonly vaultPosture: VaultGitHygieneVaultPosture;
	/** Foreground work outside the vault remains eligible. */
	readonly foregroundNonVaultWorkAllowed: true;
	/** Exactly one safe continuation. */
	readonly nextAction: VaultGitNextAction;
}

/** Bounded Janitor runner; never spawns an agent task. */
export interface VaultGitJanitor {
	/** Inspect, classify, and apply only admitted deterministic repairs. */
	run(input: VaultGitJanitorInput): Promise<VaultGitJanitorReport>;
}

interface CheckerFinding {
	readonly id: string;
	readonly file: string;
	readonly repairId: string | null;
	readonly field?: string;
}

interface CheckerRepair {
	readonly id: string;
	readonly findingId: string;
}

/** One finding admitted for a registered deterministic repair. */
interface AdmittedRepair {
	readonly findingId: string;
	readonly file: string;
	readonly repairId: string;
	readonly field: string;
}

const emptyPrivateHygiene = {
	capabilityFiles: 0,
	doctorTokenRecords: 0,
	janitorReports: 0,
} as const;

/** Conservative checker-derived token shape; a leading '-' never reaches argv. */
const SAFE_CHECKER_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/**
 * Create one conservative Janitor over the existing transaction engine.
 *
 * @param options - Engine, checker, remote, and fresh lease policy
 * @returns Runner that previews ambiguity and closes deterministic repairs
 * @throws Never for expected checker, policy, or transaction refusals
 *
 * @example
 * ```typescript
 * const report = await createVaultGitJanitor(options).run({ trigger: "nightly" })
 * follow(report.nextAction)
 * ```
 */
export function createVaultGitJanitor(
	options: VaultGitJanitorOptions,
): VaultGitJanitor {
	const finalize = async (
		report: VaultGitJanitorReport,
	): Promise<VaultGitJanitorReport> => {
		try {
			await options.engine.recordJanitorReport(JSON.stringify(report));
			return report;
		} catch {
			return {
				...report,
				status: report.status === "repaired" ? "repaired" : "refused",
				skippedRepairs: [
					...report.skippedRepairs,
					{ owner: "manager", reason: "private_hygiene_failed" },
				],
				nextAction: operatorAction(
					"Restore private Janitor report custody before the next run.",
				),
			};
		}
	};
	return {
		async run(input) {
			const policy = evaluateVaultGitWorkerPolicy({ trigger: input.trigger });
			if (!policy.eligible || !policy.trigger) {
				return finalize(baseReport({
					status: "refused",
					nextAction: policy.nextAction,
				}));
			}

			let preflight: VaultGitJanitorPreflight;
			try {
				preflight = await options.engine.inspectJanitorPreflight(options.remote);
			} catch {
				return finalize(baseReport({
					status: "refused",
					trigger: policy.trigger,
					nextAction: operatorAction("Inspect Janitor preflight failure with an operator."),
				}));
			}
			const anomalies = anomaliesFor(preflight.doctor);
			if (preflight.status === "refused") {
				return finalize(baseReport({
					status: "refused",
					trigger: policy.trigger,
					...anomalies,
					blocker: preflight.blocker,
					nextAction: actionForBlocker(preflight.blocker),
				}));
			}

			const skippedRepairs: VaultGitJanitorSkippedRepair[] = [];
			let privateHygiene: VaultGitPrivateHygieneResult = emptyPrivateHygiene;
			try {
				privateHygiene = await options.engine.prunePrivateHygiene();
			} catch {
				skippedRepairs.push({
					owner: "manager",
					reason: "private_hygiene_failed",
				});
			}

			let admission: VaultGitCheckerAdmissionRecord | null;
			try {
				admission = await options.engine.readCheckerAdmission();
			} catch {
				skippedRepairs.push({ owner: "checker", reason: "checker_output_invalid" });
				return finalize(previewReport(policy.trigger, anomalies, privateHygiene, skippedRepairs));
			}
			if (!admission) {
				skippedRepairs.push({ owner: "checker", reason: "checker_unadmitted" });
				return finalize(previewReport(policy.trigger, anomalies, privateHygiene, skippedRepairs));
			}
			const admitted = admission;
			// KTD10 TOCTOU guard: every checker execution boundary re-proves the
			// on-disk checker still matches the admitted fingerprint immediately
			// before that boundary runs.
			const verifyAdmission = async (): Promise<
				"admitted" | "checker_changed" | "checker_output_invalid"
			> => {
				let current: Awaited<ReturnType<VaultGitCheckerPort["fingerprint"]>>;
				try {
					current = await options.checker.fingerprint();
				} catch {
					return "checker_output_invalid";
				}
				return current.entrypointHash === admitted.entrypointHash &&
					current.dependencyBundleHash === admitted.dependencyBundleHash
					? "admitted"
					: "checker_changed";
			};

			let findings: readonly CheckerFinding[];
			let registry: readonly CheckerRepair[];
			try {
				const beforeCheck = await verifyAdmission();
				if (beforeCheck !== "admitted") {
					skippedRepairs.push({ owner: "checker", reason: beforeCheck });
					return finalize(previewReport(policy.trigger, anomalies, privateHygiene, skippedRepairs));
				}
				const checkResult = await options.checker.runCheck();
				const beforeRegistry = await verifyAdmission();
				if (beforeRegistry !== "admitted") {
					skippedRepairs.push({ owner: "checker", reason: beforeRegistry });
					return finalize(previewReport(policy.trigger, anomalies, privateHygiene, skippedRepairs));
				}
				const registryResult = await options.checker.readRepairRegistry();
				findings = parseFindings(checkResult);
				registry = parseRegistry(registryResult);
			} catch {
				skippedRepairs.push({ owner: "checker", reason: "checker_output_invalid" });
				return finalize(previewReport(policy.trigger, anomalies, privateHygiene, skippedRepairs));
			}

			const registryById = new Map(registry.map((repair) => [repair.id, repair]));
			const classified = classifyFindings(findings, registryById);
			skippedRepairs.push(...classified.skipped);
			const requests = classified.admitted;
			const groups = requests.length === 0 ? [] : [groupFor(requests)];
			if (requests.length === 0) {
				return finalize(previewReport(
					policy.trigger,
					anomalies,
					privateHygiene,
					skippedRepairs,
					groups,
				));
			}

			let leaseHeld = false;
			let transaction: VaultGitEngineResult;
			try {
				transaction = await options.engine.runHygieneTransaction({
					paths: groups[0]?.files ?? [],
					remote: options.remote,
					leaseDurationMs: options.leaseDurationMs,
					summary: "chore(vault): apply deterministic hygiene",
					onLeaseAcquired() {
						leaseHeld = true;
					},
					async apply() {
						// Fresh-lease staleness gate: the admitted fingerprint and the
						// admitted finding set must both survive lease acquisition, or
						// this transaction refuses without mutating anything.
						if ((await verifyAdmission()) !== "admitted") return false;
						let rescanned: readonly CheckerFinding[];
						try {
							rescanned = parseFindings(await options.checker.runCheck());
						} catch {
							return false;
						}
						const recheck = classifyFindings(rescanned, registryById);
						if (!sameAdmittedSet(requests, recheck.admitted)) return false;
						for (const request of requests) {
							const applied = parseApplied(
								await options.checker.applyRepair({
									repairId: request.repairId,
									file: request.file,
									field: request.field,
								}),
							);
							if (!applied) return false;
						}
						return true;
					},
				});
			} catch {
				transaction = refusedEngineResult(
					"checker_repair_refused",
					leaseHeld ? "partial" : "none",
				);
			}
			if (transaction.status === "completed") leaseHeld = false;
			const vaultPosture = evaluateVaultGitWorkerPolicy({
				trigger: policy.trigger,
				leaseHeld,
			}).vaultPosture;
			if (transaction.status !== "completed") {
				for (const request of requests) {
					skippedRepairs.push({
						owner: "checker",
						findingId: request.findingId,
						repairId: request.repairId,
						reason: "repair_refused",
					});
				}
				return finalize(baseReport({
					status: "refused",
					trigger: policy.trigger,
					...anomalies,
					proposedTransactionGroups: groups,
					skippedRepairs,
					privateHygiene,
					blocker: transaction.blocker ?? "checker_repair_refused",
					changedState: transaction.changedState,
					vaultPosture,
					nextAction: transaction.nextAction,
				}));
			}
			return finalize(baseReport({
				status: "repaired",
				trigger: policy.trigger,
				...anomalies,
				proposedTransactionGroups: groups,
				skippedRepairs,
				privateHygiene,
				changedState: transaction.changedState,
				vaultPosture,
				nextAction: transaction.nextAction,
			}));
		},
	};
}

function classifyFindings(
	findings: readonly CheckerFinding[],
	registryById: ReadonlyMap<string, CheckerRepair>,
): {
	readonly admitted: readonly AdmittedRepair[];
	readonly skipped: readonly VaultGitJanitorSkippedRepair[];
} {
	const admitted: AdmittedRepair[] = [];
	const skipped: VaultGitJanitorSkippedRepair[] = [];
	for (const finding of findings) {
		if (!isSafeRelativeFile(finding.file)) {
			skipped.push(skip(finding, "unsafe_file"));
			continue;
		}
		if (finding.id === "body-secret-shaped-value") {
			skipped.push(skip(finding, "secret_like"));
			continue;
		}
		if (!finding.repairId || !finding.field) {
			skipped.push(skip(finding, "preview_only"));
			continue;
		}
		if (
			!SAFE_CHECKER_TOKEN.test(finding.repairId) ||
			!SAFE_CHECKER_TOKEN.test(finding.field)
		) {
			skipped.push(skip(finding, "preview_only"));
			continue;
		}
		const repair = registryById.get(finding.repairId);
		if (!repair || repair.findingId !== finding.id) {
			skipped.push(skip(finding, "unknown_repair"));
			continue;
		}
		admitted.push({
			findingId: finding.id,
			file: finding.file,
			repairId: repair.id,
			field: finding.field,
		});
	}
	return { admitted, skipped };
}

function sameAdmittedSet(
	expected: readonly AdmittedRepair[],
	observed: readonly AdmittedRepair[],
): boolean {
	const serialize = (repairs: readonly AdmittedRepair[]): string =>
		JSON.stringify(
			repairs
				.map((repair) => [repair.findingId, repair.file, repair.repairId, repair.field])
				.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
		);
	return serialize(expected) === serialize(observed);
}

function parseFindings(result: VaultGitCheckerProcessResult): readonly CheckerFinding[] {
	const value = parseStructured(result);
	if (!isRecord(value) || value.schema_version !== 1 || !Array.isArray(value.findings)) {
		throw new Error("checker findings malformed");
	}
	const findings: CheckerFinding[] = [];
	for (const finding of value.findings) {
		// The checker contract declares detail optional; absence is valid and
		// simply leaves the finding preview-only downstream.
		if (
			!isRecord(finding) ||
			typeof finding.id !== "string" ||
			typeof finding.file !== "string" ||
			!(finding.repair_id === null || typeof finding.repair_id === "string") ||
			!(finding.detail === undefined || isRecord(finding.detail))
		) {
			throw new Error("checker finding malformed");
		}
		const field = isRecord(finding.detail) ? finding.detail.field : undefined;
		findings.push({
			id: finding.id,
			file: finding.file,
			repairId: finding.repair_id,
			...(typeof field === "string" && field.length > 0 ? { field } : {}),
		});
	}
	if (result.exitCode !== (findings.length === 0 ? 0 : 1)) {
		throw new Error("checker exit disagrees with findings");
	}
	return findings;
}

function parseRegistry(result: VaultGitCheckerProcessResult): readonly CheckerRepair[] {
	if (result.exitCode !== 0) throw new Error("checker registry failed");
	const value = parseStructured(result);
	if (!isRecord(value) || value.schema_version !== 1 || !Array.isArray(value.repairs)) {
		throw new Error("checker registry malformed");
	}
	return value.repairs.map((repair) => {
		if (
			!isRecord(repair) ||
			typeof repair.id !== "string" ||
			typeof repair.finding_id !== "string"
		) {
			throw new Error("checker repair malformed");
		}
		return { id: repair.id, findingId: repair.finding_id };
	});
}

function parseApplied(result: VaultGitCheckerProcessResult): boolean {
	const value = parseStructured(result);
	return (
		result.exitCode === 0 &&
		isRecord(value) &&
		value.schema_version === 1 &&
		value.status === "repaired"
	);
}

function parseStructured(result: VaultGitCheckerProcessResult): unknown {
	if (result.timedOut || result.stdout.length === 0 || result.stdout.length > 1_000_000) {
		throw new Error("checker output unavailable");
	}
	return JSON.parse(result.stdout);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativeFile(file: string): boolean {
	if (
		file.length === 0 ||
		file.startsWith("/") ||
		file.startsWith("-") ||
		file.includes("\\") ||
		/[\r\n\0]/.test(file)
	) {
		return false;
	}
	const segments = file.split("/");
	return !segments.some(
		(segment) =>
			segment.length === 0 ||
			segment === "." ||
			segment === ".." ||
			segment.toLowerCase() === ".git",
	);
}

function groupFor(
	requests: readonly VaultGitCheckerRepairRequest[],
): VaultGitJanitorTransactionGroup {
	return {
		files: [...new Set(requests.map((request) => request.file))].sort(),
		repairIds: [...new Set(requests.map((request) => request.repairId))].sort(),
	};
}

function skip(
	finding: CheckerFinding,
	reason: VaultGitJanitorSkippedRepair["reason"],
): VaultGitJanitorSkippedRepair {
	return {
		owner: "checker",
		findingId: finding.id,
		...(finding.repairId ? { repairId: finding.repairId } : {}),
		reason,
	};
}

function anomaliesFor(doctor: VaultGitDoctorResult): Pick<
	VaultGitJanitorReport,
	"staleReceipts" | "leaseAnomalies" | "pushPending"
> {
	const staleFindings = new Set<VaultGitDoctorFinding>([
		"acquisition_not_started",
		"lease_acknowledgement_missing",
		"checks_interrupted",
		"commit_interrupted",
		"lease_expired",
	]);
	const leaseFindings = new Set<VaultGitDoctorFinding>([
		"lease_acquired",
		"lease_expired",
		"lease_superseded",
		"host_quarantined",
	]);
	return {
		staleReceipts: staleFindings.has(doctor.finding) ? [doctor.finding] : [],
		leaseAnomalies:
			leaseFindings.has(doctor.finding) || doctor.blocker?.startsWith("lease_")
				? [doctor.blocker ?? doctor.finding]
				: [],
		pushPending: doctor.state === "push_pending",
	};
}

function previewReport(
	trigger: VaultGitHygieneWorkerTrigger,
	anomalies: Pick<
		VaultGitJanitorReport,
		"staleReceipts" | "leaseAnomalies" | "pushPending"
	>,
	privateHygiene: VaultGitPrivateHygieneResult,
	skippedRepairs: readonly VaultGitJanitorSkippedRepair[],
	proposedTransactionGroups: readonly VaultGitJanitorTransactionGroup[] = [],
): VaultGitJanitorReport {
	return baseReport({
		status: "preview",
		trigger,
		...anomalies,
		privateHygiene,
		skippedRepairs,
		proposedTransactionGroups,
		nextAction:
			skippedRepairs.length === 0
				? { id: "none", summary: "No deterministic vault repair is pending." }
				: operatorAction("Review the skipped Janitor repairs before any vault write."),
	});
}

function baseReport(
	input: Partial<VaultGitJanitorReport> &
		Pick<VaultGitJanitorReport, "status" | "nextAction">,
): VaultGitJanitorReport {
	return {
		status: input.status,
		...(input.trigger ? { trigger: input.trigger } : {}),
		staleReceipts: input.staleReceipts ?? [],
		leaseAnomalies: input.leaseAnomalies ?? [],
		pushPending: input.pushPending ?? false,
		proposedTransactionGroups: input.proposedTransactionGroups ?? [],
		skippedRepairs: input.skippedRepairs ?? [],
		privateHygiene: input.privateHygiene ?? emptyPrivateHygiene,
		...(input.blocker ? { blocker: input.blocker } : {}),
		...(input.changedState !== undefined
			? { changedState: input.changedState }
			: {}),
		vaultPosture: input.vaultPosture ?? "normal",
		foregroundNonVaultWorkAllowed: true,
		nextAction: input.nextAction,
	};
}

function operatorAction(summary: string): VaultGitNextAction {
	return { id: "request_operator_review", summary };
}

function actionForBlocker(blocker: VaultGitBlockerId): VaultGitNextAction {
	if (blocker === "remote_unavailable") {
		return { id: "retry_remote", summary: "Restore remote access, then retry Janitor." };
	}
	if (blocker === "dirty_tree") {
		return {
			id: "preserve_local_edits",
			summary: "Preserve or finish local vault edits before retrying Janitor.",
		};
	}
	return operatorAction("Inspect the blocking transaction evidence before retrying Janitor.");
}

function refusedEngineResult(
	blocker: VaultGitBlockerId,
	changedState: VaultGitEngineResult["changedState"] = "none",
): VaultGitEngineResult {
	return {
		status: "refused",
		state: "human_required",
		phase: "human_required",
		writePermission: "denied",
		changedState,
		retrySafety: "operator_required",
		blocker,
		nextAction: {
			id: "request_operator_review",
			summary: "Inspect the refused checker repair transaction.",
		},
	};
}
