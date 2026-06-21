import {
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import type { StorybookDocsLoopRuntime } from "./docs-loop-state.ts";

/** Input for Storybook docs-loop inventory discovery. */
export interface DocsLoopInventoryInput {
	/** Target repository path. Falls back to runtime cwd. */
	readonly repo?: string;
	/** Target package path relative to repo, or absolute path inside repo. */
	readonly pkg?: string;
	/** Component name to discover. */
	readonly component?: string;
	/** Story path to resolve to its owning component. */
	readonly story?: string;
}

/** Component story cluster returned to the next agent. */
export interface DocsLoopComponentCluster {
	/** Component name inferred from story paths. */
	readonly component: string;
	/** Resolved repository root. */
	readonly repo_root: string;
	/** Resolved package root. */
	readonly package_root: string;
	/** Primary story file relative to repo root. */
	readonly main_story: string | null;
	/** Matrix story files relative to repo root. */
	readonly matrix_stories: readonly string[];
	/** Focused or state story files relative to repo root. */
	readonly focused_stories: readonly string[];
	/** Nearby test files relative to repo root. */
	readonly nearby_tests: readonly string[];
	/** Nearby evidence files relative to repo root. */
	readonly evidence_files: readonly string[];
	/** Cheap Storybook story id hints when title/export parsing is reliable. */
	readonly story_id_hints: readonly string[];
}

/** Successful inventory result. */
export interface DocsLoopInventoryOk {
	/** Result status. */
	readonly status: "ok";
	/** Component cluster. */
	readonly cluster: DocsLoopComponentCluster;
}

/** Blocked inventory result with repair guidance. */
export interface DocsLoopInventoryBlocked {
	/** Result status. */
	readonly status: "blocked";
	/** Package-owned reason code. */
	readonly reason:
		| "package_not_found"
		| "story_not_found"
		| "component_not_found"
		| "target_outside_repo";
	/** Repair hint for the next agent. */
	readonly next_safe_action: string;
}

/** Ambiguous inventory result with candidate component names. */
export interface DocsLoopInventoryAmbiguous {
	/** Result status. */
	readonly status: "ambiguous";
	/** Candidate component names. */
	readonly alternatives: readonly string[];
	/** Repair hint for the next agent. */
	readonly next_safe_action: string;
}

/** Inventory result for docs-loop target discovery. */
export type DocsLoopInventoryResult =
	| DocsLoopInventoryOk
	| DocsLoopInventoryBlocked
	| DocsLoopInventoryAmbiguous;

/** Successful inventory-set result for batch run creation. */
export interface DocsLoopInventorySetOk {
	/** Result status. */
	readonly status: "ok";
	/** Discovered component clusters. */
	readonly clusters: readonly DocsLoopComponentCluster[];
}

/** Inventory-set result for batch run creation. */
export type DocsLoopInventorySetResult =
	| DocsLoopInventorySetOk
	| DocsLoopInventoryBlocked
	| DocsLoopInventoryAmbiguous;

type StoryCandidate = {
	readonly path: string;
	readonly component: string;
	readonly role: "main" | "matrix" | "focused";
	readonly storyIds: readonly string[];
};

type ResolvedInventoryTarget = {
	readonly repoRoot: string;
	readonly packageRoot: string;
};

const STORY_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mdx"]);
const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const STORY_FILE_PATTERN = /\.stories\.(ts|tsx|js|jsx|mdx)$/;

/**
 * Discover a Storybook component cluster without editing target files.
 *
 * @param runtime - Runtime boundary
 * @param input - Repo, package, component, or story selector
 * @returns Inventory result with cluster data or repair guidance
 *
 * @example
 * ```typescript
 * const result = await discoverDocsLoopInventory(runtime, { component: "Button" })
 * ```
 */
export async function discoverDocsLoopInventory(
	runtime: StorybookDocsLoopRuntime,
	input: DocsLoopInventoryInput,
): Promise<DocsLoopInventoryResult> {
	const target = await resolveInventoryTarget(runtime, input);
	if (target.status !== "ok") return target;
	const { repoRoot, packageRoot } = target;

	const stories = await readStoryCandidates(runtime, packageRoot);
	const targetComponent = input.story
		? resolveStoryComponent(repoRoot, packageRoot, input.story, stories)
		: resolveComponentName(input.component, stories);
	if (targetComponent.status !== "ok") return targetComponent;
	const componentStories = stories.filter(
		(story) => story.component === targetComponent.component,
	);
	if (componentStories.length === 0) {
		return {
			status: "blocked",
			reason: "component_not_found",
			next_safe_action: "Check the component name or story path.",
		};
	}
	return {
		status: "ok",
		cluster: await buildCluster(
			runtime,
			repoRoot,
			packageRoot,
			targetComponent.component,
			componentStories,
		),
	};
}

/**
 * Discover one or more Storybook component clusters for a batch run.
 *
 * @param runtime - Runtime boundary
 * @param input - Repo, package, component, or story selector
 * @returns Inventory-set result with clusters or repair guidance
 *
 * @example
 * ```typescript
 * const result = await discoverDocsLoopInventorySet(runtime, { pkg: "packages/ui" })
 * ```
 */
export async function discoverDocsLoopInventorySet(
	runtime: StorybookDocsLoopRuntime,
	input: DocsLoopInventoryInput,
): Promise<DocsLoopInventorySetResult> {
	if (input.component || input.story) {
		const single = await discoverDocsLoopInventory(runtime, input);
		if (single.status !== "ok") return single;
		return { status: "ok", clusters: [single.cluster] };
	}

	const target = await resolveInventoryTarget(runtime, input);
	if (target.status !== "ok") return target;
	const { repoRoot, packageRoot } = target;

	const stories = await readStoryCandidates(runtime, packageRoot);
	const components = [...new Set(stories.map((story) => story.component))].sort();
	if (components.length === 0) {
		return {
			status: "blocked",
			reason: "component_not_found",
			next_safe_action: "Add or choose a Storybook story file.",
		};
	}
	return {
		status: "ok",
		clusters: await Promise.all(
			components.map((component) =>
				buildCluster(
					runtime,
					repoRoot,
					packageRoot,
					component,
					stories.filter((story) => story.component === component),
				),
			),
		),
	};
}

async function resolveInventoryTarget(
	runtime: StorybookDocsLoopRuntime,
	input: DocsLoopInventoryInput,
): Promise<
	| ({ readonly status: "ok" } & ResolvedInventoryTarget)
	| DocsLoopInventoryBlocked
> {
	const repoRoot = resolve(input.repo ?? runtime.cwd());
	const packageRoot = resolvePackageRoot(repoRoot, input.pkg);
	if (!isContained(repoRoot, packageRoot)) {
		return {
			status: "blocked",
			reason: "target_outside_repo",
			next_safe_action: "Choose a package path inside the target repo.",
		};
	}
	if (!(await runtime.fileExists(packageRoot))) {
		return {
			status: "blocked",
			reason: "package_not_found",
			next_safe_action: "Check the package path and rerun inventory.",
		};
	}
	return { status: "ok", repoRoot, packageRoot };
}

function resolvePackageRoot(repoRoot: string, pkg: string | undefined): string {
	if (!pkg) return repoRoot;
	return resolve(isAbsolutePath(pkg) ? pkg : join(repoRoot, pkg));
}

async function readStoryCandidates(
	runtime: StorybookDocsLoopRuntime,
	packageRoot: string,
): Promise<StoryCandidate[]> {
	const storyFiles = await findFiles(runtime, packageRoot, isStoryFile);
	return Promise.all(storyFiles.map((path) => buildStoryCandidate(runtime, path)));
}

function resolveStoryComponent(
	repoRoot: string,
	packageRoot: string,
	story: string,
	stories: readonly StoryCandidate[],
): { status: "ok"; component: string } | DocsLoopInventoryBlocked {
	const storyPath = resolve(isAbsolutePath(story) ? story : join(repoRoot, story));
	if (!isContained(packageRoot, storyPath)) {
		return {
			status: "blocked",
			reason: "target_outside_repo",
			next_safe_action: "Choose a story path inside the target package.",
		};
	}
	const match = stories.find((candidate) => candidate.path === storyPath);
	if (!match) {
		return {
			status: "blocked",
			reason: "story_not_found",
			next_safe_action: "Check the story path and rerun inventory.",
		};
	}
	return { status: "ok", component: match.component };
}

function resolveComponentName(
	component: string | undefined,
	stories: readonly StoryCandidate[],
):
	| { status: "ok"; component: string }
	| DocsLoopInventoryBlocked
	| DocsLoopInventoryAmbiguous {
	if (!component) {
		return {
			status: "blocked",
			reason: "component_not_found",
			next_safe_action: "Provide a component name or story path.",
		};
	}
	const components = [...new Set(stories.map((story) => story.component))].sort();
	const exact = components.find(
		(candidate) => candidate.toLowerCase() === component.toLowerCase(),
	);
	if (exact) return { status: "ok", component: exact };
	const matches = components.filter((candidate) =>
		candidate.toLowerCase().includes(component.toLowerCase()),
	);
	if (matches.length === 1) return { status: "ok", component: matches[0] };
	if (matches.length > 1 && matches.length <= 10) {
		return {
			status: "ambiguous",
			alternatives: matches,
			next_safe_action: "Choose one component from alternatives.",
		};
	}
	return {
		status: "blocked",
		reason: "component_not_found",
		next_safe_action: "Check the component name or story path.",
	};
}

async function buildStoryCandidate(
	runtime: StorybookDocsLoopRuntime,
	path: string,
): Promise<StoryCandidate> {
	const name = componentNameFromStoryPath(path);
	const content = await safeRead(runtime, path);
	return {
		path,
		component: name,
		role: storyRole(path, content),
		storyIds: storyIdHints(content),
	};
}

async function buildCluster(
	runtime: StorybookDocsLoopRuntime,
	repoRoot: string,
	packageRoot: string,
	component: string,
	stories: readonly StoryCandidate[],
): Promise<DocsLoopComponentCluster> {
	const sortedStories = [...stories].sort((left, right) =>
		left.path.localeCompare(right.path),
	);
	const mainStory =
		sortedStories.find((story) => story.role === "main") ?? sortedStories[0];
	const componentDir = dirname(mainStory.path);
	const nearby = await findFiles(
		runtime,
		componentDir,
		(path) => TEST_FILE_PATTERN.test(path) || evidenceFile(path),
	);
	return {
		component,
		repo_root: repoRoot,
		package_root: packageRoot,
		main_story: mainStory ? toRepoRelative(repoRoot, mainStory.path) : null,
		matrix_stories: sortedStories
			.filter((story) => story.role === "matrix")
			.map((story) => toRepoRelative(repoRoot, story.path)),
		focused_stories: sortedStories
			.filter((story) => story.role === "focused")
			.map((story) => toRepoRelative(repoRoot, story.path)),
		nearby_tests: nearby
			.filter((path) => TEST_FILE_PATTERN.test(path))
			.map((path) => toRepoRelative(repoRoot, path))
			.sort(),
		evidence_files: nearby
			.filter(evidenceFile)
			.map((path) => toRepoRelative(repoRoot, path))
			.sort(),
		story_id_hints: sortedStories.flatMap((story) => story.storyIds).sort(),
	};
}

async function findFiles(
	runtime: StorybookDocsLoopRuntime,
	root: string,
	predicate: (path: string) => boolean,
): Promise<string[]> {
	const found: string[] = [];
	async function walk(dir: string): Promise<void> {
		const entries = await runtime.readDir(dir);
		for (const entry of entries) {
			const path = join(dir, entry.name);
			if (!isContained(root, path)) continue;
			if (entry.isDirectory) {
				if (entry.name === "node_modules" || entry.name === "dist") continue;
				await walk(path);
			} else if (entry.isFile && predicate(path)) {
				found.push(path);
			}
		}
	}
	await walk(root);
	return found.sort();
}

function isStoryFile(path: string): boolean {
	return STORY_FILE_PATTERN.test(path) && STORY_EXTENSIONS.has(extname(path));
}

function evidenceFile(path: string): boolean {
	const file = basename(path).toLowerCase();
	return file === "readme.md" || (file.endsWith(".mdx") && !isStoryFile(path));
}

function componentNameFromStoryPath(path: string): string {
	const file = basename(path).replace(STORY_FILE_PATTERN, "");
	const withoutRole = file.replace(/\.(matrix|states|state|focused)$/i, "");
	return withoutRole || basename(dirname(path));
}

function storyRole(path: string, content: string): "main" | "matrix" | "focused" {
	const file = basename(path).toLowerCase();
	if (file.includes(".matrix.") || /export\s+const\s+Matrix\b/.test(content)) {
		return "matrix";
	}
	if (/\.(states|state|focused)\.stories\./.test(file)) return "focused";
	return "main";
}

function storyIdHints(content: string): readonly string[] {
	const titleMatch = content.match(/title\s*:\s*['"]([^'"]+)['"]/);
	if (!titleMatch) return [];
	const exports = [...content.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)].map(
		(match) => match[1],
	);
	if (exports.length === 0) return [];
	return exports.map((storyName) => `${slug(titleMatch[1])}--${slug(storyName)}`);
}

function slug(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

async function safeRead(
	runtime: StorybookDocsLoopRuntime,
	path: string,
): Promise<string> {
	try {
		return await runtime.readTextFile(path);
	} catch {
		return "";
	}
}

function toRepoRelative(repoRoot: string, path: string): string {
	return relative(repoRoot, path).split(sep).join("/");
}

function isContained(root: string, candidate: string): boolean {
	const resolvedRoot = resolve(root);
	const resolvedCandidate = resolve(candidate);
	return (
		resolvedCandidate === resolvedRoot ||
		resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)
	);
}

function isAbsolutePath(path: string): boolean {
	return isAbsolute(path);
}
