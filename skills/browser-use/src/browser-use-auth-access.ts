import type { BrowserUseTokenRetrievalPort } from "./browser-use-op";

const BROWSER_USE_AUTH_ACCESS_PATHS = [
	"managed-service-token",
	"user-present-desktop",
] as const;

export type BrowserUseAuthAccessPath =
	(typeof BROWSER_USE_AUTH_ACCESS_PATHS)[number];

export type BrowserUseAuthAccessRequest = {
	run_id: string;
	service_id: string;
	environment: string;
	profile: string;
	allowed_origins: readonly string[];
	ttl_ms: number;
};

export type BrowserUseAuthAccessLease = {
	access_path: BrowserUseAuthAccessPath;
	required_vault_scope: "exactly-one-vault";
	expires_at_epoch_ms: number;
	token_retrieval: BrowserUseTokenRetrievalPort;
	release(): Promise<void>;
};

export type BrowserUseAuthAccessProvider = (
	input: BrowserUseAuthAccessRequest,
) => Promise<
	| { ok: true; lease: BrowserUseAuthAccessLease }
	| {
			ok: false;
			cause: "authority-unavailable" | "user-presence-refused";
	  }
>;

export type BrowserUseAuthAccessAcquisition =
	| { ok: true; lease: BrowserUseAuthAccessLease }
	| {
			ok: false;
			cause:
				| "auth-access-unavailable"
				| "auth-access-authority-invalid"
				| "user-presence-refused";
			continuation: {
				next_action_id: "enroll-browser-automation-token";
				summary: string;
			};
	  };

const unavailable = (
	cause:
		| "auth-access-unavailable"
		| "auth-access-authority-invalid"
		| "user-presence-refused",
): BrowserUseAuthAccessAcquisition => ({
	ok: false,
	cause,
	continuation: {
		next_action_id: "enroll-browser-automation-token",
		summary:
			"Enroll managed Browser Authentication authority or authorize one bounded desktop session, then retry the same transaction.",
	},
});

type BrowserUseAuthAccessAttempt =
	| { status: "granted"; lease: BrowserUseAuthAccessLease }
	| { status: "unavailable" | "invalid" | "user-presence-refused" };

function hasTokenRetrievalPort(
	value: unknown,
): value is BrowserUseTokenRetrievalPort {
	if (typeof value !== "object" || value === null) return false;
	const candidate = value as Partial<BrowserUseTokenRetrievalPort>;
	return (
		typeof candidate.listVaults === "function" &&
		typeof candidate.listLoginItems === "function" &&
		typeof candidate.getLoginItem === "function" &&
		typeof candidate.fetchCredentialField === "function"
	);
}

async function releaseInvalidLease(value: unknown): Promise<void> {
	if (typeof value !== "object" || value === null) return;
	const release = (value as { release?: unknown }).release;
	if (typeof release !== "function") return;
	try {
		await release.call(value);
	} catch {
		// Invalid authority still resolves to typed recovery. Never re-enter it.
	}
}

async function acquireFromProvider(input: {
	provider?: BrowserUseAuthAccessProvider;
	request: BrowserUseAuthAccessRequest;
	expectedPath: BrowserUseAuthAccessPath;
	startedAtEpochMs: number;
	now: () => number;
}): Promise<BrowserUseAuthAccessAttempt> {
	if (input.provider === undefined) return { status: "unavailable" };
	let result: Awaited<ReturnType<BrowserUseAuthAccessProvider>>;
	try {
		result = await input.provider(input.request);
	} catch {
		return { status: "invalid" };
	}
	if (!result.ok) {
		return {
			status:
				result.cause === "user-presence-refused"
					? "user-presence-refused"
					: "unavailable",
		};
	}
	const lease = result.lease;
	const expiresWithinRequest =
		Number.isSafeInteger(lease.expires_at_epoch_ms) &&
		lease.expires_at_epoch_ms > input.now() &&
		lease.expires_at_epoch_ms <=
			input.startedAtEpochMs + input.request.ttl_ms;
	if (
		lease.access_path !== input.expectedPath ||
		lease.required_vault_scope !== "exactly-one-vault" ||
		!expiresWithinRequest ||
		!hasTokenRetrievalPort(lease.token_retrieval) ||
		typeof lease.release !== "function"
	) {
		await releaseInvalidLease(lease);
		return { status: "invalid" };
	}
	return { status: "granted", lease };
}

export async function acquireBrowserUseAuthAccess(input: {
	request: BrowserUseAuthAccessRequest;
	now: () => number;
	managed?: BrowserUseAuthAccessProvider;
	userPresent?: BrowserUseAuthAccessProvider;
}): Promise<BrowserUseAuthAccessAcquisition> {
	const startedAtEpochMs = input.now();
	const managed = await acquireFromProvider({
		provider: input.managed,
		request: input.request,
		expectedPath: "managed-service-token",
		startedAtEpochMs,
		now: input.now,
	});
	if (managed.status === "granted") return { ok: true, lease: managed.lease };

	const userPresent = await acquireFromProvider({
		provider: input.userPresent,
		request: input.request,
		expectedPath: "user-present-desktop",
		startedAtEpochMs,
		now: input.now,
	});
	if (userPresent.status === "granted") {
		return { ok: true, lease: userPresent.lease };
	}
	if (userPresent.status === "user-presence-refused") {
		return unavailable("user-presence-refused");
	}
	if (managed.status === "invalid" || userPresent.status === "invalid") {
		return unavailable("auth-access-authority-invalid");
	}
	return unavailable("auth-access-unavailable");
}

export function managedBrowserUseAuthAccessProvider(input: {
	tokenRetrieval: BrowserUseTokenRetrievalPort;
	now: () => number;
}): BrowserUseAuthAccessProvider {
	return async (request) => ({
		ok: true,
		lease: {
			access_path: "managed-service-token",
			required_vault_scope: "exactly-one-vault",
			expires_at_epoch_ms: input.now() + request.ttl_ms,
			token_retrieval: input.tokenRetrieval,
			release: async () => {},
		},
	});
}
