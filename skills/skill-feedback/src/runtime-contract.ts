import type { Stats } from "node:fs";

/**
 * Repository target selected for read commands, or repair-state context.
 */
export type ReadTargetResolution =
	| {
			ok: true;
			explicit: boolean;
			seedPath: string;
			repoRoot: string;
			inboxPath: string;
	  }
	| {
			ok: false;
			explicit: boolean;
			seedPath: string;
			code: "read_target_resolution_failed";
			message: string;
			hint: string;
			gitExitCode?: number;
	  };

/**
 * Public stdin telemetry merged into the receipt.
 *
 * Only `model` is accepted here. Trust-bearing capture fields use
 * `InternalRecordTelemetry`, which is passed by hook code that calls the runner
 * directly instead of piping public `record` stdin.
 */
export type StdinTelemetry = {
	model?: string;
};

/**
 * Runtime adapter for repository, stdin, and private inbox filesystem access.
 */
export type SkillFeedbackRuntime = {
	repoRoot: () => string;
	resolveReadTarget: (targetPath?: string) => Promise<ReadTargetResolution>;
	readGitSha: () => Promise<string>;
	readSkillVersion: (skill: string) => Promise<string>;
	readStdinTelemetry: () => Promise<StdinTelemetry>;
	readStdinText: () => Promise<string>;
	checkIgnored: (repoRoot: string, relativePath: string) => Promise<number>;
	mkdirPrivate: (path: string, mode: number) => Promise<void>;
	writePrivateFile: (path: string, content: string, mode: number) => Promise<void>;
	removeFile: (path: string) => Promise<void>;
	lstatPath: (path: string) => Promise<Stats>;
	realpathPath: (path: string) => Promise<string>;
	readText: (path: string) => Promise<string>;
	nowIso: () => string;
};
