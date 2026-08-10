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
                ["/login"],
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
                == "f20cc45bdc28ac77a0d760002f4a9b25d0952902413a422d850838c5c410d8fd"
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
        #expect(selected["login_paths"] as? [String] == ["/login"])
        let output = try #require(String(data: envelope, encoding: .utf8))
        #expect(!output.contains("GitHub"))
        #expect(!output.contains("private-user"))
    }

    @Test
    func selectionCancelNormalizesTransportOrderAndCandidateFactDriftFailsClosed() throws {
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
        let reorderedSelection = try #require(
            reorderedObject["selection"] as? [String: Any]
        )
        let reorderedItem = try #require(
            reorderedSelection["selected_item"] as? [String: Any]
        )
        #expect(reorderedObject["ok"] as? Bool == true)
        #expect(reorderedItem["item_id"] as? String == "item-1")

        var driftedRows = rows
        driftedRows[1]["urls"] = [["href": "https://example.test/login"]]
        let drifted = bindingSelectionEnvelope(
            bytes: [UInt8](try JSONSerialization.data(withJSONObject: driftedRows)),
            vaultID: "vault-1",
            origin: "https://github.com",
            expectedDigest: digest,
            expectedCount: 2,
            select: { _, _ in 0 }
        )
        let driftedObject = try #require(
            JSONSerialization.jsonObject(with: drifted) as? [String: Any]
        )
        let driftedRejection = try #require(
            driftedObject["rejection"] as? [String: Any]
        )
        #expect(driftedObject["ok"] as? Bool == false)
        #expect(driftedRejection["code"] as? String == "selection-candidates-drifted")

        var pathDriftedRows = rows
        pathDriftedRows[1]["urls"] = [["href": "https://github.com/session"]]
        let pathDrifted = bindingSelectionEnvelope(
            bytes: [UInt8](try JSONSerialization.data(withJSONObject: pathDriftedRows)),
            vaultID: "vault-1",
            origin: "https://github.com",
            expectedDigest: digest,
            expectedCount: 2,
            select: { _, _ in 0 }
        )
        let pathDriftedObject = try #require(
            JSONSerialization.jsonObject(with: pathDrifted) as? [String: Any]
        )
        let pathDriftedRejection = try #require(
            pathDriftedObject["rejection"] as? [String: Any]
        )
        #expect(pathDriftedObject["ok"] as? Bool == false)
        #expect(pathDriftedRejection["code"] as? String == "selection-candidates-drifted")
    }

    @Test
    func atPrefixedUsernameKeepsOnlyMaskedDomain() throws {
        var row = item(id: "item-1", urls: ["https://github.com/login"])
        row["title"] = "Fixture"
        row["additional_information"] = "@corp.example"
        var displayed: [String] = []

        _ = bindingSelectionEnvelope(
            bytes: [UInt8](try JSONSerialization.data(withJSONObject: [row])),
            vaultID: "vault-1",
            origin: "https://github.com",
            expectedDigest: try selectionDigest(["item-1"]),
            expectedCount: 1,
            select: { labels, _ in
                displayed = labels
                return nil
            }
        )

        let label = try #require(displayed.first)
        #expect(label == "Fixture | ***@corp.example | https://github.com")
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
        #expect(projected.compactMap { $0["id"] as? String } == [
            "clean", "fragment", "native-app", "query",
        ])
        let origins = projected.map { row in
            (row["urls"] as? [[String: String]] ?? []).compactMap { $0["href"] }
        }
        #expect(origins == [
            ["https://fasttrack.test/"],
            ["https://app.glofox.com/"],
            ["https://native.example.test/"],
            ["https://192.168.1.1/"],
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
