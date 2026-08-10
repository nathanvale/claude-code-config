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
    case signingKeyAmbiguous
    case signingKeyCustodyMismatch
    case signingKeyAlreadyEnrolled
    case legacySigningKeyMissing
    case legacySigningKeyReconstructionFailed
    case legacySigningKeyPresenceFailed
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
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.activate(ignoringOtherApps: true)
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

    /// Sign one complete immutable Item Binding revision after local review.
    static func issueBindingApproval(
        disposition: String,
        resolutionKey: [String: Any],
        binding: [String: Any],
        predecessorReceiptID: Any,
        signingKey: SecureEnclave.P256.Signing.PrivateKey
    ) throws -> [String: Any] {
        let issuedAt = Int(Date().timeIntervalSince1970 * 1_000)
        let verifierKeyID = hex(SHA256.hash(data: pinnedPublicVerifier(for: signingKey)))
        var unsigned: [String: Any] = [
            "contract": "browser-use.binding-approval",
            "schema_version": "1",
            "receipt_id": "binding-\(UUID().uuidString.lowercased())",
            "disposition": disposition,
            "resolution_key": resolutionKey,
            "binding": binding,
            "predecessor_receipt_id": predecessorReceiptID,
            "issued_at_epoch_ms": issuedAt,
            "verifier_key_id": verifierKeyID,
        ]
        let digestKeys = [
            "contract",
            "schema_version",
            "receipt_id",
            "disposition",
            "resolution_key",
            "binding",
            "predecessor_receipt_id",
            "issued_at_epoch_ms",
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

    /// Sign one short-lived first-binding selection grant after the native picker.
    static func issueBindingSelectionGrant(
        resolutionKey: [String: Any],
        binding: [String: Any],
        facts: [String: Any],
        signingKey: SecureEnclave.P256.Signing.PrivateKey
    ) throws -> [String: Any] {
        let issuedAt = Int(Date().timeIntervalSince1970 * 1_000)
        let verifierKeyID = hex(SHA256.hash(data: pinnedPublicVerifier(for: signingKey)))
        var unsigned: [String: Any] = [
            "grant_id": "selection-\(UUID().uuidString.lowercased())",
            "resolution_key": resolutionKey,
            "binding": binding,
            "facts": facts,
            "issued_at_epoch_ms": issuedAt,
            "expires_at_epoch_ms": issuedAt + 90_000,
            "verifier_key_id": verifierKeyID,
        ]
        let canonical = try JSONSerialization.data(
            withJSONObject: canonicalApprovalValue(unsigned),
            options: [.withoutEscapingSlashes]
        )
        let digest = Data(SHA256.hash(data: canonical))
        let signature = try signingKey.signature(for: digest)
        unsigned["signature"] = signature.derRepresentation.base64EncodedString()
        return unsigned
    }

    /// The pinned public verifier identity: the SEC1 uncompressed (x9.63) public
    /// key bytes verifiers trust — a 65-byte `0x04 || X || Y` point. The
    /// TypeScript verifier requires this encoding (it reads the `0x04` prefix and
    /// slices X/Y at offsets 1..33 and 33..65); CryptoKit's `rawRepresentation`
    /// omits the prefix, so emit `x963Representation`. Rotation changes this
    /// identity and revokes every outstanding authorization (R20).
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
    case selectionNoResponse
    case selectionAmbiguous
}

/// The only Keychain item allowed to retain the opaque Secure Enclave handle.
private enum SigningKeyHandleLocator {
    static var accessGroup: String {
        Bundle.main.bundleIdentifier ?? ""
    }
    static let service = "com.side-quest.browser-use-security.reviewed-action-signing-key"
    static let account = "device-bound-signing-key-v1"
    static let schemaVersion = "1"
    static let presencePolicy = "secure-enclave-private-key-usage-user-presence-v1"
    static let legacyDefaultsKey = "reviewed-action-signing-key-handle-v1"
    static let expectedAccessible = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
}

/// A reconstructed key plus custody evidence admitted by the broker.
private struct AdmittedSigningKey {
    let key: SecureEnclave.P256.Signing.PrivateKey
    let presencePolicy: String
}

private enum ApprovalBrokerCommandSupport {
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

    private static let bindingResolutionKeys: Set<String> = [
        "binding_ref", "service_id", "auth_context", "environment", "profile",
    ]
    private static let bindingKeys: Set<String> = [
        "service_id", "auth_context", "allowed_origins", "allowed_login_paths",
        "vault_id", "item_id", "allowed_auth_methods", "binding_revision",
    ]
    private static let bindingSelectionFactKeys: Set<String> = [
        "run_id", "service_id", "origin", "vault_id", "candidate_set_digest",
    ]
    private static let bindingSelectionPrivateOwnerKeys: Set<String> = [
        "supervisor_path", "op_path", "config_root",
    ]

    private static func signingKeyItemQuery() throws -> [String: Any] {
        let task = SecTaskCreateFromSelf(nil)
        guard let task,
              let groups = SecTaskCopyValueForEntitlement(
                  task,
                  "keychain-access-groups" as CFString,
                  nil
              ) as? [String],
              groups.count == 1,
              let accessGroup = groups.first,
              accessGroup == SigningKeyHandleLocator.accessGroup ||
                  accessGroup.hasSuffix(".\(SigningKeyHandleLocator.accessGroup)")
        else {
            throw BrokerError.signingKeyCustodyMismatch
        }
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: SigningKeyHandleLocator.service,
            kSecAttrAccount as String: SigningKeyHandleLocator.account,
            kSecAttrAccessGroup as String: accessGroup,
            kSecAttrSynchronizable as String: false,
            kSecUseDataProtectionKeychain as String: true,
        ]
    }

    /// Load one immutable, device-only handle and admit its recorded key policy.
    ///
    /// CryptoKit does not expose the reconstructed Secure Enclave key's
    /// `SecAccessControl`. The private Keychain record therefore binds the exact
    /// creation policy and verifier identity to the opaque representation. This
    /// broker has no update/delete path, and a missing, ambiguous, malformed, or
    /// identity-mismatched record fails closed instead of rotating the key.
    static func loadSigningKey(
        signingReason: String = "Sign the Reviewed Action promotion receipt"
    ) throws -> AdmittedSigningKey {
        var query = try signingKeyItemQuery()
        query[kSecMatchLimit as String] = kSecMatchLimitAll
        query[kSecReturnAttributes as String] = true
        query[kSecReturnData as String] = true

        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            break
        case errSecItemNotFound:
            throw BrokerError.signingKeyMissing
        default:
            throw BrokerError.signingKeyCustodyMismatch
        }
        guard let items = result as? [[String: Any]] else {
            throw BrokerError.signingKeyCustodyMismatch
        }
        guard items.count == 1, let item = items.first else {
            throw items.isEmpty ? BrokerError.signingKeyMissing : BrokerError.signingKeyAmbiguous
        }
        let accessible = item[kSecAttrAccessible as String] as CFTypeRef?
        guard let accessible,
              CFEqual(accessible, SigningKeyHandleLocator.expectedAccessible),
              item[kSecAttrSynchronizable as String] as? Bool == false,
              let custodyRecord = item[kSecValueData as String] as? Data
        else {
            throw BrokerError.signingKeyCustodyMismatch
        }

        let decoded = try decodeCustodyRecord(custodyRecord)
        let context = LAContext()
        context.localizedReason = signingReason
        let key: SecureEnclave.P256.Signing.PrivateKey
        do {
            key = try SecureEnclave.P256.Signing.PrivateKey(
                dataRepresentation: decoded.representation,
                authenticationContext: context
            )
        } catch {
            throw BrokerError.signingKeyCustodyMismatch
        }
        let verifier = verifierIdentity(for: key)
        guard verifier.key_id == decoded.verifierKeyID else {
            throw BrokerError.signingKeyCustodyMismatch
        }
        return AdmittedSigningKey(key: key, presencePolicy: decoded.presencePolicy)
    }

    /// Explicitly enroll the first signing identity. Never replaces an item.
    static func enrollSigningKey() throws -> AdmittedSigningKey {
        do {
            _ = try loadSigningKey()
            throw BrokerError.signingKeyAlreadyEnrolled
        } catch BrokerError.signingKeyMissing {
            // Absence is safe only on this explicit, user-presence-backed path.
        }

        let key = try ApprovalBroker.createDeviceBoundSigningKey()
        try persistSigningKey(key)
        return try loadSigningKey()
    }

    private static func persistSigningKey(
        _ key: SecureEnclave.P256.Signing.PrivateKey
    ) throws {
        let verifier = verifierIdentity(for: key)
        let custodyRecord = try encodeCustodyRecord(
            representation: key.dataRepresentation,
            verifierKeyID: verifier.key_id
        )
        var item = try signingKeyItemQuery()
        item[kSecAttrAccessible as String] = SigningKeyHandleLocator.expectedAccessible
        item[kSecValueData as String] = custodyRecord
        switch SecItemAdd(item as CFDictionary, nil) {
        case errSecSuccess:
            return
        case errSecDuplicateItem:
            throw BrokerError.signingKeyAlreadyEnrolled
        default:
            throw BrokerError.signingKeyCustodyMismatch
        }
    }

    /// Explicitly migrate the pre-Keychain opaque handle without rotating it.
    static func migrateLegacySigningKey() throws -> AdmittedSigningKey {
        do {
            _ = try loadSigningKey()
            throw BrokerError.signingKeyAlreadyEnrolled
        } catch BrokerError.signingKeyMissing {
            // Continue only from an absent current-format record.
        }
        guard
            let representation = UserDefaults.standard.data(
                forKey: SigningKeyHandleLocator.legacyDefaultsKey
            )
        else {
            throw BrokerError.legacySigningKeyMissing
        }
        let context = try ApprovalBroker.requireUserPresence(for: .replace)
        context.localizedReason = "Migrate the existing Browser Use signing key"
        let key: SecureEnclave.P256.Signing.PrivateKey
        do {
            key = try SecureEnclave.P256.Signing.PrivateKey(
                dataRepresentation: representation,
                authenticationContext: context
            )
        } catch {
            throw BrokerError.legacySigningKeyReconstructionFailed
        }
        do {
            _ = try key.signature(
                for: Data(SHA256.hash(data: Data("browser-use-key-migration-v1".utf8)))
            )
        } catch {
            throw BrokerError.legacySigningKeyPresenceFailed
        }
        try persistSigningKey(key)
        let migrated = try loadSigningKey()
        guard
            verifierIdentity(for: migrated.key).key_id == verifierIdentity(for: key).key_id
        else {
            throw BrokerError.signingKeyCustodyMismatch
        }
        UserDefaults.standard.removeObject(
            forKey: SigningKeyHandleLocator.legacyDefaultsKey
        )
        return migrated
    }

    private static func encodeCustodyRecord(
        representation: Data,
        verifierKeyID: String
    ) throws -> Data {
        try JSONSerialization.data(
            withJSONObject: [
                "schema_version": SigningKeyHandleLocator.schemaVersion,
                "presence_policy": SigningKeyHandleLocator.presencePolicy,
                "verifier_key_id": verifierKeyID,
                "key_representation": representation.base64EncodedString(),
            ],
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
    }

    private static func decodeCustodyRecord(
        _ data: Data
    ) throws -> (representation: Data, verifierKeyID: String, presencePolicy: String) {
        let expectedKeys: Set<String> = [
            "schema_version", "presence_policy", "verifier_key_id", "key_representation",
        ]
        guard data.count <= 65_536,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              Set(object.keys) == expectedKeys,
              object["schema_version"] as? String == SigningKeyHandleLocator.schemaVersion,
              let presencePolicy = object["presence_policy"] as? String,
              let verifierKeyID = object["verifier_key_id"] as? String,
              let representationBase64 = object["key_representation"] as? String,
              let representation = Data(base64Encoded: representationBase64),
              !representation.isEmpty
        else {
            throw BrokerError.signingKeyCustodyMismatch
        }
        guard presencePolicy == SigningKeyHandleLocator.presencePolicy else {
            throw BrokerError.signingKeyCustodyMismatch
        }
        return (representation, verifierKeyID, presencePolicy)
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

    static func reviewHumanIdentityAttestation(
        runID: String,
        boundFacts: [String: Any],
        display: [String]
    ) throws {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.activate(ignoringOtherApps: true)

        let factsData = try JSONSerialization.data(
            withJSONObject: boundFacts,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        guard let factsText = String(data: factsData, encoding: .utf8) else {
            throw PromotionCommandError.invalidInput
        }
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 720, height: 420))
        textView.isEditable = false
        textView.isSelectable = true
        textView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        textView.string = "SIGNED RUN ID\n\(runID)\n\nDISPLAY ENTRIES\n\(display.joined(separator: "\n"))\n\nBOUND FACTS\n\(factsText)"
        let scrollView = NSScrollView(frame: textView.frame)
        scrollView.hasVerticalScroller = true
        scrollView.documentView = textView

        let alert = NSAlert()
        alert.messageText = "Review one-run Human Identity Attestation"
        alert.informativeText = "Approve only if every displayed identity claim and bound fact is correct. Touch ID signs this one-run attestation."
        alert.alertStyle = .warning
        alert.accessoryView = scrollView
        alert.addButton(withTitle: "Approve and Sign")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else {
            throw PromotionCommandError.reviewCancelled
        }
    }

    static func reviewBindingApproval(
        disposition: String,
        resolutionKey: [String: Any],
        binding: [String: Any],
        display: [String]
    ) throws {
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        application.activate(ignoringOtherApps: true)

        let factsData = try JSONSerialization.data(
            withJSONObject: [
                "disposition": disposition,
                "resolution_key": resolutionKey,
                "binding": binding,
            ],
            options: [.sortedKeys, .withoutEscapingSlashes]
        )
        guard let factsText = String(data: factsData, encoding: .utf8) else {
            throw PromotionCommandError.invalidInput
        }
        let textView = NSTextView(frame: NSRect(x: 0, y: 0, width: 720, height: 420))
        textView.isEditable = false
        textView.isSelectable = true
        textView.font = NSFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        textView.string = "ITEM BINDING REVIEW\n\(display.joined(separator: "\n"))\n\nCOMPLETE SIGNED FACTS\n\(factsText)"
        let scrollView = NSScrollView(frame: textView.frame)
        scrollView.hasVerticalScroller = true
        scrollView.documentView = textView

        let alert = NSAlert()
        alert.messageText = disposition == "revoked" ? "Revoke Browser Use Item Binding" : "Create Browser Use Item Binding"
        alert.informativeText = "Approve only if the complete binding revision is correct. Touch ID signs this immutable revision."
        alert.alertStyle = .warning
        alert.accessoryView = scrollView
        alert.addButton(withTitle: disposition == "revoked" ? "Revoke and Sign" : "Approve and Sign")
        alert.addButton(withTitle: "Cancel")
        guard alert.runModal() == .alertFirstButtonReturn else {
            throw PromotionCommandError.reviewCancelled
        }
    }

    static func promotionReceipt(
        request: ReviewedActionPromotionRequest,
        admittedKey: AdmittedSigningKey
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

        let verifier = verifierIdentity(for: admittedKey.key)
        let receiptID = "receipt-\(UUID().uuidString.lowercased())"
        let issuedAt = Int64(Date().timeIntervalSince1970 * 1_000)
        let unsigned = try ReviewedActionPromotionProtocol.makeUnsignedReceipt(
            request: request,
            receiptID: receiptID,
            issuedAtEpochMilliseconds: issuedAt,
            verifierKeyID: verifier.key_id,
            presenceBacked: admittedKey.presencePolicy == SigningKeyHandleLocator.presencePolicy
        )
        let digest = Data(SHA256.hash(
            data: try ReviewedActionPromotionProtocol.canonicalPayload(for: unsigned)
        ))
        let signature = try admittedKey.key.signature(for: digest).derRepresentation.base64EncodedString()
        return ReviewedActionPromotionProtocol.withSignature(unsigned, signature: signature)
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
        try reviewHumanIdentityAttestation(
            runID: runID,
            boundFacts: boundFacts,
            display: display
        )
        return try ApprovalBroker.issueHumanIdentityAttestation(
            subject: subject,
            boundFacts: boundFacts,
            signingKey: key
        )
    }

    static func bindingApprovalReceipt(
        request: [String: Any],
        key: SecureEnclave.P256.Signing.PrivateKey
    ) throws -> [String: Any] {
        guard
            Set(request.keys) == Set(["disposition", "resolution_key", "binding", "predecessor_receipt_id", "display"]),
            let disposition = request["disposition"] as? String,
            disposition == "approved" || disposition == "revoked",
            let resolutionKey = request["resolution_key"] as? [String: Any],
            Set(resolutionKey.keys) == bindingResolutionKeys,
            let binding = request["binding"] as? [String: Any],
            Set(binding.keys) == bindingKeys,
            let display = request["display"] as? [String],
            !display.isEmpty,
            display.count <= 16,
            display.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 }),
            let revision = binding["binding_revision"] as? Int,
            revision > 0,
            let resolutionService = resolutionKey["service_id"] as? String,
            let resolutionContext = resolutionKey["auth_context"] as? String,
            binding["service_id"] as? String == resolutionService,
            binding["auth_context"] as? String == resolutionContext,
            resolutionContext == "interactive-login",
            let origins = binding["allowed_origins"] as? [String],
            !origins.isEmpty,
            origins.allSatisfy({
                guard let components = URLComponents(string: $0),
                      components.scheme == "http" || components.scheme == "https",
                      components.host != nil,
                      components.user == nil,
                      components.password == nil,
                      components.path.isEmpty,
                      components.query == nil,
                      components.fragment == nil,
                      components.string == $0
                else { return false }
                return true
            }),
            let paths = binding["allowed_login_paths"] as? [String],
            paths.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 }),
            let methods = binding["allowed_auth_methods"] as? [String],
            !methods.isEmpty,
            methods.allSatisfy({ $0 == "password" || $0 == "otp" }),
            let vaultID = binding["vault_id"] as? String,
            !vaultID.isEmpty,
            let itemID = binding["item_id"] as? String,
            !itemID.isEmpty
        else {
            throw PromotionCommandError.invalidInput
        }
        for field in ["binding_ref", "service_id", "environment", "profile"] {
            guard let value = resolutionKey[field] as? String,
                  !value.isEmpty,
                  value.utf8.count <= 1_024
            else { throw PromotionCommandError.invalidInput }
        }
        let predecessor = request["predecessor_receipt_id"]!
        if !(predecessor is NSNull) {
            guard let value = predecessor as? String,
                  !value.isEmpty,
                  value.utf8.count <= 512
            else { throw PromotionCommandError.invalidInput }
        }
        try reviewBindingApproval(
            disposition: disposition,
            resolutionKey: resolutionKey,
            binding: binding,
            display: display
        )
        return try ApprovalBroker.issueBindingApproval(
            disposition: disposition,
            resolutionKey: resolutionKey,
            binding: binding,
            predecessorReceiptID: predecessor,
            signingKey: key
        )
    }

    private static func admittedPrivateOwnerPath(_ value: Any?) -> String? {
        guard let path = value as? String,
              path.hasPrefix("/"),
              path.utf8.count <= 2_048,
              !path.contains("\0"),
              URL(fileURLWithPath: path).standardizedFileURL.path == path
        else { return nil }
        return path
    }

    static func bindingSelectionGrant(
        request: [String: Any]
    ) throws -> [String: Any] {
        guard
            Set(request.keys) == Set(["resolution_key", "facts", "candidate_count", "private_owner"]),
            let resolutionKey = request["resolution_key"] as? [String: Any],
            Set(resolutionKey.keys) == bindingResolutionKeys,
            let facts = request["facts"] as? [String: Any],
            Set(facts.keys) == bindingSelectionFactKeys,
            let candidateCount = request["candidate_count"] as? Int,
            candidateCount > 0,
            candidateCount <= 1_000,
            let privateOwner = request["private_owner"] as? [String: Any],
            Set(privateOwner.keys) == bindingSelectionPrivateOwnerKeys,
            let supervisorPath = admittedPrivateOwnerPath(privateOwner["supervisor_path"]),
            let opPath = admittedPrivateOwnerPath(privateOwner["op_path"]),
            let configRoot = admittedPrivateOwnerPath(privateOwner["config_root"]),
            let runID = facts["run_id"] as? String,
            !runID.isEmpty,
            let serviceID = facts["service_id"] as? String,
            (resolutionKey["service_id"] as? String) == serviceID,
            let vaultID = facts["vault_id"] as? String,
            !vaultID.isEmpty,
            let origin = facts["origin"] as? String,
            let originComponents = URLComponents(string: origin),
            originComponents.scheme == "https",
            originComponents.host != nil,
            originComponents.user == nil,
            originComponents.password == nil,
            originComponents.path.isEmpty,
            originComponents.query == nil,
            originComponents.fragment == nil,
            originComponents.string == origin,
            let expectedDigest = facts["candidate_set_digest"] as? String,
            expectedDigest.count == 64,
            expectedDigest.allSatisfy({ $0.isHexDigit }),
            resolutionKey["auth_context"] as? String == "interactive-login"
        else { throw PromotionCommandError.invalidInput }
        for field in ["binding_ref", "service_id", "environment", "profile"] {
            guard let value = resolutionKey[field] as? String,
                  !value.isEmpty,
                  value.utf8.count <= 1_024
            else { throw PromotionCommandError.invalidInput }
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: supervisorPath)
        process.arguments = [
            "binding-selection",
            "--config-root", configRoot,
            "--op-path", opPath,
            "--vault-id", vaultID,
            "--origin", origin,
            "--expected-candidate-digest", expectedDigest,
            "--candidate-count", String(candidateCount),
        ]
        process.environment = ["TMPDIR": configRoot]
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        let completed = DispatchSemaphore(value: 0)
        process.terminationHandler = { _ in completed.signal() }
        try process.run()
        if completed.wait(timeout: .now() + .seconds(300)) == .timedOut {
            process.terminate()
            throw PromotionCommandError.selectionNoResponse
        }
        let bytes = output.fileHandleForReading.readDataToEndOfFile()
        _ = errors.fileHandleForReading.readDataToEndOfFile()
        guard bytes.count <= 1_048_576,
              let envelope = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any]
        else { throw PromotionCommandError.selectionNoResponse }
        if process.terminationStatus != 0 || envelope["ok"] as? Bool != true {
            let rejection = envelope["rejection"] as? [String: Any]
            switch rejection?["code"] as? String {
            case "presence-cancelled":
                throw PromotionCommandError.reviewCancelled
            case "selection-candidates-drifted":
                throw PromotionCommandError.candidateDigestMismatch
            case "selection-ambiguous":
                throw PromotionCommandError.selectionAmbiguous
            default:
                throw PromotionCommandError.selectionNoResponse
            }
        }
        guard Set(envelope.keys) == Set(["schema_version", "ok", "selection"]),
              envelope["schema_version"] as? Int == 1,
              let selection = envelope["selection"] as? [String: Any],
              Set(selection.keys) == Set(["selected_item", "candidate_set_digest"]),
              selection["candidate_set_digest"] as? String == expectedDigest,
              let item = selection["selected_item"] as? [String: Any],
              Set(item.keys) == Set(["item_id", "vault_id", "origins", "login_paths", "supported_methods", "state"]),
              item["vault_id"] as? String == vaultID,
              item["state"] as? String == "active",
              let itemID = item["item_id"] as? String,
              !itemID.isEmpty,
              let itemOrigins = item["origins"] as? [String],
              itemOrigins.contains(origin),
              let loginPaths = item["login_paths"] as? [String],
              let methods = item["supported_methods"] as? [String],
              !methods.isEmpty,
              methods.allSatisfy({ $0 == "password" || $0 == "otp" })
        else { throw PromotionCommandError.invalidInput }
        let binding: [String: Any] = [
            "service_id": serviceID,
            "auth_context": "interactive-login",
            "allowed_origins": [origin],
            "allowed_login_paths": loginPaths,
            "vault_id": vaultID,
            "item_id": itemID,
            "allowed_auth_methods": methods,
            "binding_revision": 1,
        ]
        let admittedKey = try loadSigningKey(
            signingReason: "Sign this one-use Browser Use login selection"
        )
        return try ApprovalBroker.issueBindingSelectionGrant(
            resolutionKey: resolutionKey,
            binding: binding,
            facts: facts,
            signingKey: admittedKey.key
        )
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
            ApprovalBrokerCommandSupport.write(["ok": false, "code": "invalid-command", "message": "expected enroll, migrate-key, verifier, promote, attest, bind, or select-binding mode"])
            exit(20)
        }
        do {
            switch CommandLine.arguments[1] {
            case "enroll":
                let admittedKey = try ApprovalBrokerCommandSupport.enrollSigningKey()
                let verifier = ApprovalBrokerCommandSupport.verifierIdentity(for: admittedKey.key)
                ApprovalBrokerCommandSupport.write([
                    "ok": true,
                    "verifier": ["key_id": verifier.key_id, "public_key": verifier.public_key],
                ])
            case "verifier":
                let admittedKey = try ApprovalBrokerCommandSupport.loadSigningKey()
                let verifier = ApprovalBrokerCommandSupport.verifierIdentity(for: admittedKey.key)
                ApprovalBrokerCommandSupport.write([
                    "ok": true,
                    "verifier": ["key_id": verifier.key_id, "public_key": verifier.public_key],
                ])
            case "migrate-key":
                let admittedKey = try ApprovalBrokerCommandSupport.migrateLegacySigningKey()
                let verifier = ApprovalBrokerCommandSupport.verifierIdentity(for: admittedKey.key)
                ApprovalBrokerCommandSupport.write([
                    "ok": true,
                    "verifier": ["key_id": verifier.key_id, "public_key": verifier.public_key],
                ])
            case "promote":
                let input = FileHandle.standardInput.readDataToEndOfFile()
                guard input.count <= 1_048_576 else { throw PromotionCommandError.invalidInput }
                let request = try ReviewedActionPromotionProtocol.decodeRequest(input)
                let admittedKey = try ApprovalBrokerCommandSupport.loadSigningKey()
                let receipt = try ApprovalBrokerCommandSupport.promotionReceipt(request: request, admittedKey: admittedKey)
                let response = try ReviewedActionPromotionProtocol.encodeResponse(.approved(receipt))
                FileHandle.standardOutput.write(response)
                FileHandle.standardOutput.write(Data("\n".utf8))
            case "attest":
                let admittedKey = try ApprovalBrokerCommandSupport.loadSigningKey(
                    signingReason: "Sign this one-run Human Identity Attestation"
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
                    key: admittedKey.key
                )
                ApprovalBrokerCommandSupport.write(["ok": true, "grant": grant])
            case "bind":
                let admittedKey = try ApprovalBrokerCommandSupport.loadSigningKey(
                    signingReason: "Sign this Item Binding revision"
                )
                let input = FileHandle.standardInput.readDataToEndOfFile()
                guard
                    input.count <= 1_048_576,
                    let request = try JSONSerialization.jsonObject(with: input) as? [String: Any]
                else {
                    throw PromotionCommandError.invalidInput
                }
                let receipt = try ApprovalBrokerCommandSupport.bindingApprovalReceipt(
                    request: request,
                    key: admittedKey.key
                )
                ApprovalBrokerCommandSupport.write(["ok": true, "receipt": receipt])
            case "select-binding":
                let input = FileHandle.standardInput.readDataToEndOfFile()
                guard
                    input.count <= 1_048_576,
                    let request = try JSONSerialization.jsonObject(with: input) as? [String: Any]
                else { throw PromotionCommandError.invalidInput }
                let grant = try ApprovalBrokerCommandSupport.bindingSelectionGrant(
                    request: request
                )
                ApprovalBrokerCommandSupport.write(["ok": true, "grant": grant])
            default:
                throw PromotionCommandError.invalidInput
            }
        } catch PromotionCommandError.candidateDigestMismatch {
            ApprovalBrokerCommandSupport.writeFailure(code: "selection-candidates-drifted", message: "the ordered login candidate set changed before selection")
            exit(20)
        } catch PromotionCommandError.selectionNoResponse {
            ApprovalBrokerCommandSupport.writeFailure(code: "selection-no-response", message: "the local binding selection did not return a usable response")
            exit(20)
        } catch PromotionCommandError.selectionAmbiguous {
            ApprovalBrokerCommandSupport.writeFailure(code: "selection-ambiguous", message: "the local binding selection was ambiguous")
            exit(20)
        } catch PromotionCommandError.reviewCancelled {
            ApprovalBrokerCommandSupport.writeFailure(code: "presence-cancelled", message: "the human reviewer cancelled authorization")
            exit(20)
        } catch BrokerError.userPresenceUnavailable {
            ApprovalBrokerCommandSupport.writeFailure(code: "biometric-capability-missing", message: "Touch ID user presence is unavailable")
            exit(20)
        } catch BrokerError.userPresenceCancelled {
            ApprovalBrokerCommandSupport.writeFailure(code: "presence-cancelled", message: "Touch ID user presence was cancelled")
            exit(20)
        } catch BrokerError.signingKeyMissing {
            ApprovalBrokerCommandSupport.writeFailure(code: "signing-key-missing", message: "the approval broker signing key is not enrolled; an operator must run the explicit enroll action")
            exit(20)
        } catch BrokerError.signingKeyAlreadyEnrolled {
            ApprovalBrokerCommandSupport.writeFailure(code: "signing-key-already-enrolled", message: "the approval broker signing key is already enrolled and was not replaced")
            exit(20)
        } catch BrokerError.legacySigningKeyMissing {
            ApprovalBrokerCommandSupport.writeFailure(code: "legacy-signing-key-missing", message: "no legacy signing key handle is available to migrate")
            exit(20)
        } catch BrokerError.legacySigningKeyReconstructionFailed {
            ApprovalBrokerCommandSupport.writeFailure(code: "legacy-signing-key-reconstruction-failed", message: "the legacy Secure Enclave key handle could not be reconstructed under this signed app identity")
            exit(20)
        } catch BrokerError.legacySigningKeyPresenceFailed {
            ApprovalBrokerCommandSupport.writeFailure(code: "legacy-signing-key-presence-failed", message: "the legacy Secure Enclave key could not complete its user-presence-backed migration signature")
            exit(20)
        } catch BrokerError.signingKeyAmbiguous,
                BrokerError.signingKeyCustodyMismatch {
            ApprovalBrokerCommandSupport.writeFailure(code: "signing-key-custody-invalid", message: "the approval broker signing key failed private Keychain custody checks")
            exit(20)
        } catch {
            ApprovalBrokerCommandSupport.writeFailure(code: "broker-failed", message: "the approval broker failed closed")
            exit(20)
        }
    }
}

// On-demand lifetime: the broker performs one command and exits. No run loop,
// no LaunchAgent, no daemon (ADR 0027).
