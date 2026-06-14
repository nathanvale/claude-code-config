import { existsSync } from "node:fs";
import { join } from "node:path";

/** Discover package-level and CLI Front Door command contract modules. */
export async function discoverCommandContractPaths(root: string): Promise<string[]> {
	const srcDir = join(root, "src");
	const contractPaths: string[] = [];
	const packageContractPath = join(srcDir, "command-contract.ts");
	if (await Bun.file(packageContractPath).exists()) {
		contractPaths.push(packageContractPath);
	}

	const frontDoorContractPaths: string[] = [];
	const frontDoorsDir = join(srcDir, "front-doors");
	if (existsSync(frontDoorsDir)) {
		// Depth-N: grouped front doors such as
		// src/front-doors/admin/users/command-contract.ts are real surfaces.
		const glob = new Bun.Glob("**/command-contract.ts");
		for await (const rel of glob.scan({ cwd: frontDoorsDir, onlyFiles: true })) {
			frontDoorContractPaths.push(join(frontDoorsDir, rel));
		}
	}

	return [...contractPaths, ...frontDoorContractPaths.sort()];
}
