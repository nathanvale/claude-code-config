import { describe, expect, test } from "bun:test";
import type { Registry, Worktree } from "./model.ts";
import {
	assignColor,
	computeHash,
	guessFocus,
	isDrift,
	readHeaderHash,
	renderWorkspace,
	stampHeader,
} from "./wt-engine.ts";

const twoWorktrees: Worktree[] = [
	{ path: "/code/repo-a", branch: "codex/browser-use-refactor" },
	{ path: "/code/repo-b", branch: "codex/harden-test-runner" },
];

describe("renderWorkspace", () => {
	test("renders WIP folder first, then a focus pair per worktree", () => {
		const registry: Registry = {
			branches: {
				"codex/browser-use-refactor": { focus: "skills/browser-use", color: "blue" },
				"codex/harden-test-runner": { focus: "skills/test-runner", color: "green" },
			},
			defaults: { wip: "/code/_wip" },
		};
		const ws = renderWorkspace(registry, twoWorktrees, () => true);

		expect(ws.folders[0]).toEqual({ name: "📌 WIP", path: "/code/_wip" });
		expect(ws.folders[1]).toEqual({
			name: "🌐 browser-use-refactor",
			path: "/code/repo-a/skills/browser-use",
		});
		expect(ws.folders[2]).toEqual({ name: "📁 browser-use-refactor repo", path: "/code/repo-a" });
		expect(ws.folders[3]).toEqual({
			name: "🌐 harden-test-runner",
			path: "/code/repo-b/skills/test-runner",
		});
	});

	test("mirrors files.exclude into search.exclude and enables fileNesting", () => {
		const ws = renderWorkspace({ branches: {} }, [], () => false);
		expect(ws.settings["files.exclude"]).toEqual(ws.settings["search.exclude"]);
		expect(ws.settings["explorer.fileNesting.enabled"]).toBe(true);
	});

	test("zero worktrees with no WIP renders an empty folder list", () => {
		const ws = renderWorkspace({ branches: {} }, [], () => false);
		expect(ws.folders).toEqual([]);
	});

	test("worktree with no resolvable focus renders a single full-repo folder", () => {
		const ws = renderWorkspace(
			{ branches: {} },
			[{ path: "/code/repo-x", branch: "main" }],
			() => false,
		);
		expect(ws.folders).toEqual([{ name: "📁 main", path: "/code/repo-x" }]);
	});
});

describe("assignColor", () => {
	test("returns the explicit pref when set", () => {
		expect(assignColor("codex/x", { color: "teal" })).toBe("teal");
	});

	test("is deterministic across calls for the same branch", () => {
		const first = assignColor("codex/some-branch", undefined);
		const second = assignColor("codex/some-branch", undefined);
		expect(first).toBe(second);
	});
});

describe("guessFocus", () => {
	test("strips type prefix and role suffix, probes skills/<stem>", () => {
		const focus = guessFocus(
			"codex/harden-test-runner",
			undefined,
			(p) => p === "skills/test-runner",
		);
		expect(focus).toBe("skills/test-runner");
	});

	test("falls back to repo root when the probe finds nothing", () => {
		expect(guessFocus("codex/unknown-thing", undefined, () => false)).toBe("");
	});

	test("honors an explicit focus pref over the guess", () => {
		expect(guessFocus("codex/x", { focus: "packages/y" }, () => false)).toBe("packages/y");
	});
});

describe("drift detection", () => {
	test("stampHeader round-trips: readHeaderHash recovers the stamped hash", () => {
		const ws = renderWorkspace({ branches: {} }, twoWorktrees, () => true);
		const text = stampHeader(ws);
		expect(readHeaderHash(text)).not.toBeNull();
		expect(isDrift(text)).toBe(false);
	});

	test("an edited body drifts from the recorded header hash", () => {
		const ws = renderWorkspace({ branches: {} }, twoWorktrees, () => true);
		const text = stampHeader(ws);
		const edited = text.replace("repo-a", "repo-EDITED");
		expect(isDrift(edited)).toBe(true);
	});

	test("a file with no wt header is treated as drifted", () => {
		expect(isDrift('{ "folders": [] }')).toBe(true);
		expect(readHeaderHash('{ "folders": [] }')).toBeNull();
	});

	test("computeHash is stable for identical input and shifts on change", () => {
		expect(computeHash("abc")).toBe(computeHash("abc"));
		expect(computeHash("abc")).not.toBe(computeHash("abd"));
	});
});
