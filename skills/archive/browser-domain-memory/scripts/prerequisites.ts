/**
 * Prerequisite inventory + pure check functions for browser-domain-memory.
 *
 * This module owns the deterministic contract for "what must exist before
 * browser-domain-memory runtime implementation (active plan U1/U1a/U2+) begins":
 *
 *  - prototype evidence the later units lift code from,
 *  - root deterministic-replay runtime dependencies, and
 *  - the script-local private facade package.
 *
 * Prose docs point at this list; they do not duplicate it. The CLI gate
 * (`preflight-prerequisites.ts`) consumes these checks and renders results.
 */

import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Repo root, derived from this file's location (skills/<skill>/scripts). */
export const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "../../..");

/** Directory of the browser-domain-memory script-local package. */
export const SCRIPT_DIR = join(
	REPO_ROOT,
	"skills",
	"browser-domain-memory",
	"scripts",
);

/**
 * A required prototype source named by the active plan's U0/Sources.
 *
 * `path` is repo-relative. `reason` records why a later unit needs it, so a
 * missing-source failure can name both the path and what it blocks.
 */
export type PrototypeSource = {
	readonly id: string;
	readonly path: string;
	readonly reason: string;
};

/**
 * Required prototype evidence. The active plan's U1 approach enumerates these
 * by capability; each maps to a directory under one of the two restored roots.
 * Keep this list aligned with `docs/plans/2026-05-31-001-feat-browser-domain-memory-plan.md`.
 */
export const REQUIRED_PROTOTYPE_SOURCES: readonly PrototypeSource[] = [
	{
		id: "browser-use-uplift-root",
		path: "prototypes/browser-use-uplift",
		reason: "Root of the browser-use uplift prototype set later units lift from.",
	},
	{
		id: "build-scratch-handoff-root",
		path: "prototypes/build-scratch-handoff",
		reason: "Root of the build-scratch/handoff prototype set.",
	},
	{
		id: "recorder-json",
		path: "prototypes/browser-use-uplift/recorder-json",
		reason: "Recorder JSON build/replay reference for deterministic mode.",
	},
	{
		id: "booking-flow",
		path: "prototypes/browser-use-uplift/booking-furdo",
		reason: "End-to-end booking flow capture reference.",
	},
	{
		id: "runbook-dual",
		path: "prototypes/browser-use-uplift/runbook-dual",
		reason: "Runbook dual-output projection reference.",
	},
	{
		id: "self-healing",
		path: "prototypes/browser-use-uplift/self-healing",
		reason: "Self-healing selector reference.",
	},
	{
		id: "consult-gate",
		path: "prototypes/browser-use-uplift/consult-gate",
		reason: "Human-consult gate reference.",
	},
	{
		id: "capture-verify",
		path: "prototypes/browser-use-uplift/capture-verify",
		reason: "Capture verification reference.",
	},
	{
		id: "staleness",
		path: "prototypes/browser-use-uplift/staleness",
		reason: "Staleness detection reference.",
	},
	{
		id: "provenance",
		path: "prototypes/browser-use-uplift/provenance",
		reason: "Provenance recording reference.",
	},
	{
		id: "reliable-submit",
		path: "prototypes/browser-use-uplift/reliable-submit",
		reason: "Reliable submit reference.",
	},
	{
		id: "live-auth",
		path: "prototypes/browser-use-uplift/live-auth",
		reason: "Live auth pointer reference.",
	},
	{
		id: "success-verify",
		path: "prototypes/browser-use-uplift/success-verify",
		reason: "Success verification reference.",
	},
	{
		id: "op-auth",
		path: "prototypes/browser-use-uplift/op-auth",
		reason: "1Password-backed auth reference.",
	},
	{
		id: "lifecycle",
		path: "prototypes/browser-use-uplift/lifecycle",
		reason: "Capture lifecycle reference.",
	},
	{
		id: "journal-tidy",
		path: "prototypes/browser-use-uplift/journal-tidy",
		reason: "Journal tidy reference.",
	},
	{
		id: "crash-safety",
		path: "prototypes/browser-use-uplift/crash-safety",
		reason: "Crash-safety reference.",
	},
	{
		id: "parallel-spike",
		path: "prototypes/browser-use-uplift/parallel-spike",
		reason: "Parallel-run spike reference.",
	},
	{
		id: "metrics",
		path: "prototypes/browser-use-uplift/metrics-real",
		reason: "Metrics reference (representative of the metrics-* group).",
	},
];

/** A single prerequisite check result. */
export type CheckResult = {
	readonly ok: boolean;
	/** Stable id (source id, package name) for machine consumers. */
	readonly id: string;
	/** Human/agent-facing detail: present version, missing path, or repair hint. */
	readonly detail: string;
};

async function pathExists(absolutePath: string): Promise<boolean> {
	try {
		await stat(absolutePath);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve and check every required prototype source.
 *
 * Returns one {@link CheckResult} per source. A missing source carries
 * `ok: false` and a detail that names the exact repo-relative path so a stop
 * message can point the next agent at the missing evidence (R2).
 *
 * @param repoRoot Override the repo root (tests stub a temp tree here).
 */
export async function checkPrototypeEvidence(
	repoRoot: string = REPO_ROOT,
): Promise<CheckResult[]> {
	return Promise.all(
		REQUIRED_PROTOTYPE_SOURCES.map(async (source) => {
			const absolute = join(repoRoot, source.path);
			const exists = await pathExists(absolute);
			return {
				ok: exists,
				id: source.id,
				detail: exists
					? `present: ${source.path}`
					: `missing prototype source: ${source.path} (${source.reason})`,
			} satisfies CheckResult;
		}),
	);
}

/** True when every result is ok. */
export function allOk(results: readonly CheckResult[]): boolean {
	return results.every((result) => result.ok);
}
