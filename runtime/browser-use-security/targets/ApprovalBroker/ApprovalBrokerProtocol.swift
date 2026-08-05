import CryptoKit
import Foundation

enum ReviewedActionPromotionProtocolError: Error, Equatable {
    case invalidEnvelope
    case unsupportedVersion
    case invalidFacts
    case invalidReceipt
}

struct ReviewedActionApprovalFacts: Codable, Equatable {
    let source_commit: String
    let action_id: String
    let approved_digest: String
    let approved_origin: String
    let approved_effect: String
    let audited_capabilities: [String]
    let containment: String
    let input_schema_digest: String
    let result_schema_digest: String
    let postcondition_digest: String?
}

struct ReviewedActionPromotionRequest: Codable, Equatable {
    let contract: String
    let schema_version: String
    let facts: ReviewedActionApprovalFacts
    let candidate_bytes: String
    let approval_reference: String
}

struct ReviewedActionVerifierIdentity: Codable, Equatable {
    let key_id: String
    let public_key: String
}

struct ReviewedActionPromotionReceipt: Codable, Equatable {
    let contract: String
    let schema_version: String
    let receipt_id: String
    let disposition: String
    let source_commit: String
    let action_id: String
    let approved_digest: String
    let approved_origin: String
    let approved_effect: String
    let audited_capabilities: [String]
    let containment: String
    let input_schema_digest: String
    let result_schema_digest: String
    let postcondition_digest: String?
    let approval_reference: String
    let presence_backed: Bool
    let issued_at_epoch_ms: Int64
    let verifier_key_id: String
    let signature: String
}

enum ReviewedActionPromotionResponse: Equatable {
    case approved(ReviewedActionPromotionReceipt)
    case refused(code: String, message: String)
}

enum ReviewedActionPromotionClientResult: Equatable {
    case approved(ReviewedActionPromotionReceipt)
    case refused(code: String, message: String)
    case unknown(code: String, message: String)
}

enum ReviewedActionPromotionProtocol {
    static let requestContract = "browser-use.reviewed-action-promotion-request"
    static let receiptContract = "browser-use.reviewed-action-promotion"
    static let schemaVersion = "1"

    private static let factsKeys: Set<String> = [
        "source_commit", "action_id", "approved_digest", "approved_origin",
        "approved_effect", "audited_capabilities", "containment",
        "input_schema_digest", "result_schema_digest", "postcondition_digest",
    ]
    private static let receiptKeys: Set<String> = factsKeys.union([
        "contract", "schema_version", "receipt_id", "disposition",
        "approval_reference", "presence_backed", "issued_at_epoch_ms",
        "verifier_key_id", "signature",
    ])
    private static let safeCommit = try! NSRegularExpression(pattern: "^[0-9a-f]{40}([0-9a-f]{24})?$")
    private static let safeDigest = try! NSRegularExpression(pattern: "^[0-9a-f]{64}$")
    private static let safeIdentifier = try! NSRegularExpression(pattern: "^[a-z0-9][a-z0-9-]{0,127}$")

    static func decodeRequest(_ data: Data) throws -> ReviewedActionPromotionRequest {
        guard
            let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            Set(object.keys) == ["contract", "schema_version", "facts", "candidate_bytes", "approval_reference"],
            let facts = object["facts"] as? [String: Any],
            Set(facts.keys) == factsKeys
        else {
            throw ReviewedActionPromotionProtocolError.invalidEnvelope
        }
        let request = try JSONDecoder().decode(ReviewedActionPromotionRequest.self, from: data)
        guard request.contract == requestContract, request.schema_version == schemaVersion else {
            throw ReviewedActionPromotionProtocolError.unsupportedVersion
        }
        guard factsAreValid(request.facts), safeID(request.approval_reference), request.candidate_bytes.utf8.count <= 1_048_576 else {
            throw ReviewedActionPromotionProtocolError.invalidFacts
        }
        return request
    }

    static func encodeRequest(_ request: ReviewedActionPromotionRequest) throws -> Data {
        let object: [String: Any] = [
            "contract": request.contract,
            "schema_version": request.schema_version,
            "facts": factsJSONObject(request.facts),
            "candidate_bytes": request.candidate_bytes,
            "approval_reference": request.approval_reference,
        ]
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    static func canonicalPayload(for receipt: ReviewedActionPromotionReceipt) throws -> Data {
        let value: [String: Any] = [
            "source_commit": receipt.source_commit,
            "action_id": receipt.action_id,
            "approved_digest": receipt.approved_digest,
            "approved_origin": receipt.approved_origin,
            "approved_effect": receipt.approved_effect,
            "audited_capabilities": receipt.audited_capabilities,
            "containment": receipt.containment,
            "input_schema_digest": receipt.input_schema_digest,
            "result_schema_digest": receipt.result_schema_digest,
            "postcondition_digest": receipt.postcondition_digest as Any? ?? NSNull(),
            "receipt_id": receipt.receipt_id,
            "approval_reference": receipt.approval_reference,
            "issued_at_epoch_ms": receipt.issued_at_epoch_ms,
            "verifier_key_id": receipt.verifier_key_id,
        ]
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    static func makeUnsignedReceipt(
        request: ReviewedActionPromotionRequest,
        receiptID: String,
        issuedAtEpochMilliseconds: Int64,
        verifierKeyID: String,
        presenceBacked: Bool
    ) throws -> ReviewedActionPromotionReceipt {
        guard factsAreValid(request.facts), safeID(receiptID), safeID(verifierKeyID), presenceBacked else {
            throw ReviewedActionPromotionProtocolError.invalidReceipt
        }
        return ReviewedActionPromotionReceipt(
            contract: receiptContract,
            schema_version: schemaVersion,
            receipt_id: receiptID,
            disposition: "approved",
            source_commit: request.facts.source_commit,
            action_id: request.facts.action_id,
            approved_digest: request.facts.approved_digest,
            approved_origin: request.facts.approved_origin,
            approved_effect: request.facts.approved_effect,
            audited_capabilities: request.facts.audited_capabilities,
            containment: request.facts.containment,
            input_schema_digest: request.facts.input_schema_digest,
            result_schema_digest: request.facts.result_schema_digest,
            postcondition_digest: request.facts.postcondition_digest,
            approval_reference: request.approval_reference,
            presence_backed: presenceBacked,
            issued_at_epoch_ms: issuedAtEpochMilliseconds,
            verifier_key_id: verifierKeyID,
            signature: "pending"
        )
    }

    static func verifierIdentity(for publicKey: P256.Signing.PublicKey) -> ReviewedActionVerifierIdentity {
        let raw = publicKey.x963Representation
        return ReviewedActionVerifierIdentity(
            key_id: hex(SHA256.hash(data: raw)),
            public_key: raw.base64EncodedString()
        )
    }

    static func verify(
        receipt: ReviewedActionPromotionReceipt,
        verifier: ReviewedActionVerifierIdentity
    ) -> Bool {
        guard receiptIsValid(receipt), receipt.verifier_key_id == verifier.key_id,
              let raw = Data(base64Encoded: verifier.public_key),
              hex(SHA256.hash(data: raw)) == verifier.key_id,
              let publicKey = try? P256.Signing.PublicKey(x963Representation: raw),
              let signatureData = Data(base64Encoded: receipt.signature),
              let signature = try? P256.Signing.ECDSASignature(derRepresentation: signatureData),
              let payload = try? canonicalPayload(for: receipt)
        else {
            return false
        }
        return publicKey.isValidSignature(signature, for: Data(SHA256.hash(data: payload)))
    }

    static func verify(
        receipt: ReviewedActionPromotionReceipt,
        verifier: ReviewedActionVerifierIdentity,
        request: ReviewedActionPromotionRequest
    ) -> Bool {
        verify(receipt: receipt, verifier: verifier) &&
            receipt.approval_reference == request.approval_reference &&
            factsOf(receipt) == request.facts
    }

    static func verifyUnique(
        receipts: [ReviewedActionPromotionReceipt],
        verifier: ReviewedActionVerifierIdentity
    ) -> Bool {
        var seen = Set<String>()
        for receipt in receipts {
            guard seen.insert(receipt.receipt_id).inserted,
                  verify(receipt: receipt, verifier: verifier) else { return false }
        }
        return true
    }

    static func encodeResponse(_ response: ReviewedActionPromotionResponse) throws -> Data {
        // Keep this exact envelope aligned with the installed signed broker.
        // The nested receipt owns the versioned promotion contract.
        let object: [String: Any]
        switch response {
        case .approved(let receipt):
            object = [
                "ok": true,
                "receipt": receiptJSONObject(receipt),
            ]
        case .refused(let code, let message):
            object = [
                "ok": false,
                "code": code,
                "message": message,
            ]
        }
        return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
    }

    static func decodeResponse(_ data: Data) throws -> ReviewedActionPromotionResponse {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let ok = object["ok"] as? Bool else {
            throw ReviewedActionPromotionProtocolError.invalidEnvelope
        }
        if ok {
            guard Set(object.keys) == ["ok", "receipt"], let receiptObject = object["receipt"] as? [String: Any], Set(receiptObject.keys) == receiptKeys else {
                throw ReviewedActionPromotionProtocolError.invalidEnvelope
            }
            let receiptData = try JSONSerialization.data(withJSONObject: receiptObject)
            let receipt = try JSONDecoder().decode(ReviewedActionPromotionReceipt.self, from: receiptData)
            guard receiptIsValid(receipt) else { throw ReviewedActionPromotionProtocolError.invalidReceipt }
            return .approved(receipt)
        }
        guard Set(object.keys) == ["ok", "code", "message"],
              let code = object["code"] as? String, safeID(code),
              let message = object["message"] as? String, !message.isEmpty, message.utf8.count <= 4096 else {
            throw ReviewedActionPromotionProtocolError.invalidEnvelope
        }
        return .refused(code: code, message: message)
    }

    static func sendOnce(
        _ request: ReviewedActionPromotionRequest,
        transport: (Data) throws -> Data
    ) -> ReviewedActionPromotionClientResult {
        do {
            let response = try decodeResponse(transport(try encodeRequest(request)))
            switch response {
            case .approved(let receipt): return .approved(receipt)
            case .refused(let code, let message): return .refused(code: code, message: message)
            }
        } catch {
            return .unknown(code: "broker-response-unknown", message: "the broker may have dispatched signing; retry requires a fresh operator action")
        }
    }

    static func factsJSONObject(_ facts: ReviewedActionApprovalFacts) -> [String: Any] {
        [
            "source_commit": facts.source_commit,
            "action_id": facts.action_id,
            "approved_digest": facts.approved_digest,
            "approved_origin": facts.approved_origin,
            "approved_effect": facts.approved_effect,
            "audited_capabilities": facts.audited_capabilities,
            "containment": facts.containment,
            "input_schema_digest": facts.input_schema_digest,
            "result_schema_digest": facts.result_schema_digest,
            "postcondition_digest": facts.postcondition_digest as Any? ?? NSNull(),
        ]
    }

    static func receiptJSONObject(_ receipt: ReviewedActionPromotionReceipt) -> [String: Any] {
        var object = factsJSONObject(factsOf(receipt))
        object["contract"] = receipt.contract
        object["schema_version"] = receipt.schema_version
        object["receipt_id"] = receipt.receipt_id
        object["disposition"] = receipt.disposition
        object["approval_reference"] = receipt.approval_reference
        object["presence_backed"] = receipt.presence_backed
        object["issued_at_epoch_ms"] = receipt.issued_at_epoch_ms
        object["verifier_key_id"] = receipt.verifier_key_id
        object["signature"] = receipt.signature
        return object
    }

    static func hex<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
        bytes.map { String(format: "%02x", $0) }.joined()
    }

    static func withSignature(_ receipt: ReviewedActionPromotionReceipt, signature: String) -> ReviewedActionPromotionReceipt {
        ReviewedActionPromotionReceipt(
            contract: receipt.contract, schema_version: receipt.schema_version,
            receipt_id: receipt.receipt_id, disposition: receipt.disposition,
            source_commit: receipt.source_commit, action_id: receipt.action_id,
            approved_digest: receipt.approved_digest, approved_origin: receipt.approved_origin,
            approved_effect: receipt.approved_effect, audited_capabilities: receipt.audited_capabilities,
            containment: receipt.containment, input_schema_digest: receipt.input_schema_digest,
            result_schema_digest: receipt.result_schema_digest, postcondition_digest: receipt.postcondition_digest,
            approval_reference: receipt.approval_reference, presence_backed: receipt.presence_backed,
            issued_at_epoch_ms: receipt.issued_at_epoch_ms, verifier_key_id: receipt.verifier_key_id,
            signature: signature
        )
    }

    private static func receiptIsValid(_ receipt: ReviewedActionPromotionReceipt) -> Bool {
        receipt.contract == receiptContract && receipt.schema_version == schemaVersion &&
            receipt.disposition == "approved" && receipt.presence_backed &&
            safeID(receipt.receipt_id) && safeID(receipt.approval_reference) &&
            safeID(receipt.verifier_key_id) && receipt.issued_at_epoch_ms >= 0 &&
            receipt.signature.utf8.count <= 4096 && !receipt.signature.isEmpty &&
            factsAreValid(factsOf(receipt))
    }

    // Project the ten approval-facts fields out of a receipt. Kept in one place so a
    // new fact field is added once here rather than silently omitted at one of the
    // call sites (verify, receiptJSONObject, receiptIsValid) that reconstruct facts.
    static func factsOf(_ receipt: ReviewedActionPromotionReceipt) -> ReviewedActionApprovalFacts {
        ReviewedActionApprovalFacts(
            source_commit: receipt.source_commit, action_id: receipt.action_id,
            approved_digest: receipt.approved_digest, approved_origin: receipt.approved_origin,
            approved_effect: receipt.approved_effect, audited_capabilities: receipt.audited_capabilities,
            containment: receipt.containment, input_schema_digest: receipt.input_schema_digest,
            result_schema_digest: receipt.result_schema_digest, postcondition_digest: receipt.postcondition_digest
        )
    }

    private static func factsAreValid(_ facts: ReviewedActionApprovalFacts) -> Bool {
        matches(safeCommit, facts.source_commit) && safeID(facts.action_id) &&
            matches(safeDigest, facts.approved_digest) && exactOrigin(facts.approved_origin) &&
            ["read", "mutation"].contains(facts.approved_effect) &&
            !facts.audited_capabilities.isEmpty && Set(facts.audited_capabilities).count == facts.audited_capabilities.count &&
            facts.audited_capabilities.allSatisfy(safeID) &&
            ["none", "read-only-observation"].contains(facts.containment) &&
            matches(safeDigest, facts.input_schema_digest) && matches(safeDigest, facts.result_schema_digest) &&
            (facts.postcondition_digest == nil || matches(safeDigest, facts.postcondition_digest!))
    }

    private static func safeID(_ value: String) -> Bool { matches(safeIdentifier, value) }

    private static func exactOrigin(_ value: String) -> Bool {
        guard let components = URLComponents(string: value),
              let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme),
              let host = components.host?.lowercased(),
              components.user == nil, components.password == nil,
              components.path.isEmpty, components.query == nil, components.fragment == nil else {
            return false
        }
        var normalized = URLComponents()
        normalized.scheme = scheme
        normalized.host = host
        if components.port != (scheme == "https" ? 443 : 80) {
            normalized.port = components.port
        }
        return normalized.string == value
    }

    private static func matches(_ expression: NSRegularExpression, _ value: String) -> Bool {
        expression.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) != nil
    }
}
