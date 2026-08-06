import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";
import {
	BUN_PREFLIGHT_INSTALL_COMMAND,
	BUN_PREFLIGHT_MISSING_EXIT_CODE,
	BUN_PREFLIGHT_RUNTIME_NAME,
	bunPreflightRemedy,
	bunPreflightShim,
} from "./browser-use-bun-preflight";

// DDA-A21 (runtime-env cluster): a missing or wrong-version Bun runtime must
// yield ACTIONABLE guidance, not a raw exec error. The oracle: PATH without
// `bun` — the installed entry fails with a named remedy.
//
// PROCESS tier: the launcher shim is spawned as the installed entry under a
// PATH stripped of bun, and the emitted stderr/exit are asserted. Baseline
// contrast: a raw `#!/usr/bin/env bun` shebang under the same PATH emits the
// bare `env: bun` error the shim replaces. HERMETIC: temp dirs only; the only
// `bun` visible is a fixture the test plants, never the real runtime.

const disposables: (() => void)[] = [];
afterAll(() => {
	for (const dispose of disposables) dispose();
});

function sandbox() {
	const base = realpathSync(mkdtempSync(join(tmpdir(), "browser-use-bun-preflight-")));
	disposables.push(() => rmSync(base, { recursive: true, force: true }));
	return base;
}

// A PATH containing only the standard system dirs — deliberately no bun.
const BUN_LESS_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

describe("DDA-A21 bun runtime preflight on the installed entry", () => {
	test("the checked-in self-hosted entry emits the contract remedy without bun", () => {
		const deliveredEntry = join(import.meta.dir, "browser-use-bun-preflight.ts");
		const result = spawnSync(deliveredEntry, ["task", "list"], {
			env: { PATH: BUN_LESS_PATH },
			encoding: "utf8",
		});

		expect(result.status).toBe(BUN_PREFLIGHT_MISSING_EXIT_CODE);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe(`${bunPreflightRemedy("browser-use")}\n`);
	});

	test("baseline: a raw #!/usr/bin/env bun shebang emits a bare exec error under a bun-less PATH", () => {
		const base = sandbox();
		const raw = join(base, "browser-use-raw");
		writeFileSync(raw, "#!/usr/bin/env bun\nconsole.log('ran');\n");
		chmodSync(raw, 0o755);

		const result = spawnSync(raw, [], { env: { PATH: BUN_LESS_PATH }, encoding: "utf8" });

		// The raw shebang is exactly the DDA-A21 hazard: no named remedy, a bare
		// `env: bun` exec failure at exit 127.
		expect(result.status).toBe(127);
		expect(result.stderr).toContain("bun");
		expect(result.stderr).not.toContain(BUN_PREFLIGHT_INSTALL_COMMAND);
	});

	test("the shim replaces the raw error with a named, actionable remedy and a typed exit", () => {
		const base = sandbox();
		const shimPath = join(base, "browser-use");
		writeFileSync(
			shimPath,
			bunPreflightShim({ commandName: "browser-use", entryPath: "/opt/browser-use/src/browser-use.ts" }),
		);
		chmodSync(shimPath, 0o755);

		const result = spawnSync(shimPath, ["task", "list"], {
			env: { PATH: BUN_LESS_PATH },
			encoding: "utf8",
		});

		// Typed exit code (input tier), never the bare 127 exec error.
		expect(result.status).toBe(BUN_PREFLIGHT_MISSING_EXIT_CODE);
		// The remedy NAMES the runtime, the install command, and the command.
		expect(result.stderr).toContain(BUN_PREFLIGHT_RUNTIME_NAME);
		expect(result.stderr).toContain(BUN_PREFLIGHT_INSTALL_COMMAND);
		expect(result.stderr).toContain("browser-use");
		// It is NOT the raw exec error.
		expect(result.stderr).not.toContain("No such file or directory");
		// stdout stays clean — the remedy is a stderr diagnostic.
		expect(result.stdout).toBe("");
	});

	test("with bun present on PATH the shim execs the entry, preserving args and exit status", () => {
		const base = sandbox();
		const binDir = join(base, "bin");
		mkdirSync(binDir, { recursive: true });
		// A fixture `bun` that echoes its args and exits non-zero, so the test can
		// prove the shim `exec`'d it (args preserved) rather than short-circuiting.
		const fakeBun = join(binDir, "bun");
		writeFileSync(fakeBun, '#!/bin/sh\nprintf "bun-ran %s\\n" "$*"\nexit 7\n');
		chmodSync(fakeBun, 0o755);

		const shimPath = join(base, "browser-use");
		writeFileSync(
			shimPath,
			bunPreflightShim({ commandName: "browser-use", entryPath: "/opt/browser-use/src/browser-use.ts" }),
		);
		chmodSync(shimPath, 0o755);

		const result = spawnSync(shimPath, ["task", "list"], {
			env: { PATH: `${binDir}:${BUN_LESS_PATH}` },
			encoding: "utf8",
		});

		// The shim exec'd the fixture bun with the real entry followed by the
		// forwarded args, and the fixture's exit status propagated.
		expect(result.status).toBe(7);
		expect(result.stdout).toContain("bun-ran");
		expect(result.stdout).toContain("/opt/browser-use/src/browser-use.ts");
		expect(result.stdout).toContain("task list");
	});

	test("the remedy string names the runtime, install command, and command name", () => {
		const remedy = bunPreflightRemedy("browser-use");
		expect(remedy).toContain(BUN_PREFLIGHT_RUNTIME_NAME);
		expect(remedy).toContain(BUN_PREFLIGHT_INSTALL_COMMAND);
		expect(remedy).toContain("browser-use");
		// No absolute path leaks into the operator-facing remedy.
		expect(remedy).not.toContain("/opt/");
	});
});
