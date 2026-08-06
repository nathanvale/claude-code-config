// Runtime-seam proof (U02). The injectable seam has two adapters: the prod
// placeholder that returns the typed `native-capability-absent` verdict until
// the signed product exists, and the earned in-memory test fake. The fake must
// match the prod adapter's output shape EXACTLY — same envelope, same JSON bytes
// under both compact and pretty serialization (repo feedback: fakes must match
// real output shape). Both adapters go through the same `main(argv, deps)` seam.
import { describe, expect, test } from "bun:test";

import {
	createNativeAbsentRuntime,
	createInMemoryAdmissionRuntime,
	type AdmissionRuntime,
} from "../src/runtime.ts";
import { buildAdmittedManifest } from "../src/admission.ts";
import { TARGET_BUNDLE_IDS } from "../src/model.ts";
import { main } from "../src/cli.ts";

// Built from the real, minted com.side-quest.* bundle ids (TARGET_BUNDLE_IDS),
// which mirror the Xcode targets' PRODUCT_BUNDLE_IDENTIFIER exactly.
const MINTED = buildAdmittedManifest({
	product_version: "1.0.0",
	targets: {
		"approval-broker": {
			bundle_id: TARGET_BUNDLE_IDS["approval-broker"] as string,
			team_identifier: "TEAMID0001",
			designated_requirement: `anchor apple generic and identifier "${TARGET_BUNDLE_IDS["approval-broker"]}"`,
		},
		"token-retrieval-launcher": {
			bundle_id: TARGET_BUNDLE_IDS["token-retrieval-launcher"] as string,
			team_identifier: "TEAMID0001",
			designated_requirement: `anchor apple generic and identifier "${TARGET_BUNDLE_IDS["token-retrieval-launcher"]}"`,
		},
		"confidential-field-delivery-xpc": {
			bundle_id: TARGET_BUNDLE_IDS["confidential-field-delivery-xpc"] as string,
			team_identifier: "TEAMID0001",
			designated_requirement: `anchor apple generic and identifier "${TARGET_BUNDLE_IDS["confidential-field-delivery-xpc"]}"`,
		},
	},
});

/** Collect a CliWriter's writes into one string. */
function makeWriter(): { write: (chunk: string) => boolean; text: () => string } {
	let buffer = "";
	return {
		write: (chunk: string) => {
			buffer += chunk;
			return true;
		},
		text: () => buffer,
	};
}

describe("prod placeholder runtime — native capability absent, fail-closed", () => {
	test("verifyProduct returns the typed native-capability-absent verdict, never throws", async () => {
		const runtime = createNativeAbsentRuntime();
		const result = await runtime.verifyProduct();
		expect(result.verdict).toBe("native-capability-absent");
	});

	test("verifyTarget returns native-capability-absent for every target", async () => {
		const runtime = createNativeAbsentRuntime();
		const result = await runtime.verifyTarget("approval-broker");
		expect(result.verdict).toBe("native-capability-absent");
	});
});

describe("in-memory fake runtime — the earned second adapter", () => {
	test("admits when its installed manifest matches the code-owned baseline", async () => {
		const runtime = createInMemoryAdmissionRuntime({ installed: MINTED });
		const result = await runtime.verifyProduct();
		expect(result.verdict).toBe("admitted");
	});

	test("reports native-capability-absent when nothing is installed", async () => {
		const runtime = createInMemoryAdmissionRuntime({ installed: null });
		const result = await runtime.verifyProduct();
		expect(result.verdict).toBe("native-capability-absent");
	});
});

// --- Fake/real output-shape parity (repo feedback memory) --------------------
// The absent verdict must serialize to identical bytes whether it came from the
// prod placeholder adapter or the in-memory fake configured with nothing
// installed. A compact-vs-pretty divergence is exactly the class of bug the
// feedback memory records, so assert byte-for-byte parity under BOTH forms.
describe("fake matches real output shape (compact + pretty JSON parity)", () => {
	const prodRuntime: AdmissionRuntime = createNativeAbsentRuntime();
	const fakeRuntime: AdmissionRuntime = createInMemoryAdmissionRuntime({
		installed: null,
	});

	test("both adapters produce the identical native-absent product verdict object", async () => {
		const [prod, fake] = await Promise.all([
			prodRuntime.verifyProduct(),
			fakeRuntime.verifyProduct(),
		]);
		expect(fake).toEqual(prod);
	});

	test("compact serialization is byte-identical across adapters", async () => {
		const prod = JSON.stringify(await prodRuntime.verifyProduct());
		const fake = JSON.stringify(await fakeRuntime.verifyProduct());
		expect(fake).toBe(prod);
	});

	test("pretty serialization is byte-identical across adapters", async () => {
		const prod = JSON.stringify(await prodRuntime.verifyProduct(), null, 2);
		const fake = JSON.stringify(await fakeRuntime.verifyProduct(), null, 2);
		expect(fake).toBe(prod);
	});
});

describe("main(argv, deps) seam — drives either adapter in-process", () => {
	test("verify with the in-memory admitted runtime emits admitted, exit 0", async () => {
		const stdout = makeWriter();
		const stderr = makeWriter();
		const code = await main(["verify"], {
			stdout,
			stderr,
			runtime: createInMemoryAdmissionRuntime({ installed: MINTED }),
		});
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.text());
		expect(parsed.verdict).toBe("admitted");
	});

	test("verify with the prod placeholder emits native-capability-absent, exit 0, no crash", async () => {
		const stdout = makeWriter();
		const stderr = makeWriter();
		const code = await main(["verify"], {
			stdout,
			stderr,
			runtime: createNativeAbsentRuntime(),
		});
		expect(code).toBe(0);
		const parsed = JSON.parse(stdout.text());
		expect(parsed.verdict).toBe("native-capability-absent");
	});

	test("verify with a widened in-memory manifest emits not-admitted, exit 20", async () => {
		// Widen the broker to hold the OP token — a custody-union that admission
		// must reject; the seam surfaces it as a fail-closed non-zero exit.
		const widened = {
			...MINTED,
			targets: MINTED.targets.map((t) =>
				t.target_id === "approval-broker"
					? { ...t, entitlements: { ...t.entitlements, holds_op_token: true } }
					: t,
			),
		};
		const stdout = makeWriter();
		const stderr = makeWriter();
		const code = await main(["verify"], {
			stdout,
			stderr,
			runtime: createInMemoryAdmissionRuntime({ installed: widened }),
		});
		expect(code).toBe(20);
		const parsed = JSON.parse(stdout.text());
		expect(parsed.verdict).toBe("not-admitted");
	});

	test("default (bare) invocation renders the typed posture without crashing", async () => {
		const stdout = makeWriter();
		const stderr = makeWriter();
		const code = await main([], {
			stdout,
			stderr,
			runtime: createNativeAbsentRuntime(),
		});
		expect(code).toBe(0);
		expect(stdout.text().length).toBeGreaterThan(0);
	});

	test("unknown command fails closed with a usage exit, no throw", async () => {
		const stdout = makeWriter();
		const stderr = makeWriter();
		const code = await main(["frobnicate"], {
			stdout,
			stderr,
			runtime: createNativeAbsentRuntime(),
		});
		expect(code).toBe(2);
	});
});
