import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CleanupRegistry } from "./cleanup.ts";

export function makeTempDir(
	registry: CleanupRegistry,
	prefix: string,
): string {
	const dir = mkdtempSync(join(tmpdir(), `cli-test-${prefix}-`));
	registry.paths.push(dir);
	return dir;
}
