import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";

/** Ledger/discovery label for the package-level CLI surface. */
export const ROOT_FRONT_DOOR = "root";

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

/** Discover package-level and CLI Front Door Branch Station Catalog modules. */
export async function discoverStationCatalogPaths(root: string): Promise<string[]> {
	const srcDir = join(root, "src");
	const catalogPaths: string[] = [];
	const packageCatalogPath = join(srcDir, "branch-station-catalog.ts");
	if (await Bun.file(packageCatalogPath).exists()) {
		catalogPaths.push(packageCatalogPath);
	}

	const frontDoorCatalogPaths: string[] = [];
	const frontDoorsDir = join(srcDir, "front-doors");
	if (existsSync(frontDoorsDir)) {
		const glob = new Bun.Glob("**/branch-station-catalog.ts");
		for await (const rel of glob.scan({ cwd: frontDoorsDir, onlyFiles: true })) {
			frontDoorCatalogPaths.push(join(frontDoorsDir, rel));
		}
	}

	return [...catalogPaths, ...frontDoorCatalogPaths.sort()];
}

/** Return `root` or the depth-N path under `src/front-doors` for a source file. */
export function frontDoorLabelForPath(root: string, path: string): string {
	const frontDoorsDir = join(root, "src", "front-doors");
	const rel = relative(frontDoorsDir, path);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return ROOT_FRONT_DOOR;
	const parts = rel.split(/[\\/]/);
	parts.pop();
	return parts.length === 0 ? ROOT_FRONT_DOOR : parts.join("/");
}
