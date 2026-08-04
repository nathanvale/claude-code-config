import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	BrowserUseReviewedActionApprovalFacts,
	BrowserUseReviewedActionPromotionReceipt,
	BrowserUseReviewedActionVerifierIdentity,
} from "./browser-use-reviewed-action-approval";
import { createNativeReviewedActionOperatorBroker } from "./browser-use-reviewed-action-promotion";

const cleanup = new Set<string>();

afterEach(async () => {
	for (const path of cleanup) await rm(path, { recursive: true, force: true });
	cleanup.clear();
});

async function promotionFixture() {
	return JSON.parse(
		await readFile(
			new URL(
				"../../../runtime/browser-use-security/targets/ApprovalBrokerTests/Fixtures/reviewed-action-promotion-v1.json",
				import.meta.url,
			),
			"utf8",
		),
	) as {
		approved_response: {
			ok: true;
			receipt: BrowserUseReviewedActionPromotionReceipt;
		};
		refused_response: {
			ok: false;
			code: "presence-cancelled";
			message: string;
		};
		request: {
			facts: BrowserUseReviewedActionApprovalFacts;
			candidate_bytes: string;
			approval_reference: string;
		};
		receipt: BrowserUseReviewedActionPromotionReceipt;
		verifier: BrowserUseReviewedActionVerifierIdentity;
	};
}

async function writeBrokerScript(root: string, body: string): Promise<string> {
	const executable = join(root, "ApprovalBroker");
	await writeFile(executable, `#!/bin/sh\n${body}\n`);
	await chmod(executable, 0o700);
	return executable;
}

describe("native Reviewed Action promotion broker", () => {
	test("sends the versioned exact-facts request and admits the signed broker response", async () => {
		const fixture = await promotionFixture();
		const root = await mkdtemp(join(tmpdir(), "reviewed-action-broker-"));
		cleanup.add(root);
		const requestPath = join(root, "request.json");
		const verifierEnvelope = JSON.stringify({ ok: true, verifier: fixture.verifier });
		const responseEnvelope = JSON.stringify(fixture.approved_response);
		const executable = await writeBrokerScript(
			root,
			`case "$1" in\n  verifier) printf '%s\\n' '${verifierEnvelope}' ;;\n  promote) IFS= read -r request; printf '%s\\n' "$request" > '${requestPath}'; printf '%s\\n' '${responseEnvelope}' ;;\n  *) exit 20 ;;\nesac`,
		);
		const broker = createNativeReviewedActionOperatorBroker(executable);

		expect(await broker.readVerifierIdentity()).toEqual({
			ok: true,
			identity: fixture.verifier,
		});
		expect(
			await broker.issueReviewedActionPromotion(fixture.request),
		).toMatchObject({ ok: true, receipt: fixture.receipt });
		expect(JSON.parse(await readFile(requestPath, "utf8"))).toEqual({
			contract: "browser-use.reviewed-action-promotion-request",
			schema_version: "1",
			...fixture.request,
		});
	});

	test("preserves a typed presence refusal carried by exit 20", async () => {
		const fixture = await promotionFixture();
		const root = await mkdtemp(join(tmpdir(), "reviewed-action-broker-"));
		cleanup.add(root);
		const responseEnvelope = JSON.stringify(fixture.refused_response);
		const executable = await writeBrokerScript(
			root,
			`IFS= read -r request\nprintf '%s\\n' '${responseEnvelope}'\nexit 20`,
		);

		expect(
			await createNativeReviewedActionOperatorBroker(
				executable,
			).issueReviewedActionPromotion(fixture.request),
		).toEqual({
			ok: false,
			rejection: {
				code: fixture.refused_response.code,
				message: fixture.refused_response.message,
			},
		});
	});

	test("rejects extra broker response fields and malformed receipts", async () => {
		const fixture = await promotionFixture();
		const cases = [
			{ ...fixture.approved_response, contract: "untrusted" },
			{
				...fixture.approved_response,
				receipt: { ...fixture.receipt, extra: true },
			},
			{ ...fixture.refused_response, extra: true },
		];

		for (const response of cases) {
			const root = await mkdtemp(join(tmpdir(), "reviewed-action-broker-"));
			cleanup.add(root);
			const executable = await writeBrokerScript(
				root,
				`IFS= read -r request\nprintf '%s\\n' '${JSON.stringify(response)}'`,
			);

			expect(
				await createNativeReviewedActionOperatorBroker(
					executable,
				).issueReviewedActionPromotion(fixture.request),
			).toMatchObject({
				ok: false,
				rejection: { code: "broker-response-unknown" },
			});
		}
	});

	test("classifies a lost broker response as unknown without retrying", async () => {
		const fixture = await promotionFixture();
		const root = await mkdtemp(join(tmpdir(), "reviewed-action-broker-"));
		cleanup.add(root);
		const countPath = join(root, "count");
		const executable = await writeBrokerScript(
			root,
			`IFS= read -r request\nprintf 'one' >> '${countPath}'\nexit 20`,
		);

		expect(
			await createNativeReviewedActionOperatorBroker(
				executable,
			).issueReviewedActionPromotion(fixture.request),
		).toMatchObject({
			ok: false,
			rejection: { code: "broker-response-unknown" },
		});
		expect(await readFile(countPath, "utf8")).toBe("one");
	});
});
