import {
	type CommandFacadeActionAffordance,
	type CommandFacadeContract,
	defineCommandFacadeContract,
	projectCommandDiscoveryTree,
} from "@side-quest/cli-command-facade";
import {
	BROWSER_CONNECT_CLI_NAME,
	BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS,
	BROWSER_CONNECT_CONTRACT_ID,
	type BrowserConnectFailureActionId,
	BROWSER_CONNECT_SCHEMA_VERSION,
	type BrowserConnectSuccessActionId,
	browserConnectFailureActions,
	browserConnectSuccessActions,
} from "./model.ts";

/**
 * Public browser-connect command vocabulary.
 *
 * `dashboard` is the bare, no-arg read-only projection (R15); the dispatcher
 * (U6) routes a bare invocation to it. `check`/`connect`/`run` are the explicit
 * subcommands. Owned here rather than in model.ts because U2's model surface
 * carries envelope vocabulary, not command identity; the CLI surface is the
 * contract owner (facade lane).
 */
export const BROWSER_CONNECT_COMMANDS = [
	"dashboard",
	"check",
	"connect",
	"run",
] as const;

/**
 * Public command union.
 */
export type BrowserConnectCommand = (typeof BROWSER_CONNECT_COMMANDS)[number];

/**
 * browser-connect command audience. `agent` marks the machine surfaces (the
 * envelope consumers); `operator` marks the human-facing dashboard.
 */
export type BrowserConnectAudience = "agent" | "operator";

/**
 * browser-connect mutation class. `browser` marks the connect/run lifecycle that
 * may launch Agent Chrome or exec a wrapped command; `check` marks the
 * read-only dashboard and environment read.
 */
export type BrowserConnectMutation = "check" | "browser";

/**
 * Facade contract type for the public browser-connect CLI.
 */
export type BrowserConnectCommandContract = CommandFacadeContract<
	BrowserConnectCommand,
	BrowserConnectAudience,
	BrowserConnectMutation
>;

/**
 * Package-owned connection-entry exit code (KTD4): warm-chrome's exit-20
 * semantic family, same fail-closed meaning. No adapter fallback.
 *
 * @defaultValue "20"
 */
export const BROWSER_CONNECT_CONNECTION_ENTRY_EXIT_CODE = "20" as const;

/**
 * Package-owned wrapped-command-not-found exit code (KTD4). Distinct from the
 * exit-20 connect family: emitted after the envelope is on stderr plus a second
 * spawn-failure diagnostic line, so it is mechanically distinguishable from a
 * wrapped tool's own exit 127.
 *
 * @defaultValue "127"
 */
export const BROWSER_CONNECT_WRAPPED_NOT_FOUND_EXIT_CODE = "127" as const;

const resultContract = {
	id: BROWSER_CONNECT_CONTRACT_ID,
	kind: "Browser Adapter verified handoff.",
	schema_version: BROWSER_CONNECT_SCHEMA_VERSION,
} as const satisfies NonNullable<
	BrowserConnectCommandContract["resultContract"]
>;

/**
 * Facade-owned global diagnostics accepted before command parsing. `--run-id`
 * carries warm-chrome `--run-id` correlation parity (facade-owned on the outer
 * envelope).
 */
export const BROWSER_CONNECT_GLOBAL_DIAGNOSTIC_FLAGS = [
	"--run-id",
	"--quiet",
	"--verbose",
	"--debug",
] as const;

/**
 * Exit semantics (KTD4): facade baseline 0/1/2 plus package-owned 20 and 127.
 *
 * The exit-20 meaning is agent-visible discovery text and carries the
 * fail-closed, no-fallback continuation meaning the connect/run envelopes
 * enforce (R11). Exit 127 is browser-connect-authored for `run`.
 */
export const browserConnectExitCodes = {
	"0": "Verified handoff, or wrapped command's own zero.",
	"1": "Unexpected runtime failure.",
	"2": "Invalid usage.",
	"20": "Connection entry failure; fail closed, no adapter fallback.",
	"127": "Wrapped command not found; envelope and spawn-failure diagnostic emitted first.",
} as const satisfies BrowserConnectCommandContract["exitCodes"];

/**
 * Connect/run exit semantics: baseline plus 20 plus 127.
 */
export const browserConnectRunExitCodes = browserConnectExitCodes;

/**
 * Read-surface exit semantics (dashboard/check): baseline plus 20. No 127; the
 * wrapped-command spawn path exists only under `run`.
 */
export const browserConnectReadExitCodes = {
	"0": browserConnectExitCodes["0"],
	"1": browserConnectExitCodes["1"],
	"2": browserConnectExitCodes["2"],
	"20": browserConnectExitCodes["20"],
} as const satisfies BrowserConnectCommandContract["exitCodes"];

const jsonFlag = {
	"--json": { type: "boolean", description: "Emit the JSON envelope." },
} as const satisfies BrowserConnectCommandContract["flags"];

const dashboardFlags = {
	...jsonFlag,
} as const satisfies BrowserConnectCommandContract["flags"];

const checkFlags = {
	...jsonFlag,
} as const satisfies BrowserConnectCommandContract["flags"];

const connectFlags = {
	...jsonFlag,
} as const satisfies BrowserConnectCommandContract["flags"];

const runFlags = {
	...jsonFlag,
} as const satisfies BrowserConnectCommandContract["flags"];

const actionAffordances = {
	success: browserConnectSuccessActions,
	failure: browserConnectFailureActions,
} as const satisfies BrowserConnectCommandContract["actionAffordances"];

/**
 * Facade-backed command catalog for the browser-connect CLI (R2/R7/R15/R17).
 *
 * Owns discovery metadata, rendered help, accepted flags, exit semantics, and
 * side-effect declarations for the four-command surface. `connect`/`run`
 * declare the `browser` mutation with a `previewExemption` naming `check` as the
 * read-only preview surface; `dashboard`/`check` stay read-only.
 */
export const browserConnectContracts = defineCommandFacadeContract(
	{
		dashboard: {
			script: BROWSER_CONNECT_CLI_NAME,
			summary:
				"Read-only, stateless dashboard of registered adapters and route evidence; never probes, proves, launches, or persists.",
			usage: ["browser-connect [--json]"],
			json: true,
			audience: "operator",
			mutation: "check",
			// R15: reading never probes attachment, proves an environment, launches,
			// or reads persisted run state; a plain read of static registry data.
			sideEffects: ["read"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			capabilityRoles: ["diagnostic"],
			interactivity: "none",
			resultContract,
			actionAffordances,
			flags: dashboardFlags,
			exitCodes: browserConnectReadExitCodes,
		},
		check: {
			script: BROWSER_CONNECT_CLI_NAME,
			summary:
				"Read the Agent Chrome environment and report verification without changing local state.",
			usage: ["browser-connect check [--json]"],
			json: true,
			audience: "agent",
			mutation: "check",
			sideEffects: ["check", "network"],
			executionModes: ["check"],
			outputModes: ["json", "plain"],
			capabilityRoles: ["diagnostic"],
			interactivity: "none",
			resultContract,
			actionAffordances,
			flags: checkFlags,
			exitCodes: browserConnectReadExitCodes,
		},
		connect: {
			script: BROWSER_CONNECT_CLI_NAME,
			summary:
				"Prove or launch Agent Chrome, run the adapter gate sequence, and emit the verified handoff envelope.",
			usage: ["browser-connect connect <adapter> [--json]"],
			json: true,
			audience: "agent",
			mutation: "browser",
			// connect may launch Agent Chrome as part of the prove-or-launch gate,
			// which writes local browser/profile state through the Agent Chrome
			// implementation; declared honestly as a write effect.
			sideEffects: ["check", "network", "browser", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason:
					"Connect may launch Agent Chrome during the prove-or-launch gate; browser-connect check is the read-only preview surface and never launches.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract,
			actionAffordances,
			flags: connectFlags,
			exitCodes: browserConnectReadExitCodes,
		},
		run: {
			script: BROWSER_CONNECT_CLI_NAME,
			summary:
				"Prove or launch, emit the envelope on stderr, inject the endpoint, then exec the wrapped command with exit passthrough.",
			usage: ["browser-connect run <adapter> [--json] -- <command> [args...]"],
			json: true,
			audience: "agent",
			mutation: "browser",
			// run may launch Agent Chrome (connect gate) and execs the wrapped
			// command; both are honest browser/write-adjacent effects.
			sideEffects: ["check", "network", "browser", "write"],
			executionModes: ["normal"],
			previewExemption: {
				reason:
					"Run may launch Agent Chrome and execs the wrapped command with the caller's authority; browser-connect check is the read-only preview surface and the wrapped command is never previewed.",
			},
			outputModes: ["json", "plain"],
			interactivity: "none",
			resultContract,
			actionAffordances,
			flags: runFlags,
			exitCodes: browserConnectRunExitCodes,
		},
	} as const satisfies Record<
		BrowserConnectCommand,
		BrowserConnectCommandContract
	>,
	{
		path: "runtime/browser-connect/src/command-contract.ts",
		writeImplyingMutations: new Set(["browser"]),
	},
);

/**
 * Contract entries in stable command order.
 */
export const browserConnectContractEntries = BROWSER_CONNECT_COMMANDS.map(
	(command) => [command, browserConnectContracts[command]] as const,
);

/**
 * Agent-visible preview notes projected into command discovery.
 *
 * previewExemption reasons are contract-internal; these notes make the same
 * boundary discoverable: check is the read-only preview surface for connect and
 * run, and the wrapped command (run) is never previewable.
 */
export const BROWSER_CONNECT_PREVIEW_NOTES = {
	connect:
		"Preview with browser-connect check; connect may launch Agent Chrome and check never does.",
	run: "Preview with browser-connect check; run execs the wrapped command with the caller's authority and it cannot be previewed.",
} as const satisfies Partial<Record<BrowserConnectCommand, string>>;

type BrowserConnectDiscoveryAugment = {
	/** Agent-visible preview boundary note for mutating commands. */
	preview_note?: string;
	/** Facade-owned global diagnostics accepted before command parsing. */
	global_diagnostic_flags: typeof BROWSER_CONNECT_GLOBAL_DIAGNOSTIC_FLAGS;
	/**
	 * Compatibility-only action ids (R20): discoverable for released schema-1
	 * consumers, never an outer `continuation.next_action_id`.
	 */
	compatibility_only_action_ids: typeof BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS;
};

/**
 * Command Discovery Tree projection for the browser-connect CLI (R2/R15).
 *
 * Covers all four commands, exit code 20 with its meaning, capability roles,
 * runtime actions, the result contract id, the preview-boundary notes, and
 * the compatibility-only action marking (R20).
 */
export function projectBrowserConnectCommandDiscoveryTree() {
	return projectCommandDiscoveryTree(browserConnectContractEntries, {
		augment: (command): BrowserConnectDiscoveryAugment => {
			const note =
				command in BROWSER_CONNECT_PREVIEW_NOTES
					? BROWSER_CONNECT_PREVIEW_NOTES[
							command as keyof typeof BROWSER_CONNECT_PREVIEW_NOTES
						]
					: undefined;
			return {
				global_diagnostic_flags: BROWSER_CONNECT_GLOBAL_DIAGNOSTIC_FLAGS,
				compatibility_only_action_ids:
					BROWSER_CONNECT_COMPATIBILITY_ONLY_ACTION_IDS,
				...(note === undefined ? {} : { preview_note: note }),
			};
		},
	});
}

// Re-export the action affordance shape for tests that assert action id
// vocabulary against the contract without re-importing model internals.
export type {
	BrowserConnectFailureActionId,
	BrowserConnectSuccessActionId,
};
export const browserConnectContractFailureActions: readonly (CommandFacadeActionAffordance & {
	id: BrowserConnectFailureActionId;
})[] = browserConnectFailureActions;
export const browserConnectContractSuccessActions: readonly (CommandFacadeActionAffordance & {
	id: BrowserConnectSuccessActionId;
})[] = browserConnectSuccessActions;
