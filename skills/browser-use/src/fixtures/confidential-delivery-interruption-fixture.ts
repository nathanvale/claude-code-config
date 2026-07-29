import type { BrowserUseItemBinding } from "../browser-use-auth-bindings";
import {
	type BrowserUseVerifiedTarget,
	deliverConfidentialFields,
} from "../browser-use-confidential-field-delivery";
import type {
	BrowserUseSecretHandle,
	BrowserUseTokenRetrievalPort,
} from "../browser-use-op";
import { deriveConformanceSentinel } from "../browser-use-secret-scan";

const signalPath = process.argv[2];
const nonce = process.argv[3];
if (signalPath === undefined || nonce === undefined) {
	throw new Error("fixture requires signal path and nonce");
}

const binding: BrowserUseItemBinding = {
	service_id: "fixture",
	service_account_id: "service-account-1",
	auth_context: "interactive-login",
	allowed_origins: ["https://fixture.test"],
	allowed_login_paths: [],
	vault_id: "fixture-vault",
	item_id: "fixture-item",
	item_revision: 7,
	allowed_auth_methods: ["password"],
	binding_revision: 1,
};

const target: BrowserUseVerifiedTarget = {
	lane_id: "agent-browser",
	run_id: "run-confidential-interruption",
	top_level_origin: "https://fixture.test",
	frame_origin: "https://fixture.test",
	target_id: "target-1",
	page_id: "page-1",
	frame_id: "frame-1",
	account_ref: "fixture-account",
	target_proof_digest: "d".repeat(32),
};

const tokenRetrieval: BrowserUseTokenRetrievalPort = {
	getServiceAccountIdentity: async () => ({
		ok: true,
		identity: {
			service_account_id: "service-account-1",
			state: "ACTIVE",
			type: "SERVICE_ACCOUNT",
		},
	}),
	listVaults: async () => ({ ok: true, vaults: [] }),
	listLoginItems: async () => ({ ok: true, items: [] }),
	getLoginItem: async () => ({
		ok: false,
		rejection: { code: "item-missing", message: "fixture" },
	}),
	fetchCredentialField: async (
		input,
	): Promise<{ ok: true; handle: BrowserUseSecretHandle }> => ({
		ok: true,
		handle: {
			handle_id: `fixture-${input.field}`,
			field: input.field,
			expires_at_epoch_ms: Date.now() + 60_000,
		},
	}),
};

await deliverConfidentialFields({
	binding,
	target,
	fields: ["password"],
	tokenRetrieval,
	deliver: async () => {
		const sentinel = deriveConformanceSentinel("password", nonce);
		if (!sentinel.ok) throw new Error("fixture sentinel rejected");
		if (sentinel.value.length === 0) throw new Error("fixture sentinel empty");

		// Emit the stdout marker BEFORE raising the signal file the test waits on,
		// and flush it, so the file (which gates the SIGKILL) can only appear once
		// "delivery-engaged" is already on stdout. Otherwise the kill can land in
		// the window between the file write and the flush, making the stdout
		// assertion flaky.
		await new Promise<void>((resolve) => {
			if (process.stdout.write("delivery-engaged\n")) {
				resolve();
				return;
			}
			process.stdout.once("drain", resolve);
		});

		await Bun.write(
			signalPath,
			JSON.stringify({
				event: "delivery-engaged",
				field: "password",
				byte_length: sentinel.value.length,
			}),
		);

		await Bun.sleep(60_000);
		return {
			ok: true,
			shape: { field: "password", byte_length: sentinel.value.length },
		};
	},
	reproveTarget: async () => ({
		proven: true,
		observed_digest: target.target_proof_digest,
	}),
});
