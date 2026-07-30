import { describe, expect, test } from "bun:test";
import {
	type BrowserUseCatalogDigestPort,
	shippedCatalogDigest,
} from "./browser-use-catalog-digest";

function catalogPort(
	entries: Readonly<Record<string, readonly string[]>>,
	hashes: Readonly<Record<string, string>>,
): BrowserUseCatalogDigestPort {
	return {
		async lstat(path) {
			if (path in entries) return { kind: "directory" };
			if (path in hashes) return { kind: "file" };
			return undefined;
		},
		async readDirectory(path) {
			const children = entries[path];
			if (children === undefined) throw new Error(`missing directory: ${path}`);
			return children;
		},
		async hashFile(path) {
			const digest = hashes[path];
			if (digest === undefined) throw new Error(`missing file: ${path}`);
			return digest;
		},
	};
}

describe("shipped catalog digest", () => {
	test("binds sorted relative-path and exact file-hash pairs", async () => {
		const digest = await shippedCatalogDigest(
			"/catalog",
			catalogPort(
				{
					"/catalog": ["zeta", "alpha"],
					"/catalog/zeta": ["flow"],
					"/catalog/zeta/flow": ["runbook.json"],
					"/catalog/alpha": ["flow"],
					"/catalog/alpha/flow": ["runbook.json"],
				},
				{
					"/catalog/zeta/flow/runbook.json": "b".repeat(64),
					"/catalog/alpha/flow/runbook.json": "a".repeat(64),
				},
			),
		);

		expect(digest).toBe(
			"afce15cf4376af03e800db39ded3450772b7b4792a5dbeadc567f040f6ba6b02",
		);
	});
});
