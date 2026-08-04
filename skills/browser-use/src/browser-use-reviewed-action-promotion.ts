import { lstat, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	type BrowserUseReviewedActionPromotionBrokerPort,
	type BrowserUseReviewedActionVerifierIdentity,
	REVIEWED_ACTION_VERIFIER_CONTRACT,
	REVIEWED_ACTION_VERIFIER_FILE,
	REVIEWED_ACTION_VERIFIER_SCHEMA_VERSION,
	createP256ReviewedActionApprovalVerifier,
	createReviewedActionPromotionRouter,
} from "./browser-use-reviewed-action-approval";
import { promoteReviewedActionCandidate } from "./browser-use-reviewed-action-authoring";
import { resolveBrowserUsePaths } from "./browser-use-paths";

const VERIFIER_CONTRACT = REVIEWED_ACTION_VERIFIER_CONTRACT;
const VERIFIER_SCHEMA_VERSION = REVIEWED_ACTION_VERIFIER_SCHEMA_VERSION;
const VERIFIER_FILE = REVIEWED_ACTION_VERIFIER_FILE;

/** Operator broker surface: public identity discovery plus presence-backed issuance. */
export type BrowserUseReviewedActionOperatorBroker =
	BrowserUseReviewedActionPromotionBrokerPort & {
		readVerifierIdentity(): Promise<
			| { ok: true; identity: BrowserUseReviewedActionVerifierIdentity }
			| { ok: false; code: string; message: string }
		>;
	};

async function pinVerifierIdentity(
	env: Record<string, string | undefined>,
	identity: BrowserUseReviewedActionVerifierIdentity,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
	const resolved = resolveBrowserUsePaths(env);
	if (!resolved.ok) return { ok: false, code: resolved.refusal.code, message: resolved.refusal.message };
	const configRoot = resolved.resolution.roots.config;
	const path = join(configRoot, VERIFIER_FILE);
	try {
		await mkdir(configRoot, { recursive: true, mode: 0o700 });
		const rootStat = await lstat(configRoot);
		const uid = process.getuid?.();
		if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || (rootStat.mode & 0o077) !== 0 || (uid !== undefined && rootStat.uid !== uid)) {
			return { ok: false, code: "action_promotion_verifier_store_unsafe", message: "the Browser Use config root is not private and owner-controlled." };
		}
		const bytes = `${JSON.stringify({ contract: VERIFIER_CONTRACT, schema_version: VERIFIER_SCHEMA_VERSION, ...identity }, null, 2)}\n`;
		const existing = await readFile(path, "utf8").catch(() => undefined);
		if (existing !== undefined) {
			const stat = await lstat(path);
			if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || existing !== bytes) {
				return { ok: false, code: "action_promotion_verifier_pin_mismatch", message: "the pinned Reviewed Action verifier differs from the admitted broker." };
			}
			return { ok: true };
		}
		const handle = await open(path, "wx", 0o600);
		try {
			await handle.writeFile(bytes, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		return { ok: true };
	} catch {
		return { ok: false, code: "action_promotion_verifier_store_unsafe", message: "the Reviewed Action verifier pin could not be persisted safely." };
	}
}

/** Run the complete operator-only, presence-backed promotion transaction. */
export async function runReviewedActionPromotionFrontDoor(input: {
	sourceRoot: string;
	actionId: string;
	approvalReference: string;
	env: Record<string, string | undefined>;
	broker: BrowserUseReviewedActionOperatorBroker;
}) {
	const identity = await input.broker.readVerifierIdentity();
	if (!identity.ok) return identity;
	const pinned = await pinVerifierIdentity(input.env, identity.identity);
	if (!pinned.ok) return pinned;
	const verifier = createP256ReviewedActionApprovalVerifier(identity.identity);
	return promoteReviewedActionCandidate({
		sourceRoot: input.sourceRoot,
		actionId: input.actionId,
		approvalReference: input.approvalReference,
		router: createReviewedActionPromotionRouter({ broker: input.broker, verifier }),
		verifier,
	});
}
