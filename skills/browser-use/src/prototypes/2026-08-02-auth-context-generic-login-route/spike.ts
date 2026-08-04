import type { BrowserUseItemBinding } from "../../browser-use-auth-bindings";
import {
	createBrowserUseCdpObserver,
	type BrowserUseCdpObserverRequest,
} from "../../browser-use-cdp-observer";
import type {
	BrowserUseDeliveryHook,
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
import { AUTH_ROUTE_SHAPES, authRouteFixtureHtml, type AuthRouteShape } from "./fixture";

type CdpRequest = BrowserUseCdpObserverRequest | BrowserUseDevToolsRequest | {
	method: string;
	params?: Record<string, unknown>;
	sessionId?: string;
};

type PendingRequest = { resolve(value: unknown): void; reject(error: Error): void };

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
			if (message.error !== undefined) pending.reject(new Error(JSON.stringify(message.error)));
			else pending.resolve(message.result);
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
	const process = Bun.spawn(["browser-connect", "connect", "agent-browser", "--json"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const output = await new Response(process.stdout).text();
	const exitCode = await process.exited;
	if (exitCode !== 0) throw new Error("browser-connect verification failed");
	const envelope = objectOf(JSON.parse(output));
	const data = objectOf(envelope.data);
	const endpoint = objectOf(data.endpoint).ws;
	if (typeof endpoint !== "string") throw new Error("verified endpoint absent");
	return endpoint;
}

/**
 * Throwaway runbook fixture. Carries an auth-context ref and one business step,
 * and — per ADR 0032/0033 — no username, password, or OTP steps of its own.
 */
type RouteRunbook = {
	service_id: string;
	flow_id: string;
	auth_context_ref: string;
	business_step: { role: string; name: string };
};

function routeRunbook(shape: AuthRouteShape): RouteRunbook {
	return {
		service_id: shape,
		flow_id: "auth-route-spike",
		auth_context_ref: "interactive-login",
		business_step: { role: "button", name: "Submit timesheet" },
	};
}

function binding(origin: string, ref: string): BrowserUseItemBinding {
	return {
		service_id: ref,
		// Closed auth-context vocabulary; the runbook's auth_context_ref resolves
		// to the single interactive-login context.
		auth_context: "interactive-login",
		allowed_origins: [origin],
		allowed_login_paths: ["/"],
		vault_id: "fixture-vault",
		item_id: "fixture-item",
		allowed_auth_methods: ["password"],
		binding_revision: 1,
	};
}

function tokenPort(): BrowserUseTokenRetrievalPort {
	return {
		listVaults: async () => ({ ok: true, vaults: [] }),
		listLoginItems: async () => ({ ok: true, items: [] }),
		getLoginItem: async () => ({
			ok: false,
			rejection: { code: "item-missing", message: "unused by prototype" },
		}),
		fetchCredentialField: async ({ field }) => ({
			ok: true,
			handle: {
				handle_id: `dummy-${field}`,
				field,
				expires_at_epoch_ms: 9_999_999_999_999,
			} satisfies BrowserUseSecretHandle,
		}),
	};
}

const dummyByField: Readonly<Record<BrowserUseOpCredentialField, string>> = {
	username: "dummy-user",
	password: "dummy-password",
	"otp-current": "123456",
};

async function evaluateProbe(client: FlatCdpClient, targetId: string): Promise<Record<string, unknown>> {
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
				params: { expression: "window.__probe()", returnByValue: true },
			}),
		);
		return objectOf(objectOf(evaluated.result).value);
	} finally {
		await client.request({ method: "Target.detachFromTarget", params: { sessionId } });
	}
}

/**
 * Throwaway business-step dispatch. Clicks the labelled business control by
 * role+name through a trusted mouse-event sequence. This stands in for the
 * runbook execution boundary above the login engine; it must never run before
 * authentication succeeds.
 */
async function dispatchBusinessStep(
	client: FlatCdpClient,
	targetId: string,
	step: { role: string; name: string },
): Promise<boolean> {
	const attached = objectOf(
		await client.request({
			method: "Target.attachToTarget",
			params: { targetId, flatten: true },
		}),
	);
	const sessionId = attached.sessionId;
	if (typeof sessionId !== "string") return false;
	try {
		const evaluated = objectOf(
			await client.request({
				method: "Runtime.evaluate",
				sessionId,
				params: {
					expression: `(() => {
						const el = [...document.querySelectorAll('button')]
							.find((b) => b.textContent.trim() === ${JSON.stringify(step.name)});
						if (!el) return false;
						el.click();
						return true;
					})()`,
					returnByValue: true,
				},
			}),
		);
		return objectOf(evaluated.result).value === true;
	} finally {
		await client.request({ method: "Target.detachFromTarget", params: { sessionId } });
	}
}

async function runShape(
	client: FlatCdpClient,
	origin: string,
	shape: AuthRouteShape,
): Promise<Record<string, unknown>> {
	const runbook = routeRunbook(shape);
	// Run identity is minted once from the runbook and carried through the whole
	// route: engine input, and (if reached) the business dispatch resume record.
	const runId = `route-${runbook.service_id}-${runbook.flow_id}`;
	const url = `${origin}/${shape}`;
	const created = objectOf(
		await client.request({ method: "Target.createTarget", params: { url } }),
	);
	const targetId = created.targetId;
	if (typeof targetId !== "string") throw new Error("fixture target absent");
	await Bun.sleep(250);

	const proofFields = new Map<string, number>();
	const proveTarget: BrowserUseLoginTargetProof = async (input) => {
		const proof = await mintBrowserUseVerifiedTarget(client, input);
		if (proof.ok) {
			proofFields.set(proof.target.target_proof_digest, proof.target.field.backend_node_id);
		}
		return proof;
	};
	const deliver: BrowserUseDeliveryHook = async ({ field, target }) => {
		const backendNodeId = proofFields.get(target.target_proof_digest);
		if (backendNodeId === undefined) return { ok: false, reason: "target-drift", field_cleared: false };
		const attached = objectOf(
			await client.request({
				method: "Target.attachToTarget",
				params: { targetId: target.target_id, flatten: true },
			}),
		);
		const sessionId = attached.sessionId;
		if (typeof sessionId !== "string") return { ok: false, reason: "helper-unavailable", field_cleared: false };
		try {
			await client.request({ method: "DOM.focus", sessionId, params: { backendNodeId } });
			const text = dummyByField[field];
			await client.request({ method: "Input.insertText", sessionId, params: { text } });
			return { ok: true, shape: { field, byte_length: new TextEncoder().encode(text).byteLength } };
		} finally {
			await client.request({ method: "Target.detachFromTarget", params: { sessionId } });
		}
	};

	try {
		// State BEFORE the auth route: business counter must be zero.
		const before = await evaluateProbe(client, targetId);

		// Authentication transaction: the runbook's auth_context_ref resolves the
		// binding; the generic engine owns the current page shape. No login steps
		// live in the runbook itself.
		const result = await runBrowserUseLoginEngine(
			{
				observer: createBrowserUseCdpObserver(client),
				proveTarget,
				tokenRetrieval: tokenPort(),
				deliver,
			},
			{
				lane_id: "agent-browser",
				run_id: runId,
				target_id: targetId,
				expected_url: url,
				allowed_origins: [origin],
				binding: binding(origin, runbook.auth_context_ref),
			},
		);

		const afterAuth = await evaluateProbe(client, targetId);

		// Business step dispatches ONLY on auth success, under the same run id.
		let businessDispatched = false;
		let resumeRunId: string | null = null;
		if (result.ok) {
			businessDispatched = await dispatchBusinessStep(client, targetId, runbook.business_step);
			resumeRunId = runId; // same identity resumes the run after auth
		}

		const afterBusiness = await evaluateProbe(client, targetId);
		return {
			shape,
			run_id: runId,
			resume_run_id: resumeRunId,
			engine_ok: result.ok,
			blocked_cause: result.ok ? null : result.blocked.blocked_cause,
			business_before_auth: before.businessCount,
			business_after_auth: afterAuth.businessCount,
			business_after_dispatch: afterBusiness.businessCount,
			business_dispatched: businessDispatched,
			signed_in: afterBusiness.signedIn,
		};
	} finally {
		await client.request({ method: "Target.closeTarget", params: { targetId } });
	}
}

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		const shape = new URL(request.url).pathname.slice(1) as AuthRouteShape;
		return AUTH_ROUTE_SHAPES.includes(shape)
			? new Response(authRouteFixtureHtml(shape), {
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
	for (const shape of AUTH_ROUTE_SHAPES) {
		const outcome = await runShape(client, origin, shape);
		outcomes.push(outcome);
		console.log(JSON.stringify(outcome));
	}

	const positive = outcomes.find((o) => o.shape === "multistep-then-business");
	const nearMiss = outcomes.find((o) => o.shape === "ambiguous-near-miss");

	const positivePass =
		positive?.engine_ok === true &&
		positive.business_before_auth === 0 &&
		positive.business_after_auth === 0 &&
		positive.business_after_dispatch === 1 &&
		positive.business_dispatched === true &&
		positive.resume_run_id === positive.run_id &&
		positive.signed_in === true;

	const nearMissPass =
		nearMiss?.engine_ok === false &&
		nearMiss.blocked_cause === "human-identity-attestation-required" &&
		nearMiss.business_before_auth === 0 &&
		nearMiss.business_after_dispatch === 0 &&
		nearMiss.business_dispatched === false &&
		nearMiss.resume_run_id === null;

	const passed = positivePass && nearMissPass;
	console.log(
		JSON.stringify({
			verdict: passed ? "PASS" : "FAIL",
			route: "auth_context_ref -> generic login engine -> business step",
			positive_pass: positivePass,
			near_miss_pass: nearMissPass,
			adapter_proven: "agent-browser",
		}),
	);
	if (!passed) process.exitCode = 1;
} finally {
	client.close();
	server.stop(true);
}
