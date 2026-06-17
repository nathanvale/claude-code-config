import { dirname, join, resolve } from "node:path";
import type { StorybookDoctorRuntime } from "./storybook-doctor-runtime.ts";
import type { TargetInfo } from "./readiness-model.ts";

const STORYBOOK_CONFIG_EXTENSIONS = [
	"js",
	"cjs",
	"mjs",
	"ts",
	"mts",
	"cts",
] as const;

export type ResolvedTarget = {
	readonly targetPath: string;
	readonly info: TargetInfo;
	readonly packageJson: PackageJsonData | null;
	readonly storybookConfigPath: string | null;
	readonly workspaceRootPackageJson: PackageJsonData | null;
};

type PackageJsonData = {
	readonly path: string;
	readonly dependencies?: Record<string, string>;
	readonly devDependencies?: Record<string, string>;
	readonly peerDependencies?: Record<string, string>;
	readonly optionalDependencies?: Record<string, string>;
	readonly scripts?: Record<string, string>;
};

export function resolveTarget(
	runtime: StorybookDoctorRuntime,
	options: { repo?: string },
): ResolvedTarget {
	const targetPath = resolveTargetPath(runtime, options.repo);
	const packageJson = findPackageJson(runtime, targetPath);
	const storybookConfigPath = findStorybookConfig(runtime, targetPath);
	const workspaceRootPackageJson = findWorkspaceRootPackageJson(
		runtime,
		targetPath,
		packageJson?.path,
	);

	const hasDep = (name: string) =>
		hasDependency(name, packageJson) ||
		hasDependency(name, workspaceRootPackageJson);

	const hasStorybookScript =
		hasScript("storybook", packageJson) ||
		hasScript("dev:storybook", packageJson) ||
		hasScript("storybook:dev", packageJson);

	const hasMcpAddonConfig = storybookConfigPath
		? configListsAddon(runtime, storybookConfigPath, "@storybook/addon-mcp")
		: false;

	const info: TargetInfo = {
		resolved_path: targetPath,
		has_package_json: packageJson !== null,
		has_storybook_config: storybookConfigPath !== null,
		has_storybook_dependency: hasDep("storybook"),
		has_mcp_addon_dependency: hasDep("@storybook/addon-mcp"),
		has_mcp_addon_config: hasMcpAddonConfig,
		has_storybook_script: hasStorybookScript,
	};

	return {
		targetPath,
		info,
		packageJson,
		storybookConfigPath,
		workspaceRootPackageJson,
	};
}

function resolveTargetPath(
	runtime: StorybookDoctorRuntime,
	repoOverride?: string,
): string {
	if (repoOverride) return resolve(repoOverride);
	const cwd = runtime.cwd();
	return walkUpToPackageJson(runtime, cwd) ?? cwd;
}

function walkUpToPackageJson(
	runtime: StorybookDoctorRuntime,
	startDir: string,
): string | null {
	let dir = resolve(startDir);
	const root = resolve("/");
	while (dir !== root) {
		if (runtime.fileExists(join(dir, "package.json"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function findPackageJson(
	runtime: StorybookDoctorRuntime,
	targetPath: string,
): PackageJsonData | null {
	const pkgPath = join(targetPath, "package.json");
	if (!runtime.fileExists(pkgPath)) return null;
	try {
		const content = JSON.parse(runtime.readTextFile(pkgPath));
		return {
			path: pkgPath,
			dependencies: content.dependencies,
			devDependencies: content.devDependencies,
			peerDependencies: content.peerDependencies,
			optionalDependencies: content.optionalDependencies,
			scripts: content.scripts,
		};
	} catch {
		return null;
	}
}

function findStorybookConfig(
	runtime: StorybookDoctorRuntime,
	targetPath: string,
): string | null {
	for (const ext of STORYBOOK_CONFIG_EXTENSIONS) {
		const candidate = join(targetPath, ".storybook", `main.${ext}`);
		if (runtime.fileExists(candidate)) return candidate;
	}
	return null;
}

function findWorkspaceRootPackageJson(
	runtime: StorybookDoctorRuntime,
	targetPath: string,
	targetPkgPath?: string,
): PackageJsonData | null {
	let dir = dirname(targetPath);
	const root = resolve("/");
	while (dir !== root) {
		const candidate = join(dir, "package.json");
		if (candidate !== targetPkgPath && runtime.fileExists(candidate)) {
			try {
				const content = JSON.parse(runtime.readTextFile(candidate));
				if (content.workspaces) {
					return {
						path: candidate,
						dependencies: content.dependencies,
						devDependencies: content.devDependencies,
						peerDependencies: content.peerDependencies,
						optionalDependencies: content.optionalDependencies,
						scripts: content.scripts,
					};
				}
			} catch {
				// Skip unparseable package.json
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function hasDependency(
	name: string,
	pkg: PackageJsonData | null | undefined,
): boolean {
	if (!pkg) return false;
	return (
		name in (pkg.dependencies ?? {}) ||
		name in (pkg.devDependencies ?? {}) ||
		name in (pkg.peerDependencies ?? {}) ||
		name in (pkg.optionalDependencies ?? {})
	);
}

function hasScript(
	name: string,
	pkg: PackageJsonData | null | undefined,
): boolean {
	if (!pkg?.scripts) return false;
	return name in pkg.scripts;
}

function configListsAddon(
	runtime: StorybookDoctorRuntime,
	configPath: string,
	addonName: string,
): boolean {
	try {
		const content = runtime.readTextFile(configPath);
		return content.includes(addonName);
	} catch {
		return false;
	}
}
