#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_PKG = "packages/portal-ui";
const DEFAULT_BATCH_SIZE = 8;
const PILOT_COMPONENTS = ["Button", "ToggleButton", "ActionMenu"];
const CATEGORY_ORDER = {
	"core-ui": 0,
	"data-table": 1,
	"shadcn-public-check": 2,
};

const options = parseArgs(process.argv.slice(2));
const repo = path.resolve(options.repo || process.cwd());
const pkg = options.pkg || DEFAULT_PKG;
const batchSize = positiveInt(options["batch-size"], DEFAULT_BATCH_SIZE);
const statePath = options.state
	? path.resolve(options.state)
	: path.join(os.tmpdir(), `component-library-standard-jsdoc-loop-${slug(repo)}.json`);

let state = options.reset || !fs.existsSync(statePath)
	? freshState()
	: readJson(statePath);

state.repo = repo;
state.pkg = pkg;
state.batchSize = batchSize;
state.inventory = buildInventory(repo, pkg);

if (options.cursor !== undefined) {
	state.cursor = positiveInt(options.cursor, 0);
}

if (options.next) {
	state.cursor = Math.min(state.cursor + batchSize, state.inventory.length);
}

const batch = state.inventory.slice(state.cursor, state.cursor + batchSize);
state.lastBatch = batch.map((item) => item.source);
writeJson(statePath, state);

if (options.json) {
	console.log(JSON.stringify({ statePath, ...state, batch }, null, 2));
} else {
	console.log(renderPrompt({ state, batch, statePath }));
}

function parseArgs(argv) {
	const parsed = {};
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (!arg.startsWith("--")) continue;
		const key = arg.slice(2);
		if (["reset", "next", "json"].includes(key)) {
			parsed[key] = true;
			continue;
		}
		parsed[key] = argv[index + 1];
		index++;
	}
	return parsed;
}

function positiveInt(value, fallback) {
	const parsed = Number.parseInt(String(value ?? ""), 10);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function freshState() {
	return {
		cursor: 0,
		repo,
		pkg,
		batchSize,
		inventory: [],
		lastBatch: [],
	};
}

function readJson(filePath) {
	return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function slug(value) {
	return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "repo";
}

function buildInventory(repoRoot, packagePath) {
	const packageRoot = path.join(repoRoot, packagePath);
	const roots = [
		path.join(packageRoot, "src/ui"),
		path.join(packageRoot, "src/components/ui"),
	];

	const files = roots
		.filter((root) => fs.existsSync(root))
		.flatMap((root) => walk(root))
		.filter(isComponentSource);

	return files
		.flatMap((filePath) => componentEntries(repoRoot, filePath))
		.sort(compareInventoryItems);
}

function walk(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const filePath = path.join(dir, entry.name);
		if (entry.isDirectory()) return walk(filePath);
		return [filePath];
	});
}

function isComponentSource(filePath) {
	const name = path.basename(filePath);
	if (!filePath.endsWith(".tsx")) return false;
	if (name.includes(".stories.")) return false;
	if (name.includes(".matrix.")) return false;
	if (name.includes(".test.")) return false;
	if (name.includes(".spec.")) return false;
	if (filePath.includes(`${path.sep}__tests__${path.sep}`)) return false;
	if (filePath.includes(`${path.sep}fixtures${path.sep}`)) return false;
	return true;
}

function componentEntries(repoRoot, filePath) {
	const source = fs.readFileSync(filePath, "utf8");
	const exports = exportedRuntimeNames(source);
	if (exports.length === 0) return [];

	const relativePath = path.relative(repoRoot, filePath);
	const summaryCount = countMatches(source, /@summary/g);
	const propsSummary = hasPropsSummary(source);
	const category = categoryFor(relativePath);
	const action = propsSummary || summaryCount === 0 || summaryCount > exports.length
		? "edit"
		: "verify";

	return [
		{
			category,
			component: exports.join(", "),
			exports,
			source: relativePath,
			summaryCount,
			propsSummary,
			action,
			evidence: evidenceFiles(repoRoot, filePath),
		},
	];
}

function exportedRuntimeNames(source) {
	const names = new Set();
	for (const match of source.matchAll(/export\s+(?:const|function)\s+([A-Z][A-Za-z0-9_]*)/g)) {
		names.add(match[1]);
	}
	for (const match of source.matchAll(/export\s+\{\s*([A-Z][A-Za-z0-9_]*)\s*\}/g)) {
		names.add(match[1]);
	}
	return [...names].sort();
}

function countMatches(source, expression) {
	return [...source.matchAll(expression)].length;
}

function hasPropsSummary(source) {
	return /\/\*\*[\s\S]*?@summary[\s\S]*?\*\/\s*export\s+interface\s+[A-Za-z0-9_]*Props\b/.test(source);
}

function categoryFor(relativePath) {
	if (relativePath.includes("/src/components/ui/")) return "shadcn-public-check";
	if (relativePath.includes("/src/ui/data-table/")) return "data-table";
	return "core-ui";
}

function compareInventoryItems(left, right) {
	return (
		pilotScore(left) - pilotScore(right)
		|| CATEGORY_ORDER[left.category] - CATEGORY_ORDER[right.category]
		|| actionScore(left) - actionScore(right)
		|| left.source.localeCompare(right.source)
	);
}

function pilotScore(item) {
	const index = PILOT_COMPONENTS.findIndex((component) => item.exports.includes(component));
	return index === -1 ? Number.POSITIVE_INFINITY : index;
}

function actionScore(item) {
	return item.action === "edit" ? 0 : 1;
}

function evidenceFiles(repoRoot, filePath) {
	const dir = path.dirname(filePath);
	const siblings = fs
		.readdirSync(dir)
		.filter((name) => /\.(stories|matrix\.stories|test|spec)\.tsx$/.test(name) || /\.(md|mdx)$/.test(name))
		.map((name) => path.relative(repoRoot, path.join(dir, name)));
	return siblings.sort();
}

function renderPrompt({ state, batch, statePath }) {
	const start = state.cursor + 1;
	const end = state.cursor + batch.length;
	const remaining = Math.max(state.inventory.length - end, 0);

	return `# Component JSDoc Cleanup Batch

State file: ${statePath}
Repo: ${state.repo}
Package: ${state.pkg}
Cursor: ${state.cursor}
Batch: ${batch.length === 0 ? "complete" : `${start}-${end} of ${state.inventory.length}`}
Remaining after this batch: ${remaining}

${renderTable(batch)}

## Coordinator Prompt

Use component-library-standard in JSDoc-only cleanup mode.

Audience:
- UI builders and agent builders choosing Portal UI Lego bricks.

For this batch only:
1. Read each source file plus listed evidence files.
2. Use read-only explorer agents if available; explorers gather facts only.
3. Write one builder-facing component-level @summary on each public runtime component export.
4. Remove @summary from matching props interfaces and replace it with plain JSDoc, usually \`Props for {@link ComponentName}.\`
5. Preserve prop member intent comments.
6. Add or keep @example only when it helps a builder choose or compose the component.
7. Do not edit stories, Matrix, UxTips, docs-only helpers, recipes, product examples, or runtime behavior unless explicitly requested.
8. For shadcn/public primitive files, allow multiple @summary tags only when each belongs to a distinct public runtime export.

Local-first research:
- source, props, barrel, stories, tests, README/MDX, nearby usage.
- external search only when local purpose is unclear.
- prefer WAI-ARIA APG, WCAG, MDN, official platform/design-system docs, Radix, shadcn/ui, MUI, Carbon, GOV.UK, or Apple HIG.
- do not copy external wording.

After editing this batch, run:
\`\`\`bash
pnpm --filter @packages/portal-ui check:agent-registry
\`\`\`

Advance when green:
\`\`\`bash
node /Users/nathanvale/code/claude-code-config/skills/component-library-standard/scripts/jsdoc-summary-loop.mjs \\
  --repo ${state.repo} \\
  --pkg ${state.pkg} \\
  --batch-size ${state.batchSize} \\
  --next
\`\`\`
`;
}

function renderTable(batch) {
	if (batch.length === 0) return "No remaining candidates.";

	const rows = batch.map((item, index) => {
		const evidence = item.evidence.length === 0 ? "none listed" : item.evidence.join("<br>");
		const props = item.propsSummary ? "yes" : "no";
		return `| ${index + 1} | ${item.category} | ${item.component} | ${item.source} | ${item.summaryCount} | ${props} | ${item.action} | ${evidence} |`;
	});

	return [
		"| # | category | export | source | @summary count | props @summary | action | evidence |",
		"|---|---|---|---|---:|---|---|---|",
		...rows,
	].join("\n");
}
