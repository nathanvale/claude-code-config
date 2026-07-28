import { describe, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserConnectHandoffPayload } from "@side-quest/browser-connect/contract";
import type {
	AgentBrowserAuthDeliveryContext,
	AgentBrowserExecutionRuntime,
	AgentBrowserVerifiedHandoff,
} from "./browser-use-agent-browser";
import type { BrowserUseItemBinding } from "./browser-use-auth-bindings";
import type {
	BrowserUseDeliveryHook,
	BrowserUseTargetReproof,
	BrowserUseVerifiedTarget,
} from "./browser-use-confidential-field-delivery";
import type {
	BrowserUseOpCredentialField,
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";
import { type BrowserUsePlatformFs, createDefaultPlatformFs } from "./browser-use-paths";
import {
	type BrowserUseActiveGenerationSeam,
	type BrowserUseRunbookAuthDelivery,
	BrowserUseShippedRunbooksMissingError,
	RUNBOOK_PRIVATE_INPUT_MAX_BYTES,
	executePreparedRunbook,
	listRunbooks,
	prepareRunbookExecution,
	readPrivateStructuredInput,
	resolveEffectiveRunbook,
	runRunbook,
	runbooksRoot,
	shippedRunbooksRoot,
	showRunbook,
	verifyEffectiveCatalog,
} from "./browser-use-runbook";
import {
	type BrowserUseRunbook,
	type BrowserUseRunbookValueSchema,
	INPUT_SCHEMA_MAX_DEPTH,
	parseRunbookRecord,
	planRunbookExecution,
	projectRunbookCatalogRow,
	valueMatchesSchema,
	validateRunbook,
} from "./browser-use-runbook-model";
import { actionAssetDigest } from "./browser-use-runbook-actions";
import type {
	BrowserUseActionGenerationSeam,
	BrowserUseReviewedActionRecord,
} from "./browser-use-runbook-actions";
import { deriveConformanceSentinel } from "./browser-use-secret-scan";

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
		schema_version: "2",
		service_id: "oncore",
		flow_id: "snapshot-verify",
		flow_name: "verify-loaded",
		version: "2",
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
// --- Model: validation (v2) --------------------------------------------------

describe("runbook model validation (v2)", () => {
	test("a well-formed read-only v2 runbook passes", () => {
		expect(validateRunbook(baseRunbook())).toEqual([]);
	});

	test("rejects a non-v2 schema version", () => {
		const issues = validateRunbook(
			baseRunbook({ schema_version: "1" as unknown as "2" }),
		);
		expect(issues.map((i) => i.code)).toContain("runbook_schema_unsupported");
	});

	test("rejects an unsafe service or flow id", () => {
		const issues = validateRunbook(baseRunbook({ service_id: "../escape" }));
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

	test("rejects a click with an empty semantic target", () => {
		const issues = validateRunbook(
			baseRunbook({
				steps: [
					{
						kind: "click",
						target: { role: "", name: "Submit" },
						postcondition: { kind: "element-visible", selector: ".done" },
					},
				],
			}),
		);
		expect(issues.map((i) => i.code)).toContain("runbook_target_invalid");
	});

	test("accepts a click with a valid semantic target", () => {
		expect(
			validateRunbook(
				baseRunbook({
					steps: [
						{
							kind: "click",
							target: { role: "button", name: "Save draft" },
							postcondition: { kind: "element-visible", selector: ".saved" },
						},
					],
				}),
			),
		).toEqual([]);
	});

	test("rejects a secret-shaped value in an ordinary fill", () => {
		const issues = validateRunbook(
			baseRunbook({
				steps: [
					{
						kind: "fill",
						target: { role: "textbox", name: "Password" },
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
						target: { role: "textbox", name: "Week" },
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
							target: { role: "textbox", name: "Password" },
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

// --- Model: recursive typed-input value schemas (R9) -------------------------

describe("v2 typed-input value schemas (R9)", () => {
	function inputSchema(schema: BrowserUseRunbookValueSchema): BrowserUseRunbook {
		return baseRunbook({
			inputs: [{ id: "value", summary: "s", required: true, schema }],
		});
	}

	test("accepts nested array/object/enum/number/boolean/date/uuid defaults", () => {
		const rb = inputSchema({
			kind: "object",
			fields: {
				name: { schema: { kind: "string", min_length: 1 }, required: true },
				count: {
					schema: { kind: "number", integer: true, minimum: 0, maximum: 10, default: 3 },
					required: false,
				},
				enabled: { schema: { kind: "boolean", default: true }, required: false },
				mode: {
					schema: { kind: "enum", values: ["a", "b"], default: "a" },
					required: false,
				},
				when: { schema: { kind: "date", default: "2026-07-28" }, required: false },
				id: {
					schema: {
						kind: "uuid",
						default: "00000000-0000-0000-0000-000000000000",
					},
					required: false,
				},
				tags: {
					schema: { kind: "array", items: { kind: "string" }, max_items: 4 },
					required: false,
				},
			},
		});
		expect(validateRunbook(rb)).toEqual([]);
	});

	test("valueMatchesSchema accepts a conforming nested value and rejects an unknown field", () => {
		const schema: BrowserUseRunbookValueSchema = {
			kind: "object",
			fields: { name: { schema: { kind: "string" }, required: true } },
		};
		expect(valueMatchesSchema({ name: "ok" }, schema)).toBe(true);
		expect(valueMatchesSchema({ name: "ok", extra: 1 }, schema)).toBe(false);
	});

	test("valueMatchesSchema enforces enum, uuid, date, and number bounds", () => {
		expect(
			valueMatchesSchema("b", { kind: "enum", values: ["a", "b"] }),
		).toBe(true);
		expect(
			valueMatchesSchema("c", { kind: "enum", values: ["a", "b"] }),
		).toBe(false);
		expect(valueMatchesSchema("not-a-uuid", { kind: "uuid" })).toBe(false);
		expect(valueMatchesSchema("2026-02-30", { kind: "date" })).toBe(false);
		expect(
			valueMatchesSchema(11, { kind: "number", maximum: 10 }),
		).toBe(false);
	});

	test("valueMatchesSchema resolves a discriminated union by its discriminant", () => {
		const schema: BrowserUseRunbookValueSchema = {
			kind: "discriminated-union",
			discriminant: "kind",
			variants: {
				a: { x: { schema: { kind: "number" }, required: true } },
				b: { y: { schema: { kind: "string" }, required: true } },
			},
		};
		expect(valueMatchesSchema({ kind: "a", x: 1 }, schema)).toBe(true);
		expect(valueMatchesSchema({ kind: "b", y: "s" }, schema)).toBe(true);
		expect(valueMatchesSchema({ kind: "a", y: "s" }, schema)).toBe(false);
		expect(valueMatchesSchema({ kind: "c" }, schema)).toBe(false);
	});

	test("rejects an invalid default (enum default not a member)", () => {
		const issues = validateRunbook(
			inputSchema({ kind: "enum", values: ["a", "b"], default: "z" }),
		);
		expect(issues.map((i) => i.code)).toContain("runbook_input_default_invalid");
	});

	test("rejects an invalid date default", () => {
		const issues = validateRunbook(
			inputSchema({ kind: "date", default: "2026-13-01" }),
		);
		expect(issues.map((i) => i.code)).toContain("runbook_input_default_invalid");
	});

	test("rejects an invalid string pattern schema", () => {
		const issues = validateRunbook(
			inputSchema({ kind: "string", pattern: "([" }),
		);
		expect(issues.map((i) => i.code)).toContain("runbook_input_schema_invalid");
	});

	test("rejects a schema nested past the maximum depth", () => {
		let schema: BrowserUseRunbookValueSchema = { kind: "string" };
		for (let i = 0; i < INPUT_SCHEMA_MAX_DEPTH + 2; i += 1) {
			schema = { kind: "array", items: schema };
		}
		const issues = validateRunbook(inputSchema(schema));
		expect(issues.map((i) => i.code)).toContain("runbook_input_schema_invalid");
	});
});

// --- Model: total parsing (drop-v1) ------------------------------------------

describe("runbook total parsing (drop-v1)", () => {
	test("parses a well-formed v2 record shape", () => {
		const result = parseRunbookRecord(JSON.parse(JSON.stringify(baseRunbook())));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.runbook.schema_version).toBe("2");
	});

	test("rejects a retired v1 record with a schema-unsupported issue", () => {
		const v1 = {
			contract: "browser-use.runbook",
			schema_version: "1",
			service_id: "oncore",
			flow_id: "f",
			flow_name: "n",
			version: "1",
			summary: "s",
			allowed_origins: ["https://portal.example.com"],
			inputs: [],
			steps: [{ kind: "snapshot", interactive: true }],
		};
		const result = parseRunbookRecord(v1);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issue.code).toBe("runbook_schema_unsupported");
	});

	test("rejects a record that is not an object", () => {
		const result = parseRunbookRecord([1, 2, 3]);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issue.code).toBe("runbook_shape_invalid");
	});

	test("rejects a malformed step shape", () => {
		const bad = {
			...JSON.parse(JSON.stringify(baseRunbook())),
			steps: [{ kind: "fill", target: { role: "x" } }],
		};
		const result = parseRunbookRecord(bad);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issue.code).toBe("runbook_shape_invalid");
	});

	test("rejects a malformed input value schema", () => {
		const bad = {
			...JSON.parse(JSON.stringify(baseRunbook())),
			inputs: [{ id: "v", summary: "s", required: true, schema: { kind: "nope" } }],
		};
		const result = parseRunbookRecord(bad);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issue.code).toBe("runbook_shape_invalid");
	});
});

// --- Model: plan (F7 continuation) -------------------------------------------

describe("runbook execution planning (v2, F7)", () => {
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

	test("compiles a semantic-target click into a click-semantic step", () => {
		const planned = planRunbookExecution(
			baseRunbook({
				steps: [
					{
						kind: "click",
						target: { role: "button", name: "Save draft" },
						postcondition: { kind: "element-visible", selector: ".saved" },
					},
				],
			}),
			{ inputs: {}, resumeFromStep: 0 },
		);
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		const step = planned.plan.steps[0];
		expect(step?.kind).toBe("click-semantic");
		expect(step?.kind === "click-semantic" && step.name).toBe("Save draft");
	});

	test("substitutes a declared input into an ordinary fill value", () => {
		const runbook = baseRunbook({
			inputs: [
				{ id: "week_ending", summary: "w", required: true, schema: { kind: "date" } },
			],
			steps: [
				{
					kind: "fill",
					target: { role: "textbox", name: "Week" },
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

	test("materializes an omitted optional default before substitution", () => {
		const runbook = baseRunbook({
			inputs: [
				{
					id: "page_size",
					summary: "p",
					required: false,
					schema: { kind: "number", integer: true, default: 25 },
				},
			],
			steps: [
				{
					kind: "fill",
					target: { role: "textbox", name: "Page size" },
					sensitivity: "ordinary",
					value: "{{page_size}}",
					postcondition: {
						kind: "value-equals",
						selector: ".page-size",
						value: "25",
					},
				},
			],
		});
		const planned = planRunbookExecution(runbook, {
			inputs: {},
			resumeFromStep: 0,
		});
		expect(planned.ok).toBe(true);
		if (!planned.ok) return;
		const step = planned.plan.steps[0];
		expect(step?.kind === "fill" && step.value).toBe("25");
	});

	test("refuses a missing required input", () => {
		const runbook = baseRunbook({
			inputs: [
				{ id: "week_ending", summary: "w", required: true, schema: { kind: "date" } },
			],
		});
		const planned = planRunbookExecution(runbook, {
			inputs: {},
			resumeFromStep: 0,
		});
		expect(planned.ok).toBe(false);
		if (planned.ok) return;
		expect(planned.refusal.code).toBe("runbook_input_missing");
	});

	test("refuses an input that fails its declared value schema", () => {
		const runbook = baseRunbook({
			inputs: [
				{
					id: "week_ending",
					summary: "w",
					required: true,
					schema: { kind: "date" },
				},
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

	test("refuses a declared-but-unavailable reviewed-action step (U3 stub)", () => {
		const runbook = baseRunbook({
			steps: [
				{
					kind: "action",
					action_id: "oncore-diagnose",
					expected_digest: "a".repeat(64),
					inputs: {},
				},
			],
		});
		// The shape validates...
		expect(validateRunbook(runbook)).toEqual([]);
		// ...but compilation refuses until U3 supplies the action registry.
		const planned = planRunbookExecution(runbook, {
			inputs: {},
			resumeFromStep: 0,
		});
		expect(planned.ok).toBe(false);
		if (planned.ok) return;
		expect(planned.refusal.code).toBe("runbook_action_registry_unavailable");
	});

	test("refuses an injected empty iterate resolution", () => {
		const runbook = baseRunbook({
			inputs: [
				{
					id: "item_keys",
					summary: "i",
					required: true,
					schema: {
						kind: "array",
						items: { kind: "string" },
						min_items: 1,
						max_items: 512,
					},
				},
			],
			steps: [
				{
					kind: "iterate",
					over_input: "item_keys",
					step: {
						kind: "action",
						action_id: "oncore-fill",
						expected_digest: "a".repeat(64),
						inputs: {},
					},
				},
			],
		});
		const planned = planRunbookExecution(runbook, {
			inputs: { item_keys: ["mon"] },
			resumeFromStep: 0,
			resolvedActionSteps: new Map([[0, []]]),
		});
		expect(planned.ok).toBe(false);
		if (planned.ok) return;
		expect(planned.refusal.code).toBe("runbook_action_registry_unavailable");
	});

	test("surfaces confidential item bindings as pending", () => {
		const planned = planRunbookExecution(
			baseRunbook({
				steps: [
					{
						kind: "fill",
						target: { role: "textbox", name: "Password" },
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

describe("runbook catalog projection (R13/R35)", () => {
	test("redacts to identity, counts, effect class, and health; no target or origin", () => {
		const row = projectRunbookCatalogRow(baseRunbook(), "healthy");
		expect(row).toEqual({
			service_id: "oncore",
			flow_id: "snapshot-verify",
			flow_name: "verify-loaded",
			version: "2",
			summary: "Read-only snapshot verification.",
			step_count: 2,
			input_count: 0,
			requires_auth: false,
			requires_approval: false,
			effect_class: "read-only",
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

	test("flags a mutation effect class and approval for a reviewed action", () => {
		const row = projectRunbookCatalogRow(
			baseRunbook({
				steps: [
					{
						kind: "action",
						action_id: "oncore-fill",
						expected_digest: "b".repeat(64),
						inputs: {},
					},
				],
			}),
			"healthy",
		);
		expect(row.effect_class).toBe("mutation");
		expect(row.requires_approval).toBe(true);
	});
});

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
		"list discovers the shipped catalog when the store root is absent",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			const rows = await listRunbooks(fs, dataRoot);
			// Discovery scans the code-owned shipped catalog even with no store, so
			// `runbook list` never reports catalog_count=0 out of the box.
			expect(rows).toEqual([
				expect.objectContaining({
					service_id: "matest",
					flow_id: "development-snapshot-verify",
					health: "healthy",
				}),
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
	test("resolves to an existing directory containing the shipped runbooks", () => {
		const root = shippedRunbooksRoot();
		expect(existsSync(root)).toBe(true);
		expect(statSync(root).isDirectory()).toBe(true);
		const oncore = join(
			root,
			"oncore",
			"timesheet-snapshot-verify",
			"runbook.json",
		);
		expect(existsSync(oncore)).toBe(true);
		const parsedOncore = JSON.parse(readFileSync(oncore, "utf8")) as {
			service_id: string;
			flow_id: string;
		};
		expect(parsedOncore.service_id).toBe("oncore");
		expect(parsedOncore.flow_id).toBe("timesheet-snapshot-verify");

		const matest = join(
			root,
			"matest",
			"development-snapshot-verify",
			"runbook.json",
		);
		expect(existsSync(matest)).toBe(true);
		const parsedMatest = JSON.parse(readFileSync(matest, "utf8")) as {
			service_id: string;
			flow_id: string;
		};
		expect(parsedMatest.service_id).toBe("matest");
		expect(parsedMatest.flow_id).toBe("development-snapshot-verify");
		expect(parsedMatest).toMatchObject({
			allowed_origins: ["https://experience-test.elluciancloud.com.au"],
			auth_context_ref: "matest-experience-session",
			inputs: [],
			steps: [
				{
					kind: "open",
					url: "https://experience-test.elluciancloud.com.au/matest/development",
					postcondition: {
						kind: "url-equals",
						url: "https://experience-test.elluciancloud.com.au/matest/development",
					},
				},
				{ kind: "snapshot", interactive: true },
			],
		});
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
				// selectTarget: fresh selected-url reproof
				{ stdout: json({ url: "https://portal.example.com/timesheets" }) },
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
		"fails a confidential runbook closed when the native auth capability is absent (no seam injected), before any browser effect",
		withDataRoot(async (dataRoot) => {
			writeRunbook(
				dataRoot,
				baseRunbook({
					flow_id: "with-secret",
					steps: [
						{ kind: "snapshot", interactive: true },
						{
							kind: "fill",
							target: { role: "textbox", name: "Password" },
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
			// No authDelivery seam: the native Token Retrieval capability is absent,
			// so the confidential runbook must fail closed on the typed repair
			// pointer rather than dispatching an unauthenticated fill.
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
				"runbook_confidential_native_capability_absent",
			);
			// No browser command was dispatched.
			expect(runtime.calls).toHaveLength(0);
		}),
	);

	test(
		"checkpoints a neutral first open before confidential auth construction",
		withDataRoot(async (dataRoot) => {
			writeRunbook(
				dataRoot,
				baseRunbook({
					flow_id: "neutral-auth",
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
						{
							kind: "fill",
							target: { role: "textbox", name: "Password" },
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
			const base = runtimeFor([
				{ stdout: json({ tabs: [{ tabId: "t1", url: "about:blank" }] }) },
				{ stdout: json({ selected: true }) },
				{ stdout: json({ url: "about:blank" }) },
				{ stdout: json({ opened: true }) },
				{ stdout: json({ url: "https://portal.example.com/timesheets" }) },
				{
					stdout: json({
						tabs: [
							{
								tabId: "t1",
								url: "https://portal.example.com/timesheets",
							},
						],
					}),
				},
				{ stdout: json({ selected: true }) },
				{ stdout: json({ url: "https://portal.example.com/timesheets" }) },
				{ stdout: json({ refs: { "@e1": {} } }) },
			]);
			const events: string[] = [];
			const runtime: AgentBrowserExecutionRuntime = {
				beforeMutationDispatch: base.beforeMutationDispatch,
				runCommand: async (command) => {
					events.push(command.args.slice(4, 6).join(" "));
					return await base.runCommand(command);
				},
			};
			const { hook } = confidentialLeakHelper({
				username: "unused-u",
				password: "unused-p",
				"otp-current": "unused-o",
			});
			const { seam } = confidentialSeam("run-neutral-auth", hook, false);
			const outcome = await runRunbook(
				{
					fs: createDefaultPlatformFs(),
					runtime,
					dataRoot,
					authDelivery: async (input) => {
						events.push("auth");
						return await seam(input);
					},
					afterNeutralOpen: async (nextStep) => {
						events.push(`checkpoint ${nextStep}`);
						return true;
					},
				},
				{
					serviceId: "oncore",
					flowId: "neutral-auth",
					handoff: HANDOFF,
					runId: "run-neutral-auth",
					targetTabId: "t1",
					expectedTargetUrl: "about:blank",
					inputs: {},
					resumeFromStep: 0,
				},
			);
			expect(outcome.ok).toBe(true);
			expect(events).toContain("open https://portal.example.com/timesheets");
			expect(events).toContain("checkpoint 1");
			expect(events).toContain("auth");
			const openIndex = events.indexOf(
				"open https://portal.example.com/timesheets",
			);
			const checkpointIndex = events.indexOf("checkpoint 1");
			const authIndex = events.indexOf("auth");
			expect(openIndex).toBeLessThan(checkpointIndex);
			expect(checkpointIndex).toBeLessThan(authIndex);
		}),
	);

	test(
		"refuses confidential neutral execution when no durable checkpoint hook exists",
		withDataRoot(async (dataRoot) => {
			writeRunbook(
				dataRoot,
				baseRunbook({
					flow_id: "neutral-auth-no-checkpoint",
					steps: [
						{
							kind: "open",
							url: "https://portal.example.com/timesheets",
							postcondition: {
								kind: "url-equals",
								url: "https://portal.example.com/timesheets",
							},
						},
						{
							kind: "fill",
							target: { role: "textbox", name: "Password" },
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
			const prepared = await prepareRunbookExecution(
				createDefaultPlatformFs(),
				dataRoot,
				{
					serviceId: "oncore",
					flowId: "neutral-auth-no-checkpoint",
					inputs: {},
					resumeFromStep: 0,
				},
			);
			expect(prepared.ok).toBe(true);
			if (!prepared.ok) return;
			const runtime = runtimeFor([]);
			let authCalls = 0;
			const outcome = await executePreparedRunbook(
				{
					runtime,
					authDelivery: async () => {
						authCalls += 1;
						return { ok: false, message: "must not run" };
					},
				},
				{
					plan: prepared.plan,
					handoff: HANDOFF,
					runId: "run-neutral-auth-no-checkpoint",
					targetTabId: "t1",
					expectedTargetUrl: "about:blank",
				},
			);
			expect(outcome).toMatchObject({
				ok: false,
				refusal: { code: "runbook_neutral_checkpoint_unavailable" },
			});
			expect(authCalls).toBe(0);
			expect(runtime.calls).toHaveLength(0);
		}),
	);

	test(
		"keeps confidential leading-open execution fused for an allowed non-neutral target",
		withDataRoot(async (dataRoot) => {
			writeRunbook(
				dataRoot,
				baseRunbook({
					flow_id: "allowed-origin-auth",
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
						{
							kind: "fill",
							target: { role: "textbox", name: "Password" },
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
			const prepared = await prepareRunbookExecution(
				createDefaultPlatformFs(),
				dataRoot,
				{
					serviceId: "oncore",
					flowId: "allowed-origin-auth",
					inputs: {},
					resumeFromStep: 0,
				},
			);
			expect(prepared.ok).toBe(true);
			if (!prepared.ok) return;
			const expectedTargetUrl = "https://portal.example.com/timesheets";
			const base = runtimeFor([
				{
					stdout: json({
						tabs: [{ tabId: "t1", url: expectedTargetUrl }],
					}),
				},
				{ stdout: json({ selected: true }) },
				{ stdout: json({ url: expectedTargetUrl }) },
				{ stdout: json({ opened: true }) },
				{ stdout: json({ url: expectedTargetUrl }) },
				{ stdout: json({ refs: { "@e1": {} } }) },
			]);
			const events: string[] = [];
			const runtime: AgentBrowserExecutionRuntime = {
				beforeMutationDispatch: base.beforeMutationDispatch,
				runCommand: async (command) => {
					events.push(command.args.slice(4, 6).join(" "));
					return await base.runCommand(command);
				},
			};
			const { hook } = confidentialLeakHelper({
				username: "unused-u",
				password: "unused-p",
				"otp-current": "unused-o",
			});
			const { seam } = confidentialSeam("run-allowed-origin-auth", hook, false);
			const outcome = await executePreparedRunbook(
				{
					runtime,
					authDelivery: async (input) => {
						events.push("auth");
						return await seam(input);
					},
					afterNeutralOpen: async (nextStep) => {
						events.push(`checkpoint ${nextStep}`);
						return true;
					},
				},
				{
					plan: prepared.plan,
					handoff: HANDOFF,
					runId: "run-allowed-origin-auth",
					targetTabId: "t1",
					expectedTargetUrl,
				},
			);

			expect(outcome.ok).toBe(true);
			expect(events[0]).toBe("auth");
			expect(events).toContain("open https://portal.example.com/timesheets");
			expect(events).not.toContain("checkpoint 1");
		}),
	);

	test(
		"routes a confidential runbook through the injected auth-delivery seam and threads the context into the task",
		withDataRoot(async (dataRoot) => {
			writeRunbook(
				dataRoot,
				baseRunbook({
					flow_id: "with-secret",
					steps: [
						{ kind: "snapshot", interactive: true },
						{
							kind: "fill",
							target: { role: "textbox", name: "Password" },
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
			// The executor only reaches the confidential fill after the snapshot,
			// which produces the ref the fill targets. The seam yields an
			// out-of-sensitive-interval context: the executor then applies the
			// EXACT pre-U11 refusal, proving the context is threaded verbatim
			// without weakening the default. (A live in-interval delivery needs a
			// proven target the engine cannot fabricate; the wiring proof is that
			// the seam is consulted and its context reaches task.auth_delivery.)
			const context: AgentBrowserAuthDeliveryContext = {
				in_sensitive_interval: false,
				binding: {
					service_id: "oncore",
					auth_context: "interactive-login",
					allowed_origins: ["https://portal.example.com"],
					allowed_login_paths: [],
					vault_id: "vault-1",
					item_id: "item-1",
					allowed_auth_methods: ["password"],
					binding_revision: 1,
				},
				target: {
					lane_id: "agent-browser",
					run_id: "run-3",
					top_level_origin: "https://portal.example.com",
					frame_origin: "https://portal.example.com",
					target_id: "target-1",
					page_id: "page-1",
					frame_id: "frame-1",
					account_ref: "account-1",
					target_proof_digest: "d".repeat(32),
				},
				tokenRetrieval: {
					listVaults: async () => ({ ok: true, vaults: [] }),
					listLoginItems: async () => ({ ok: true, items: [] }),
					getLoginItem: async () => ({
						ok: false,
						rejection: { code: "item-missing", message: "unused" },
					}),
					fetchCredentialField: async () => ({
						ok: false,
						rejection: { code: "token-invalid", message: "unused" },
					}),
				},
				deliver: async () => ({
					ok: true,
					shape: { field: "password", byte_length: 1 },
				}),
				reproveTarget: async () => ({
					proven: true,
					observed_digest: "d".repeat(32),
				}),
				field_by_ref: {},
			};
			const seamCalls: Array<readonly string[]> = [];
			// tab list + select, then the interactive snapshot yields the @e1 ref
			// the confidential fill targets.
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
				// selectTarget: fresh selected-url reproof
				{ stdout: json({ url: "https://portal.example.com/timesheets" }) },
				// snapshot yields the @e1 ref (with semantic metadata) the fill targets
				{
					stdout: json({
						refs: { "@e1": { role: "textbox", name: "Password" } },
					}),
				},
			]);
			const outcome = await runRunbook(
				{
					fs: createDefaultPlatformFs(),
					runtime,
					dataRoot,
					authDelivery: async (seamInput) => {
						seamCalls.push(seamInput.pendingItemBindings);
						return { ok: true, context };
					},
				},
				{
					serviceId: "oncore",
					flowId: "with-secret",
					handoff: HANDOFF,
					runId: "run-3",
					targetTabId: "t1",
					inputs: {},
					resumeFromStep: 0,
				},
			);
			// The seam was consulted with the plan's pending bindings.
			expect(seamCalls).toEqual([["oncore_password"]]);
			// The executor ran (snapshot dispatched), then applied the threaded
			// out-of-interval context's refusal at the confidential fill.
			expect(outcome.ok).toBe(true);
			if (!outcome.ok) return;
			expect(outcome.result.ok).toBe(false);
			if (outcome.result.ok) return;
			expect(outcome.result.code).toBe(
				"agent_browser_confidential_input_requires_auth_transaction",
			);
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

// --- (C) Deterministic contract: the wired confidential runbook path ----------
//
// U13 tier-C. The newly wired runbook-run confidential path (U10/U11) routes a
// confidential field through the REAL deliverConfidentialFields choreography
// when an in-interval auth-delivery seam is injected — instead of refusing —
// and holds the typed fail-closed pointer when the native Token Retrieval seam
// is absent. Fakes live ONLY at the injected port boundaries (Seam A/B =
// authDelivery, plus the TokenRetrievalPort + delivery hook the context
// carries); the engine and the executor run for real. Sentinel VALUES are
// conformance markers (obviously-fake, never a real-looking credential) so a
// clean sweep of the task/adapter surfaces is meaningful, not vacuous. No
// public test-only bypass exists: the confidential fill still refuses without a
// seam, matching the browser-use-confidential-delivery-seam.test.ts posture.

const CONFIDENTIAL_RUNBOOK = baseRunbook({
	flow_id: "with-secret",
	allowed_origins: ["https://portal.example.com"],
	steps: [
		{ kind: "snapshot", interactive: true },
		{
			kind: "fill",
			target: { role: "textbox", name: "Password" },
			sensitivity: "confidential",
			item_binding: "oncore_password",
			postcondition: {
				kind: "value-equals",
				selector: "input[name=password]",
				value: "•••",
			},
		},
	],
});

const CONFIDENTIAL_BINDING: BrowserUseItemBinding = {
	service_id: "oncore",
	auth_context: "interactive-login",
	allowed_origins: ["https://portal.example.com"],
	allowed_login_paths: [],
	vault_id: "vault-1",
	item_id: "item-1",
	allowed_auth_methods: ["password", "otp"],
	binding_revision: 1,
};

function confidentialTarget(runId: string): BrowserUseVerifiedTarget {
	return {
		lane_id: "agent-browser",
		run_id: runId,
		top_level_origin: "https://portal.example.com",
		frame_origin: "https://portal.example.com",
		target_id: "target-1",
		page_id: "page-1",
		frame_id: "frame-1",
		account_ref: "acct-ref-redacted",
		target_proof_digest: "d".repeat(32),
	};
}

const confidentialReproveOk: BrowserUseTargetReproof = async ({ target }) => ({
	proven: true,
	observed_digest: target.target_proof_digest,
});

// An opaque-handle-only TokenRetrievalPort (never bytes): the ONLY place the
// port boundary is faked. Its handle names the field, carrying no value.
const confidentialFakePort: BrowserUseTokenRetrievalPort = {
	listVaults: async () => ({ ok: true, vaults: [] }),
	listLoginItems: async () => ({ ok: true, items: [] }),
	getLoginItem: async () => ({
		ok: false,
		rejection: { code: "item-missing", message: "n/a" },
	}),
	fetchCredentialField: async (
		input,
	): Promise<{ ok: true; handle: BrowserUseSecretHandle }> => ({
		ok: true,
		handle: {
			handle_id: `handle-${input.field}`,
			field: input.field,
			expires_at_epoch_ms: 9_999_999,
		},
	}),
};

// The delivery-hook fake: the ONLY component that observes sentinel bytes. It
// reports back an outcome + a non-secret shape only.
function confidentialLeakHelper(
	sentinelValue: Readonly<Record<BrowserUseOpCredentialField, string>>,
): { hook: BrowserUseDeliveryHook; observed: string[] } {
	const observed: string[] = [];
	const hook: BrowserUseDeliveryHook = async (input) => {
		const value = sentinelValue[input.field];
		observed.push(value);
		return { ok: true, shape: { field: input.field, byte_length: value.length } };
	};
	return { hook, observed };
}

// A confidential runbook's runtime: tab list, tab select, interactive snapshot
// yielding @e1, then the post-auth value-equals proof of the delivered field.
function confidentialRuntime(): AgentBrowserExecutionRuntime & {
	calls: Array<readonly string[]>;
} {
	return runtimeFor([
		{
			stdout: json({
				tabs: [{ tabId: "t1", url: "https://portal.example.com/timesheets" }],
			}),
		},
		{ stdout: json({ selected: true }) },
		{ stdout: json({ url: "https://portal.example.com/timesheets" }) },
		{
			stdout: json({
				snapshot: "@e1 textbox password",
				refs: { "@e1": { role: "textbox", name: "Password" } },
			}),
		},
		// post-auth proof: reprove-origin `get url`, then the `get value` check.
		{ stdout: json({ url: "https://portal.example.com/timesheets" }) },
		{ stdout: json({ value: "•••" }) },
	]);
}

// Seam A/B factory (the injected authDelivery port). Given a delivery hook and
// the sensitive-interval flag, it builds a real AgentBrowserAuthDeliveryContext
// mapping @e1 -> password. `in_sensitive_interval` gates whether the executor
// routes the confidential fill through delivery. This is the ONLY seam the
// engine consumes; nothing bypasses the executor's confidential gate.
function confidentialSeam(
	runId: string,
	hook: BrowserUseDeliveryHook,
	inSensitiveInterval: boolean,
): { seam: BrowserUseRunbookAuthDelivery; seamCalls: Array<readonly string[]> } {
	const seamCalls: Array<readonly string[]> = [];
	const seam: BrowserUseRunbookAuthDelivery = async (seamInput) => {
		seamCalls.push(seamInput.pendingItemBindings);
		const context: AgentBrowserAuthDeliveryContext = {
			in_sensitive_interval: inSensitiveInterval,
			binding: CONFIDENTIAL_BINDING,
			target: confidentialTarget(runId),
			tokenRetrieval: confidentialFakePort,
			deliver: hook,
			reproveTarget: confidentialReproveOk,
			field_by_ref: { "@e1": "password" },
		};
		return { ok: true, context };
	};
	return { seam, seamCalls };
}

describe("(C) runbook-run confidential path — wired delivery seam", () => {
	test(
		"Seam A: an in-interval seam routes a confidential field through deliverConfidentialFields instead of refusing",
		withDataRoot(async (dataRoot) => {
			const RUN = "run-c-seam-a";
			writeRunbook(dataRoot, CONFIDENTIAL_RUNBOOK);
			// Conformance sentinels: the delivered VALUE equals a marker the sentinel
			// owner derives, so a leak onto any surface is literally a swept token.
			const PASS = deriveConformanceSentinel("password", "runcseama01");
			expect(PASS.ok).toBe(true);
			if (!PASS.ok) return;
			const sentinelValue: Record<BrowserUseOpCredentialField, string> = {
				username: PASS.value,
				password: PASS.value,
				"otp-current": PASS.value,
			};
			const { hook, observed } = confidentialLeakHelper(sentinelValue);
			const { seam, seamCalls } = confidentialSeam(RUN, hook, true);
			const runtime = confidentialRuntime();

			const outcome = await runRunbook(
				{ fs: createDefaultPlatformFs(), runtime, dataRoot, authDelivery: seam },
				{
					serviceId: "oncore",
					flowId: "with-secret",
					handoff: HANDOFF as AgentBrowserVerifiedHandoff,
					runId: RUN,
					targetTabId: "t1",
					inputs: {},
					resumeFromStep: 0,
				},
			);

			// The seam was consulted with the plan's pending bindings and the
			// choreography delivered the password (the hook saw the sentinel bytes).
			expect(seamCalls).toEqual([["oncore_password"]]);
			expect(observed).toContain(sentinelValue.password);
			expect(outcome.ok).toBe(true);
			if (!outcome.ok) return;
			expect(outcome.result.ok).toBe(true);
			if (!outcome.result.ok) return;
			// Delivery evidence rode the executor result verbatim; the executor never
			// issued its own `fill` command for the confidential step.
			expect(outcome.result.delivery?.method_step_events).toEqual([
				"fill-password",
			]);
			expect(outcome.result.delivery?.delivered_shapes).toEqual([
				{ field: "password", byte_length: sentinelValue.password.length },
			]);
			expect(
				runtime.calls.some((call) => call.includes("fill")),
			).toBe(false);
			// No adapter argv and no task-surface JSON ever carried the raw value.
			expect(JSON.stringify(runtime.calls)).not.toContain(
				sentinelValue.password,
			);
			expect(JSON.stringify(outcome)).not.toContain(sentinelValue.password);
		}),
	);

	test(
		"Seam B: compact/pretty serialization of the seam-built context carries no delivered value (port-boundary parity)",
		withDataRoot(async (dataRoot) => {
			const RUN = "run-c-seam-b";
			writeRunbook(dataRoot, CONFIDENTIAL_RUNBOOK);
			const PASS = deriveConformanceSentinel("password", "runcseamb01");
			expect(PASS.ok).toBe(true);
			if (!PASS.ok) return;
			const sentinelValue: Record<BrowserUseOpCredentialField, string> = {
				username: PASS.value,
				password: PASS.value,
				"otp-current": PASS.value,
			};
			const { hook } = confidentialLeakHelper(sentinelValue);
			// Capture the exact context the seam hands the engine.
			let captured: AgentBrowserAuthDeliveryContext | undefined;
			const seam: BrowserUseRunbookAuthDelivery = async (seamInput) => {
				const context: AgentBrowserAuthDeliveryContext = {
					in_sensitive_interval: true,
					binding: CONFIDENTIAL_BINDING,
					target: confidentialTarget(RUN),
					tokenRetrieval: confidentialFakePort,
					deliver: hook,
					reproveTarget: confidentialReproveOk,
					field_by_ref: { "@e1": "password" },
				};
				expect(seamInput.pendingItemBindings).toEqual(["oncore_password"]);
				captured = context;
				return { ok: true, context };
			};
			const outcome = await runRunbook(
				{ fs: createDefaultPlatformFs(), runtime: confidentialRuntime(), dataRoot, authDelivery: seam },
				{
					serviceId: "oncore",
					flowId: "with-secret",
					handoff: HANDOFF as AgentBrowserVerifiedHandoff,
					runId: RUN,
					targetTabId: "t1",
					inputs: {},
					resumeFromStep: 0,
				},
			);
			expect(outcome.ok).toBe(true);
			expect(captured).toBeDefined();
			if (captured === undefined) return;
			// The context is a real port object (functions do not serialize); the
			// data-only portion serializes byte-identically compact vs pretty and
			// carries only structural facts — never the delivered value.
			const dataOnly = {
				in_sensitive_interval: captured.in_sensitive_interval,
				binding: captured.binding,
				target: captured.target,
				field_by_ref: captured.field_by_ref,
			};
			const compact = JSON.stringify(dataOnly);
			const pretty = JSON.stringify(dataOnly, null, 2);
			expect(JSON.parse(compact)).toEqual(JSON.parse(pretty));
			expect(compact).not.toContain(sentinelValue.password);
			expect(pretty).not.toContain(sentinelValue.password);
			// The field mapping names the field kind only, no value.
			expect(captured.field_by_ref).toEqual({ "@e1": "password" });
		}),
	);

	test(
		"Seam gate: an out-of-interval seam threads the context verbatim and the executor still refuses (default not weakened)",
		withDataRoot(async (dataRoot) => {
			const RUN = "run-c-seam-out";
			writeRunbook(dataRoot, CONFIDENTIAL_RUNBOOK);
			const { hook, observed } = confidentialLeakHelper({
				username: "not-a-real-secret-u",
				password: "not-a-real-secret-p",
				"otp-current": "not-a-real-secret-o",
			});
			const { seam, seamCalls } = confidentialSeam(RUN, hook, false);
			const outcome = await runRunbook(
				{ fs: createDefaultPlatformFs(), runtime: confidentialRuntime(), dataRoot, authDelivery: seam },
				{
					serviceId: "oncore",
					flowId: "with-secret",
					handoff: HANDOFF as AgentBrowserVerifiedHandoff,
					runId: RUN,
					targetTabId: "t1",
					inputs: {},
					resumeFromStep: 0,
				},
			);
			expect(seamCalls).toEqual([["oncore_password"]]);
			// Out of the sensitive interval: no delivery, unchanged typed refusal.
			expect(observed).toHaveLength(0);
			expect(outcome.ok).toBe(true);
			if (!outcome.ok) return;
			expect(outcome.result.ok).toBe(false);
			if (outcome.result.ok) return;
			expect(outcome.result.code).toBe(
				"agent_browser_confidential_input_requires_auth_transaction",
			);
		}),
	);

	test(
		"Fail-closed pointer: with no seam injected (native Token Retrieval absent), the confidential runbook refuses closed before any browser effect",
		withDataRoot(async (dataRoot) => {
			writeRunbook(dataRoot, CONFIDENTIAL_RUNBOOK);
			const runtime = runtimeFor([]);
			// No authDelivery: this models the unsigned machine where the native
			// Token Retrieval capability is absent, so the driver injects no seam.
			const outcome = await runRunbook(
				{ fs: createDefaultPlatformFs(), runtime, dataRoot },
				{
					serviceId: "oncore",
					flowId: "with-secret",
					handoff: HANDOFF as AgentBrowserVerifiedHandoff,
					runId: "run-c-no-seam",
					targetTabId: "t1",
					inputs: {},
					resumeFromStep: 0,
				},
			);
			expect(outcome.ok).toBe(false);
			if (outcome.ok) return;
			expect(outcome.refusal.code).toBe(
				"runbook_confidential_native_capability_absent",
			);
			// The typed pointer names the repair path and never a secret.
			expect(outcome.refusal.message).toContain(
				"Browser Authentication Transaction",
			);
			expect(runtime.calls).toHaveLength(0);
		}),
	);

	test(
		"Seam blocked outcome maps to the typed delivery-unavailable refusal (present capability, unproven interval)",
		withDataRoot(async (dataRoot) => {
			writeRunbook(dataRoot, CONFIDENTIAL_RUNBOOK);
			const runtime = runtimeFor([]);
			// The native capability is present but the seam cannot complete the
			// sensitive-interval transaction (mirrors the driver's current
			// buildRunbookAuthDelivery typed-blocked outcome). Fail closed, no fill.
			const seam: BrowserUseRunbookAuthDelivery = async () => ({
				ok: false,
				message:
					"the runbook lane's live sensitive-interval delivery is not wired yet.",
			});
			const outcome = await runRunbook(
				{ fs: createDefaultPlatformFs(), runtime, dataRoot, authDelivery: seam },
				{
					serviceId: "oncore",
					flowId: "with-secret",
					handoff: HANDOFF as AgentBrowserVerifiedHandoff,
					runId: "run-c-seam-blocked",
					targetTabId: "t1",
					inputs: {},
					resumeFromStep: 0,
				},
			);
			expect(outcome.ok).toBe(false);
			if (outcome.ok) return;
			expect(outcome.refusal.code).toBe(
				"runbook_confidential_delivery_unavailable",
			);
			// No browser command dispatched: the engine refused before the executor.
			expect(runtime.calls).toHaveLength(0);
		}),
	);
});

// --- Effective-catalog resolver + shadow matrix (R7, R14) --------------------

describe("effective-catalog resolver shadow matrix (R7)", () => {
	// A minimal active-generation seam fake: one id maps to one runbook, one id
	// fails closed (corrupt), everything else is absent.
	function seamFor(records: {
		valid?: Record<string, BrowserUseRunbook>;
		corrupt?: readonly string[];
	}): BrowserUseActiveGenerationSeam {
		const valid = records.valid ?? {};
		const corrupt = new Set(records.corrupt ?? []);
		return {
			async loadRunbook(id) {
				const key = `${id.serviceId}/${id.flowId}`;
				if (corrupt.has(key)) {
					return {
						ok: false,
						absent: false,
						failure: {
							code: "runbook_record_corrupt",
							message: "active-generation record is corrupt.",
						},
					};
				}
				const runbook = valid[key];
				if (runbook !== undefined) {
					return { ok: true, runbook, health: "healthy" };
				}
				return { ok: false, absent: true };
			},
			async listIds() {
				return [
					...Object.keys(valid),
					...corrupt,
				].map((key) => {
					const [serviceId, flowId] = key.split("/");
					return { serviceId: serviceId ?? "", flowId: flowId ?? "" };
				});
			},
		};
	}

	test(
		"active generation shadows the compat XDG override and the shipped base",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			// compat-xdg record for oncore/snapshot-verify...
			writeRunbook(
				dataRoot,
				baseRunbook({ flow_id: "snapshot-verify", flow_name: "store-wins" }),
			);
			// ...but the active generation shadows it.
			const seam = seamFor({
				valid: {
					"oncore/snapshot-verify": baseRunbook({
						flow_id: "snapshot-verify",
						flow_name: "generation-wins",
					}),
				},
			});
			const resolved = await resolveEffectiveRunbook(
				fs,
				dataRoot,
				{ serviceId: "oncore", flowId: "snapshot-verify" },
				seam,
			);
			expect(resolved?.effective_source).toBe("active-generation");
			expect(resolved?.ok).toBe(true);
			if (resolved?.ok !== true) return;
			expect(resolved.runbook.flow_name).toBe("generation-wins");
		}),
	);

	test(
		"compat XDG override shadows the shipped base",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			writeRunbook(
				dataRoot,
				baseRunbook({
					service_id: "oncore",
					flow_id: "timesheet-snapshot-verify",
					flow_name: "store-override",
				}),
			);
			const resolved = await resolveEffectiveRunbook(fs, dataRoot, {
				serviceId: "oncore",
				flowId: "timesheet-snapshot-verify",
			});
			expect(resolved?.effective_source).toBe("compat-xdg");
			expect(resolved?.ok === true && resolved.runbook.flow_name).toBe(
				"store-override",
			);
		}),
	);

	test(
		"resolves the shipped base when no higher layer holds the id",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			const resolved = await resolveEffectiveRunbook(fs, dataRoot, {
				serviceId: "oncore",
				flowId: "timesheet-snapshot-verify",
			});
			expect(resolved?.effective_source).toBe("shipped-base");
			expect(resolved?.ok).toBe(true);
		}),
	);

	test(
		"a corrupt active-generation record FAILS CLOSED with no lower-layer fallback",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			// A VALID compat-xdg record exists for the same id...
			writeRunbook(
				dataRoot,
				baseRunbook({ flow_id: "snapshot-verify", flow_name: "store-valid" }),
			);
			// ...but the higher active-generation layer holds a corrupt record; the
			// id must fail closed at that layer, never fall through to the store.
			const seam = seamFor({ corrupt: ["oncore/snapshot-verify"] });
			const resolved = await resolveEffectiveRunbook(
				fs,
				dataRoot,
				{ serviceId: "oncore", flowId: "snapshot-verify" },
				seam,
			);
			expect(resolved?.effective_source).toBe("active-generation");
			expect(resolved?.ok).toBe(false);
			if (resolved?.ok !== false) return;
			expect(resolved.failure.code).toBe("runbook_record_corrupt");
		}),
	);

	test(
		"a corrupt compat-xdg record FAILS CLOSED with no shipped fallback",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			// Torn JSON at the shipped seed's own id: fail closed, never shadowed by
			// the valid shipped default.
			const dir = join(
				runbooksRoot(dataRoot),
				"oncore",
				"timesheet-snapshot-verify",
			);
			mkdirSync(dir, { recursive: true });
			writeFileSync(join(dir, "runbook.json"), "{ not json");
			const resolved = await resolveEffectiveRunbook(fs, dataRoot, {
				serviceId: "oncore",
				flowId: "timesheet-snapshot-verify",
			});
			expect(resolved?.effective_source).toBe("compat-xdg");
			expect(resolved?.ok).toBe(false);
			if (resolved?.ok !== false) return;
			expect(resolved.failure.code).toBe("runbook_record_corrupt");
		}),
	);

	test(
		"whole-catalog verification reports id, effective source, and failure per record (R14)",
		withDataRoot(async (dataRoot) => {
			const fs = createDefaultPlatformFs();
			// One valid store record and one corrupt store record: BOTH must appear
			// in verification — an invalid record never silently disappears.
			writeRunbook(dataRoot, baseRunbook({ flow_id: "good-flow" }));
			const badDir = join(runbooksRoot(dataRoot), "oncore", "bad-flow");
			mkdirSync(badDir, { recursive: true });
			writeFileSync(join(badDir, "runbook.json"), "{ not json");
			const entries = await verifyEffectiveCatalog(fs, dataRoot);
			const good = entries.find((e) => e.flow_id === "good-flow");
			const bad = entries.find((e) => e.flow_id === "bad-flow");
			expect(good?.ok).toBe(true);
			expect(good?.effective_source).toBe("compat-xdg");
			expect(bad?.ok).toBe(false);
			expect(bad?.effective_source).toBe("compat-xdg");
			if (bad?.ok !== false) return;
			expect(bad.failure.code).toBe("runbook_record_corrupt");
			// The shipped seeds still surface too.
			expect(
				entries.some((e) => e.flow_id === "timesheet-snapshot-verify"),
			).toBe(true);
		}),
	);
});

// --- Private-file structured-input route (R10) -------------------------------

describe("private-file structured input custody (R10)", () => {
	function withInputRoot(
		fn: (root: string) => void | Promise<void>,
	): () => Promise<void> {
		return async () => {
			const root = mkdtempSync(join(tmpdir(), "browser-use-private-input-"));
			try {
				await fn(root);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		};
	}

	test(
		"reads a well-formed owner-only regular private file",
		withInputRoot(async (root) => {
			const filePath = join(root, "value.json");
			writeFileSync(filePath, JSON.stringify({ week: "2026-07-28" }), {
				mode: 0o600,
			});
			const result = await readPrivateStructuredInput({
				inputId: "profile",
				inputRoot: root,
				filePath,
			});
			expect(result.ok).toBe(true);
			if (!result.ok) return;
			expect(result.inputs).toEqual({ profile: { week: "2026-07-28" } });
		}),
	);

	test(
		"rejects a path escape above the admitted input root",
		withInputRoot(async (root) => {
			const result = await readPrivateStructuredInput({
				inputId: "profile",
				inputRoot: root,
				filePath: join(root, "..", "escape.json"),
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.refusal.code).toBe("private_input_path_unsafe");
			// Never echoes the value or the source path.
			expect(result.refusal.message).not.toContain("escape.json");
		}),
	);

	test(
		"rejects a symlink at the final component (no-follow open)",
		withInputRoot(async (root) => {
			const real = join(root, "real.json");
			writeFileSync(real, JSON.stringify({ v: 1 }), { mode: 0o600 });
			const link = join(root, "link.json");
			symlinkSync(real, link);
			const result = await readPrivateStructuredInput({
				inputId: "profile",
				inputRoot: root,
				filePath: link,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.refusal.code).toBe("private_input_open_failed");
		}),
	);

	test(
		"rejects a symlink in an intermediate component beneath the admitted root",
		withInputRoot(async (root) => {
			const outside = mkdtempSync(join(tmpdir(), "browser-use-private-outside-"));
			try {
				const filePath = join(outside, "value.json");
				writeFileSync(filePath, JSON.stringify({ v: 1 }), { mode: 0o600 });
				const redirectedDirectory = join(root, "redirected");
				symlinkSync(outside, redirectedDirectory);
				const result = await readPrivateStructuredInput({
					inputId: "profile",
					inputRoot: root,
					filePath: join(redirectedDirectory, "value.json"),
				});
				expect(result.ok).toBe(false);
				if (result.ok) return;
				expect(result.refusal.code).toBe("private_input_path_unsafe");
				expect(result.refusal.message).not.toContain(filePath);
			} finally {
				rmSync(outside, { recursive: true, force: true });
			}
		}),
	);

	test(
		"rejects a hard-link alias (link count other than one)",
		withInputRoot(async (root) => {
			const original = join(root, "orig.json");
			writeFileSync(original, JSON.stringify({ v: 1 }), { mode: 0o600 });
			const alias = join(root, "alias.json");
			linkSync(original, alias);
			const result = await readPrivateStructuredInput({
				inputId: "profile",
				inputRoot: root,
				filePath: alias,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.refusal.code).toBe("private_input_multiple_links");
		}),
	);

	test(
		"rejects a non-regular file (a directory)",
		withInputRoot(async (root) => {
			const dirPath = join(root, "adir");
			mkdirSync(dirPath, { mode: 0o700 });
			const result = await readPrivateStructuredInput({
				inputId: "profile",
				inputRoot: root,
				filePath: dirPath,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			// O_NOFOLLOW open of a directory for O_RDONLY may succeed, then fstat
			// proves non-regular; either failure path is a fail-closed refusal.
			expect(
				["private_input_not_regular", "private_input_open_failed"],
			).toContain(result.refusal.code);
		}),
	);

	test(
		"rejects a group/other-readable (loose-mode) file",
		withInputRoot(async (root) => {
			const filePath = join(root, "loose.json");
			writeFileSync(filePath, JSON.stringify({ v: 1 }), { mode: 0o644 });
			chmodSync(filePath, 0o644);
			const result = await readPrivateStructuredInput({
				inputId: "profile",
				inputRoot: root,
				filePath,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.refusal.code).toBe("private_input_mode_loose");
		}),
	);

	test(
		"rejects a wrong-owner file (expected owner mismatch)",
		withInputRoot(async (root) => {
			const filePath = join(root, "owned.json");
			writeFileSync(filePath, JSON.stringify({ v: 1 }), { mode: 0o600 });
			// Force an owner mismatch by claiming a different expected uid.
			const result = await readPrivateStructuredInput({
				inputId: "profile",
				inputRoot: root,
				filePath,
				expectedOwnerUid: (process.getuid?.() ?? 0) + 99991,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.refusal.code).toBe("private_input_wrong_owner");
		}),
	);

	test(
		"rejects oversized content before parsing the value",
		withInputRoot(async (root) => {
			const filePath = join(root, "big.json");
			const big = `{"v":"${"x".repeat(RUNBOOK_PRIVATE_INPUT_MAX_BYTES + 10)}"}`;
			writeFileSync(filePath, big, { mode: 0o600 });
			const result = await readPrivateStructuredInput({
				inputId: "profile",
				inputRoot: root,
				filePath,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.refusal.code).toBe("private_input_oversize");
		}),
	);

	test(
		"caps a caller-supplied maxBytes at the code-owned ceiling",
		withInputRoot(async (root) => {
			const filePath = join(root, "caller-bound.json");
			const oversized = `{"v":"${"x".repeat(RUNBOOK_PRIVATE_INPUT_MAX_BYTES)}"}`;
			writeFileSync(filePath, oversized, { mode: 0o600 });
			const result = await readPrivateStructuredInput({
				inputId: "profile",
				inputRoot: root,
				filePath,
				maxBytes: Number.MAX_SAFE_INTEGER,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.refusal.code).toBe("private_input_oversize");
			expect(result.refusal.message).not.toContain("caller-bound.json");
		}),
	);

	test(
		"rejects invalid JSON through the proven descriptor",
		withInputRoot(async (root) => {
			const filePath = join(root, "torn.json");
			writeFileSync(filePath, "{ not json", { mode: 0o600 });
			const result = await readPrivateStructuredInput({
				inputId: "profile",
				inputRoot: root,
				filePath,
			});
			expect(result.ok).toBe(false);
			if (result.ok) return;
			expect(result.refusal.code).toBe("private_input_json_invalid");
		}),
	);
});

// --- U3: reviewed-action step resolution through the engine ------------------

const ACTION_ORIGIN = "https://portal.example.com";
const ACTION_READ_BYTES =
	"async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length })";
const ACTION_READ_DIGEST = actionAssetDigest(ACTION_READ_BYTES);

function actionRunbook(
	overrides: Partial<BrowserUseRunbook> = {},
): BrowserUseRunbook {
	return baseRunbook({
		flow_id: "diagnose",
		allowed_origins: [ACTION_ORIGIN],
		steps: [
			{ kind: "snapshot", interactive: false },
			{
				kind: "action",
				action_id: "diagnose-grid",
				expected_digest: ACTION_READ_DIGEST,
				inputs: {},
			},
		],
		...overrides,
	});
}

function iterateRunbook(
	expectedDigest = ACTION_READ_DIGEST,
): BrowserUseRunbook {
	return actionRunbook({
		inputs: [
			{
				id: "items",
				summary: "Stable item keys.",
				required: true,
				schema: {
					kind: "array",
					min_items: 1,
					max_items: 256,
					items: { kind: "string", min_length: 1, max_length: 128 },
				},
			},
		],
		steps: [
			{
				kind: "iterate",
				over_input: "items",
				step: {
					kind: "action",
					action_id: "diagnose-grid",
					expected_digest: expectedDigest,
					inputs: {},
				},
			},
		],
	});
}

function actionSeam(
	record: BrowserUseReviewedActionRecord,
	bytes: Readonly<Record<string, string>>,
): BrowserUseActionGenerationSeam {
	return {
		async loadActionRecord(actionId) {
			return actionId === record.action_id
				? { ok: true, record }
				: { ok: false, absent: true };
		},
		async loadActionAssetBytes(assetId) {
			const found = bytes[assetId];
			return found === undefined
				? { ok: false, reason: "bytes_unavailable" }
				: { ok: true, bytes: found };
		},
	};
}

function approvedReadRecord(): BrowserUseReviewedActionRecord {
	return {
		action_id: "diagnose-grid",
		asset_id: ACTION_READ_DIGEST,
		expected_digest: ACTION_READ_DIGEST,
		allowed_origin: ACTION_ORIGIN,
		effect_class: "read",
		containment: "read-only-observation",
		input_schema: { kind: "object", fields: {} },
		result_schema: {
			kind: "object",
			fields: { rows: { schema: { kind: "number" }, required: true } },
		},
		result_sensitivity: "low",
		source_provenance: "oncore/diagnose-grid-state.js",
		promotion_receipt: {
			approved_digest: ACTION_READ_DIGEST,
			disposition: "approved",
			approved_origin: ACTION_ORIGIN,
			approved_effect: "read",
			approver_ref: "operator-1",
		},
	};
}

describe("engine reviewed-action step resolution (U3)", () => {
	test(
		"an action-step runbook refuses without a generation seam",
		withDataRoot(async (dataRoot) => {
			writeRunbook(dataRoot, actionRunbook());
			const prepared = await prepareRunbookExecution(
				createDefaultPlatformFs(),
				dataRoot,
				{ serviceId: "oncore", flowId: "diagnose", inputs: {}, resumeFromStep: 0 },
			);
			expect(prepared.ok).toBe(false);
			if (prepared.ok) return;
			expect(prepared.refusal.code).toBe("runbook_action_registry_unavailable");
		}),
	);

	test(
		"an approved action resolves to an evaluate step through the seam",
		withDataRoot(async (dataRoot) => {
			writeRunbook(dataRoot, actionRunbook());
			const prepared = await prepareRunbookExecution(
				createDefaultPlatformFs(),
				dataRoot,
				{
					serviceId: "oncore",
					flowId: "diagnose",
					inputs: {},
					resumeFromStep: 0,
					actionSeam: actionSeam(approvedReadRecord(), {
						[ACTION_READ_DIGEST]: ACTION_READ_BYTES,
					}),
				},
			);
			expect(prepared.ok).toBe(true);
			if (!prepared.ok) return;
			const evaluateStep = prepared.plan.steps.find((s) => s.kind === "evaluate");
			expect(evaluateStep).toBeDefined();
			if (evaluateStep?.kind === "evaluate") {
				expect(evaluateStep.review_status).toBe("approved");
				expect(evaluateStep.effect).toBe("read");
				expect(evaluateStep.script_sha256).toBe(ACTION_READ_DIGEST);
			}
		}),
	);

	test(
		"a rejected receipt refuses through the engine (before any dispatch)",
		withDataRoot(async (dataRoot) => {
			writeRunbook(dataRoot, actionRunbook());
			const record = approvedReadRecord();
			const prepared = await prepareRunbookExecution(
				createDefaultPlatformFs(),
				dataRoot,
				{
					serviceId: "oncore",
					flowId: "diagnose",
					inputs: {},
					resumeFromStep: 0,
					actionSeam: actionSeam(
						{
							...record,
							promotion_receipt: {
								...record.promotion_receipt,
								disposition: "rejected",
							},
						},
						{ [ACTION_READ_DIGEST]: ACTION_READ_BYTES },
					),
				},
			);
			expect(prepared.ok).toBe(false);
			if (prepared.ok) return;
			expect(prepared.refusal.code).toBe("runbook_action_refused");
			expect(prepared.refusal.message).toContain("action_receipt_not_approved");
		}),
	);

	test(
		"a direct action refuses when the runbook digest differs from the registry",
		withDataRoot(async (dataRoot) => {
			writeRunbook(
				dataRoot,
				actionRunbook({
					steps: [
						{
							kind: "action",
							action_id: "diagnose-grid",
							expected_digest: "b".repeat(64),
							inputs: {},
						},
					],
				}),
			);
			const prepared = await prepareRunbookExecution(
				createDefaultPlatformFs(),
				dataRoot,
				{
					serviceId: "oncore",
					flowId: "diagnose",
					inputs: {},
					resumeFromStep: 0,
					actionSeam: actionSeam(approvedReadRecord(), {
						[ACTION_READ_DIGEST]: ACTION_READ_BYTES,
					}),
				},
			);
			expect(prepared.ok).toBe(false);
			if (prepared.ok) return;
			expect(prepared.refusal.code).toBe("runbook_action_refused");
			expect(prepared.refusal.message).toContain("action_digest_mismatch");
		}),
	);

	test(
		"an iterate action refuses when the runbook digest differs from the registry",
		withDataRoot(async (dataRoot) => {
			writeRunbook(dataRoot, iterateRunbook("b".repeat(64)));
			const record = approvedReadRecord();
			const prepared = await prepareRunbookExecution(
				createDefaultPlatformFs(),
				dataRoot,
				{
					serviceId: "oncore",
					flowId: "diagnose",
					inputs: { items: ["item-1"] },
					resumeFromStep: 0,
					actionSeam: actionSeam(
						{
							...record,
							input_schema: {
								kind: "object",
								fields: {
									item_key: {
										schema: { kind: "string", max_length: 128 },
										required: true,
									},
								},
							},
						},
						{ [ACTION_READ_DIGEST]: ACTION_READ_BYTES },
					),
				},
			);
			expect(prepared.ok).toBe(false);
			if (prepared.ok) return;
			expect(prepared.refusal.code).toBe("runbook_action_refused");
			expect(prepared.refusal.message).toContain("action_digest_mismatch");
		}),
	);

	test(
		"iterate validates a non-empty bounded unique stable-key sequence before action resolution",
		withDataRoot(async (dataRoot) => {
			writeRunbook(dataRoot, iterateRunbook());
			const invalidInputs: readonly unknown[] = [
				undefined,
				"item-1",
				[],
				[""],
				[1],
				["bad key"],
				["item-1", "item-1"],
				Array.from({ length: 513 }, (_unused, index) => `item-${index}`),
			];
			const mustNotResolve: BrowserUseActionGenerationSeam = {
				async loadActionRecord() {
					throw new Error("invalid iteration reached action resolution");
				},
				async loadActionAssetBytes() {
					throw new Error("invalid iteration reached asset resolution");
				},
			};
			for (const items of invalidInputs) {
				const prepared = await prepareRunbookExecution(
					createDefaultPlatformFs(),
					dataRoot,
					{
						serviceId: "oncore",
						flowId: "diagnose",
						inputs: items === undefined ? {} : { items },
						resumeFromStep: 0,
						actionSeam: mustNotResolve,
					},
				);
				expect(prepared.ok).toBe(false);
				if (prepared.ok) continue;
				expect(prepared.refusal.code).toBe("runbook_action_refused");
				expect(prepared.refusal.message).toContain("action_input_rejected");
			}
		}),
	);

	test(
		"a runbook cannot inline script bytes: only the action id + digest reference exists",
		() => {
			const runbook = actionRunbook();
			// The runbook JSON never carries script bytes — only an id + digest.
			const serialized = JSON.stringify(runbook);
			expect(serialized).not.toContain("document.querySelectorAll");
			expect(serialized).toContain(ACTION_READ_DIGEST);
		},
	);
});
