import { afterEach, describe, expect, test } from "bun:test";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

describe("mcp-doctor", () => {
	test("health cannot create a persistent MC Porter worker", async () => {
		const directory = await mkdtemp(join(tmpdir(), "mcp-doctor-"));
		temporaryDirectories.push(directory);

		const fakeMcporter = join(directory, "mcporter");
		const observedGuard = join(directory, "observed-guard");
		const daemonMarker = join(directory, "daemon-created");

		await writeFile(
			fakeMcporter,
			`#!/bin/sh
printf '%s\n' "\${MCPORTER_NO_KEEPALIVE-}" >> "$MCP_DOCTOR_OBSERVED_GUARD"
if [ "\${MCPORTER_NO_KEEPALIVE-}" != "*" ]; then
  : > "$MCP_DOCTOR_DAEMON_MARKER"
fi
printf '%s\n' '- notion (1 tools, 0.1s) [source: fixture]'
`,
		);
		await chmod(fakeMcporter, 0o700);

		for (const inheritedGuard of ["1", undefined]) {
			const environment = {
				...process.env,
				PATH: `${directory}:${process.env.PATH ?? ""}`,
				MCP_DOCTOR_OBSERVED_GUARD: observedGuard,
				MCP_DOCTOR_DAEMON_MARKER: daemonMarker,
			};
			if (inheritedGuard === undefined) delete environment.MCPORTER_NO_KEEPALIVE;
			else environment.MCPORTER_NO_KEEPALIVE = inheritedGuard;

			const result = Bun.spawnSync(["bun", join(import.meta.dir, "mcp-doctor.ts"), "--json"], {
				env: environment,
				stderr: "pipe",
				stdout: "pipe",
			});

			expect(result.exitCode).toBe(0);
		}

		expect(await readFile(observedGuard, "utf8")).toBe("*\n*\n");
		expect(await pathExists(daemonMarker)).toBe(false);
	});
});
