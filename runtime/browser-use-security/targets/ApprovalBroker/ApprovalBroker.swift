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

    private static func canonicalApprovalValue(_ value: Any) throws -> Any {
        if let array = value as? [Any] {
            return try array.map(canonicalApprovalValue)
        }
        if let object = value as? [String: Any] {
            return try object.keys.sorted().map { key in
                [key, try canonicalApprovalValue(object[key]!)] as [Any]
            }
        }
        return value
    }

    private static func hex<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// Issue the signed one-use grant that backs one Human Identity Attestation.
    ///
    /// The request has already passed the command boundary's exact key and
    /// bounded-string checks. This function signs the TypeScript contract's
    /// canonical grant digest, so ordinary Browser Use can verify it offline.
    static func issueHumanIdentityAttestation(
        subject: [String: Any],
        boundFacts: [String: Any],
        signingKey: SecureEnclave.P256.Signing.PrivateKey
    ) throws -> [String: Any] {
        let issuedAt = Int(Date().timeIntervalSince1970 * 1_000)
        let verifierKeyID = hex(SHA256.hash(data: pinnedPublicVerifier(for: signingKey)))
        var unsigned: [String: Any] = [
            "grant_id": "grant-\(UUID().uuidString.lowercased())",
            "subject": subject,
            "bound_facts": boundFacts,
            "issued_at_epoch_ms": issuedAt,
            "expires_at_epoch_ms": issuedAt + 30_000,
            "verifier_key_id": verifierKeyID,
        ]
        let digestKeys = [
            "grant_id",
            "subject",
            "bound_facts",
            "issued_at_epoch_ms",
            "expires_at_epoch_ms",
            "verifier_key_id",
        ]
        let canonicalValues = try digestKeys.map { key in
            try canonicalApprovalValue(unsigned[key]!)
        }
        let canonical = try JSONSerialization.data(
            withJSONObject: canonicalValues,
            options: [.withoutEscapingSlashes]
        )
        let digest = Data(SHA256.hash(data: canonical))
        let signature = try signingKey.signature(for: digest)
        unsigned["signature"] = signature.derRepresentation.base64EncodedString()
        return unsigned
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

private enum PromotionCommandError: Error {
    case invalidInput
    case candidateDigestMismatch
    case reviewCancelled
}

private enum ApprovalBrokerCommandSupport {
    private static let signingKeyHandleDefaultsKey = "reviewed-action-signing-key-handle-v1"
    private static let humanIdentityBoundFactKeys: Set<String> = [
        "service_id",
        "auth_context",
        "environment",
        "profile",
        "origin",
        "runbook_id",
        "action",
        "mutation_class",
        "handoff_evidence_id",
        "lane_id",
        "target_id",
        "subject_reference",
        "account_reference",
        "tenant_reference",
        "mutation_target",
        "mutation_scope",
        "action_policy_hash",
    ]

    static func loadOrCreateSigningKey(
        localizedReason: String
    ) throws -> SecureEnclave.P256.Signing.PrivateKey {
        let context = LAContext()
        context.localizedReason = localizedReason
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

    static func hex<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func verifierIdentity(for key: SecureEnclave.P256.Signing.PrivateKey) -> [String: Any] {
        let raw = ApprovalBroker.pinnedPublicVerifier(for: key)
        return [
            "key_id": hex(SHA256.hash(data: raw)),
            "public_key": raw.base64EncodedString(),
        ]
    }

    static func canonicalData(_ value: Any) throws -> Data {
        try JSONSerialization.data(
            withJSONObject: value,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
    }

    static func reviewExactCandidate(facts: [String: Any], candidateBytes: String) throws {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.activate(ignoringOtherApps: true)

        let factsData = try canonicalData(facts)
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
        request: [String: Any],
        key: SecureEnclave.P256.Signing.PrivateKey
    ) throws -> [String: Any] {
        guard
            let facts = request["facts"] as? [String: Any],
            let candidateBytes = request["candidate_bytes"] as? String,
            let approvalReference = request["approval_reference"] as? String,
            let approvedDigest = facts["approved_digest"] as? String,
            approvalReference.range(of: "^[a-z0-9][a-z0-9-]{0,127}$", options: .regularExpression) != nil
        else {
            throw PromotionCommandError.invalidInput
        }
        let observedDigest = hex(SHA256.hash(data: Data(candidateBytes.utf8)))
        guard observedDigest == approvedDigest else {
            throw PromotionCommandError.candidateDigestMismatch
        }
        try reviewExactCandidate(facts: facts, candidateBytes: candidateBytes)

        let verifier = verifierIdentity(for: key)
        let receiptID = "receipt-\(UUID().uuidString.lowercased())"
        let issuedAt = Int(Date().timeIntervalSince1970 * 1_000)
        var unsigned = facts
        unsigned["receipt_id"] = receiptID
        unsigned["approval_reference"] = approvalReference
        unsigned["issued_at_epoch_ms"] = issuedAt
        unsigned["verifier_key_id"] = verifier["key_id"]
        let factsDigest = SHA256.hash(data: try canonicalData(unsigned))
        let signature = try key.signature(for: Data(factsDigest))

        var receipt = unsigned
        receipt["contract"] = "browser-use.reviewed-action-promotion"
        receipt["schema_version"] = "1"
        receipt["disposition"] = "approved"
        receipt["presence_backed"] = true
        receipt["signature"] = signature.derRepresentation.base64EncodedString()
        return receipt
    }

    static func humanIdentityGrant(
        request: [String: Any],
        key: SecureEnclave.P256.Signing.PrivateKey
    ) throws -> [String: Any] {
        guard
            Set(request.keys) == Set(["subject", "bound_facts", "display"]),
            let subject = request["subject"] as? [String: Any],
            Set(subject.keys) == Set(["purpose", "run_id"]),
            subject["purpose"] as? String == "human-identity-attestation",
            let runID = subject["run_id"] as? String,
            !runID.isEmpty,
            runID.utf8.count <= 512,
            let boundFacts = request["bound_facts"] as? [String: Any],
            Set(boundFacts.keys) == humanIdentityBoundFactKeys,
            let display = request["display"] as? [String],
            display.count > 0,
            display.count <= 16,
            display.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 })
        else {
            throw PromotionCommandError.invalidInput
        }
        for key in humanIdentityBoundFactKeys {
            let value = boundFacts[key]
            if key == "runbook_id", value is NSNull {
                continue
            }
            guard
                let text = value as? String,
                !text.isEmpty,
                text.utf8.count <= 1_024
            else {
                throw PromotionCommandError.invalidInput
            }
        }
        return try ApprovalBroker.issueHumanIdentityAttestation(
            subject: subject,
            boundFacts: boundFacts,
            signingKey: key
        )
    }

    static func write(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes]) else {
            exit(20)
        }
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}

@main
enum ApprovalBrokerCommand {
    static func main() {
        guard CommandLine.arguments.count == 2 else {
            ApprovalBrokerCommandSupport.write(["ok": false, "code": "invalid-command", "message": "expected verifier, promote, or attest mode"])
            exit(20)
        }
        do {
            switch CommandLine.arguments[1] {
            case "verifier":
                let key = try ApprovalBrokerCommandSupport.loadOrCreateSigningKey(
                    localizedReason: "Read the Browser Use approval verifier"
                )
                ApprovalBrokerCommandSupport.write([
                    "ok": true,
                    "verifier": ApprovalBrokerCommandSupport.verifierIdentity(for: key),
                ])
            case "promote":
                let key = try ApprovalBrokerCommandSupport.loadOrCreateSigningKey(
                    localizedReason: "Sign the Reviewed Action promotion receipt"
                )
                let input = FileHandle.standardInput.readDataToEndOfFile()
                guard
                    input.count <= 1_048_576,
                    let request = try JSONSerialization.jsonObject(with: input) as? [String: Any]
                else {
                    throw PromotionCommandError.invalidInput
                }
                let receipt = try ApprovalBrokerCommandSupport.promotionReceipt(request: request, key: key)
                ApprovalBrokerCommandSupport.write(["ok": true, "receipt": receipt])
            case "attest":
                let key = try ApprovalBrokerCommandSupport.loadOrCreateSigningKey(
                    localizedReason: "Confirm this one-run browser identity claim"
                )
                let input = FileHandle.standardInput.readDataToEndOfFile()
                guard
                    input.count <= 1_048_576,
                    let request = try JSONSerialization.jsonObject(with: input) as? [String: Any]
                else {
                    throw PromotionCommandError.invalidInput
                }
                let grant = try ApprovalBrokerCommandSupport.humanIdentityGrant(
                    request: request,
                    key: key
                )
                ApprovalBrokerCommandSupport.write(["ok": true, "grant": grant])
            default:
                throw PromotionCommandError.invalidInput
            }
        } catch PromotionCommandError.reviewCancelled {
            ApprovalBrokerCommandSupport.write(["ok": false, "code": "presence-cancelled", "message": "the human reviewer cancelled promotion"])
            exit(20)
        } catch BrokerError.userPresenceUnavailable {
            ApprovalBrokerCommandSupport.write(["ok": false, "code": "biometric-capability-missing", "message": "Touch ID user presence is unavailable"])
            exit(20)
        } catch BrokerError.userPresenceCancelled {
            ApprovalBrokerCommandSupport.write(["ok": false, "code": "presence-cancelled", "message": "Touch ID user presence was cancelled"])
            exit(20)
        } catch {
            ApprovalBrokerCommandSupport.write(["ok": false, "code": "broker-failed", "message": "the approval broker failed closed"])
            exit(20)
        }
    }
}

// On-demand lifetime: the broker performs one command and exits. No run loop,
// no LaunchAgent, no daemon (ADR 0027).
