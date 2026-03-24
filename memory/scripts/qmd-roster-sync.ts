#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";

type RepoProfile = "life-hub" | "work-repo" | "infra-repo" | string;

type RosterRepo = {
	name: string;
	profile: RepoProfile;
	location: string;
	collection: string;
	update_command?: string;
	primary_paths: string[];
};

type Roster = {
	version: number;
	hub: string;
	repos: RosterRepo[];
};

const rosterPath = resolve(import.meta.dir, "../federation/roster.yml");

const home = process.env.HOME ?? "";
const resolvePath = (p: string): string => p.replaceAll("~/", `${home}/`);

const loadRoster = (): Roster => {
	const result = spawnSync("yq", ["-o=json", rosterPath], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		console.error(`yq failed: ${result.stderr}`);
		process.exit(1);
	}
	return JSON.parse(result.stdout) as Roster;
};

const qmdInstalled = (): boolean => {
	const result = spawnSync("sh", ["-lc", "command -v qmd >/dev/null 2>&1"]);
	return result.status === 0;
};

const collectionExists = (name: string): boolean => {
	const result = spawnSync("sh", [
		"-lc",
		`qmd collection show ${shellEscape(name)} >/dev/null 2>&1`,
	]);
	return result.status === 0;
};

type ExistingCollection = {
	path: string;
	pattern: string;
};

const shellEscape = (value: string): string =>
	`'${value.replaceAll("'", "'\\''")}'`;

const isMarkdownFile = (relativePath: string): boolean =>
	relativePath.endsWith(".md");

const maskPattern = (relativePath: string): string =>
	isMarkdownFile(relativePath) ? relativePath : `${relativePath}/**/*.md`;

const collectionMask = (repo: RosterRepo): string => {
	const patterns = repo.primary_paths.map(maskPattern);

	if (patterns.length === 1) {
		return patterns[0];
	}

	return `{${patterns.join(",")}}`;
};

const collectionCommand = (repo: RosterRepo): string =>
	`qmd collection add ${shellEscape(resolvePath(repo.location))} --name ${shellEscape(repo.collection)} --mask ${shellEscape(collectionMask(repo))}`;

const removeCollectionCommand = (repo: RosterRepo): string =>
	`qmd collection remove ${shellEscape(repo.collection)}`;

const updateCommand = (repo: RosterRepo): string | null =>
	repo.update_command
		? `qmd collection update-cmd ${shellEscape(repo.collection)} ${shellEscape(resolvePath(repo.update_command))}`
		: null;

const profileLabel = (profile: RepoProfile): string => {
	switch (profile) {
		case "life-hub":
			return "Personal control-plane and promoted knowledge";
		case "work-repo":
			return "Work repo docs, memory, and task surfaces";
		case "infra-repo":
			return "Infrastructure docs, runbooks, and implementation history";
		case "reference-corpus":
			return "External reference corpus, converted vendor docs, and retrieval-oriented mirror";
		default:
			return "Federated markdown corpus";
	}
};

const pathLabel = (relativePath: string): string => {
	switch (relativePath) {
		case "docs":
			return "Project docs, specs, runbooks, decisions, and reference material";
		case "memory":
			return "Durable memory, glossary, and stable project context";
		case "apis":
			return "Converted API reference docs derived from vendor OpenAPI specs";
		case "repos":
			return "Converted vendor guides, examples, and API client reference docs";
		case "TASKS.md":
			return "Current task surface and next actions";
		case "CLAUDE.md":
			return "Hot memory, current state, and session guidance";
		case "AGENTS.md":
			return "Agent instructions, repo contract, and working conventions";
		case "00 Inbox":
			return "Inbox capture and untriaged notes";
		case "01 Projects":
			return "Active projects, plans, and project execution notes";
		case "02 Areas":
			return "Ongoing areas of responsibility and maintenance";
		case "03 Resources":
			return "Reference material, evergreen notes, and reusable knowledge";
		default:
			return `${basename(relativePath)} notes within the ${relativePath} surface`;
	}
};

const collectionTarget = (repo: RosterRepo): string =>
	`qmd://${repo.collection}`;

const pathTarget = (repo: RosterRepo, relativePath: string): string =>
	`${collectionTarget(repo)}/${relativePath}`;

const contextCommand = (repo: RosterRepo): string =>
	`qmd context add ${shellEscape(collectionTarget(repo))} ${shellEscape(profileLabel(repo.profile))}`;

const pathContextCommands = (repo: RosterRepo): string[] =>
	repo.primary_paths.map(
		(relativePath) =>
			`qmd context add ${shellEscape(pathTarget(repo, relativePath))} ${shellEscape(pathLabel(relativePath))}`,
	);

const existingCollection = (name: string): ExistingCollection | null => {
	const result = spawnSync(
		"sh",
		["-lc", `qmd collection show ${shellEscape(name)}`],
		{ encoding: "utf8" },
	);

	if (result.status !== 0 || !result.stdout) {
		return null;
	}

	const pathMatch = result.stdout.match(/^\s*Path:\s+(.*)$/m);
	const patternMatch = result.stdout.match(/^\s*Pattern:\s+(.*)$/m);

	if (!pathMatch || !patternMatch) {
		return null;
	}

	return {
		path: pathMatch[1].trim(),
		pattern: patternMatch[1].trim(),
	};
};

const printPlan = (roster: Roster): void => {
	console.log("# QMD Federation Plan");
	console.log("");
	for (const repo of roster.repos) {
		console.log(`- ${repo.name}`);
		console.log(`  collection: ${repo.collection}`);
		console.log(`  location: ${repo.location}`);
		console.log(`  mask: ${collectionMask(repo)}`);
		if (repo.update_command) {
			console.log(`  update_command: ${repo.update_command}`);
		}
		console.log(`  primary_paths: ${repo.primary_paths.join(", ")}`);
	}
};

const printCommands = (roster: Roster): void => {
	console.log("# QMD Commands");
	console.log("");
	for (const repo of roster.repos) {
		console.log(collectionCommand(repo));
		const updateCmd = updateCommand(repo);
		if (updateCmd) {
			console.log(updateCmd);
		}
		console.log(contextCommand(repo));
		for (const command of pathContextCommands(repo)) {
			console.log(command);
		}
		console.log("");
	}
};

const applyCommands = (roster: Roster): void => {
	if (!qmdInstalled()) {
		console.error("qmd is not installed; cannot apply roster.");
		process.exit(1);
	}

	const skipped: string[] = [];

	for (const repo of roster.repos) {
		const resolvedLocation = resolvePath(repo.location);
		if (!existsSync(resolvedLocation)) {
			console.log(`SKIP ${repo.collection} (${resolvedLocation} not found)`);
			skipped.push(repo.name);
			continue;
		}

		const updateCmd = updateCommand(repo);
		const commands = [];
		const desiredMask = collectionMask(repo);

		if (collectionExists(repo.collection)) {
			const existing = existingCollection(repo.collection);
			if (
				existing &&
				(existing.path !== resolvedLocation ||
					existing.pattern !== desiredMask)
			) {
				console.log(
					`collection ${repo.collection} differs from roster; recreating`,
				);
				commands.push(removeCollectionCommand(repo), collectionCommand(repo));
			} else {
				console.log(
					`collection ${repo.collection} already exists; skipping add`,
				);
			}
		} else {
			commands.push(collectionCommand(repo));
		}

		if (updateCmd) {
			commands.push(updateCmd);
		}

		commands.push(contextCommand(repo), ...pathContextCommands(repo));
		for (const command of commands) {
			const result = spawnSync("sh", ["-lc", command], { stdio: "inherit" });
			if (result.status !== 0) {
				process.exit(result.status ?? 1);
			}
		}
		console.log(`configured ${repo.collection}`);
	}

	if (skipped.length > 0) {
		console.log(
			`\nSkipped ${skipped.length} repos (not on this machine): ${skipped.join(", ")}`,
		);
	}
};

const printStatus = (roster: Roster): void => {
	console.log("# QMD Federation Status");
	console.log("");
	console.log(`roster_exists: ${existsSync(rosterPath)}`);
	console.log(`qmd_installed: ${qmdInstalled()}`);
	for (const repo of roster.repos) {
		console.log(
			`- ${repo.collection} <= ${repo.name} [${collectionMask(repo)}]`,
		);
		if (repo.update_command) {
			console.log(`  update_command: ${repo.update_command}`);
		}
	}
};

const usage = "usage: bun qmd-roster-sync.ts [plan|commands|status|apply]";

const mode = Bun.argv[2] ?? "plan";
const roster = loadRoster();

switch (mode) {
	case "plan":
		printPlan(roster);
		break;
	case "commands":
		printCommands(roster);
		break;
	case "status":
		printStatus(roster);
		break;
	case "apply":
		applyCommands(roster);
		break;
	default:
		console.error(`unknown mode: ${mode}`);
		console.error(usage);
		process.exit(1);
}
