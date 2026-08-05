import type { BrowserUseItemBinding } from "../../browser-use-auth-bindings";
import {
	createBrowserUseCdpObserver,
	type BrowserUseCdpObserverRequest,
} from "../../browser-use-cdp-observer";
import type {
	BrowserUseDeliveryHook,
	BrowserUseVerifiedTarget,
} from "../../browser-use-confidential-field-delivery";
import {
	runBrowserUseLoginEngine,
	type BrowserUseLoginTargetProof,
} from "../../browser-use-login-engine";
import type {
	BrowserUseOpCredentialField,
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "../../browser-use-op";
import {
	mintBrowserUseVerifiedTarget,
	type BrowserUseDevToolsRequest,
} from "../../browser-use-target-proof";
import {
	LOGIN_FIXTURE_SHAPES,
	loginFixtureHtml,
	type LoginFixtureShape,
} from "./fixture";

type CdpRequest = BrowserUseCdpObserverRequest | BrowserUseDevToolsRequest | {
	method: string;
	params?: Record<string, unknown>;
	sessionId?: string;
};

type PendingRequest = {
	resolve(value: unknown): void;
	reject(error: Error): void;
};

class FlatCdpClient {
	readonly #socket: WebSocket;
	readonly #pending = new Map<number, PendingRequest>();
	#nextId = 0;

	private constructor(socket: WebSocket) {
		this.#socket = socket;
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data)) as {
				id?: number;
				result?: unknown;
				error?: unknown;
			};
			if (message.id === undefined) return;
			const pending = this.#pending.get(message.id);
			if (!pending) return;
			this.#pending.delete(message.id);
			if (message.error !== undefined) {
				pending.reject(new Error(JSON.stringify(message.error)));
			} else {
				pending.resolve(message.result);
			}
		});
	}

	static async connect(endpoint: string): Promise<FlatCdpClient> {
		return await new Promise((resolve, reject) => {
			const socket = new WebSocket(endpoint);
			socket.addEventListener("open", () => resolve(new FlatCdpClient(socket)));
			socket.addEventListener("error", () => reject(new Error("CDP connection failed")));
		});
	}

	async request(request: CdpRequest): Promise<unknown> {
		const id = ++this.#nextId;
		return await new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#socket.send(JSON.stringify({ id, ...request }));
		});
	}

	close(): void {
		this.#socket.close();
	}
}

function objectOf(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: {};
}

async function verifiedEndpoint(): Promise<string> {
	const process = Bun.spawn(
		["browser-connect", "connect", "agent-browser", "--json"],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const output = await new Response(process.stdout).text();
	const exitCode = await process.exited;
	if (exitCode !== 0) throw new Error("browser-connect verification failed");
	const envelope = objectOf(JSON.parse(output));
	const data = objectOf(envelope.data);
	const endpoint = objectOf(data.endpoint).ws;
	if (typeof endpoint !== "string") throw new Error("verified endpoint absent");
	return endpoint;
}

function binding(origin: string, shape: LoginFixtureShape): BrowserUseItemBinding {
	return {
		service_id: shape,
		auth_context: "interactive-login",
		allowed_origins: [origin],
		allowed_login_paths: ["/"],
		vault_id: "fixture-vault",
		item_id: "fixture-item",
		allowed_auth_methods: shape === "matest-otp" ? ["password", "otp"] : ["password"],
		binding_revision: 1,
	};
}

function tokenPort(onCredentialFetch: () => void): BrowserUseTokenRetrievalPort {
	return {
		listVaults: async () => ({ ok: true, vaults: [] }),
		listLoginItems: async () => ({ ok: true, items: [] }),
		getLoginItem: async () => ({
			ok: false,
			rejection: { code: "item-missing", message: "unused by prototype" },
		}),
		fetchCredentialField: async ({ field }) => {
			onCredentialFetch();
			return {
				ok: true,
				handle: {
					handle_id: `dummy-${field}`,
					field,
					expires_at_epoch_ms: 9_999_999_999_999,
				} satisfies BrowserUseSecretHandle,
			};
		},
	};
}

const dummyByField: Readonly<Record<BrowserUseOpCredentialField, string>> = {
	username: "dummy-user",
	password: "dummy-password",
	"otp-current": "123456",
};

async function evaluateProbe(
	client: FlatCdpClient,
	targetId: string,
): Promise<unknown> {
	const attached = objectOf(
		await client.request({
			method: "Target.attachToTarget",
			params: { targetId, flatten: true },
		}),
	);
	const sessionId = attached.sessionId;
	if (typeof sessionId !== "string") throw new Error("target attach failed");
	try {
		const evaluated = objectOf(
			await client.request({
				method: "Runtime.evaluate",
				sessionId,
				params: {
					expression: "window.__probe()",
					returnByValue: true,
				},
			}),
		);
		return objectOf(evaluated.result).value;
	} finally {
		await client.request({
			method: "Target.detachFromTarget",
			params: { sessionId },
		});
	}
}

async function runShape(
	client: FlatCdpClient,
	origin: string,
	shape: LoginFixtureShape,
): Promise<Record<string, unknown>> {
	const url = `${origin}/${shape}`;
	const created = objectOf(
		await client.request({ method: "Target.createTarget", params: { url } }),
	);
	const targetId = created.targetId;
	if (typeof targetId !== "string") throw new Error("fixture target absent");
	await Bun.sleep(250);
	let credentialFetchCount = 0;
	const proofFields = new Map<string, number>();
	const proveTarget: BrowserUseLoginTargetProof = async (input) => {
		const proof = await mintBrowserUseVerifiedTarget(client, input);
		if (proof.ok) {
			proofFields.set(
				proof.target.target_proof_digest,
				proof.target.field.backend_node_id,
			);
		}
		return proof;
	};
	const deliver: BrowserUseDeliveryHook = async ({ field, target }) => {
		const backendNodeId = proofFields.get(target.target_proof_digest);
		if (backendNodeId === undefined) {
			return { ok: false, reason: "target-drift", field_cleared: false };
		}
		const attached = objectOf(
			await client.request({
				method: "Target.attachToTarget",
				params: { targetId: target.target_id, flatten: true },
			}),
		);
		const sessionId = attached.sessionId;
		if (typeof sessionId !== "string") {
			return { ok: false, reason: "helper-unavailable", field_cleared: false };
		}
		try {
			await client.request({
				method: "DOM.focus",
				sessionId,
				params: { backendNodeId },
			});
			const text = dummyByField[field];
			await client.request({
				method: "Input.insertText",
				sessionId,
				params: { text },
			});
			return {
				ok: true,
				shape: { field, byte_length: new TextEncoder().encode(text).byteLength },
			};
		} finally {
			await client.request({
				method: "Target.detachFromTarget",
				params: { sessionId },
			});
		}
	};
	try {
		const result = await runBrowserUseLoginEngine(
			{
				observer: createBrowserUseCdpObserver(client),
				proveTarget,
				tokenRetrieval: tokenPort(() => {
					credentialFetchCount += 1;
				}),
				deliver,
			},
			{
				lane_id: "agent-browser",
				run_id: `prototype-${shape}`,
				target_id: targetId,
				expected_url: url,
				allowed_origins: [origin],
				binding: binding(origin, shape),
			},
		);
		const probe = objectOf(await evaluateProbe(client, targetId));
		return {
			shape,
			engine_ok: result.ok,
			trace: result.trace.map((entry) => entry.step),
			blocked_cause: result.ok ? null : result.blocked.blocked_cause,
			committed: probe.committed,
			activation_count: probe.activationCount,
			credential_fetch_count: credentialFetchCount,
			signed_in: probe.signedIn,
		};
	} finally {
		await client.request({ method: "Target.closeTarget", params: { targetId } });
	}
}

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		const shape = new URL(request.url).pathname.slice(1) as LoginFixtureShape;
		return LOGIN_FIXTURE_SHAPES.includes(shape)
			? new Response(loginFixtureHtml(shape), {
				headers: { "content-type": "text/html; charset=utf-8" },
			})
			: new Response("not found", { status: 404 });
	},
});

const endpoint = await verifiedEndpoint();
const client = await FlatCdpClient.connect(endpoint);
const origin = `http://127.0.0.1:${server.port}`;

try {
	const outcomes: Record<string, unknown>[] = [];
	for (const shape of LOGIN_FIXTURE_SHAPES) {
		const outcome = await runShape(client, origin, shape);
		outcomes.push(outcome);
		console.log(JSON.stringify(outcome));
	}
	const positive = outcomes.filter(
		(outcome) => outcome.shape !== "ambiguous-near-miss",
	);
	const nearMiss = outcomes.find(
		(outcome) => outcome.shape === "ambiguous-near-miss",
	);
	const nearMissCommitted = objectOf(nearMiss?.committed);
	const passed =
		positive.every(
			(outcome) => outcome.engine_ok === true && outcome.signed_in === true,
		) &&
		nearMiss?.engine_ok === false &&
		nearMiss.blocked_cause === "human-identity-attestation-required" &&
		nearMiss.credential_fetch_count === 0 &&
		Object.keys(nearMissCommitted).length > 0 &&
		Object.values(nearMissCommitted).every((value) => value === false) &&
		nearMiss.activation_count === 0;
	console.log(
		JSON.stringify({
			verdict: passed ? "PASS" : "FAIL",
			engine: "runBrowserUseLoginEngine",
			portal_specific_engine_branches: 0,
			positive_shapes: positive.length,
			near_miss_fired: nearMiss?.engine_ok === false,
		}),
	);
	if (!passed) process.exitCode = 1;
} finally {
	client.close();
	server.stop(true);
}
