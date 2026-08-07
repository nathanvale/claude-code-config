import { canonicalArraySha256DigestOf } from "./browser-use-auth-model";
import { referenceOf } from "./browser-use-auth-bindings";
import {
	type BrowserUseAuthenticatedStateProof,
	authenticatedStateStructuralEvidence,
} from "./browser-use-login-engine";

function expectedOriginOf(
	expectedUrl: string,
	allowedOrigins: readonly string[],
): string | undefined {
	try {
		const origin = new URL(expectedUrl).origin;
		return allowedOrigins.some((allowedOrigin) => {
			try {
				return new URL(allowedOrigin).origin === origin;
			} catch {
				return false;
			}
		})
			? origin
			: undefined;
	} catch {
		return undefined;
	}
}

function validatedProofOwner(
	owner: BrowserUseAuthenticatedStateProof,
): BrowserUseAuthenticatedStateProof {
	return async (input) => {
		const result = await owner(input);
		if (result.proven && result.proof.target_id !== input.target_id) {
			return { proven: false, cause: "target-proof-invalid" };
		}
		return result;
	};
}

/**
 * Create the production-owned, secret-free Session Identity Proof owner.
 *
 * A seam owner remains bounded by target-id validation. Without one, the
 * in-process owner derives proof only from the approved opaque binding and a
 * fresh accessibility snapshot.
 *
 * @param seamOwner - Optional production security-seam implementation
 * @returns Authenticated-state proof owner with target binding enforced
 * @internal
 */
export function createBrowserUseSessionIdentityProof(
	seamOwner?: BrowserUseAuthenticatedStateProof,
): BrowserUseAuthenticatedStateProof {
	if (seamOwner !== undefined) return validatedProofOwner(seamOwner);

	return async (input) => {
		const origin = expectedOriginOf(input.expected_url, input.allowed_origins);
		if (origin === undefined || input.snapshot.target_id !== input.target_id) {
			return { proven: false, cause: "origin-mismatch" };
		}

		const evidence = authenticatedStateStructuralEvidence(input.snapshot);
		if (
			evidence.has_conflicting_auth_structure ||
			!evidence.has_app_structure ||
			(!evidence.has_signed_in_marker &&
				input.transition === "pre-existing-session")
		) {
			return {
				proven: false,
				cause: "session-identity-proof-unavailable",
			};
		}

		const subjectReference = referenceOf("subject", input.binding);
		const accountReference = referenceOf("account", input.binding);
		const tenantReference = referenceOf("tenant", input.binding);
		const structuralEvidenceKey = JSON.stringify(
			evidence.evidence_nodes
				.map((node) => [node.node_id, node.role, node.accessible_name])
				.sort((left, right) =>
					JSON.stringify(left).localeCompare(JSON.stringify(right)),
				),
		);

		return {
			proven: true,
			proof: {
				target_id: input.target_id,
				page_id: input.target_id,
				frame_id: input.target_id,
				origin,
				subject_reference: subjectReference,
				account_reference: accountReference,
				tenant_reference: tenantReference,
				identity_basis_digest: canonicalArraySha256DigestOf([
					input.lane_id,
					input.run_id,
					input.target_id,
					origin,
					subjectReference,
					accountReference,
					tenantReference,
					input.transition,
					structuralEvidenceKey,
				]),
			},
		};
	};
}
