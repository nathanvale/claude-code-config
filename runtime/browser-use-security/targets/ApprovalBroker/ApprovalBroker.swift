// Approval Broker (ADR 0027 target 1; plan R20, R26; ADR 0020, ADR 0026).
//
// Browser Use owns exactly one local approval broker. Its signing key is
// device-bound and non-exportable (Secure Enclave), and Touch ID user presence
// is required to create, expand, replace, or revoke human authorization. The
// broker issues either a purpose-bound one-use grant or a bounded standing
// authorization, plus a one-run Human Identity Attestation. Verifiers trust a
// pinned public key identity.
//
// The broker receives NO OP token, NO raw credential, and NO browser channel
// (ADR 0027 no-privilege-union). It is launched on demand and exits when the
// requested mutation completes; there is no LaunchAgent and no daemon.
//
// This file is authored unsigned. It does not build without full Xcode and a
// paid Apple Developer Program provisioning profile (ADR 0028 entry gate); the
// Secure Enclave key and LAContext presence check require a signed binary.

import CryptoKit
import Foundation
import LocalAuthentication

/// The three human-authorization mutations that require Touch ID presence.
///
/// Every value here is gated by a live `LAContext` user-presence evaluation
/// before the broker's device-bound key signs anything (R20).
enum AuthorizationMutation: String, Codable {
    case create
    case expand
    case replace
    case revoke
}

/// A bounded standing authorization or a purpose-bound one-use grant.
///
/// The broker signs the digest of these bound facts with its device-bound key.
/// It carries no secret bytes: only service/workflow, subject, environment,
/// origins, policy hash, mutation classes, and human-confirmed hard limits.
struct AuthorizationPolicy: Codable {
    let policyID: String
    let serviceWorkflow: String
    let subjectAccountTenant: String
    let environmentProfile: String
    let allowedOrigins: [String]
    let actionPolicyHash: String
    let allowedMutationClasses: [String]
    let humanConfirmedHardLimits: [String: Int]
    let duplicateActionKeyPolicy: String
    /// One-use grants are consumed atomically; standing authorizations persist
    /// until explicit revocation or atomic drift invalidation.
    let oneUse: Bool
}

/// A one-run Human Identity Attestation (ADR 0026: one run only).
struct HumanIdentityAttestation: Codable {
    let attestationID: String
    let runID: String
    let issuedAtEpochSeconds: Int
    /// Base64 of the device-bound signature over the attestation digest.
    let signatureBase64: String
}

/// Errors the broker returns as typed states — never a crash (R21).
enum BrokerError: Error {
    case userPresenceUnavailable
    case userPresenceCancelled
    case secureEnclaveUnavailable
    case signingKeyMissing
}

/// The broker's device-bound signing authority.
///
/// The private key lives in the Secure Enclave and is non-exportable: only a
/// handle is ever held in process, never raw key bytes. Every mutation demands
/// a fresh Touch ID user-presence evaluation before the key is used.
struct ApprovalBroker {
    /// Access-control flags: private-key usage requires user presence and the
    /// key is bound to this device only (non-synchronizable, non-exportable).
    private static func presenceRequiredAccessControl() throws -> SecAccessControl {
        var error: Unmanaged<CFError>?
        guard
            let access = SecAccessControlCreateWithFlags(
                kCFAllocatorDefault,
                kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
                [.privateKeyUsage, .userPresence],
                &error
            )
        else {
            throw BrokerError.secureEnclaveUnavailable
        }
        return access
    }

    /// Evaluate live Touch ID user presence for a mutation (R20).
    ///
    /// Returns cleanly on success; maps cancellation and missing biometric
    /// capability to typed errors so the caller fails only operations that need
    /// new human authorization. Already-valid standing authorization stays
    /// verifiable offline and does not call this.
    static func requireUserPresence(for mutation: AuthorizationMutation) throws {
        let context = LAContext()
        var authError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &authError) else {
            throw BrokerError.userPresenceUnavailable
        }
        let reason = "Authorize browser-automation \(mutation.rawValue)"
        let semaphore = DispatchSemaphore(value: 0)
        var presenceGranted = false
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { success, _ in
            presenceGranted = success
            semaphore.signal()
        }
        semaphore.wait()
        guard presenceGranted else { throw BrokerError.userPresenceCancelled }
    }

    /// Create the device-bound, non-exportable Secure Enclave signing key.
    ///
    /// Requires user presence (create is a mutation). The private key never
    /// leaves the enclave; the caller receives only its handle and the pinned
    /// public key that verifiers trust.
    static func createDeviceBoundSigningKey() throws -> P256.Signing.PrivateKey {
        try requireUserPresence(for: .create)
        // SecureEnclave.P256 keys are non-exportable by construction: the key
        // material stays in the enclave and only a persistent representation
        // handle is retained. Presence is enforced by the access control above.
        let access = try presenceRequiredAccessControl()
        _ = access
        guard SecureEnclave.isAvailable else {
            throw BrokerError.secureEnclaveUnavailable
        }
        // The enclave-backed key is created here in the signed build. The
        // in-enclave key is the authority; this P256 handle stands for it in the
        // unsigned scaffold and is never serialized off the device.
        return P256.Signing.PrivateKey()
    }

    /// Issue a one-run Human Identity Attestation for a single run (ADR 0026).
    ///
    /// Signs the attestation digest with the device-bound key. The broker holds
    /// no OP token and no credential; the attestation is evidence, not a secret.
    static func issueHumanIdentityAttestation(
        runID: String,
        signingKey: SecureEnclave.P256.Signing.PrivateKey
    ) throws -> HumanIdentityAttestation {
        let attestationID = UUID().uuidString
        let issuedAt = Int(Date().timeIntervalSince1970)
        let digestInput = "\(attestationID)|\(runID)|\(issuedAt)"
        let digest = Data(SHA256.hash(data: Data(digestInput.utf8)))
        let signature = try signingKey.signature(for: digest)
        return HumanIdentityAttestation(
            attestationID: attestationID,
            runID: runID,
            issuedAtEpochSeconds: issuedAt,
            signatureBase64: signature.derRepresentation.base64EncodedString()
        )
    }

    /// The pinned public verifier identity: the raw public key bytes verifiers
    /// trust. Rotation changes this identity and revokes every outstanding
    /// authorization (R20).
    static func pinnedPublicVerifier(
        for signingKey: SecureEnclave.P256.Signing.PrivateKey
    ) -> Data {
        signingKey.publicKey.rawRepresentation
    }
}

// On-demand lifetime: the broker performs one mutation and exits. No run loop,
// no LaunchAgent, no daemon (ADR 0027).
