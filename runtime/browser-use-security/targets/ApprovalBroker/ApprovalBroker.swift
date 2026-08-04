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
import AppKit
import Security

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
    /// Returns the authenticated `LAContext` on success so the caller can bind
    /// that same live presence evaluation to the Secure Enclave key it creates;
    /// maps cancellation and missing biometric capability to typed errors so the
    /// caller fails only operations that need new human authorization.
    /// Already-valid standing authorization stays verifiable offline and does not
    /// call this.
    @discardableResult
    static func requireUserPresence(for mutation: AuthorizationMutation) throws -> LAContext {
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
        return context
    }

    /// Create the device-bound, non-exportable Secure Enclave signing key.
    ///
    /// Requires user presence (create is a mutation). The private key never
    /// leaves the enclave; the caller receives only its handle and the pinned
    /// public key that verifiers trust. The presence-gated access control and the
    /// live authenticated `LAContext` are both attached to the key, so the
    /// user-presence gate reaches the signing key itself — not just key creation.
    static func createDeviceBoundSigningKey() throws -> SecureEnclave.P256.Signing.PrivateKey {
        let authenticationContext = try requireUserPresence(for: .create)
        guard SecureEnclave.isAvailable else {
            throw BrokerError.secureEnclaveUnavailable
        }
        // SecureEnclave.P256 keys are non-exportable by construction: the key
        // material stays in the enclave and only a persistent representation
        // handle is retained. The access control demands user presence on every
        // private-key usage, and the authenticated context binds this creation to
        // the live Touch ID evaluation above.
        let access = try presenceRequiredAccessControl()
        do {
            return try SecureEnclave.P256.Signing.PrivateKey(
                accessControl: access,
                authenticationContext: authenticationContext
            )
        } catch {
            throw BrokerError.secureEnclaveUnavailable
        }
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
        signingKey.publicKey.x963Representation
    }
}

private enum PromotionCommandError: Error {
    case invalidInput
    case candidateDigestMismatch
    case reviewCancelled
}

private enum ApprovalBrokerCommandSupport {
    private static let signingKeyHandleDefaultsKey = "reviewed-action-signing-key-handle-v1"

    static func loadOrCreateSigningKey() throws -> SecureEnclave.P256.Signing.PrivateKey {
        let context = LAContext()
        context.localizedReason = "Sign the Reviewed Action promotion receipt"
        if let representation = UserDefaults.standard.data(forKey: signingKeyHandleDefaultsKey) {
            return try SecureEnclave.P256.Signing.PrivateKey(
                dataRepresentation: representation,
                authenticationContext: context
            )
        }
        let key = try ApprovalBroker.createDeviceBoundSigningKey()
        UserDefaults.standard.set(key.dataRepresentation, forKey: signingKeyHandleDefaultsKey)
        return key
    }

    static func verifierIdentity(for key: SecureEnclave.P256.Signing.PrivateKey) -> ReviewedActionVerifierIdentity {
        ReviewedActionPromotionProtocol.verifierIdentity(for: key.publicKey)
    }

    static func reviewExactCandidate(facts: [String: Any], candidateBytes: String) throws {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.activate(ignoringOtherApps: true)

        let factsData = try JSONSerialization.data(
            withJSONObject: facts,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        guard let factsText = String(data: factsData, encoding: .utf8) else {
            throw PromotionCommandError.invalidInput
        }
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 720, height: 420))
        textView.isEditable = false
        textView.isSelectable = true
        textView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        textView.string = "MECHANICALLY AUDITED FACTS\n\(factsText)\n\nEXACT CANDIDATE BYTES\n\(candidateBytes)"
        let scrollView = NSScrollView(frame: textView.frame)
        scrollView.hasVerticalScroller = true
        scrollView.documentView = textView

        let alert = NSAlert()
        alert.messageText = "Review exact Reviewed Action bytes"
        alert.informativeText = "Approve only if the exact bytes and every bound fact below are correct. Touch ID signs this one receipt."
        alert.alertStyle = .warning
        alert.accessoryView = scrollView
        alert.addButton(withTitle: "Approve and Sign")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else {
            throw PromotionCommandError.reviewCancelled
        }
    }

    static func promotionReceipt(
        request: ReviewedActionPromotionRequest,
        key: SecureEnclave.P256.Signing.PrivateKey
    ) throws -> ReviewedActionPromotionReceipt {
        let observedDigest = ReviewedActionPromotionProtocol.hex(
            SHA256.hash(data: Data(request.candidate_bytes.utf8))
        )
        guard observedDigest == request.facts.approved_digest else {
            throw PromotionCommandError.candidateDigestMismatch
        }
        try reviewExactCandidate(
            facts: ReviewedActionPromotionProtocol.factsJSONObject(request.facts),
            candidateBytes: request.candidate_bytes
        )

        let verifier = verifierIdentity(for: key)
        let receiptID = "receipt-\(UUID().uuidString.lowercased())"
        let issuedAt = Int64(Date().timeIntervalSince1970 * 1_000)
        let unsigned = try ReviewedActionPromotionProtocol.makeUnsignedReceipt(
            request: request,
            receiptID: receiptID,
            issuedAtEpochMilliseconds: issuedAt,
            verifierKeyID: verifier.key_id
        )
        let digest = Data(SHA256.hash(
            data: try ReviewedActionPromotionProtocol.canonicalPayload(for: unsigned)
        ))
        let signature = try key.signature(for: digest).derRepresentation.base64EncodedString()
        return ReviewedActionPromotionProtocol.withSignature(unsigned, signature: signature)
    }

    static func write(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes]) else {
            exit(20)
        }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }

    static func writeFailure(code: String, message: String) {
        if CommandLine.arguments.count == 2, CommandLine.arguments[1] == "promote",
           let data = try? ReviewedActionPromotionProtocol.encodeResponse(
               .refused(code: code, message: message)
           ) {
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
            return
        }
        write(["ok": false, "code": code, "message": message])
    }
}

@main
enum ApprovalBrokerCommand {
    static func main() {
        guard CommandLine.arguments.count == 2 else {
            ApprovalBrokerCommandSupport.write(["ok": false, "code": "invalid-command", "message": "expected verifier or promote mode"])
            exit(20)
        }
        do {
            let key = try ApprovalBrokerCommandSupport.loadOrCreateSigningKey()
            switch CommandLine.arguments[1] {
            case "verifier":
                let verifier = ApprovalBrokerCommandSupport.verifierIdentity(for: key)
                ApprovalBrokerCommandSupport.write([
                    "ok": true,
                    "verifier": ["key_id": verifier.key_id, "public_key": verifier.public_key],
                ])
            case "promote":
                let input = FileHandle.standardInput.readDataToEndOfFile()
                guard input.count <= 1_048_576 else { throw PromotionCommandError.invalidInput }
                let request = try ReviewedActionPromotionProtocol.decodeRequest(input)
                let receipt = try ApprovalBrokerCommandSupport.promotionReceipt(request: request, key: key)
                let response = try ReviewedActionPromotionProtocol.encodeResponse(.approved(receipt))
                FileHandle.standardOutput.write(response)
                FileHandle.standardOutput.write(Data("\n".utf8))
            default:
                throw PromotionCommandError.invalidInput
            }
        } catch PromotionCommandError.reviewCancelled {
            ApprovalBrokerCommandSupport.writeFailure(code: "presence-cancelled", message: "the human reviewer cancelled promotion")
            exit(20)
        } catch BrokerError.userPresenceUnavailable {
            ApprovalBrokerCommandSupport.writeFailure(code: "biometric-capability-missing", message: "Touch ID user presence is unavailable")
            exit(20)
        } catch BrokerError.userPresenceCancelled {
            ApprovalBrokerCommandSupport.writeFailure(code: "presence-cancelled", message: "Touch ID user presence was cancelled")
            exit(20)
        } catch {
            ApprovalBrokerCommandSupport.writeFailure(code: "broker-failed", message: "the approval broker failed closed")
            exit(20)
        }
    }
}

// On-demand lifetime: the broker performs one command and exits. No run loop,
// no LaunchAgent, no daemon (ADR 0027).
