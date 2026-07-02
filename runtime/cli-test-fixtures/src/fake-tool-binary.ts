import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeFakeToolBinary(
	dir: string,
	toolName: string,
	script: string,
): void {
	const binDir = join(dir, "node_modules", ".bin");
	mkdirSync(binDir, { recursive: true });
	const binPath = join(binDir, toolName);
	writeFileSync(binPath, script);
	chmodSync(binPath, 0o755);
}
