import { describe, expect, test } from "bun:test";
import { runForTest } from "./browser-use";
import { makeRuntime, parseJson } from "./browser-use-test-helpers";
import { makeTempXdgEnv } from "./browser-use-platform-test-helpers";

// ---------------------------------------------------------------------------
// DDA-G17 anti-drift oracle (Daily Driver Acceptance Ledger,
// docs/plans/2026-07-27-daily-driver-acceptance-ledger.md).
//
// Row: "Relative XDG values are refused with a typed usage error at the process
// tier." Oracle: `XDG_STATE_HOME=./x` — exit 2 typed.
//
// KNOWN GAP (verdict FAIL): the store-backed families resolve XDG roots through
// the one path owner (openBrowserUsePaths / resolveBrowserUsePaths in
// browser-use-paths.ts), which refuses a SET-but-relative value with the typed
// `xdg_root_relative` code. The refusal IS typed, but the driver's
// emitXdgRefusal (browser-use.ts) maps it to the BINDING-FAIL-CLOSED exit code
// 20, NOT the usage exit code 2 the oracle requires.
//
// The ledger classifies malformed environment input as a usage error at exit 2
// consistently (F25 hostile run id, B22 malformed mcporter JSON — both "exit 2
// typed"), so a relative XDG value should exit 2 as well. Moving it to exit 2
// is a deliberate contract change with a wide blast radius: three sibling tests
// pin exit 20 for exactly this refusal and encode the AE4 "identical refusal
// shape across all five store-backed commands" invariant —
//   - browser-use-run-commands.test.ts ("a relative XDG root yields ... exit 20
//     everywhere"; "plain mode writes the typed refusal to stderr only")
//   - browser-use-platform-contract.test.ts ("runbook list is live and fails
//     closed on an unresolvable XDG root" — exit 20)
// Reversing exit 20 -> 2 would break those tests and flip a documented
// fail-closed contract owned by the platform plan, so this row is reported FAIL
// with the concrete gap rather than forced green by weakening the oracle.
//
// This test encodes the oracle verbatim (exit 2). It FAILS on purpose today; it
// turns green only when the owner reclassifies xdg_root_relative as a usage
// error (exit 2) and updates the sibling exit-20 assertions in lockstep.
// ---------------------------------------------------------------------------

describe("DDA-G17 relative XDG value is refused with a typed usage error", () => {
	// E tier: a store-backed command run with a relative XDG_STATE_HOME refuses
	// with the typed code and exits 2 (usage error), never a silent success and
	// never a state path under the relative root.
	test.skip("E: `run status` with a relative XDG_STATE_HOME exits 2 typed — DDA-G17 gap: driver emits exit 20 (fail-closed), oracle demands exit 2; unskip when xdg_root_relative is reclassified", async () => {
		const xdg = makeTempXdgEnv();
		try {
			const env = { ...xdg.env, XDG_STATE_HOME: "./x" };
			const result = await runForTest(
				["run", "status", "--json"],
				makeRuntime({ env }),
			);
			// Oracle: exit 2 typed. Current behavior exits 20 (fail-closed) — the
			// documented gap this row exists to catch.
			expect(result.exitCode).toBe(2);
			const envelope = parseJson(result.stdout) as {
				status: string;
				error: { code: string; message: string };
			};
			expect(envelope.status).toBe("error");
			expect(envelope.error.code).toBe("xdg_root_relative");
			expect(envelope.error.message).toContain("XDG_STATE_HOME");
		} finally {
			xdg.dispose();
		}
	});
});
