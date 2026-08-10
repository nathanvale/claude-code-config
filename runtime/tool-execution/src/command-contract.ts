import {
	defineCommandFacadeContract,
	projectCommandDiscoveryTree,
	type CommandFacadeContract,
} from "@side-quest/cli-command-facade";

export const TOOL_EXECUTION_COMMANDS = [
	"contract",
	"checkpoint",
	"prepare",
	"approve",
	"call",
	"observe",
	"resume",
	"receipts",
] as const;

export type ToolExecutionCommand = (typeof TOOL_EXECUTION_COMMANDS)[number];

export const TOOL_EXECUTION_INPUT_CONTRACTS = {
	prepare: {
		schema_version: 1,
		additional_fields: "rejected",
		required_fields: [
			"adapter",
			"route",
			"checkpoint_id",
			"qualification_cell",
			"request",
		],
		optional_fields: ["deadline_ms"],
		adapters: {
			"firecrawl-cli": {
				route: "firecrawl.search",
				request: {
					required_fields: ["operation", "query"],
					optional_fields: ["options"],
					fixed_values: { operation: "search" },
				},
			},
			"mcporter-cli": {
				route: "mcporter.firecrawl.search",
				request: {
					required_fields: ["server", "tool", "arguments"],
					optional_fields: [],
					fixed_values: {
						server: "firecrawl",
						tool: "firecrawl_search",
					},
				},
			},
		},
		redacted_examples: {
			"firecrawl-cli": {
				adapter: "firecrawl-cli",
				route: "firecrawl.search",
				checkpoint_id: "<active-checkpoint-id>",
				qualification_cell: {
					lane: "explicit_cli",
					client: "tool-execution",
					provider: "firecrawl",
					route: "firecrawl.search",
				},
				request: { operation: "search", query: "<public-query>" },
			},
			"mcporter-cli": {
				adapter: "mcporter-cli",
				route: "mcporter.firecrawl.search",
				checkpoint_id: "<active-checkpoint-id>",
				qualification_cell: {
					lane: "explicit_cli",
					client: "tool-execution",
					provider: "firecrawl",
					route: "mcporter.firecrawl.search",
				},
				request: {
					server: "firecrawl",
					tool: "firecrawl_search",
					arguments: { query: "<public-query>" },
				},
			},
		},
	},
} as const;

const BASE_EXIT_CODES = {
	"0": "Command completed.",
	"1": "Runtime or policy failure.",
	"2": "Invalid command input.",
	"3": "Task approval is required.",
	"4": "Outcome is unknown and automatic continuation stopped.",
} as const;

type ToolExecutionContract = CommandFacadeContract<
	ToolExecutionCommand,
	"agent" | "operator" | "governance",
	string
>;

export const TOOL_EXECUTION_COMMAND_CONTRACTS = defineCommandFacadeContract<
	ToolExecutionCommand,
	ToolExecutionContract
>({
	contract: {
		script: "tool-execution",
		summary: "Show the machine-readable command and result contract.",
		usage: ["tool-execution contract [--json]"],
		json: true,
		audience: "agent",
		mutation: "none",
		sideEffects: ["read"],
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: {
			id: "tool-execution.contract",
			kind: "command_discovery",
			schema_version: 1,
		},
		flags: {
			"--json": { type: "boolean", description: "Emit stable JSON." },
		},
		exitCodes: BASE_EXIT_CODES,
	},
	checkpoint: {
		script: "tool-execution",
		summary: "Read or set the one active execution checkpoint.",
		usage: ["tool-execution checkpoint [--input <path>] [--check] [--json]"],
		json: true,
		audience: "operator",
		mutation: "checkpoint_state",
		sideEffects: ["read", "write"],
		executionModes: ["normal", "check"],
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: {
			id: "tool-execution.checkpoint",
			kind: "checkpoint_card",
			schema_version: 1,
		},
		flags: {
			"--input": { type: "path", description: "Read JSON from a file or dash." },
			"--check": { type: "boolean", description: "Validate without writing." },
			"--json": { type: "boolean", description: "Emit stable JSON." },
		},
		exitCodes: BASE_EXIT_CODES,
	},
	prepare: {
		script: "tool-execution",
		summary: "Prepare a redacted provider request without dispatch.",
		usage: ["tool-execution prepare --input <path> [--check] [--json]"],
		json: true,
		audience: "agent",
		mutation: "receipt_state",
		sideEffects: ["read", "write"],
		executionModes: ["normal", "check"],
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: {
			id: "tool-execution.prepare",
			kind: "prepared_receipt",
			schema_version: 1,
		},
		actionAffordances: {
			continuation: [
				{
					id: "operator_review",
					summary: "Review the prepared route and request fingerprint.",
					sideEffects: ["read"],
				},
			],
		},
		flags: {
			"--input": { type: "path", required: true, description: "Read JSON from a file or dash." },
			"--check": { type: "boolean", description: "Validate without writing." },
			"--json": { type: "boolean", description: "Emit stable JSON." },
		},
		exitCodes: BASE_EXIT_CODES,
	},
	approve: {
		script: "tool-execution",
		summary: "Record one explicit short-lived task-policy decision.",
		usage: ["tool-execution approve --receipt <id> (--approve | --deny) [--check] [--json]"],
		json: true,
		audience: "operator",
		mutation: "approval_state",
		sideEffects: ["read", "write"],
		executionModes: ["normal", "check"],
		outputModes: ["plain", "json"],
		interactivity: "required",
		resultContract: {
			id: "tool-execution.approve",
			kind: "approval_binding",
			schema_version: 1,
		},
		flags: {
			"--receipt": { type: "string", required: true, description: "Select a prepared receipt id." },
			"--approve": { type: "boolean", description: "Record the externally approved task decision." },
			"--deny": { type: "boolean", description: "Record a terminal denial." },
			"--check": { type: "boolean", description: "Validate without writing." },
			"--json": { type: "boolean", description: "Emit stable JSON." },
		},
		exitCodes: BASE_EXIT_CODES,
	},
	call: {
		script: "tool-execution",
		summary: "Run one approved provider request through its selected adapter.",
		usage: ["tool-execution call --receipt <id> --input <path> [--check] [--json]"],
		json: true,
		audience: "operator",
		mutation: "provider_dispatch",
		sideEffects: ["read", "write", "network"],
		executionModes: ["normal", "check"],
		outputModes: ["plain", "json"],
		interactivity: "required",
		resultContract: {
			id: "tool-execution.call",
			kind: "execution_result",
			schema_version: 1,
		},
		flags: {
			"--receipt": { type: "string", required: true, description: "Select an approved receipt id." },
			"--input": { type: "path", required: true, description: "Read matching request JSON from a file or dash." },
			"--check": { type: "boolean", description: "Validate without dispatch." },
			"--json": { type: "boolean", description: "Emit stable JSON." },
		},
		exitCodes: BASE_EXIT_CODES,
	},
	observe: {
		script: "tool-execution",
		summary: "Record provenance-bound native execution evidence.",
		usage: ["tool-execution observe --input <path> [--check] [--json]"],
		json: true,
		audience: "agent",
		mutation: "observation_state",
		sideEffects: ["read", "write"],
		executionModes: ["normal", "check"],
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: {
			id: "tool-execution.observe",
			kind: "native_observation",
			schema_version: 1,
		},
		flags: {
			"--input": { type: "path", required: true, description: "Read redacted evidence JSON from a file or dash." },
			"--check": { type: "boolean", description: "Validate without writing." },
			"--json": { type: "boolean", description: "Emit stable JSON." },
		},
		exitCodes: BASE_EXIT_CODES,
	},
	resume: {
		script: "tool-execution",
		summary: "Inspect durable work and continue only when its state permits.",
		usage: ["tool-execution resume --receipt <id> [--approve-retry] [--check] [--json]"],
		json: true,
		audience: "agent",
		mutation: "receipt_state",
		sideEffects: ["read", "write"],
		executionModes: ["normal", "check"],
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: {
			id: "tool-execution.resume",
			kind: "resume_decision",
			schema_version: 1,
		},
		flags: {
			"--receipt": { type: "string", required: true, description: "Select a durable receipt id." },
			"--approve-retry": { type: "boolean", description: "Record the externally approved retry decision." },
			"--check": { type: "boolean", description: "Validate without writing." },
			"--json": { type: "boolean", description: "Emit stable JSON." },
		},
		exitCodes: BASE_EXIT_CODES,
	},
	receipts: {
		script: "tool-execution",
		summary: "List redacted durable execution receipts.",
		usage: ["tool-execution receipts [--state <state>] [--json]"],
		json: true,
		audience: "governance",
		mutation: "none",
		sideEffects: ["read"],
		outputModes: ["plain", "json"],
		interactivity: "none",
		resultContract: {
			id: "tool-execution.receipts",
			kind: "receipt_list",
			schema_version: 1,
		},
		flags: {
			"--state": {
				type: "enum",
				values: ["prepared", "dispatched", "terminal", "unknown"],
				description: "Filter by durable state.",
			},
			"--json": { type: "boolean", description: "Emit stable JSON." },
		},
		exitCodes: BASE_EXIT_CODES,
	},
});

export const TOOL_EXECUTION_DISCOVERY = projectCommandDiscoveryTree(
	TOOL_EXECUTION_COMMANDS.map(
		(command) =>
			[command, TOOL_EXECUTION_COMMAND_CONTRACTS[command]] as const,
	),
);
