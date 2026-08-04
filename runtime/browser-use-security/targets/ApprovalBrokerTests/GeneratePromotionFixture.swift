import CryptoKit
import Foundation

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: swift GeneratePromotionFixture.swift <output.json>\n".utf8))
    exit(2)
}

let candidateBytes = "async ({ inputs }) => ({ rows: document.querySelectorAll('.row').length })"
let privateScalar = Data(repeating: 0, count: 31) + Data([1])
let privateKey = try P256.Signing.PrivateKey(rawRepresentation: privateScalar)
let publicKey = privateKey.publicKey.x963Representation

func hex<S: Sequence>(_ bytes: S) -> String where S.Element == UInt8 {
    bytes.map { String(format: "%02x", $0) }.joined()
}

let keyID = hex(SHA256.hash(data: publicKey))
let facts: [String: Any] = [
    "source_commit": String(repeating: "1", count: 40),
    "action_id": "count-visible-rows",
    "approved_digest": hex(SHA256.hash(data: Data(candidateBytes.utf8))),
    "approved_origin": "https://portal.example.test",
    "approved_effect": "read",
    "audited_capabilities": ["dom-query", "dom-read"],
    "containment": "read-only-observation",
    "input_schema_digest": String(repeating: "3", count: 64),
    "result_schema_digest": String(repeating: "4", count: 64),
    "postcondition_digest": NSNull(),
]
let request: [String: Any] = [
    "contract": "browser-use.reviewed-action-promotion-request",
    "schema_version": "1",
    "facts": facts,
    "candidate_bytes": candidateBytes,
    "approval_reference": "review-swift-vector",
]
var unsigned = facts
unsigned["receipt_id"] = "receipt-swift-vector"
unsigned["approval_reference"] = "review-swift-vector"
unsigned["issued_at_epoch_ms"] = 1_754_265_600_000 as Int64
unsigned["verifier_key_id"] = keyID
let canonicalPayload = try JSONSerialization.data(
    withJSONObject: unsigned,
    options: [.sortedKeys, .withoutEscapingSlashes]
)
let payloadDigest = Data(SHA256.hash(data: canonicalPayload))
// Fixed RFC-compatible signature keeps regeneration byte-for-byte stable. The
// generator verifies it against the fixed test key before writing the vector.
let signature = "MEYCIQDVwWdYw5JG0ADhcyV3hEauldib3GoKQn3pFWvLXCjF+AIhAJd7vr4dbkwdGdY7+/GK1+qGyrCkEn3SF34/IdW6CuY+"
let signatureValue = try P256.Signing.ECDSASignature(
    derRepresentation: Data(base64Encoded: signature)!
)
guard privateKey.publicKey.isValidSignature(signatureValue, for: payloadDigest) else {
    fatalError("the checked-in deterministic fixture signature no longer verifies")
}

var receipt = unsigned
receipt["contract"] = "browser-use.reviewed-action-promotion"
receipt["schema_version"] = "1"
receipt["disposition"] = "approved"
receipt["presence_backed"] = true
receipt["signature"] = signature

let fixture: [String: Any] = [
    "contract": "browser-use.reviewed-action-promotion-fixture",
    "schema_version": "1",
    "generated_by": "GeneratePromotionFixture.swift",
    "request": request,
    "canonical_payload_base64": canonicalPayload.base64EncodedString(),
    "verifier": [
        "key_id": keyID,
        "public_key": publicKey.base64EncodedString(),
    ],
    "receipt": receipt,
]
let output = try JSONSerialization.data(
    withJSONObject: fixture,
    options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
)
try (output + Data("\n".utf8)).write(to: URL(fileURLWithPath: CommandLine.arguments[1]), options: .atomic)
