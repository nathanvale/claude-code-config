import { describe, expect, test } from "bun:test";

import {
	createVaultGitJanitor,
	type VaultGitJanitorEnginePort,
} from "../src/janitor.ts";
import type {
	VaultGitCheckerPort,
	VaultGitCheckerProcessResult,
} from "../src/ports.ts";

const admittedHash = "a".repeat(64);
const bundleHash = "b".repeat(64);

describe("deterministic Janitor", () => {
	test("runs one registered checker repair through one hygiene transaction", async () => {
		let transactions = 0;
		let applies = 0;
		const checker = fakeChecker({
			check: output(1, {
				schema_version: 1,
				findings: [
					{
						id: "optional-field-empty",
						file: "notes/a.md",
						message: "ignored human text",
						repair_id: "remove-empty-optional-field",
						detail: { field: "owner" },
					},
				],
			}),
			registry: output(0, {
				schema_version: 1,
				repairs: [
					{
						id: "remove-empty-optional-field",
						finding_id: "optional-field-empty",
						description: "ignored human text",
					},
				],
			}),
			async applyRepair() {
				applies += 1;
				return output(0, { schema_version: 1, status: "repaired" });
			},
		});
		const engine = fakeEngine({
			async runHygieneTransaction(request) {
				transactions += 1;
				expect(request.paths).toEqual(["notes/a.md"]);
				expect(await request.apply()).toBe(true);
				return {
					status: "completed",
					state: "closed",
					phase: "closed",
					writePermission: "owner",
					changedState: "remote",
					retrySafety: "same_input_safe",
					nextAction: { id: "none", summary: "Done." },
				};
			},
		});
		const report = await createVaultGitJanitor({
			engine,
			checker,
			remote: "origin",
			leaseDurationMs: 60_000,
		}).run({ trigger: "nightly" });

		expect(report.status).toBe("repaired");
		expect(report.proposedTransactionGroups).toEqual([
			{
				files: ["notes/a.md"],
				repairIds: ["remove-empty-optional-field"],
			},
		]);
		expect(report.nextAction.id).toBe("none");
		expect(transactions).toBe(1);
		expect(applies).toBe(1);
	});

	test("keeps changed, malformed, semantic, secret, and unknown repairs preview-only", async () => {
		for (const scenario of [
			{
				name: "changed checker",
				fingerprint: { entrypointHash: "c".repeat(64), dependencyBundleHash: bundleHash },
				check: validRepairCheck(),
				registry: validRegistry(),
			},
			{
				name: "malformed checker",
				fingerprint: { entrypointHash: admittedHash, dependencyBundleHash: bundleHash },
				check: output(1, { schema_version: 999, findings: [] }),
				registry: validRegistry(),
			},
			{
				name: "semantic finding",
				fingerprint: { entrypointHash: admittedHash, dependencyBundleHash: bundleHash },
				check: output(1, {
					schema_version: 1,
					findings: [{ id: "summary-too-long", file: "notes/a.md", message: "ignored", repair_id: null, detail: {} }],
				}),
				registry: validRegistry(),
			},
			{
				name: "secret finding",
				fingerprint: { entrypointHash: admittedHash, dependencyBundleHash: bundleHash },
				check: output(1, {
					schema_version: 1,
					findings: [{ id: "body-secret-shaped-value", file: "notes/a.md", message: "ignored", repair_id: null, detail: {} }],
				}),
				registry: validRegistry(),
			},
			{
				name: "private evidence path",
				fingerprint: { entrypointHash: admittedHash, dependencyBundleHash: bundleHash },
				check: output(1, {
					schema_version: 1,
					findings: [{ id: "optional-field-empty", file: ".git/private-receipt.json", message: "ignored", repair_id: "remove-empty-optional-field", detail: { field: "owner" } }],
				}),
				registry: validRegistry(),
			},
			{
				name: "unknown repair",
				fingerprint: { entrypointHash: admittedHash, dependencyBundleHash: bundleHash },
				check: validRepairCheck("unknown-repair"),
				registry: validRegistry(),
			},
		]) {
			let transactions = 0;
			const report = await createVaultGitJanitor({
				engine: fakeEngine({
					async runHygieneTransaction() {
						transactions += 1;
						throw new Error("must stay preview-only");
					},
				}),
				checker: fakeChecker(scenario),
				remote: "origin",
				leaseDurationMs: 60_000,
			}).run({ trigger: "nightly" });
			expect(report.status, scenario.name).toBe("preview");
			expect(report.skippedRepairs.length, scenario.name).toBeGreaterThan(0);
			expect(transactions, scenario.name).toBe(0);
		}
	});

	test("keeps an unadmitted checker preview-only without running it", async () => {
		let checkerRuns = 0;
		const checker: VaultGitCheckerPort = {
			...fakeChecker(),
			async runCheck() {
				checkerRuns += 1;
				return validRepairCheck();
			},
		};
		const report = await createVaultGitJanitor({
			engine: fakeEngine({ async readCheckerAdmission() { return null; } }),
			checker,
			remote: "origin",
			leaseDurationMs: 60_000,
		}).run({ trigger: "nightly" });
		expect(report).toMatchObject({
			status: "preview",
			skippedRepairs: [{ owner: "checker", reason: "checker_unadmitted" }],
		});
		expect(checkerRuns).toBe(0);
	});

	test("refuses dirty and remote-blocked runs while reporting every anomaly class", async () => {
		for (const blocker of ["dirty_tree", "remote_unavailable"] as const) {
			const report = await createVaultGitJanitor({
				engine: fakeEngine({ blocker }),
				checker: fakeChecker(),
				remote: "origin",
				leaseDurationMs: 60_000,
			}).run({ trigger: "nightly" });
			expect(report).toMatchObject({
				status: "refused",
				staleReceipts: [],
				leaseAnomalies: [],
				pushPending: false,
				proposedTransactionGroups: [],
				skippedRepairs: [],
			});
			expect(report.nextAction.id).not.toBe("");
		}
	});

	test("reports stale receipt, lease anomaly, push pending, and one next action", async () => {
		const engine = fakeEngine({
			async inspectJanitorPreflight() {
				return {
					status: "refused" as const,
					blocker: "push_pending" as const,
					doctor: {
						status: "diagnosed" as const,
						state: "push_pending" as const,
						phase: "push_pending" as const,
						finding: "commit_interrupted" as const,
						changedState: "local" as const,
						retrySafety: "same_input_safe" as const,
						blocker: "lease_owner_unknown" as const,
						nextAction: { id: "run_doctor" as const, summary: "Inspect pending evidence." },
						diagnosticsReference: "doctor:fixture",
					},
				};
			},
		});
		const report = await createVaultGitJanitor({
			engine,
			checker: fakeChecker(),
			remote: "origin",
			leaseDurationMs: 60_000,
		}).run({ trigger: "nightly" });
		expect(report).toMatchObject({
			status: "refused",
			staleReceipts: ["commit_interrupted"],
			leaseAnomalies: ["lease_owner_unknown"],
			pushPending: true,
			proposedTransactionGroups: [],
			skippedRepairs: [],
			nextAction: { id: "request_operator_review" },
		});
	});
});

function output(exitCode: number, value: unknown): VaultGitCheckerProcessResult {
	return {
		exitCode,
		stdout: `${JSON.stringify(value)}\n`,
		stderr: "",
		timedOut: false,
	};
}

function validRepairCheck(repairId = "remove-empty-optional-field") {
	return output(1, {
		schema_version: 1,
		findings: [{ id: "optional-field-empty", file: "notes/a.md", message: "ignored", repair_id: repairId, detail: { field: "owner" } }],
	});
}

function validRegistry() {
	return output(0, {
		schema_version: 1,
		repairs: [{ id: "remove-empty-optional-field", finding_id: "optional-field-empty", description: "ignored" }],
	});
}

function fakeChecker(
	overrides: Omit<
		Partial<VaultGitCheckerPort>,
		"fingerprint" | "runCheck" | "readRepairRegistry"
	> & {
		readonly fingerprint?: { readonly entrypointHash: string; readonly dependencyBundleHash: string };
		readonly check?: VaultGitCheckerProcessResult;
		readonly registry?: VaultGitCheckerProcessResult;
	} = {},
): VaultGitCheckerPort {
	return {
		async fingerprint() {
			return overrides.fingerprint ?? { entrypointHash: admittedHash, dependencyBundleHash: bundleHash };
		},
		async runCheck() {
			return overrides.check ?? output(0, { schema_version: 1, findings: [] });
		},
		async readRepairRegistry() {
			return overrides.registry ?? validRegistry();
		},
		async applyRepair(request) {
			return overrides.applyRepair?.(request) ?? output(0, { schema_version: 1, status: "repaired" });
		},
	};
}

function fakeEngine(
	overrides: Partial<VaultGitJanitorEnginePort> & { readonly blocker?: "dirty_tree" | "remote_unavailable" } = {},
): VaultGitJanitorEnginePort {
	return {
		async inspectJanitorPreflight() {
			const doctor = {
				status: "diagnosed" as const,
				state: "closed" as const,
				phase: "closed" as const,
				finding: "transaction_closed" as const,
				changedState: "none" as const,
				retrySafety: "same_input_safe" as const,
				nextAction: { id: "none" as const, summary: "No transaction action remains." },
				diagnosticsReference: "doctor:fixture",
			};
			if (overrides.blocker) {
				return {
					status: "refused" as const,
					blocker: overrides.blocker,
					doctor,
				};
			}
			return {
				status: "eligible" as const,
				doctor: {
					...doctor,
				},
			};
		},
		async readCheckerAdmission() {
			return {
				schemaVersion: 1,
				entrypointHash: admittedHash,
				dependencyBundleHash: bundleHash,
				admittedAt: "2026-08-09T00:00:00.000Z",
			};
		},
		async prunePrivateHygiene() {
			return { capabilityFiles: 0, doctorTokenRecords: 0 };
		},
		async recordJanitorReport() {},
		async runHygieneTransaction() {
			throw new Error("hygiene transaction not expected");
		},
		...overrides,
	};
}
