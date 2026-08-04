import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyReviewedActionCandidate,
	parseReviewedActionCandidate,
	promoteReviewedActionCandidate,
	reviewedActionApprovalFactsFromRecord,
	reviewedActionAuthoringSchema,
	validateReviewedActionCandidate,
	verifyAuthoredReviewedActionPromotion,
} from "./browser-use-reviewed-action-authoring";
import {
	createReviewedActionApprovalVerifier,
	createReviewedActionPromotionRouter,
	reviewedActionApprovalFactsDigest,
} from "./browser-use-reviewed-action-approval";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";

const cleanup = new Set<string>();
afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

const READ_SOURCE = "async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length })";

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		contract: "browser-use.reviewed-action-candidate",
		schema_version: "1",
		action_id: "count-rows",
		origin: "https://portal.example.test",
		source: READ_SOURCE,
		containment: "read-only-observation",
		input_schema: { kind: "object", fields: {} },
		result_schema: { kind: "object", fields: { rows: { required: true, schema: { kind: "number", integer: true } } } },
		result_sensitivity: "low",
		...overrides,
	};
}

async function sourceFixture(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "reviewed-action-authoring-"));
	cleanup.add(root);
	await mkdir(join(root, "skills/browser-use/actions"), { recursive: true });
	await writeFile(join(root, "skills/browser-use/actions/registry.json"), `${JSON.stringify({ actions: [] }, null, 2)}\n`);
	return root;
}

async function git(root: string, ...args: string[]): Promise<string> {
	const child = Bun.spawn(["git", ...args], {
		cwd: root,
		env: { ...process.env, GIT_AUTHOR_NAME: "Promotion Test", GIT_AUTHOR_EMAIL: "promotion@example.invalid", GIT_COMMITTER_NAME: "Promotion Test", GIT_COMMITTER_EMAIL: "promotion@example.invalid" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
	if (exitCode !== 0) throw new Error(stderr);
	return stdout.trim();
}

describe("Reviewed Action schema and mechanical capability audit", () => {
	test("the four FastTrack legacy assets validate unchanged through the current candidate schema", async () => {
		const registry = JSON.parse(await readFile(join(import.meta.dir, "../actions/registry.json"), "utf8")) as {
			actions: Array<{ asset_path: string; record: Record<string, unknown> }>;
		};
		for (const entry of registry.actions) {
			const record = entry.record;
			const source = await readFile(join(import.meta.dir, "../actions", entry.asset_path), "utf8");
			const result = validateReviewedActionCandidate({
				contract: "browser-use.reviewed-action-candidate",
				schema_version: "1",
				action_id: record.action_id,
				origin: record.allowed_origin,
				source,
				containment: record.containment,
				input_schema: record.input_schema,
				result_schema: record.result_schema,
				result_sensitivity: record.result_sensitivity,
				required_postcondition: record.required_postcondition,
			} as never);
			expect(result.ok, String(record.action_id)).toBe(true);
		}
	});

	test("public schema and validate commands emit the facade-owned result contract", async () => {
		const schemaResult = await runForTest(["action", "schema", "--json"], makeRuntime());
		expect(schemaResult.exitCode).toBe(0);
		expect(parseJson(schemaResult.stdout)).toMatchObject({ status: "ok", data: { contract_id: "browser-use.reviewed-action-authoring", schema_version: "1", command: "action-schema" } });
		const validateResult = await runForTest(["action", "validate", "--file", "/fixture/action.json", "--json"], makeRuntime({ readTextFile: async () => JSON.stringify(candidate()) }));
		expect(validateResult.exitCode).toBe(0);
		expect(parseJson(validateResult.stdout)).toMatchObject({ status: "ok", data: { contract_id: "browser-use.reviewed-action-authoring", command: "action-validate", result: { ok: true, effect_class: "read" } } });
	});

	test("schema exposes the complete contract and its minimal example validates unchanged", () => {
		const schema = reviewedActionAuthoringSchema();
		expect(schema).toMatchObject({ contract_id: "browser-use.reviewed-action-authoring", wrapper_shape: "async ({ inputs }) => <result>", fields: { origin: { required: true }, effect_class: { derived: true }, input_schema: { required: true }, result_schema: { required: true }, postcondition: { required_for_effect: "mutation" } } });
		const parsed = parseReviewedActionCandidate(JSON.stringify(schema.minimal_example));
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(validateReviewedActionCandidate(parsed.candidate)).toMatchObject({ ok: true, effect_class: "read", audited_capabilities: ["dom-query", "dom-read"] });
	});

	test("observational source validates while credential and secret-shaped material refuse", () => {
		expect(validateReviewedActionCandidate(candidate() as never)).toMatchObject({ ok: true, effect_class: "read" });
		const credential = validateReviewedActionCandidate(candidate({ source: "async ({ inputs }) => ({ value: document.querySelector('input[type=password]').value })" }) as never);
		expect(credential).toMatchObject({ ok: false, issues: [{ code: "action_capability_credential_field" }] });
		const secret = validateReviewedActionCandidate(candidate({ input_schema: { kind: "string", pattern: "op://vault/item/field" } }) as never);
		expect(secret).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: "action_secret_shaped_material" })]) });
		expect(JSON.stringify(secret)).not.toContain("op://vault/item/field");
	});

	test("non-authority bracket syntax passes while dynamic member access stays closed", () => {
		const fastTrackBracketShapes = validateReviewedActionCandidate(
			candidate({
				containment: "none",
				required_postcondition: { kind: "element-visible", selector: ".row" },
				source: `async ({ inputs }) => {
				const context = { requested: "visible" };
				let text = "";
				for (const [key, value] of Object.entries(context)) text = key + value;
				const match = text.match(new RegExp("^(.*)$"));
				const fallback = [context["requested"], "second"];
				const rows = ["first", "second"];
				const cells = ["first", "second"];
				const i = 0;
				const index = 1;
				const n = 0;
				const [x, y] = fallback;
				return { rows: document.querySelectorAll('.row').length, text: match ? match[1] : fallback[0], values: [rows[index], cells[n], fallback[i], x, y] };
			}`,
			}) as never,
		);
		expect(fastTrackBracketShapes).toMatchObject({
			ok: true,
			effect_class: "mutation",
		});

		const rejected: Array<[string, string]> = [
			["inputs-derived alias", "async ({ inputs }) => { const payload = {}; const userInput = String(inputs.key); payload[userInput] = document.querySelector('.row')?.textContent; return payload }"],
			["inputs-derived destructuring", "async ({ inputs }) => { const payload = {}; const { key } = inputs; payload[key] = document.querySelector('.row')?.textContent; return payload }"],
			["direct inputs key", "async ({ inputs }) => { const payload = {}; payload[inputs.key] = document.querySelector('.row')?.textContent; return payload }"],
			["member-expression key", "async ({ inputs }) => { const payload = {}; const context = { key: 'row' }; payload[context.key] = document.querySelector('.row')?.textContent; return payload }"],
			["call key", "async ({ inputs }) => { const payload = {}; payload[getKey()] = document.querySelector('.row')?.textContent; return payload }"],
			["document string", "async ({ inputs }) => ({ value: document['cookie'] })"],
			["document number", "async ({ inputs }) => ({ value: document[0] })"],
			["call result", "async ({ inputs }) => ({ value: getThing()[inputs.key], rows: document.querySelectorAll('.row').length })"],
			["member call result", "async ({ inputs }) => ({ value: foo.bar()[inputs.key], rows: document.querySelectorAll('.row').length })"],
			["window authority", "async ({ inputs }) => ({ value: window[name], rows: document.querySelectorAll('.row').length })"],
		];
		for (const [label, source] of rejected) {
			expect(validateReviewedActionCandidate(candidate({ source }) as never), label).toMatchObject({
				ok: false,
				issues: [{ code: "action_capability_computed_property" }],
			});
		}
	});

	test("closed capability audit rejects direct and indirect evasion fixtures", () => {
		const fixtures: Array<[string, string]> = [
			["dynamic", "async ({ inputs }) => eval(inputs.code)"],
			["function-constructor", "async ({ inputs }) => Function('return 1')()"],
			["alias", "async ({ inputs }) => { const d = document; return d.title }"],
			["destructured-alias", "async ({ inputs }) => { const { querySelector } = document; return querySelector('.row') }"],
			["computed", "async ({ inputs }) => document['cookie']"],
			["reflect-computed", "async ({ inputs }) => Reflect.get(document, inputs.key)"],
			["credential", "async ({ inputs }) => ({ otp: inputs.otp })"],
			["cookie", "async ({ inputs }) => document.cookie"],
			["storage", "async ({ inputs }) => localStorage.getItem('x')"],
			["network", "async ({ inputs }) => fetch('/private')"],
			["indirect-network", "async ({ inputs }) => { const send = window.fetch; return send('/private') }"],
			["navigation", "async ({ inputs }) => { location.href = '/next' }"],
			["history-navigation", "async ({ inputs }) => history.pushState({}, '', '/next')"],
			["submission", "async ({ inputs }) => document.querySelector('form').requestSubmit()"],
			["event-submission", "async ({ inputs }) => document.querySelector('form').dispatchEvent(new Event('submit'))"],
		];
		for (const [label, source] of fixtures) {
			const result = validateReviewedActionCandidate(candidate({ source }) as never);
			expect(result.ok, label).toBe(false);
			if (!result.ok) expect(result.issues[0]?.code, label).toStartWith("action_capability_");
		}
	});

	test("template-literal location navigation is contained without requiring a semicolon", () => {
		const result = validateReviewedActionCandidate(
			candidate({
				source:
					"async ({ inputs }) => { document.querySelector('.row'); location.href = `https://other.example/path` }",
				containment: "none",
				required_postcondition: {
					kind: "url-starts-with",
					url: "https://portal.example.test/",
				},
			}) as never,
		);

		expect(result).toMatchObject({
			ok: false,
			issues: [{ code: "action_capability_navigation" }],
		});
	});
});

describe("Reviewed Action candidate lifecycle", () => {
	test("current signed promotion remains authoritative when audit history contains a legacy claim", () => {
		const commit = "1".repeat(40);
		const validation = validateReviewedActionCandidate(candidate() as never);
		if (!validation.ok) throw new Error("fixture candidate failed validation");
		const record = {
			action_id: "count-rows",
			asset_id: validation.digest,
			expected_digest: validation.digest,
			allowed_origin: "https://portal.example.test",
			effect_class: validation.effect_class,
			audited_capabilities: validation.audited_capabilities,
			containment: "read-only-observation",
			input_schema: { kind: "object", fields: {} },
			result_schema: {
				kind: "object",
				fields: {
					rows: {
						required: true,
						schema: { kind: "number", integer: true },
					},
				},
			},
			result_sensitivity: "low",
			source_provenance: "authored:count-rows",
			promotion_receipt: null,
		};
		const derived = reviewedActionApprovalFactsFromRecord({
			commit,
			record: record as never,
			assetBytes: READ_SOURCE,
		});
		if (!derived.ok) throw new Error(derived.code);
		const unsigned = {
			...derived.facts,
			receipt_id: "receipt-current",
			approval_reference: "review-current",
			issued_at_epoch_ms: 1_000,
			verifier_key_id: "test-key",
		};
		const verifier = createReviewedActionApprovalVerifier({
			verifier: {
				key_id: "test-key",
				public_key: "TEST-ONLY-PUBLIC-KEY",
			},
			verifySignature: ({ digest, signature }) =>
				signature === `TEST:${digest}`,
		});
		record.promotion_receipt = {
			contract: "browser-use.reviewed-action-promotion",
			schema_version: "1",
			disposition: "approved",
			presence_backed: true,
			...unsigned,
			signature: `TEST:${reviewedActionApprovalFactsDigest(unsigned)}`,
		} as never;

		expect(
			verifyAuthoredReviewedActionPromotion({
				commit: "2".repeat(40),
				record: record as never,
				assetBytes: READ_SOURCE,
				promotionHistory: [
					{
						approved_digest: validation.digest,
						disposition: "approved",
						approved_origin: "https://portal.example.test",
						approved_effect: "read",
						approver_ref: "legacy-review",
					},
				],
				verifier,
			}),
		).toMatchObject({
			ok: true,
			receipt_id: "receipt-current",
			approval_reference: "review-current",
		});
	});

	test("operator promotion reads committed exact bytes and admits only verified receipt drift for a same-commit batch", async () => {
		const sourceRoot = await sourceFixture();
		const applied = await applyReviewedActionCandidate({ sourceRoot, candidate: candidate() as never });
		if (!applied.ok) throw new Error(applied.message);
		const second = await applyReviewedActionCandidate({ sourceRoot, candidate: candidate({ action_id: "count-more-rows" }) as never });
		if (!second.ok) throw new Error(second.message);
		await git(sourceRoot, "init", "-q");
		await git(sourceRoot, "add", "skills/browser-use/actions/registry.json", `skills/browser-use/actions/assets/${applied.digest}.js`);
		await git(sourceRoot, "commit", "-qm", "candidate");
		const commit = await git(sourceRoot, "rev-parse", "HEAD");
		const verifier = createReviewedActionApprovalVerifier({
			verifier: { key_id: "test-key", public_key: "TEST-ONLY-PUBLIC-KEY" },
			verifySignature: ({ digest, signature }) => signature === `TEST:${digest}`,
		});
		const router = createReviewedActionPromotionRouter({
			verifier,
			broker: {
				async issueReviewedActionPromotion(input) {
					const unsigned = {
						...input.facts,
						receipt_id: `receipt-${input.facts.action_id}`,
						approval_reference: input.approval_reference,
						issued_at_epoch_ms: 1_000,
						verifier_key_id: "test-key",
					};
					return {
						ok: true as const,
						receipt: {
							contract: "browser-use.reviewed-action-promotion" as const,
							schema_version: "1" as const,
							disposition: "approved" as const,
							presence_backed: true as const,
							...unsigned,
							signature: `TEST:${reviewedActionApprovalFactsDigest(unsigned)}`,
						},
					};
				},
			},
		});
		const promoted = await promoteReviewedActionCandidate({
			sourceRoot,
			actionId: "count-rows",
			approvalReference: "review-1",
			router,
			verifier,
		});
		expect(promoted).toMatchObject({ ok: true, source_commit: commit, receipt_id: "receipt-count-rows" });
		const promotedSecond = await promoteReviewedActionCandidate({
			sourceRoot,
			actionId: "count-more-rows",
			approvalReference: "review-2",
			router,
			verifier,
		});
		expect(promotedSecond).toMatchObject({ ok: true, source_commit: commit, receipt_id: "receipt-count-more-rows" });
		const registry = JSON.parse(await readFile(join(sourceRoot, "skills/browser-use/actions/registry.json"), "utf8"));
		expect(registry.actions.map((entry: { record: { promotion_receipt: unknown } }) => entry.record.promotion_receipt)).toEqual([
			expect.objectContaining({ source_commit: commit, approved_digest: applied.digest }),
			expect.objectContaining({ source_commit: commit, approved_digest: second.digest }),
		]);
	});

	test("apply creates one unpromoted digest and complete identical apply is a no-op", async () => {
		const sourceRoot = await sourceFixture();
		const first = await applyReviewedActionCandidate({ sourceRoot, candidate: candidate() as never });
		expect(first).toMatchObject({ ok: true, changed: true, promotion_state: "unpromoted" });
		if (!first.ok) return;
		const second = await applyReviewedActionCandidate({ sourceRoot, candidate: candidate() as never });
		expect(second).toMatchObject({ ok: true, changed: false, digest: first.digest, promotion_state: "unpromoted" });
		const registry = JSON.parse(await readFile(join(sourceRoot, "skills/browser-use/actions/registry.json"), "utf8"));
		expect(registry.actions).toHaveLength(1);
		expect(registry.actions[0].record.promotion_receipt).toBeNull();
	});

	test("same bytes with changed schema metadata is a replacement, not an identical no-op", async () => {
		const sourceRoot = await sourceFixture();
		const first = await applyReviewedActionCandidate({ sourceRoot, candidate: candidate() as never });
		if (!first.ok) throw new Error("fixture apply failed");
		const changedSchema = candidate({ input_schema: { kind: "object", fields: { limit: { required: false, schema: { kind: "number", integer: true } } } } });
		expect(await applyReviewedActionCandidate({ sourceRoot, candidate: changedSchema as never })).toMatchObject({ ok: false, code: "action_replacement_digest_required" });
		expect(await applyReviewedActionCandidate({ sourceRoot, candidate: changedSchema as never, expectedRecordDigest: first.record_digest })).toMatchObject({ ok: true, changed: true, digest: first.digest });
	});

	test("secret-shaped candidate is refused before asset or registry persistence", async () => {
		const sourceRoot = await sourceFixture();
		for (const secretCandidate of [
			candidate({ result_schema: { kind: "string", pattern: "wss://private-endpoint" } }),
			candidate({
				source:
					"async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length, reference: 'op://vault/item/field' })",
			}),
			candidate({
				source:
					"async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length, reference: '/Users/example/private.txt' })",
			}),
		]) {
			const result = await applyReviewedActionCandidate({
				sourceRoot,
				candidate: secretCandidate as never,
			});
			expect(result).toMatchObject({
				ok: false,
				code: "action_secret_shaped_material",
			});
		}
		const registry = JSON.parse(await readFile(join(sourceRoot, "skills/browser-use/actions/registry.json"), "utf8"));
		expect(registry.actions).toEqual([]);
		expect(await readFile(join(sourceRoot, "skills/browser-use/actions/assets"), "utf8").catch(() => undefined)).toBeUndefined();
	});

	test("changed bytes can change the audited effect and remain unpromoted", async () => {
		const sourceRoot = await sourceFixture();
		const first = await applyReviewedActionCandidate({ sourceRoot, candidate: candidate() as never });
		if (!first.ok) throw new Error("fixture apply failed");
		const mutation = candidate({
			source: "async ({ inputs }) => document.querySelector('.save').click()",
			containment: "none",
			required_postcondition: { kind: "element-visible", selector: ".saved" },
		});
		const changed = await applyReviewedActionCandidate({ sourceRoot, candidate: mutation as never, expectedRecordDigest: first.record_digest });
		expect(changed).toMatchObject({ ok: true, changed: true, effect_class: "mutation", promotion_state: "unpromoted" });
	});

	test("replacement requires the exact observed record digest", async () => {
		const sourceRoot = await sourceFixture();
		const first = await applyReviewedActionCandidate({ sourceRoot, candidate: candidate() as never });
		if (!first.ok) throw new Error("fixture apply failed");
		const changed = candidate({ source: "async ({ inputs }) => ({ count: document.querySelectorAll('.item').length })" });
		expect(await applyReviewedActionCandidate({ sourceRoot, candidate: changed as never })).toMatchObject({ ok: false, code: "action_replacement_digest_required" });
		expect(await applyReviewedActionCandidate({ sourceRoot, candidate: changed as never, expectedRecordDigest: "f".repeat(64) })).toMatchObject({ ok: false, code: "action_replacement_digest_stale" });
		expect(await applyReviewedActionCandidate({ sourceRoot, candidate: changed as never, expectedRecordDigest: first.record_digest })).toMatchObject({ ok: true, changed: true, promotion_state: "unpromoted" });
	});

	test("changed bytes preserve all prior signed receipt history", async () => {
		const sourceRoot = await sourceFixture();
		const first = await applyReviewedActionCandidate({ sourceRoot, candidate: candidate() as never });
		if (!first.ok) throw new Error("fixture apply failed");
		const registryPath = join(sourceRoot, "skills/browser-use/actions/registry.json");
		const registry = JSON.parse(await readFile(registryPath, "utf8"));
		const oldReceipt = { contract: "browser-use.reviewed-action-promotion", schema_version: "1", receipt_id: "receipt-old", disposition: "approved", source_commit: "1".repeat(40), action_id: "count-rows", approved_digest: first.digest, approved_origin: "https://portal.example.test", approved_effect: "read", audited_capabilities: ["dom-query", "dom-read"], containment: "read-only-observation", input_schema_digest: "2".repeat(64), result_schema_digest: "3".repeat(64), postcondition_digest: null, approval_reference: "review-1", presence_backed: true, issued_at_epoch_ms: 1, verifier_key_id: "test-key", signature: "TEST-SIGNATURE" };
		registry.actions[0].record.promotion_receipt = oldReceipt;
		registry.actions[0].promotion_history = [{ ...oldReceipt, receipt_id: "receipt-earlier" }];
		await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
		const identical = await applyReviewedActionCandidate({ sourceRoot, candidate: candidate() as never });
		expect(identical).toMatchObject({ ok: true, changed: false, promotion_state: "promotion-claim-present" });
		const afterIdentical = JSON.parse(await readFile(registryPath, "utf8"));
		expect(afterIdentical.actions[0].record.promotion_receipt).toEqual(oldReceipt);
		expect(afterIdentical.actions[0].promotion_history).toEqual([{ ...oldReceipt, receipt_id: "receipt-earlier" }]);
		const observed = new Bun.CryptoHasher("sha256").update(JSON.stringify(registry.actions[0].record)).digest("hex");
		const applied = await applyReviewedActionCandidate({ sourceRoot, candidate: candidate({ source: "async ({ inputs }) => ({ count: document.querySelectorAll('.item').length })" }) as never, expectedRecordDigest: observed });
		expect(applied.ok).toBe(true);
		const after = JSON.parse(await readFile(registryPath, "utf8"));
		expect(after.actions[0].record.promotion_receipt).toBeNull();
		expect(after.actions[0].promotion_history).toEqual([{ ...oldReceipt, receipt_id: "receipt-earlier" }, oldReceipt]);
	});
});
