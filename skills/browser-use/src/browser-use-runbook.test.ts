import { describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import type { AgentBrowserExecutionRuntime } from "./browser-use-agent-browser";
import { type BrowserUsePlatformFs, createDefaultPlatformFs } from "./browser-use-paths";
import {
	BrowserUseShippedRunbooksMissingError,
	listRunbooks,
	runRunbook,
	runbooksRoot,
	shippedRunbooksRoot,
	showRunbook,
} from "./browser-use-runbook";
import {
	type BrowserUseRunbook,
	planRunbookExecution,
	projectRunbookCatalogRow,
	validateRunbook,
} from "./browser-use-runbook-model";

// --- Fixtures ----------------------------------------------------------------

const HANDOFF = {
	outcome: "verified",
	environment: { name: "agent-chrome", profile: "default" },
	browser_entry_mode: "explicit-cdp",
	attachment: {
		adapter_id: "agent-browser",
		route: "explicit-cdp",
		probe_executable: "/opt/browser-connect/agent-browser",
	},
	endpoint: {
		http: "http://127.0.0.1:9222",
		ws: "ws://127.0.0.1:9222/devtools/browser/fixture",
	},
	launch: { launched: false },
	proof: {
		environment_contract_id: "warm-chrome.browser-entry",
		environment_schema_version: "1",
		route_evidence: "verified-live",
	},
	contract_id: "browser-connect.verified-handoff",
	schema_version: "2",
} as const satisfies BrowserConnectHandoffPayload & {
	contract_id: string;
	schema_version: string;
};

function baseRunbook(
	overrides: Partial<BrowserUseRunbook> = {},
): BrowserUseRunbook {
	return {
		contract: "browser-use.runbook",
		schema_version: "1",
		service_id: "oncore",
		flow_id: "snapshot-verify",
		flow_name: "verify-loaded",
		version: "1",
		summary: "Read-only snapshot verification.",
		allowed_origins: ["https://portal.example.com"],
		inputs: [],
		steps: [
			{
				kind: "open",
				url: "https://portal.example.com/timesheets",
				postcondition: {
					kind: "url-equals",
					url: "https://portal.example.com/timesheets",
				},
			},
			{ kind: "snapshot", interactive: true },
		],
		...overrides,
	};
}

function json(data: unknown): string {
	return JSON.stringify({ success: true, data, error: null });
}

function runtimeFor(
	responses: readonly { stdout?: string; exitCode?: number }[],
): AgentBrowserExecutionRuntime & { calls: Array<readonly string[]> } {
	const calls: Array<readonly string[]> = [];
	let index = 0;
	return {
		calls,
		beforeMutationDispatch: async () => ({ ok: true }),
		runCommand: async (input) => {
			calls.push([input.command, ...input.args]);
			const response = responses[index++] ?? {};
			return {
				exitCode: response.exitCode ?? 0,
				stdout: response.stdout ?? json({}),
				stderr: "",
			};
		},
	};
}

function withDataRoot(fn: (dataRoot: string) => void | Promise<void>) {
	return async () => {
		const base = mkdtempSync(join(tmpdir(), "browser-use-runbook-"));
		try {
			await fn(base);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	};
}

function writeRunbook(
	dataRoot: string,
	runbook: BrowserUseRunbook,
	outcome?: unknown,
): void {
	const dir = join(
		runbooksRoot(dataRoot),
		runbook.service_id,
		runbook.flow_id,
	);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "runbook.json"), JSON.stringify(runbook));
	if (outcome !== undefined) {
		writeFileSync(join(dir, "outcome.json"), JSON.stringify(outcome));
	}
}

// --- Model: validation -------------------------------------------------------

describe("runbook model validation (R30)", () => {
	test("a well-formed read-only runbook passes", () => {
		expect(validateRunbook(baseRunbook())).toEqual([]);
	});

	test("rejects an unsafe service or flow id", () => {
		const issues = validateRunbook(
			baseRunbook({ service_id: "../escape" }),
		);
		expect(issues.map((i) => i.code)).toContain("runbook_id_invalid");
	});

	test("rejects a non-exact allowed origin", () => {
		const issues = validateRunbook(
			baseRunbook({ allowed_origins: ["https://portal.example.com/path"] }),
		);
		expect(issues.map((i) => i.code)).toContain("runbook_origin_invalid");
	});

	test("rejects an open step outside the allowed origins", () => {
		const issues = validateRunbook(
			baseRunbook({
				steps: [
					{
						kind: "open",
						url: "https://evil.example.com/",
						postcondition: {
							kind: "url-equals",
							url: "https://evil.example.com/",
						},
					},
				],
			}),
		);
		expect(issues.map((i) => i.code)).toContain("runbook_step_invalid");
	});

	test("rejects a click ref that is not an @e<n> reference", () => {
		const issues = validateRunbook(
			baseRunbook({
				steps: [
					{
						kind: "click",
						ref: "#submit",
						postcondition: { kind: "element-visible", selector: ".done" },
					},
				],
			}),
		);
		expect(issues.map((i) => i.code)).toContain("runbook_ref_invalid");
	});

	test("rejects a secret-shaped value in an ordinary fill", () => {
		const issues = validateRunbook(
			baseRunbook({
				steps: [
					{
						kind: "fill",
						ref: "@e1",
						sensitivity: "ordinary",
						value: "op://vault/item/password",
						postcondition: { kind: "value-equals", selector: ".x", value: "y" },
					},
				],
			}),
		);
		expect(issues.map((i) => i.code)).toContain(
			"runbook_confidential_secret_present",
		);
	});

	test("rejects an ordinary fill referencing an undeclared input", () => {
		const issues = validateRunbook(
			baseRunbook({
				inputs: [],
				steps: [
					{
						kind: "fill",
						ref: "@e1",
						sensitivity: "ordinary",
						value: "{{week_ending}}",
						postcondition: { kind: "value-equals", selector: ".x", value: "y" },
					},
				],
			}),
		);
		expect(issues.map((i) => i.code)).toContain(
			"runbook_input_reference_unknown",
		);
	});

	test("accepts a confidential fill naming an item binding (no secret)", () => {
		expect(
			validateRunbook(
				baseRunbook({
					steps: [
						{
							kind: "fill",
							ref: "@e1",
							sensitivity: "confidential",
							item_binding: "oncore_password",
							postcondition: {
								kind: "element-visible",
								selector: ".signed-in",
							},
						},
					],
				}),
			),
		).toEqual([]);
	});

	test("rejects an empty step list", () => {
		const issues = validateRunbook(baseRunbook({ steps: [] }));
		expect(issues.map((i) => i.code)).toContain("runbook_no_steps");
	});
});

// --- Model: plan (F7 continuation) -------------------------------------------

describe("runbook execution planning (R30/R31, F7)", () => {
	test("compiles read-only steps for a fresh run", () => {
		const planned = planRunbookExecution(baseRunbook(), {
			inputs: {},
			resumeFromStep: 0,
		});
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		expect(planned.plan.total_steps).toBe(2);
		expect(planned.plan.resume_from_step).toBe(0);
		expect(planned.plan.steps).toHaveLength(2);
		expect(planned.plan.pending_item_bindings).toEqual([]);
	});

	test("F7: resume compiles only from the first unproven step", () => {
		const planned = planRunbookExecution(baseRunbook(), {
			inputs: {},
			resumeFromStep: 1,
		});
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		expect(planned.plan.steps).toHaveLength(1);
		expect(planned.plan.steps[0]?.kind).toBe("snapshot");
		expect(planned.plan.resume_from_step).toBe(1);
	});

	test("substitutes a declared input into an ordinary fill value", () => {
		const runbook = baseRunbook({
			inputs: [
				{ id: "week_ending", summary: "w", required: true, pattern: "[0-9-]+" },
			],
			steps: [
				{
					kind: "fill",
					ref: "@e1",
					sensitivity: "ordinary",
					value: "{{week_ending}}",
					postcondition: {
						kind: "value-equals",
						selector: ".week",
						value: "2026-07-27",
					},
				},
			],
		});
		const planned = planRunbookExecution(runbook, {
			inputs: { week_ending: "2026-07-27" },
			resumeFromStep: 0,
		});
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		const step = planned.plan.steps[0];
		expect(step?.kind === "fill" && step.value).toBe("2026-07-27");
	});

	test("refuses a missing required input", () => {
		const runbook = baseRunbook({
			inputs: [{ id: "week_ending", summary: "w", required: true }],
		});
		const planned = planRunbookExecution(runbook, {
			inputs: {},
			resumeFromStep: 0,
		});
		expect(planned.ok).toBe(false);
		if (planned.ok) return;
		expect(planned.refusal.code).toBe("runbook_input_missing");
	});

	test("refuses an input that fails its declared pattern", () => {
		const runbook = baseRunbook({
			inputs: [
				{ id: "week_ending", summary: "w", required: true, pattern: "[0-9]{4}" },
			],
		});
		const planned = planRunbookExecution(runbook, {
			inputs: { week_ending: "nope" },
			resumeFromStep: 0,
		});
		expect(planned.ok).toBe(false);
		if (planned.ok) return;
		expect(planned.refusal.code).toBe("runbook_input_rejected");
	});

	test("refuses a resume index beyond the step count", () => {
		const planned = planRunbookExecution(baseRunbook(), {
			inputs: {},
			resumeFromStep: 5,
		});
		expect(planned.ok).toBe(false);
		if (planned.ok) return;
		expect(planned.refusal.code).toBe("runbook_resume_out_of_range");
	});

	test("surfaces confidential item bindings as pending", () => {
		const planned = planRunbookExecution(
			baseRunbook({
				steps: [
					{
						kind: "fill",
						ref: "@e1",
						sensitivity: "confidential",
						item_binding: "oncore_password",
						postcondition: {
							kind: "element-visible",
							selector: ".signed-in",
						},
					},
				],
			}),
			{ inputs: {}, resumeFromStep: 0 },
		);
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		expect(planned.plan.pending_item_bindings).toEqual(["oncore_password"]);
		// The compiled confidential fill carries no value.
		const step = planned.plan.steps[0];
		expect(step?.kind === "fill" && step.value).toBe("");
	});
});

// --- Catalog projection ------------------------------------------------------

describe("runbook catalog projection (R35)", () => {
	test("redacts to identity, counts, and health; no selector or origin", () => {
		const row = projectRunbookCatalogRow(baseRunbook(), "healthy");
		expect(row).toEqual({
			service_id: "oncore",
			flow_id: "snapshot-verify",
			flow_name: "verify-loaded",
			version: "1",
			summary: "Read-only snapshot verification.",
			step_count: 2,
			input_count: 0,
			requires_auth: false,
			health: "healthy",
		});
		expect(JSON.stringify(row)).not.toContain("portal.example.com");
	});

	test("flags requires_auth for a confidential runbook", () => {
		const row = projectRunbookCatalogRow(
			baseRunbook({ auth_context_ref: "oncore-session" }),
			"healthy",
		);
		expect(row.requires_auth).toBe(true);
	});
});

// --- Discovery: list / show --------------------------------------------------

describe("runbook discovery over the XDG data root", () => {
	test(
		"list projects every valid store runbook sorted, skips invalid files",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			writeRunbook(dataRoot, baseRunbook({ flow_id: "b-flow" }));
			writeRunbook(dataRoot, baseRunbook({ flow_id: "a-flow" }));
			// A corrupt file is skipped from the catalog.
			const badDir = join(runbooksRoot(dataRoot), "oncore", "broken");
			mkdirSync(badDir, { recursive: true });
			writeFileSync(join(badDir, "runbook.json"), "{ not json");
			const rows = await listRunbooks(fs, dataRoot);
			// The shipped Oncore seed is always present; the two valid store rows
			// sort ahead of it (a-flow, b-flow < timesheet-snapshot-verify).
			const storeFlows = rows
				.map((r) => r.flow_id)
				.filter((flow) => flow === "a-flow" || flow === "b-flow");
			expect(storeFlows).toEqual(["a-flow", "b-flow"]);
			expect(rows.map((r) => r.flow_id)).toContain(
				"timesheet-snapshot-verify",
			);
		}),
	);

	test(
		"list discovers only the shipped seed when the store root is absent",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			const rows = await listRunbooks(fs, dataRoot);
			// Discovery scans the code-owned shipped catalog even with no store, so
			// `runbook list` never reports catalog_count=0 out of the box.
			expect(rows).toEqual([
				expect.objectContaining({
					service_id: "oncore",
					flow_id: "timesheet-snapshot-verify",
					health: "healthy",
				}),
			]);
		}),
	);

	test(
		"a store runbook overrides the shipped one on the same service/flow id",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			writeRunbook(
				dataRoot,
				baseRunbook({
					service_id: "oncore",
					flow_id: "timesheet-snapshot-verify",
					flow_name: "operator-override",
				}),
			);
			const rows = await listRunbooks(fs, dataRoot);
			const oncore = rows.filter(
				(r) => r.flow_id === "timesheet-snapshot-verify",
			);
			// Exactly one row for the colliding id; the store's wins.
			expect(oncore).toHaveLength(1);
			expect(oncore[0]?.flow_name).toBe("operator-override");
		}),
	);

	test(
		"show returns the validated runbook and derives degrading from a healed outcome",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			writeRunbook(dataRoot, baseRunbook(), {
				last_result: "confirmed",
				steps_healed: 2,
				drifted_selectors: [],
			});
			const shown = await showRunbook(fs, dataRoot, {
				serviceId: "oncore",
				flowId: "snapshot-verify",
			});
			expect(shown.ok).toBe(true);
			if (!shown.ok) return;
			expect(shown.runbook.flow_name).toBe("verify-loaded");
			expect(shown.health).toBe("degrading");
		}),
	);

	test(
		"show returns not-found for an absent runbook",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			const shown = await showRunbook(fs, dataRoot, {
				serviceId: "oncore",
				flowId: "missing",
			});
			expect(shown.ok).toBe(false);
			if (shown.ok) return;
			expect(shown.failure.code).toBe("runbook_not_found");
		}),
	);

	test(
		"show refuses an unsafe id without touching the fs",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			const shown = await showRunbook(fs, dataRoot, {
				serviceId: "oncore",
				flowId: "../escape",
			});
			expect(shown.ok).toBe(false);
			if (shown.ok) return;
			expect(shown.failure.code).toBe("runbook_id_invalid");
		}),
	);

	test(
		"show falls back to the shipped Oncore seed when the store has no record",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			// No store seeding: the record resolves from the code-owned shipped
			// catalog under shippedRunbooksRoot().
			const shown = await showRunbook(fs, dataRoot, {
				serviceId: "oncore",
				flowId: "timesheet-snapshot-verify",
			});
			expect(shown.ok).toBe(true);
			if (!shown.ok) return;
			expect(shown.runbook.service_id).toBe("oncore");
			expect(shown.runbook.flow_name).toBe("verify-timesheet-loaded");
			expect(validateRunbook(shown.runbook)).toEqual([]);
			expect(shown.health).toBe("healthy");
		}),
	);

	test(
		"show prefers the store record over the shipped one for the same id",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			writeRunbook(
				dataRoot,
				baseRunbook({
					service_id: "oncore",
					flow_id: "timesheet-snapshot-verify",
					flow_name: "operator-override",
				}),
			);
			const shown = await showRunbook(fs, dataRoot, {
				serviceId: "oncore",
				flowId: "timesheet-snapshot-verify",
			});
			expect(shown.ok).toBe(true);
			if (!shown.ok) return;
			expect(shown.runbook.flow_name).toBe("operator-override");
		}),
	);

	test(
		"show fails closed on a corrupt store record and never shadows it with shipped",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			// Torn JSON at the shipped seed's own id: fail-closed, NOT a silent
			// fallback to the valid shipped default (a broken store record needs a
			// repair, not a shadowed default).
			const dir = join(
				runbooksRoot(dataRoot),
				"oncore",
				"timesheet-snapshot-verify",
			);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "runbook.json"), "{ not json");
			const shown = await showRunbook(fs, dataRoot, {
				serviceId: "oncore",
				flowId: "timesheet-snapshot-verify",
			});
			expect(shown.ok).toBe(false);
			if (shown.ok) return;
			expect(shown.failure.code).toBe("runbook_record_corrupt");
		}),
	);
});

// --- Shipped catalog resolution (packaging invariant) ------------------------

describe("shipped runbooks root resolution", () => {
	test("resolves to an existing directory containing the seed runbook", () => {
		const root = shippedRunbooksRoot();
		expect(existsSync(root)).toBe(true);
		expect(statSync(root).isDirectory()).toBe(true);
		const seed = join(
			root,
			"oncore",
			"timesheet-snapshot-verify",
			"runbook.json",
		);
		expect(existsSync(seed)).toBe(true);
		const parsed = JSON.parse(readFileSync(seed, "utf8")) as {
			service_id: string;
			flow_id: string;
		};
		expect(parsed.service_id).toBe("oncore");
		expect(parsed.flow_id).toBe("timesheet-snapshot-verify");
	});

	test(
		"list throws a typed diagnostic when the shipped root is missing",
		withDataRoot(async (dataRoot) => {
			const real = createDefaultPlatformFs();
			const shippedRoot = shippedRunbooksRoot();
			// Simulate a packaged bin whose dist/runbooks/ was dropped: the shipped
			// root reports absent, everything else behaves normally.
			const fs: BrowserUsePlatformFs = {
				...real,
				lstat: async (path) =>
					path === shippedRoot ? undefined : real.lstat(path),
			};
			await expect(listRunbooks(fs, dataRoot)).rejects.toBeInstanceOf(
				BrowserUseShippedRunbooksMissingError,
			);
			try {
				await listRunbooks(fs, dataRoot);
			} catch (error) {
				expect(
					(error as BrowserUseShippedRunbooksMissingError).code,
				).toBe("runbook_shipped_root_missing");
			}
		}),
	);
});

// --- Execution binding -------------------------------------------------------

describe("runbook execution binding to the agent-browser lane (R30, F7)", () => {
	test(
		"binds a read-only runbook to the executor and returns confirmed",
		withDataRoot(async (dataRoot) => {
			writeRunbook(dataRoot, baseRunbook());
			// open -> url postcondition -> snapshot: three successful commands after
			// tab list + select.
			const runtime = runtimeFor([
				// selectTarget: tab list
				{
					stdout: json({
						tabs: [
							{ tabId: "t1", url: "https://portal.example.com/timesheets" },
						],
					}),
				},
				// selectTarget: tab select
				{ stdout: json({ selected: true }) },
				// open
				{ stdout: json({ opened: true }) },
				// open postcondition: get url
				{ stdout: json({ url: "https://portal.example.com/timesheets" }) },
				// snapshot
				{ stdout: json({ refs: { "@e1": {} } }) },
			]);
			const outcome = await runRunbook(
				{ fs: createDefaultPlatformFs(), runtime, dataRoot },
				{
					serviceId: "oncore",
					flowId: "snapshot-verify",
					handoff: HANDOFF,
					runId: "run-1",
					targetTabId: "t1",
					inputs: {},
					resumeFromStep: 0,
				},
			);
			expect(outcome.ok).toBe(true);
			if (!outcome.ok) return;
			expect(outcome.result.ok).toBe(true);
			expect(outcome.plan.total_steps).toBe(2);
			expect(outcome.plan.resume_from_step).toBe(0);
		}),
	);

	test(
		"refuses a confidential runbook to the auth transaction before any browser effect",
		withDataRoot(async (dataRoot) => {
			writeRunbook(
				dataRoot,
				baseRunbook({
					flow_id: "with-secret",
					steps: [
						{ kind: "snapshot", interactive: true },
						{
							kind: "fill",
							ref: "@e1",
							sensitivity: "confidential",
							item_binding: "oncore_password",
							postcondition: {
								kind: "element-visible",
								selector: ".signed-in",
							},
						},
					],
				}),
			);
			const runtime = runtimeFor([]);
			const outcome = await runRunbook(
				{ fs: createDefaultPlatformFs(), runtime, dataRoot },
				{
					serviceId: "oncore",
					flowId: "with-secret",
					handoff: HANDOFF,
					runId: "run-2",
					targetTabId: "t1",
					inputs: {},
					resumeFromStep: 0,
				},
			);
			expect(outcome.ok).toBe(false);
			if (outcome.ok) return;
			expect(outcome.refusal.code).toBe(
				"runbook_confidential_requires_auth_transaction",
			);
			// No browser command was dispatched.
			expect(runtime.calls).toHaveLength(0);
		}),
	);

	test(
		"refuses a missing runbook before any browser effect",
		withDataRoot(async (dataRoot) => {
			const runtime = runtimeFor([]);
			const outcome = await runRunbook(
				{ fs: createDefaultPlatformFs(), runtime, dataRoot },
				{
					serviceId: "oncore",
					flowId: "missing",
					handoff: HANDOFF,
					runId: "run-3",
					targetTabId: "t1",
					inputs: {},
					resumeFromStep: 0,
				},
			);
			expect(outcome.ok).toBe(false);
			if (outcome.ok) return;
			expect(outcome.refusal.code).toBe("runbook_not_found");
			expect(runtime.calls).toHaveLength(0);
		}),
	);
});
