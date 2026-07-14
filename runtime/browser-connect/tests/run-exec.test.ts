import { describe, expect, test } from "bun:test";

// ===========================================================================
// U7 `--`-boundary parser — pure unit tests, written BEFORE the parser body.
//
// The split has no repo precedent. These tests pin the split semantics that the
// dispatcher (cli.ts) and run-exec (spawn/passthrough) both depend on:
//   - split at the FIRST `--` only
//   - head = adapter id + browser-connect flags (parsed as browser-connect argv)
//   - tail = wrapped command VERBATIM (never scanned for --help/--version/flags)
//   - absence of `--` → a missing-separator outcome (exit 2 upstream)
// ===========================================================================

import { splitRunArgv } from "../src/run-exec.ts";

describe("splitRunArgv: the -- boundary parser (R1/R17)", () => {
	test("splits at the first -- ; head before, tail after, verbatim", () => {
		const result = splitRunArgv([
			"agent-browser",
			"--run-id",
			"abc",
			"--",
			"agent-browser",
			"snapshot",
		]);
		expect(result.kind).toBe("split");
		if (result.kind !== "split") throw new Error("unreachable");
		expect(result.head).toEqual(["agent-browser", "--run-id", "abc"]);
		expect(result.tail).toEqual(["agent-browser", "snapshot"]);
	});

	test("absence of -- → missing-separator outcome", () => {
		const result = splitRunArgv(["agent-browser", "agent-browser", "snapshot"]);
		expect(result.kind).toBe("missing-separator");
	});

	test("splits at the FIRST -- ; a wrapped command's own -- passes through in the tail verbatim", () => {
		const result = splitRunArgv([
			"agent-browser",
			"--",
			"some-tool",
			"--flag",
			"--",
			"nested",
		]);
		expect(result.kind).toBe("split");
		if (result.kind !== "split") throw new Error("unreachable");
		expect(result.head).toEqual(["agent-browser"]);
		// Everything after the first -- is verbatim, INCLUDING the wrapped tool's
		// own -- separator and its trailing tokens.
		expect(result.tail).toEqual(["some-tool", "--flag", "--", "nested"]);
	});

	test("the tail may legitimately contain --help / --version / unknown flags; the split does not scan them", () => {
		const result = splitRunArgv([
			"agent-browser",
			"--",
			"wrapped-tool",
			"--help",
			"--version",
			"--totally-unknown",
		]);
		expect(result.kind).toBe("split");
		if (result.kind !== "split") throw new Error("unreachable");
		expect(result.head).toEqual(["agent-browser"]);
		expect(result.tail).toEqual([
			"wrapped-tool",
			"--help",
			"--version",
			"--totally-unknown",
		]);
	});

	test("an empty tail (-- with nothing after) is a split with an empty tail, not missing-separator", () => {
		const result = splitRunArgv(["agent-browser", "--"]);
		expect(result.kind).toBe("split");
		if (result.kind !== "split") throw new Error("unreachable");
		expect(result.head).toEqual(["agent-browser"]);
		expect(result.tail).toEqual([]);
	});

	test("a leading -- (no head) still splits; head is empty", () => {
		const result = splitRunArgv(["--", "wrapped-tool", "arg"]);
		expect(result.kind).toBe("split");
		if (result.kind !== "split") throw new Error("unreachable");
		expect(result.head).toEqual([]);
		expect(result.tail).toEqual(["wrapped-tool", "arg"]);
	});
});

describe("applyInjection: endpoint injection into the wrapped command (R1)", () => {
	test("prepends the adapter's injection argv immediately after the wrapped executable", async () => {
		const { applyInjection } = await import("../src/run-exec.ts");
		const applied = applyInjection(
			["wrapped-tool", "user-arg"],
			{ argv: ["--cdp", "ws://127.0.0.1:9222/x"] },
			{ EXISTING: "1" },
		);
		// The wrapped executable stays first; the injected flags follow it, then the
		// caller's own args. env merges the injection env over the base env.
		expect(applied.command).toBe("wrapped-tool");
		expect(applied.args).toEqual([
			"--cdp",
			"ws://127.0.0.1:9222/x",
			"user-arg",
		]);
		expect(applied.env.EXISTING).toBe("1");
	});

	test("merges the adapter injection env over the base env", async () => {
		const { applyInjection } = await import("../src/run-exec.ts");
		const applied = applyInjection(
			["wrapped-tool"],
			{ argv: [], env: { AGENT_BROWSER_CDP: "ws://127.0.0.1:9222/x" } },
			{ PATH: "/usr/bin" },
		);
		expect(applied.command).toBe("wrapped-tool");
		expect(applied.args).toEqual([]);
		expect(applied.env.PATH).toBe("/usr/bin");
		expect(applied.env.AGENT_BROWSER_CDP).toBe("ws://127.0.0.1:9222/x");
	});
});
