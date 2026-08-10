import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const repositoryRoot = resolve(import.meta.dir, "../..");
const hookSource = resolve(repositoryRoot, "scripts/hooks/pre-commit");

describe("pre-commit compatibility hook", () => {
	test("remains executable shell and allows the commit boundary", () => {
		const result = spawnSync("bash", [hookSource], {
			cwd: repositoryRoot,
			encoding: "utf8",
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe("");
	});

	test("contains no retired instruction checker or staged scanner", () => {
		const source = readFileSync(hookSource, "utf8");
		expect(source).not.toContain("agent-instructions.sh");
		expect(source).not.toContain("PROMPT_DRIFT_CHECK_LOG");
		expect(source).not.toMatch(/git\s+diff\s+--cached/u);
	});
});
