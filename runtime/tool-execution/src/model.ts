export const TOOL_EXECUTION_SCHEMA_VERSION = 1 as const;

export const TOOL_EXECUTION_ADAPTERS = [
	"firecrawl-cli",
	"mcporter-cli",
] as const;
export type ToolExecutionAdapter = (typeof TOOL_EXECUTION_ADAPTERS)[number];

export const QUALIFICATION_LANES = [
	"claude_code_cli",
	"codex_cli_tui",
	"codex_desktop",
	"explicit_cli",
] as const;
export type QualificationLane = (typeof QUALIFICATION_LANES)[number];

export type QualificationCell = {
	lane: QualificationLane;
	client: string;
	provider: string;
	route: string;
};

export const RECEIPT_STATES = [
	"prepared",
	"dispatched",
	"terminal",
	"unknown",
] as const;
export type ReceiptState = (typeof RECEIPT_STATES)[number];

export type ReceiptResultSummary = {
	class:
		| "transport_or_client_policy_failure"
		| "jsonrpc_protocol_or_server_error"
		| "tool_error"
		| "successful_tool_result";
	code?: string;
	result_fingerprint?: string;
};

export type ApprovalBinding = {
	approval_surface: "task_policy";
	approved_at: string;
	expires_at: string;
	request_fingerprint: string;
	route: string;
	attempt: number;
	checkpoint_id: string;
};

export type ExecutionReceipt = {
	schema_version: typeof TOOL_EXECUTION_SCHEMA_VERSION;
	receipt_id: string;
	attempt: number;
	linked_receipt_id?: string;
	adapter: ToolExecutionAdapter;
	route: string;
	checkpoint_id: string;
	qualification_cell: QualificationCell;
	request_fingerprint: string;
	config_fingerprint: string;
	state: ReceiptState;
	created_at: string;
	updated_at: string;
	approval?: ApprovalBinding;
	provider_operation_id?: string;
	result?: ReceiptResultSummary;
	terminal_reason?: string;
};

type PreparedRequestBase = {
	route: string;
	checkpoint_id: string;
	qualification_cell: QualificationCell;
	deadline_ms?: number;
};

export type PreparedRequest = PreparedRequestBase &
	(
		| {
				adapter: "firecrawl-cli";
				request: {
					operation: string;
					query: string;
					options?: Record<string, unknown>;
				};
		  }
		| {
				adapter: "mcporter-cli";
				request: {
					server: string;
					tool: string;
					arguments: Record<string, unknown>;
				};
		  }
	);

export type PreparedAdapterInvocation = {
	command: string;
	args: readonly string[];
	stdinText?: string;
};

export type CheckpointCard = {
	schema_version: typeof TOOL_EXECUTION_SCHEMA_VERSION;
	id: string;
	position: number;
	total: number;
	objective: string;
	owner: string;
	expected: string;
	stop: string;
	rollback: string;
	next: string;
	active: boolean;
	native_observation_binding?: {
		qualification_cell: QualificationCell;
		client: string;
		process_identity: string;
		query_fingerprint: string;
		config_fingerprint: string;
		route: string;
		evidence_source: string;
		max_age_ms: number;
	};
};

export type NativeObservation = {
	qualification_cell: QualificationCell;
	client: string;
	process_identity: string;
	invoked_at: string;
	query_fingerprint: string;
	config_fingerprint: string;
	route: string;
	evidence_source: string;
	result: ReceiptResultSummary;
};
