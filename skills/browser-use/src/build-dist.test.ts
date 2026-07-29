import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	buildBrowserUseDist,
	validateShippedRunbookCatalog,
} from "./build-dist";

const temporaryRoots: string[] = [];

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function writeRunbook(
	root: string,
	serviceId: string,
	flowId: string,
	runbook: unknown,
): void {
	const directory = join(root, serviceId, flowId);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "runbook.json"),
		`${JSON.stringify(runbook, null, 2)}\n`,
	);
}

describe("browser-use dist catalog validation", () => {
	test("rejects any invalid shipped runbook with its catalog path", async () => {
		const root = mkdtempSync(join(tmpdir(), "browser-use-build-catalog-"));
		temporaryRoots.push(root);
		const valid = JSON.parse(
			readFileSync(
				join(
					import.meta.dir,
					"..",
					"runbooks",
					"oncore",
					"timesheet-snapshot-verify",
					"runbook.json",
				),
				"utf8",
			),
		) as Record<string, unknown>;
		writeRunbook(root, "alpha", "valid", {
			...valid,
			service_id: "alpha",
			flow_id: "valid",
		});
		writeRunbook(root, "zeta", "broken", {
			...valid,
			service_id: "zeta",
			flow_id: "broken",
			steps: [],
		});

		const validation = validateShippedRunbookCatalog(root);
		await expect(validation).rejects.toThrow(
			"zeta/broken/runbook.json",
		);
		await expect(validation).rejects.toThrow("runbook_no_steps");
	});

	test(
		"runs the dist-only shipped catalog from a neutral working directory",
		async () => {
			const root = realpathSync(
				mkdtempSync(join(tmpdir(), "browser-use-dist-proof-")),
			);
			temporaryRoots.push(root);
			const installRoot = join(root, "install");
			const distRoot = join(installRoot, "dist");
			const neutralCwd = join(root, "neutral-cwd");
			mkdirSync(neutralCwd, { recursive: true });

			const proof = await buildBrowserUseDist({
				distRoot,
				log: () => {},
			});
			const expectedRunbooks = proof.relativePaths.map((relativePath) =>
				relativePath.split("/").slice(0, 2).join("/"),
			);
			expect(existsSync(join(installRoot, "runbooks"))).toBe(false);

			const child = Bun.spawn(
				[
					process.execPath,
					join(distRoot, "browser-use.js"),
					"runbook",
					"list",
					"--json",
				],
				{
					cwd: neutralCwd,
					env: {
						HOME: join(root, "home"),
						XDG_CONFIG_HOME: join(root, "xdg-config"),
						XDG_DATA_HOME: join(root, "xdg-data"),
						XDG_STATE_HOME: join(root, "xdg-state"),
						XDG_CACHE_HOME: join(root, "xdg-cache"),
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [stdout, stderr, exitCode] = await Promise.all([
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
				child.exited,
			]);

			if (exitCode !== 0) {
				throw new Error(
					`dist-only runbook list exited ${exitCode}: stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`,
				);
			}
			expect(stderr).toBe("");
			const envelope = JSON.parse(stdout) as {
				data: {
					runbook_count: number;
					runbooks: Array<{ service_id: string; flow_id: string }>;
				};
			};
			expect(envelope.data.runbook_count).toBe(proof.runbookCount);
			expect(
				envelope.data.runbooks.map(
					({ service_id, flow_id }) => `${service_id}/${flow_id}`,
				),
			).toEqual(expectedRunbooks);
		},
		30_000,
	);
});
