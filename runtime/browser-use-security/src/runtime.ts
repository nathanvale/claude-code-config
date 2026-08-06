// Injectable admission-runtime seam (U02).
//
// The seam has two adapters. `createNativeAbsentRuntime` is the production
// placeholder: until the signed native product exists it returns the typed
// `native-capability-absent` verdict for every query and never throws — absence
// of native capability is a legal, tested state (ADR 0028), not a crash or a
// stub. `createInMemoryAdmissionRuntime` is the earned second adapter: an
// in-memory fake that verifies a supplied installed manifest against the
// code-owned baseline, so admission logic can be driven end-to-end without a
// signed product on disk.
//
// The fake matches the prod adapter's output shape EXACTLY. A `native-absent`
// verdict from the fake (configured with nothing installed) and from the prod
// placeholder are the same object, byte-for-byte under both compact and pretty
// JSON — the repo feedback memory records a compact-vs-pretty divergence hiding
// a real parse bug, so both adapters build their verdict through the same
// constructors below.

import {
	admitTarget,
	type AdmissionErrorCode,
	type AdmissionManifest,
	claimFromEntry,
} from "./admission.ts";
import {
	type BrowserUseSecurityTargetId,
	BROWSER_USE_SECURITY_TARGET_IDS,
} from "./model.ts";

/**
 * Product-level admission verdict emitted by the runtime seam.
 *
 * `admitted` requires every target to clear. `not-admitted` names the first
 * failing target and its typed {@link AdmissionErrorCode}.
 * `native-capability-absent` is a legal state (ADR 0028): no signed product is
 * installed. All three are produced by the constructors below so every adapter
 * emits the identical shape.
 */
export type ProductAdmissionResult =
	| { verdict: "admitted"; product_version: string }
	| {
			verdict: "not-admitted";
			target_id: BrowserUseSecurityTargetId | null;
			error_code: AdmissionErrorCode;
	  }
	| { verdict: "native-capability-absent" };

/**
 * Per-target admission verdict emitted by the runtime seam. Mirrors
 * {@link ProductAdmissionResult} minus the aggregate `admitted.product_version`.
 */
export type TargetVerifyResult =
	| { verdict: "admitted"; target_id: BrowserUseSecurityTargetId }
	| {
			verdict: "not-admitted";
			target_id: BrowserUseSecurityTargetId | null;
			error_code: AdmissionErrorCode;
	  }
	| { verdict: "native-capability-absent" };

/**
 * The injectable admission runtime. `main(argv, deps)` drives whichever adapter
 * is injected; production wires {@link createNativeAbsentRuntime}, tests inject
 * {@link createInMemoryAdmissionRuntime}.
 */
export interface AdmissionRuntime {
	/** Verify the whole product: admitted only if every target clears. */
	verifyProduct(): Promise<ProductAdmissionResult>;
	/** Verify one target independently (ADR 0027). */
	verifyTarget(target_id: BrowserUseSecurityTargetId): Promise<TargetVerifyResult>;
}

// --- Shared verdict constructors (the parity chokepoint) ---------------------
// Every adapter builds its verdicts here so a `native-absent` (or any) verdict
// is the identical object regardless of which adapter produced it. Do not
// inline these in an adapter — that is exactly how compact-vs-pretty drift
// creeps in.

/** The one `native-capability-absent` product verdict object. */
function nativeAbsentProduct(): ProductAdmissionResult {
	return { verdict: "native-capability-absent" };
}

/** The one `native-capability-absent` target verdict object. */
function nativeAbsentTarget(): TargetVerifyResult {
	return { verdict: "native-capability-absent" };
}

/**
 * Production placeholder adapter.
 *
 * Returns `native-capability-absent` for every query until the signed native
 * product exists (ADR 0028). It never throws: absence is a verdict, not an
 * error. A later unit replaces this with the real adapter that reads the signed
 * install off disk and verifies each target's code-signing evidence.
 *
 * @returns An {@link AdmissionRuntime} that always reports native absence
 *
 * @example
 * ```typescript
 * const runtime = createNativeAbsentRuntime()
 * await runtime.verifyProduct() // { verdict: 'native-capability-absent' }
 * ```
 */
export function createNativeAbsentRuntime(): AdmissionRuntime {
	return {
		verifyProduct: async () => nativeAbsentProduct(),
		verifyTarget: async () => nativeAbsentTarget(),
	};
}

/**
 * Configuration for the in-memory fake adapter.
 *
 * `installed` is the manifest an operator's installed product would present:
 * pass a minted manifest to exercise admission, or `null` to model nothing
 * installed (which yields `native-capability-absent`, identical to the prod
 * placeholder).
 */
export interface InMemoryAdmissionConfig {
	installed: AdmissionManifest | null;
}

/**
 * In-memory fake adapter (the earned second adapter).
 *
 * Verifies the supplied installed manifest against the code-owned baseline: each
 * installed entry becomes an observed claim, checked with {@link admitTarget}
 * against BOTH itself (identity self-consistency) and the code-owned manifest's
 * placeholder guard. With `installed: null` it emits the exact
 * `native-capability-absent` verdict the prod placeholder does — the parity the
 * feedback memory demands.
 *
 * @param config - The installed manifest, or `null` for nothing installed
 * @returns An {@link AdmissionRuntime} backed by the in-memory manifest
 *
 * @example
 * ```typescript
 * const runtime = createInMemoryAdmissionRuntime({ installed: mintedManifest })
 * await runtime.verifyProduct() // { verdict: 'admitted', product_version }
 * ```
 */
export function createInMemoryAdmissionRuntime(
	config: InMemoryAdmissionConfig,
): AdmissionRuntime {
	const installed = config.installed;

	const verifyOne = (
		target_id: BrowserUseSecurityTargetId,
	): TargetVerifyResult => {
		if (installed === null) return nativeAbsentTarget();
		const entry = installed.targets.find((t) => t.target_id === target_id);
		if (!entry) {
			// A removed target: the installed manifest is missing this signed
			// target entirely. Fail closed with the typed unknown-target reason.
			return {
				verdict: "not-admitted",
				target_id,
				error_code: "unknown-target",
			};
		}
		// Verify the installed entry against the installed manifest. Identity
		// (bundle/team/DR/version) is compared to the manifest entry; custody is
		// compared to the code-owned TARGET_POSTURE baseline inside admitTarget, so
		// a widened installed entry is caught even though it is self-consistent.
		// The placeholder guard still bites: an installed manifest carrying
		// placeholder bundle ids is never admitted.
		return admitTarget(installed, claimFromEntry(entry, installed.product_version));
	};

	return {
		verifyTarget: async (target_id) => verifyOne(target_id),
		verifyProduct: async () => {
			if (installed === null) return nativeAbsentProduct();
			for (const target_id of BROWSER_USE_SECURITY_TARGET_IDS) {
				const result = verifyOne(target_id);
				if (result.verdict === "native-capability-absent") {
					return nativeAbsentProduct();
				}
				if (result.verdict === "not-admitted") {
					return {
						verdict: "not-admitted",
						target_id: result.target_id,
						error_code: result.error_code,
					};
				}
			}
			return { verdict: "admitted", product_version: installed.product_version };
		},
	};
}
