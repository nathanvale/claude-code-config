import CryptoKit
import Foundation
import XCTest

final class ApprovalBrokerProtocolTests: XCTestCase {
    private var fixture: [String: Any]!
    private var request: ReviewedActionPromotionRequest!
    private var receipt: ReviewedActionPromotionReceipt!
    private var verifier: ReviewedActionVerifierIdentity!
    private var canonicalPayload: Data!

    override func setUpWithError() throws {
        let fixtureURL = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/reviewed-action-promotion-v1.json")
        let bytes = try Data(contentsOf: fixtureURL)
        fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: bytes) as? [String: Any])
        let requestObject = try XCTUnwrap(fixture["request"] as? [String: Any])
        request = try ReviewedActionPromotionProtocol.decodeRequest(
            JSONSerialization.data(withJSONObject: requestObject)
        )
        let receiptObject = try XCTUnwrap(fixture["receipt"] as? [String: Any])
        receipt = try JSONDecoder().decode(
            ReviewedActionPromotionReceipt.self,
            from: JSONSerialization.data(withJSONObject: receiptObject)
        )
        let verifierObject = try XCTUnwrap(fixture["verifier"] as? [String: Any])
        verifier = try JSONDecoder().decode(
            ReviewedActionVerifierIdentity.self,
            from: JSONSerialization.data(withJSONObject: verifierObject)
        )
        canonicalPayload = try XCTUnwrap(
            Data(base64Encoded: try XCTUnwrap(fixture["canonical_payload_base64"] as? String))
        )
    }

    func testVersionedRequestAndResponseRejectUnknownOrExtraFields() throws {
        let requestObject = try XCTUnwrap(fixture["request"] as? [String: Any])
        var extra = requestObject
        extra["authority"] = "self-reported"
        XCTAssertThrowsError(try ReviewedActionPromotionProtocol.decodeRequest(
            JSONSerialization.data(withJSONObject: extra)
        ))

        var extraFactsRequest = requestObject
        var extraFacts = try XCTUnwrap(extraFactsRequest["facts"] as? [String: Any])
        extraFacts["self_reported_verifier"] = true
        extraFactsRequest["facts"] = extraFacts
        XCTAssertThrowsError(try ReviewedActionPromotionProtocol.decodeRequest(
            JSONSerialization.data(withJSONObject: extraFactsRequest)
        ))

        var unknownVersion = requestObject
        unknownVersion["schema_version"] = "999"
        XCTAssertThrowsError(try ReviewedActionPromotionProtocol.decodeRequest(
            JSONSerialization.data(withJSONObject: unknownVersion)
        ))

        XCTAssertEqual(
            try ReviewedActionPromotionProtocol.decodeRequest(
                ReviewedActionPromotionProtocol.encodeRequest(request)
            ),
            request
        )

        let response = try ReviewedActionPromotionProtocol.encodeResponse(.approved(receipt))
        XCTAssertEqual(try ReviewedActionPromotionProtocol.decodeResponse(response), .approved(receipt))
        var responseObject = try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
        responseObject["extra"] = true
        XCTAssertThrowsError(try ReviewedActionPromotionProtocol.decodeResponse(
            JSONSerialization.data(withJSONObject: responseObject)
        ))

        responseObject.removeValue(forKey: "extra")
        responseObject["schema_version"] = "999"
        XCTAssertThrowsError(try ReviewedActionPromotionProtocol.decodeResponse(
            JSONSerialization.data(withJSONObject: responseObject)
        ))

        responseObject["schema_version"] = "1"
        var extraReceipt = try XCTUnwrap(responseObject["receipt"] as? [String: Any])
        extraReceipt["extra"] = true
        responseObject["receipt"] = extraReceipt
        XCTAssertThrowsError(try ReviewedActionPromotionProtocol.decodeResponse(
            JSONSerialization.data(withJSONObject: responseObject)
        ))
    }

    func testSwiftFixtureCanonicalBytesAndSignatureAreExact() throws {
        XCTAssertEqual(fixture["generated_by"] as? String, "GeneratePromotionFixture.swift")
        XCTAssertEqual(try ReviewedActionPromotionProtocol.canonicalPayload(for: receipt), canonicalPayload)
        XCTAssertTrue(ReviewedActionPromotionProtocol.verify(receipt: receipt, verifier: verifier, request: request))

        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: canonicalPayload) as? [String: Any])
        let reversed = Dictionary(uniqueKeysWithValues: object.keys.sorted(by: >).map { ($0, object[$0]!) })
        XCTAssertEqual(
            try JSONSerialization.data(withJSONObject: reversed, options: [.sortedKeys, .withoutEscapingSlashes]),
            canonicalPayload
        )
    }

    func testEverySignedFactMutationAndForgeryRefuses() throws {
        let mutations: [(String, Any)] = [
            ("source_commit", String(repeating: "2", count: 40)),
            ("action_id", "different-action"),
            ("approved_digest", String(repeating: "9", count: 64)),
            ("approved_origin", "https://other.example.test"),
            ("approved_effect", "mutation"),
            ("audited_capabilities", ["dom-query"]),
            ("containment", "none"),
            ("input_schema_digest", String(repeating: "5", count: 64)),
            ("result_schema_digest", String(repeating: "6", count: 64)),
            ("postcondition_digest", String(repeating: "7", count: 64)),
            ("receipt_id", "receipt-mutated"),
            ("approval_reference", "review-mutated"),
            ("issued_at_epoch_ms", 1_754_265_600_001 as Int64),
            ("verifier_key_id", String(repeating: "a", count: 64)),
            ("signature", Data("forged".utf8).base64EncodedString()),
        ]
        for (field, value) in mutations {
            var object = try XCTUnwrap(fixture["receipt"] as? [String: Any])
            object[field] = value
            let mutated = try JSONDecoder().decode(
                ReviewedActionPromotionReceipt.self,
                from: JSONSerialization.data(withJSONObject: object)
            )
            XCTAssertFalse(
                ReviewedActionPromotionProtocol.verify(receipt: mutated, verifier: verifier, request: request),
                "mutation unexpectedly verified: \(field)"
            )
        }
    }

    func testWrongKeyRotationAndReplayRefuse() throws {
        let wrongKey = P256.Signing.PrivateKey()
        let rotatedVerifier = ReviewedActionPromotionProtocol.verifierIdentity(for: wrongKey.publicKey)
        XCTAssertFalse(ReviewedActionPromotionProtocol.verify(receipt: receipt, verifier: rotatedVerifier))
        XCTAssertFalse(ReviewedActionPromotionProtocol.verify(
            receipt: receipt,
            verifier: ReviewedActionVerifierIdentity(
                key_id: verifier.key_id,
                public_key: rotatedVerifier.public_key
            )
        ))
        XCTAssertFalse(ReviewedActionPromotionProtocol.verify(
            receipt: receipt,
            verifier: ReviewedActionVerifierIdentity(
                key_id: String(repeating: "a", count: 64),
                public_key: verifier.public_key
            )
        ))
        XCTAssertFalse(ReviewedActionPromotionProtocol.verifyUnique(receipts: [receipt, receipt], verifier: verifier))
    }

    func testPresenceOutcomesRemainTypedProtocolResults() throws {
        for code in ["biometric-capability-missing", "presence-cancelled"] {
            let encoded = try ReviewedActionPromotionProtocol.encodeResponse(
                .refused(code: code, message: "presence unavailable")
            )
            XCTAssertEqual(
                try ReviewedActionPromotionProtocol.decodeResponse(encoded),
                .refused(code: code, message: "presence unavailable")
            )
        }
    }

    func testUnsignedReceiptRequiresCustodyDerivedPresenceEvidence() throws {
        let unsigned = try ReviewedActionPromotionProtocol.makeUnsignedReceipt(
            request: request,
            receiptID: "receipt-custody-derived-presence",
            issuedAtEpochMilliseconds: 1_754_265_600_000,
            verifierKeyID: verifier.key_id,
            presenceBacked: true
        )
        XCTAssertTrue(unsigned.presence_backed)

        XCTAssertThrowsError(try ReviewedActionPromotionProtocol.makeUnsignedReceipt(
            request: request,
            receiptID: "receipt-untrusted-presence",
            issuedAtEpochMilliseconds: 1_754_265_600_000,
            verifierKeyID: verifier.key_id,
            presenceBacked: false
        ))
    }

    func testLostBrokerResponseIsUnknownWithoutAutomaticRetry() {
        var calls = 0
        let result = ReviewedActionPromotionProtocol.sendOnce(request) { _ in
            calls += 1
            throw CocoaError(.fileReadUnknown)
        }
        XCTAssertEqual(calls, 1)
        XCTAssertEqual(
            result,
            .unknown(
                code: "broker-response-unknown",
                message: "the broker may have dispatched signing; retry requires a fresh operator action"
            )
        )
    }
}
