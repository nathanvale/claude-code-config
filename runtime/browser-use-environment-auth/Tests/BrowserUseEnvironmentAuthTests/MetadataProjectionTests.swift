@testable import BrowserUseEnvironmentAuth
import CryptoKit
import Foundation
import Testing

struct MetadataProjectionTests {
    private func item(
        id: String,
        urls: [String]
    ) -> [String: Any] {
        [
            "id": id,
            "version": 1,
            "category": "LOGIN",
            "vault": ["id": "vault-1"],
            "urls": urls.map { ["href": $0] },
            "fields": [["label": "password", "value": "fixture-secret"]],
            "notesPlain": "fixture-private-note",
        ]
    }

    private func selectionDigest(_ ids: [String]) throws -> String {
        let rows: [[Any]] = ids.map { id in
            [
                "vault-1",
                id,
                "active",
                ["https://github.com"],
                [String](),
                ["password", "otp"],
            ]
        }
        let data = try JSONSerialization.data(
            withJSONObject: rows,
            options: [.withoutEscapingSlashes]
        )
        return SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    @Test
    func candidateDigestMatchesTypeScriptJSONContract() throws {
        #expect(
            try selectionDigest(["item-1", "item-2"])
                == "4a68b5859d936dc2fd997c64874cecb17c811499d70564645f0e01c6fe68791b"
        )
    }

    @Test
    func sevenCandidateSelectionKeepsDescriptorsInsidePicker() throws {
        let ids = (1...7).map { "item-\($0)" }
        let rows = ids.enumerated().map { index, id -> [String: Any] in
            var row = item(id: id, urls: ["https://github.com/login"])
            row["title"] = index == 5 ? "GitHub" : "Other \(index + 1)"
            row["additional_information"] = index == 5
                ? "private-user@example.test"
                : "person\(index + 1)@example.test"
            return row
        }
        var displayed: [String] = []
        let envelope = bindingSelectionEnvelope(
            bytes: [UInt8](try JSONSerialization.data(withJSONObject: rows)),
            vaultID: "vault-1",
            origin: "https://github.com",
            expectedDigest: try selectionDigest(ids),
            expectedCount: 7,
            select: { labels, _ in
                displayed = labels
                return 5
            }
        )
        let object = try #require(
            JSONSerialization.jsonObject(with: envelope) as? [String: Any]
        )
        let selection = try #require(object["selection"] as? [String: Any])
        let selected = try #require(selection["selected_item"] as? [String: Any])
        #expect(object["ok"] as? Bool == true)
        #expect(displayed.count == 7)
        #expect(displayed[5].contains("GitHub"))
        #expect(displayed[5].contains("p***@example.test"))
        #expect(displayed[5].contains("https://github.com"))
        #expect(selected["item_id"] as? String == "item-6")
        #expect(selected["origins"] as? [String] == ["https://github.com"])
        let output = String(decoding: envelope, as: UTF8.self)
        #expect(!output.contains("GitHub"))
        #expect(!output.contains("private-user"))
    }

    @Test
    func selectionCancelAndCandidateReorderFailClosed() throws {
        let ids = ["item-1", "item-2"]
        let rows = ids.enumerated().map { index, id -> [String: Any] in
            var row = item(id: id, urls: ["https://github.com/login"])
            row["title"] = "Candidate \(index + 1)"
            row["additional_information"] = "person\(index + 1)@example.test"
            return row
        }
        let digest = try selectionDigest(ids)
        let cancelled = bindingSelectionEnvelope(
            bytes: [UInt8](try JSONSerialization.data(withJSONObject: rows)),
            vaultID: "vault-1",
            origin: "https://github.com",
            expectedDigest: digest,
            expectedCount: 2,
            select: { _, _ in nil }
        )
        let cancelledObject = try #require(
            JSONSerialization.jsonObject(with: cancelled) as? [String: Any]
        )
        let cancelledRejection = try #require(
            cancelledObject["rejection"] as? [String: Any]
        )
        #expect(cancelledObject["ok"] as? Bool == false)
        #expect(cancelledRejection["code"] as? String == "presence-cancelled")

        let reordered = bindingSelectionEnvelope(
            bytes: [UInt8](try JSONSerialization.data(withJSONObject: Array(rows.reversed()))),
            vaultID: "vault-1",
            origin: "https://github.com",
            expectedDigest: digest,
            expectedCount: 2,
            select: { _, _ in 0 }
        )
        let reorderedObject = try #require(
            JSONSerialization.jsonObject(with: reordered) as? [String: Any]
        )
        let reorderedRejection = try #require(
            reorderedObject["rejection"] as? [String: Any]
        )
        #expect(reorderedObject["ok"] as? Bool == false)
        #expect(reorderedRejection["code"] as? String == "selection-candidates-drifted")
    }

    @Test
    func itemListProjectionToleratesNonNormalizableURLs() throws {
        let rows = [
            item(
                id: "native-app",
                urls: [
                    "app://YB4A7C2HCN.ie.zappy.bftlive",
                    "https://native.example.test/sign-in",
                ]
            ),
            item(id: "query", urls: ["https://192.168.1.1/login?redirect=%2F"]),
            item(
                id: "fragment",
                urls: ["https://app.glofox.com/dashboard/#/password/reset?resetToken=secret"]
            ),
            item(id: "clean", urls: ["https://fasttrack.test/login"]),
        ]
        let bytes = try JSONSerialization.data(withJSONObject: rows)

        let projected = try #require(
            projectMetadata(operation: .itemList(vaultID: "vault-1"), bytes: [UInt8](bytes))
                as? [[String: Any]]
        )

        #expect(projected.count == 4)
        #expect(projected.allSatisfy {
            Set($0.keys) == ["id", "version", "category", "vault", "urls"]
        })
        let origins = projected.map { row in
            (row["urls"] as? [[String: String]] ?? []).compactMap { $0["href"] }
        }
        #expect(origins == [
            ["https://native.example.test/"],
            ["https://192.168.1.1/"],
            ["https://app.glofox.com/"],
            ["https://fasttrack.test/"],
        ])
    }

    @Test
    func itemProjectionDropsEveryNonNormalizableURL() throws {
        let projected = try #require(projectItem(item(
            id: "native-app",
            urls: [
                "app://YB4A7C2HCN.ie.zappy.bftlive",
                "https://user:password@example.test/login",
            ]
        )))

        #expect((projected["urls"] as? [[String: String]]) == [])
    }

    @Test
    func itemListProjectionRejectsStructurallyCorruptRow() throws {
        let rows: [[String: Any]] = [
            item(id: "clean", urls: ["https://fasttrack.test/login"]),
            [
                "version": 1,
                "category": "LOGIN",
                "vault": ["id": "vault-1"],
                "urls": [["href": "https://oncore.test/login"]],
            ],
        ]
        let bytes = try JSONSerialization.data(withJSONObject: rows)

        #expect(
            projectMetadata(operation: .itemList(vaultID: "vault-1"), bytes: [UInt8](bytes))
                == nil
        )
    }
}
