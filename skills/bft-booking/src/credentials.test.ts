import { describe, expect, test } from "bun:test";

import { CredentialError, credentialsFromItem } from "./credentials.ts";

describe("credentialsFromItem", () => {
	test("maps standard and custom fields without persisting them", () => {
		const credentials = credentialsFromItem(
			{
				fields: [
					{ purpose: "USERNAME", value: "member@example.test" },
					{ purpose: "PASSWORD", value: "private-password" },
					{ label: "branch_id", value: "branch-1" },
					{ label: "namespace", value: "bft" },
					{ label: "x-glofox-access-token", value: "private-app-token" },
				],
			},
			"BFT / Glofox",
		);
		expect(credentials).toEqual({
			login: "member@example.test",
			password: "private-password",
			branchId: "branch-1",
			namespace: "bft",
			headers: { "x-glofox-access-token": "private-app-token" },
			device: "ios",
		});
	});

	test("reports field names, not secret values, when incomplete", () => {
		expect(() =>
			credentialsFromItem(
				{ fields: [{ purpose: "PASSWORD", value: "do-not-print" }] },
				"BFT / Glofox",
			),
		).toThrow(CredentialError);
		try {
			credentialsFromItem(
				{ fields: [{ purpose: "PASSWORD", value: "do-not-print" }] },
				"BFT / Glofox",
			);
		} catch (error) {
			expect(String(error)).not.toContain("do-not-print");
		}
	});
});
