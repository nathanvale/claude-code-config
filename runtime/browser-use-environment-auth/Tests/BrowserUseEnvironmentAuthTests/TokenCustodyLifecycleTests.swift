@_spi(Executor) @_spi(Testing) import BrowserUseEnvironmentAuth
import Darwin
import Foundation
import Testing

@Suite
struct TokenCustodyLifecycleTests {
    private let backupProof = TokenCustodyBackupExclusionProof(
        setAndProve: { _ in },
        prove: { _ in }
    )

    private func configRoot() throws -> URL {
        // Custody-root admission refuses /var/folders temp roots (O_NOFOLLOW
        // ancestry walk + /private stripping), so fixtures live under the
        // package .build tree instead of NSTemporaryDirectory.
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent(".build", isDirectory: true)
            .appendingPathComponent("custody-fixtures", isDirectory: true)
            .resolvingSymlinksInPath()
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(
            at: root,
            withIntermediateDirectories: false,
            attributes: [.posixPermissions: 0o700]
        )
        return root
    }

    private func install(
        configRoot: URL,
        bytes: inout [UInt8],
        replacing: Bool,
        response: String
    ) throws -> TokenCustodyResult {
        var sockets: [Int32] = [-1, -1]
        try #require(socketpair(AF_UNIX, SOCK_STREAM, 0, &sockets) == 0)
        let validatorSocket = sockets[1]
        Thread.detachNewThread {
            defer { _ = Darwin.close(validatorSocket) }
            guard let descriptor = try? EnvironmentOpSupervisor
                .receiveTokenDescriptor(
                    socket: validatorSocket,
                    timeoutMilliseconds: 2_000
                )
            else {
                return
            }
            _ = Darwin.close(descriptor)
            let responseBytes = Array(response.utf8)
            _ = responseBytes.withUnsafeBytes {
                Darwin.write(
                    validatorSocket,
                    $0.baseAddress,
                    responseBytes.count
                )
            }
        }
        defer { _ = Darwin.close(sockets[0]) }
        return TokenCustody.installForTesting(
            configRoot: configRoot.path,
            tokenBytes: &bytes,
            validatorDescriptor: sockets[0],
            replacing: replacing,
            backupExclusionProof: backupProof,
            validatorTimeoutMilliseconds: 2_000
        )
    }

    @Test
    func installCreatesOwnerOnlyFileAfterValidation() throws {
        let root = try configRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        var token = Array("INSTALL_SENTINEL_52ad".utf8)
        let result = try install(
            configRoot: root,
            bytes: &token,
            replacing: false,
            response: "ok\n"
        )
        #expect(result.state == .installed)
        let paths = try TokenCustodyPaths(configRoot: root.path)
        var metadata = stat()
        #expect(lstat(paths.tokenFile, &metadata) == 0)
        #expect(metadata.st_mode & mode_t(0o777) == mode_t(0o600))
        #expect(token.allSatisfy { $0 == 0 })
    }

    @Test
    func invalidReplacementPreservesPriorWorkingFile() throws {
        let root = try configRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        var original = Array("PRIOR_WORKING_SENTINEL_14cb".utf8)
        #expect(
            try install(
                configRoot: root,
                bytes: &original,
                replacing: false,
                response: "ok\n"
            ).state == .installed
        )
        let paths = try TokenCustodyPaths(configRoot: root.path)
        let before = try Data(contentsOf: URL(fileURLWithPath: paths.tokenFile))
        var replacement = Array("INVALID_STAGED_SENTINEL_22ef".utf8)
        let result = try install(
            configRoot: root,
            bytes: &replacement,
            replacing: true,
            response: "identity\n"
        )
        #expect(result.state == .blocked)
        #expect(result.cause == .invalidServiceAccount)
        let after = try Data(contentsOf: URL(fileURLWithPath: paths.tokenFile))
        #expect(after == before)
    }

    @Test
    func removeTargetsOnlyTheFixedFileAndNamesRemoteRevocation() throws {
        let root = try configRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        var token = Array("REMOVE_SENTINEL_9a37".utf8)
        #expect(
            try install(
                configRoot: root,
                bytes: &token,
                replacing: false,
                response: "ok\n"
            ).state == .installed
        )
        let paths = try TokenCustodyPaths(configRoot: root.path)
        let sibling = URL(fileURLWithPath: paths.custodyDirectory)
            .appendingPathComponent("keep")
        try Data("keep".utf8).write(to: sibling)
        let result = TokenCustody.removeForTesting(
            configRoot: root.path,
            backupExclusionProof: backupProof,
            controls: TokenCustodyRemovalControls(
                beforeQuarantine: { _ in },
                beforeUnlinkQuarantine: { _ in },
                syncParent: { _ in true }
            )
        )
        #expect(result.state == .removed)
        #expect(result.nextAction == "revoke-service-account-token-remotely")
        #expect(result.remoteAuthority == "may-remain-live")
        #expect(FileManager.default.fileExists(atPath: sibling.path))
        #expect(!FileManager.default.fileExists(atPath: paths.tokenFile))
    }

    @Test
    func unsafeTokenModeBlocksStatusWithOneCustodyRepair() throws {
        let root = try configRoot()
        defer { try? FileManager.default.removeItem(at: root) }
        var token = Array("STATUS_SENTINEL_d631".utf8)
        #expect(
            try install(
                configRoot: root,
                bytes: &token,
                replacing: false,
                response: "ok\n"
            ).state == .installed
        )
        let paths = try TokenCustodyPaths(configRoot: root.path)
        try #require(chmod(paths.tokenFile, 0o644) == 0)
        let result = TokenCustody.statusForTesting(
            configRoot: root.path,
            backupExclusionProof: backupProof
        )
        #expect(result.state == .blocked)
        #expect(result.cause == .tokenUnsafe)
        #expect(result.nextAction == "repair-token-custody")
    }
}
