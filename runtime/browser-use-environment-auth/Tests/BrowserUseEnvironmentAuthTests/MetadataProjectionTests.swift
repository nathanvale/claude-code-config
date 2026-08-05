@testable import BrowserUseEnvironmentAuth
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
