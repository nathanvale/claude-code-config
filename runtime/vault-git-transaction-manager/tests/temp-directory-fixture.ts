import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Owns temporary directories created by one test module. */
export function createTempDirectoryFixture(): {
	readonly create: (prefix: string) => Promise<string>;
	readonly cleanup: () => Promise<void>;
} {
	const roots: string[] = [];
	return {
		async create(prefix) {
			const root = await mkdtemp(join(tmpdir(), prefix));
			roots.push(root);
			return root;
		},
		async cleanup() {
			await Promise.all(
				roots.splice(0).map((root) => rm(root, { recursive: true })),
			);
		},
	};
}
