import type {
	BrowserUseOpCommandSpec,
	BrowserUseOpExecute,
	BrowserUseOpExecutionOutcome,
	BrowserUseOpFailureCode,
	BrowserUseTokenRetrievalPort,
} from "./browser-use-op";
import { createOpTokenRetrievalPort } from "./browser-use-op";

const OUTPUT_LIMIT_BYTES = 1_048_576;

type EnvironmentOperation =
	| { kind: "vault-list" }
	| { kind: "item-list"; vaultId: string }
	| { kind: "item-get"; vaultId: string; itemId: string };

type EnvironmentOpDeps = {
	supervisorPath: string;
	opPath: string;
	configRoot: string;
};

function operationOf(spec: BrowserUseOpCommandSpec): EnvironmentOperation | undefined {
	if (spec.capture !== "json-evidence") return undefined;
	const argv = spec.argv;
	if (
		argv.length === 4 &&
		argv[0] === "op" &&
		argv[1] === "vault" &&
		argv[2] === "list" &&
		argv[3] === "--format=json"
	) {
		return { kind: "vault-list" };
	}
	if (
		argv.length === 8 &&
		argv[0] === "op" &&
		argv[1] === "item" &&
		argv[2] === "list" &&
		argv[3] === "--vault" &&
		argv[4] !== undefined &&
		argv[5] === "--categories" &&
		argv[6] === "Login" &&
		argv[7] === "--format=json"
	) {
		return { kind: "item-list", vaultId: argv[4] };
	}
	if (
		argv.length === 7 &&
		argv[0] === "op" &&
		argv[1] === "item" &&
		argv[2] === "get" &&
		argv[3] !== undefined &&
		argv[4] === "--vault" &&
		argv[5] !== undefined &&
		argv[6] === "--format=json"
	) {
		return { kind: "item-get", itemId: argv[3], vaultId: argv[5] };
	}
	return undefined;
}

function invocationFor(
	deps: EnvironmentOpDeps,
	operation: EnvironmentOperation,
): string[] {
	const argv = [
		deps.supervisorPath,
		"metadata",
		"--config-root",
		deps.configRoot,
		"--op-path",
		deps.opPath,
		"--operation",
		operation.kind,
	];
	if ("vaultId" in operation) argv.push("--vault-id", operation.vaultId);
	if ("itemId" in operation) argv.push("--item-id", operation.itemId);
	return argv;
}

async function readBounded(stream: ReadableStream<Uint8Array>): Promise<string> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		total += next.value.byteLength;
		if (total > OUTPUT_LIMIT_BYTES) {
			await reader.cancel();
			throw new Error("native OP output exceeded its bound");
		}
		chunks.push(next.value);
	}
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function failure(code: BrowserUseOpFailureCode): BrowserUseOpExecutionOutcome {
	return {
		kind: "op-failure",
		failure: {
			code,
			message: "native environment-token execution was refused.",
		},
	};
}

function failureCodeOf(code: unknown): BrowserUseOpFailureCode {
	switch (code) {
		case "token-invalid":
			return "token-invalid";
		case "item-missing":
			return "item-missing";
		case "timeout":
			return "timeout";
		case "op-executable-unavailable":
		case "op-path-unavailable":
			return "capability-missing";
		default:
			return "io-failure";
	}
}

function parseResult(value: unknown): BrowserUseOpExecutionOutcome {
	if (
		typeof value !== "object" ||
		value === null ||
		Array.isArray(value) ||
		(value as { schema_version?: unknown }).schema_version !== 1
	) {
		return failure("io-failure");
	}
	const envelope = value as {
		ok?: unknown;
		value?: unknown;
		rejection?: { code?: unknown };
	};
	if (envelope.ok === true && Object.hasOwn(envelope, "value")) {
		return { kind: "json-evidence", value: envelope.value };
	}
	return failure(failureCodeOf(envelope.rejection?.code));
}

function createEnvironmentOpExecute(deps: EnvironmentOpDeps): BrowserUseOpExecute {
	return async (spec) => {
		const operation = operationOf(spec);
		if (operation === undefined) return failure("capability-missing");
		try {
			const child = Bun.spawn(invocationFor(deps, operation), {
				env: { TMPDIR: deps.configRoot },
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
			});
			const stdout = readBounded(child.stdout);
			const stderr = readBounded(child.stderr);
			let timer: ReturnType<typeof setTimeout> | undefined;
			const timedOut = await Promise.race([
				child.exited.then(() => false),
				new Promise<true>((resolve) => {
					timer = setTimeout(() => resolve(true), spec.timeout_ms);
				}),
			]);
			if (timer !== undefined) clearTimeout(timer);
			if (timedOut) {
				child.kill("SIGKILL");
				await child.exited;
				void Promise.allSettled([stdout, stderr]);
				return failure("timeout");
			}
			const exitCode = await child.exited;
			const [stdoutText] = await Promise.all([stdout, stderr]);
			if (child.signalCode != null) return failure("io-failure");
			const result = parseResult(JSON.parse(stdoutText));
			const expectedExit = result.kind === "json-evidence" ? 0 : 20;
			return exitCode === expectedExit ? result : failure("io-failure");
		} catch {
			return failure("io-failure");
		}
	};
}

/** Bind the existing token port to the native owner-only environment token. */
export function createEnvironmentTokenRetrievalPort(
	deps: EnvironmentOpDeps,
): BrowserUseTokenRetrievalPort {
	return createOpTokenRetrievalPort({
		execute: createEnvironmentOpExecute(deps),
		token_handle_id: "environment-token-custody",
	});
}
