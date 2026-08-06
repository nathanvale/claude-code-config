import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserUsePlatformFs } from "./browser-use-paths";
import {
	type BrowserUseActionGenerationSeam,
	type BrowserUseReviewedActionRecord,
} from "./browser-use-runbook-actions";

type ShippedActionEntry = {
	asset_path: string;
	record: BrowserUseReviewedActionRecord;
};

const SAFE_ASSET_PATH =
	/^[a-z0-9][a-z0-9-]{0,63}\/[a-z0-9][a-z0-9-]{0,63}\.js$/;

function shippedActionsRoot(): string {
	const moduleDir = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(moduleDir, "actions"),
		join(moduleDir, "..", "actions"),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

async function readCatalog(
	fs: BrowserUsePlatformFs,
	root: string,
): Promise<readonly ShippedActionEntry[]> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(
			await fs.readTextFile(join(root, "registry.json")),
		);
	} catch {
		return [];
	}
	if (
		typeof parsed !== "object" ||
		parsed === null ||
		Array.isArray(parsed) ||
		!Array.isArray((parsed as { actions?: unknown }).actions)
	) {
		return [];
	}
	const entries: ShippedActionEntry[] = [];
	for (const candidate of (parsed as { actions: unknown[] }).actions) {
		if (
			typeof candidate !== "object" ||
			candidate === null ||
			Array.isArray(candidate)
		) {
			return [];
		}
		const entry = candidate as {
			asset_path?: unknown;
			record?: unknown;
		};
		if (
			typeof entry.asset_path !== "string" ||
			!SAFE_ASSET_PATH.test(entry.asset_path)
		) {
			return [];
		}
		if (
			typeof entry.record !== "object" ||
			entry.record === null ||
			Array.isArray(entry.record) ||
			typeof (entry.record as { promotion_receipt?: unknown })
				.promotion_receipt !== "object"
		) {
			return [];
		}
		entries.push({
			asset_path: entry.asset_path,
			record: entry.record as BrowserUseReviewedActionRecord,
		});
	}
	return entries;
}

/**
 * Resolve the small code-owned action catalog shipped beside the three
 * daily-driver runbooks.
 */
export function createBrowserUseShippedActionSeam(
	fs: BrowserUsePlatformFs,
): BrowserUseActionGenerationSeam {
	const root = shippedActionsRoot();
	const catalog = readCatalog(fs, root);
	const assets = new Map<
		string,
		Promise<
			| { ok: true; bytes: string }
			| { ok: false; reason: "bytes_unavailable" }
		>
	>();
	return {
		async loadActionRecord(actionId) {
			const entry = (await catalog).find(
				(candidate) => candidate.record.action_id === actionId,
			);
			return entry === undefined
				? { ok: false, absent: true }
				: { ok: true, record: entry.record };
		},
		async loadActionAssetBytes(assetId) {
			const cached = assets.get(assetId);
			if (cached !== undefined) return cached;
			const load = (async () => {
				const entry = (await catalog).find(
				(candidate) => candidate.record.asset_id === assetId,
				);
				if (entry === undefined) {
					return { ok: false as const, reason: "bytes_unavailable" as const };
				}
				try {
					return {
						ok: true as const,
						bytes: await fs.readTextFile(join(root, entry.asset_path)),
					};
				} catch {
					return { ok: false as const, reason: "bytes_unavailable" as const };
				}
			})();
			assets.set(assetId, load);
			return load;
		},
	};
}
