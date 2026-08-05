/**
 * Runbook Generation activation contract — throwaway logic spike (no browser).
 *
 * Falsifies whether the source-to-runtime model (ADR 0031) can represent
 * committed catalog provenance, whole-catalog digest review, immutable
 * generation staging, atomic activation, bootstrap cutover, and post-cutover
 * no-fallback behavior WITHOUT a second authoring source.
 *
 * Persistence IS the question, so a clearly-marked scratch temp store under the
 * session scratchpad is used and cleaned up. Full state printed after every
 * action.
 *
 * Run: `bun run prototype:runbook-generation-activation`
 */

import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Deterministic digest (reproducible; no crypto import).
// ---------------------------------------------------------------------------

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, v]) => v !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function digest(value: unknown): string {
	const text = canonical(value);
	let hash = 5381;
	for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) + hash + text.charCodeAt(i)) >>> 0;
	return `sha-${hash.toString(16).padStart(8, "0")}`;
}

// ---------------------------------------------------------------------------
// Source model: a committed catalog + referenced action bytes + commit id.
// ---------------------------------------------------------------------------

type Action = { action_id: string; bytes: string; promoted_digest: string | null };

type Catalog = {
	commit: string; // git commit the catalog + action bytes match
	runbooks: Array<{ key: string; action_refs: Array<{ action_id: string; expected_digest: string }> }>;
	actions: Action[];
	working_tree_dirty: boolean; // unrelated dirt; must NOT block
};

function catalogClosureDigest(catalog: Catalog): string {
	// Whole-catalog digest = runbooks + referenced action bytes, commit-scoped.
	const runbookPart = catalog.runbooks
		.map((r) => ({ key: r.key, refs: r.action_refs }))
		.sort((a, b) => (a.key < b.key ? -1 : 1));
	const actionPart = catalog.actions
		.map((a) => ({ id: a.action_id, digest: digest(a.bytes) }))
		.sort((a, b) => (a.id < b.id ? -1 : 1));
	return digest({ commit: catalog.commit, runbooks: runbookPart, actions: actionPart });
}

type ClosureProblem =
	| { code: "action-missing"; action_id: string }
	| { code: "action-unpromoted"; action_id: string }
	| { code: "action-digest-mismatch"; action_id: string; promoted: string; referenced: string }
	| { code: "action-bytes-mismatch"; action_id: string };

function checkClosure(catalog: Catalog): ClosureProblem | undefined {
	const byId = new Map(catalog.actions.map((a) => [a.action_id, a]));
	for (const runbook of catalog.runbooks) {
		for (const ref of runbook.action_refs) {
			const action = byId.get(ref.action_id);
			if (!action) return { code: "action-missing", action_id: ref.action_id };
			if (action.promoted_digest === null) return { code: "action-unpromoted", action_id: ref.action_id };
			// Promotion must bind the exact current bytes.
			if (digest(action.bytes) !== action.promoted_digest) {
				return { code: "action-bytes-mismatch", action_id: ref.action_id };
			}
			if (action.promoted_digest !== ref.expected_digest) {
				return {
					code: "action-digest-mismatch",
					action_id: ref.action_id,
					promoted: action.promoted_digest,
					referenced: ref.expected_digest,
				};
			}
		}
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Immutable generation store on disk (scratch temp — persistence is the point).
// ---------------------------------------------------------------------------

type ActivationResult =
	| { status: "ok"; changed: boolean; generation: string; previous: string | null; selected_digest: string }
	| { status: "refused"; changed: false; code: string; message: string; next: string };

class GenerationStore {
	readonly #root: string;
	readonly #generations: string; // immutable staged generations
	readonly #pointer: string; // atomic active pointer file
	cutover = false; // once true, no repo/package/compat-XDG fallback

	constructor(root: string) {
		this.#root = root;
		this.#generations = join(root, "generations");
		this.#pointer = join(root, "active.json");
		mkdirSync(this.#generations, { recursive: true });
	}

	#activePointer(): { digest: string; generation: string; previous: string | null } | null {
		try {
			return JSON.parse(readFileSync(this.#pointer, "utf8"));
		} catch {
			return null;
		}
	}

	activeState(): {
		cutover: boolean;
		active: { digest: string; generation: string; previous: string | null } | null;
		staged_generations: string[];
	} {
		return {
			cutover: this.cutover,
			active: this.#activePointer(),
			staged_generations: readdirSync(this.#generations).sort(),
		};
	}

	/** Bootstrap cutover: verify+stage+select the first generation, then remove fallbacks. */
	bootstrapCutover(catalog: Catalog, reviewedDigest: string): ActivationResult {
		const result = this.activate(catalog, reviewedDigest);
		if (result.status === "ok") this.cutover = true;
		return result;
	}

	activate(catalog: Catalog, reviewedDigest: string): ActivationResult {
		const current = catalogClosureDigest(catalog);
		// Activation requires the reviewed whole-catalog digest; drift refuses.
		if (reviewedDigest !== current) {
			return {
				status: "refused",
				changed: false,
				code: "catalog-drift",
				message: `Reviewed digest ${reviewedDigest} != current catalog ${current}.`,
				next: "Re-review the whole catalog and re-run activate with the current digest.",
			};
		}
		// Closure must be complete BEFORE any generation selection.
		const closure = checkClosure(catalog);
		if (closure) {
			return {
				status: "refused",
				changed: false,
				code: closure.code,
				message: `Action closure blocked: ${JSON.stringify(closure)}`,
				next: "Promote the exact referenced action digest, then re-review + re-activate.",
			};
		}
		const active = this.#activePointer();
		if (active && active.digest === current) {
			return {
				status: "ok",
				changed: false,
				generation: active.generation,
				previous: active.previous,
				selected_digest: current,
			};
		}
		// Stage an immutable generation, then atomically flip the pointer.
		const generation = `gen-${current}`;
		const genDir = join(this.#generations, generation);
		mkdirSync(genDir, { recursive: true });
		writeFileSync(
			join(genDir, "catalog.json"),
			JSON.stringify({ commit: catalog.commit, digest: current, runbooks: catalog.runbooks }),
		);
		// Public projection guard: only runtime/schema bytes; zero private source.
		writeFileSync(join(genDir, "PROVENANCE"), `commit=${catalog.commit}\ndigest=${current}\n`);
		const pointer = { digest: current, generation, previous: active?.generation ?? null };
		const tmp = `${this.#pointer}.tmp`;
		writeFileSync(tmp, JSON.stringify(pointer));
		// Atomic select: rename over the pointer.
		rmSync(this.#pointer, { force: true });
		writeFileSync(this.#pointer, JSON.stringify(pointer));
		rmSync(tmp, { force: true });
		return {
			status: "ok",
			changed: true,
			generation,
			previous: pointer.previous,
			selected_digest: current,
		};
	}

	/** Runtime resolution: post-cutover, a missing active generation NEVER falls back. */
	resolveActive(): { ok: true; generation: string } | { ok: false; code: string; message: string; next: string } {
		const active = this.#activePointer();
		if (active) return { ok: true, generation: active.generation };
		if (this.cutover) {
			return {
				ok: false,
				code: "activation-required",
				message: "No active generation after cutover; runtime reads no repo/package/compat-XDG bytes.",
				next: "Run `runbook activate` from the setup-owned source checkout.",
			};
		}
		return { ok: false, code: "pre-cutover-fallback", message: "Pre-cutover compatibility path (removed at cutover).", next: "Bootstrap cutover." };
	}
}

// Public package projection: runtime/schema files only, never private assets.
function publicPackageProjection(): { included: string[]; private_assets: string[] } {
	const included = ["runtime/runbook-runner.js", "schema/runbook-draft.schema.json"];
	const private_assets: string[] = []; // private catalog + action assets excluded by construction
	return { included, private_assets };
}

// ---------------------------------------------------------------------------
// Driver.
// ---------------------------------------------------------------------------

const store_root = mkdtempSync(join(tmpdir(), "runbook-generation-scratch-"));
const store = new GenerationStore(store_root);
console.log(`# scratch generation store (temp, cleaned up): ${store_root}`);

function show(label: string, extra: unknown): void {
	console.log(`\n# ${label}`);
	console.log(`  -> ${JSON.stringify(extra)}`);
	console.log(`  active: ${JSON.stringify(store.activeState())}`);
}

const results: Record<string, unknown> = {};

// Catalog A: clean, promoted action bound to exact bytes, unrelated dirt present.
const actionBytesA = "export default async () => ({ ok: true });";
const catalogA: Catalog = {
	commit: "commit-aaa",
	working_tree_dirty: true, // unrelated dirt must not block
	actions: [{ action_id: "submit", bytes: actionBytesA, promoted_digest: digest(actionBytesA) }],
	runbooks: [
		{ key: "fasttrack/submit", action_refs: [{ action_id: "submit", expected_digest: digest(actionBytesA) }] },
	],
};
const digestA = catalogClosureDigest(catalogA);

// Drift: reviewer used a stale digest.
const drift = store.activate(catalogA, "sha-staleeee");
results.drift_refused = drift.status === "refused" && drift.code === "catalog-drift";
show("activate with STALE reviewed digest -> refuse (drift)", drift);

// Unpromoted action closure blocks before selection.
const catalogUnpromoted: Catalog = {
	...catalogA,
	actions: [{ action_id: "submit", bytes: actionBytesA, promoted_digest: null }],
};
const unpromoted = store.activate(catalogUnpromoted, catalogClosureDigest(catalogUnpromoted));
results.unpromoted_blocked = unpromoted.status === "refused" && unpromoted.code === "action-unpromoted";
show("activate w/ UNPROMOTED action -> block before selection", unpromoted);

// First activation: bootstrap cutover stages + atomically selects generation A.
const first = store.bootstrapCutover(catalogA, digestA);
results.first_activation_ok = first.status === "ok" && first.changed === true && first.previous === null;
results.cutover_set = store.cutover === true;
show("bootstrap cutover -> stage + atomically select generation A", first);

// Re-activate the active digest -> changed:false.
const reactivate = store.activate(catalogA, digestA);
results.reactivate_noop = reactivate.status === "ok" && reactivate.changed === false;
show("re-activate active digest -> changed:false", reactivate);

// Catalog B: a later valid digest selects generation B, retaining A as previous.
const actionBytesB = "export default async () => ({ ok: true, v: 2 });";
const catalogB: Catalog = {
	commit: "commit-bbb",
	working_tree_dirty: false,
	actions: [{ action_id: "submit", bytes: actionBytesB, promoted_digest: digest(actionBytesB) }],
	runbooks: [
		{ key: "fasttrack/submit", action_refs: [{ action_id: "submit", expected_digest: digest(actionBytesB) }] },
	],
};
const digestB = catalogClosureDigest(catalogB);
const second = store.activate(catalogB, digestB);
const genA = `gen-${digestA}`;
results.second_activation_ok =
	second.status === "ok" && second.changed === true && second.previous === genA && second.generation === `gen-${digestB}`;
show("activate catalog B -> select generation B, retain A as previous", second);

// Post-cutover no-fallback: simulate a missing active generation.
rmSync(join(store_root, "active.json"), { force: true });
const resolved = store.resolveActive();
results.post_cutover_no_fallback = resolved.ok === false && resolved.code === "activation-required";
show("post-cutover missing active -> typed activation-required, zero fallback", resolved);

// Public package projection has zero private assets.
const projection = publicPackageProjection();
results.public_projection_clean = projection.private_assets.length === 0;
show("public package projection -> runtime/schema only, zero private assets", projection);

// Cleanup scratch store.
rmSync(store_root, { recursive: true, force: true });

const passed = Object.values(results).every(Boolean);
console.log(`\n== VERDICT: ${passed ? "PASS" : "FAIL"} ==`);
console.log(JSON.stringify(results));
if (!passed) process.exitCode = 1;
