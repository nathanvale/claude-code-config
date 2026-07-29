@_spi(Testing) import BrowserUseEnvironmentAuth
@_spi(Executor) import BrowserUseEnvironmentAuth
import Darwin
import Foundation

@_silgen_name("fork")
private func testFork() -> pid_t

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func check(
    _ condition: @autoclosure () throws -> Bool,
    _ message: String
) throws {
    guard try condition() else { throw TestFailure(description: message) }
}

private let acceptingBackupExclusionProof = TokenCustodyBackupExclusionProof(
    setAndProve: { _ in },
    prove: { _ in }
)

private let acceptingRemovalControls = TokenCustodyRemovalControls(
    beforeQuarantine: { _ in },
    beforeUnlinkQuarantine: { _ in },
    syncParent: { fsync($0) == 0 }
)

private func installForTest(
    configRoot: String,
    tokenBytes: inout [UInt8],
    validatorDescriptor: Int32,
    replacing: Bool,
    backupExclusionProof: TokenCustodyBackupExclusionProof =
        acceptingBackupExclusionProof,
    validatorTimeoutMilliseconds: Int32 = 5_000
) -> TokenCustodyResult {
    TokenCustody.installForTesting(
        configRoot: configRoot,
        tokenBytes: &tokenBytes,
        validatorDescriptor: validatorDescriptor,
        replacing: replacing,
        backupExclusionProof: backupExclusionProof,
        validatorTimeoutMilliseconds: validatorTimeoutMilliseconds
    )
}

private func statusForTest(configRoot: String) -> TokenCustodyResult {
    TokenCustody.statusForTesting(
        configRoot: configRoot,
        backupExclusionProof: acceptingBackupExclusionProof
    )
}

private func removeForTest(
    configRoot: String,
    controls: TokenCustodyRemovalControls = acceptingRemovalControls
) -> TokenCustodyResult {
    TokenCustody.removeForTesting(
        configRoot: configRoot,
        backupExclusionProof: acceptingBackupExclusionProof,
        controls: controls
    )
}

private func cleanupForTest(configRoot: String) -> TokenCustodyResult {
    TokenCustody.cleanupForTesting(
        configRoot: configRoot,
        backupExclusionProof: acceptingBackupExclusionProof
    )
}

private func makeConfigRoot() throws -> URL {
    let base = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        .appendingPathComponent(".test-tmp", isDirectory: true)
    try FileManager.default.createDirectory(
        at: base,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: base.path
    )
    let root = base.appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    return root
}

private final class RequestBox: @unchecked Sendable {
    var request = ""
    var receivedContent: Data?
}

private final class URLBox: @unchecked Sendable {
    var value: URL?
}

private func controlAlignment(_ size: Int) -> Int {
    let alignment = MemoryLayout<cmsghdr>.alignment
    return (size + alignment - 1) & ~(alignment - 1)
}

private func receiveDescriptor(
    socket: Int32
) -> (request: String, descriptor: Int32?) {
    let headerSize = controlAlignment(MemoryLayout<cmsghdr>.size)
    let controlSize = headerSize + controlAlignment(MemoryLayout<Int32>.size)
    var payload = [UInt8](repeating: 0, count: 128)
    var control = [UInt8](repeating: 0, count: controlSize)
    let received = payload.withUnsafeMutableBytes { payloadBytes in
        control.withUnsafeMutableBytes { controlBytes in
            var vector = iovec(
                iov_base: payloadBytes.baseAddress,
                iov_len: payloadBytes.count
            )
            return withUnsafeMutablePointer(to: &vector) { vectorPointer in
                var message = msghdr(
                    msg_name: nil,
                    msg_namelen: 0,
                    msg_iov: vectorPointer,
                    msg_iovlen: 1,
                    msg_control: controlBytes.baseAddress,
                    msg_controllen: socklen_t(controlBytes.count),
                    msg_flags: 0
                )
                return recvmsg(socket, &message, 0)
            }
        }
    }
    guard received > 0 else { return ("", nil) }
    let request = String(decoding: payload.prefix(received), as: UTF8.self)
    let descriptor = control.withUnsafeBytes { controlBytes -> Int32? in
        guard let base = controlBytes.baseAddress else { return nil }
        let header = base.assumingMemoryBound(to: cmsghdr.self).pointee
        guard header.cmsg_level == SOL_SOCKET,
              header.cmsg_type == SCM_RIGHTS,
              Int(header.cmsg_len) >= headerSize + MemoryLayout<Int32>.size
        else {
            return nil
        }
        return base.advanced(by: headerSize)
            .assumingMemoryBound(to: Int32.self)
            .pointee
    }
    return (request, descriptor)
}

private func readDescriptor(_ descriptor: Int32) -> Data {
    var output = Data()
    var offset: off_t = 0
    var buffer = [UInt8](repeating: 0, count: 4096)
    while true {
        let capacity = buffer.count
        let count = buffer.withUnsafeMutableBytes {
            pread(descriptor, $0.baseAddress, capacity, offset)
        }
        guard count > 0 else { break }
        output.append(contentsOf: buffer.prefix(count))
        offset += off_t(count)
    }
    return output
}

private func pathForDescriptor(_ descriptor: Int32) -> URL? {
    var path = [CChar](repeating: 0, count: Int(MAXPATHLEN))
    guard fcntl(descriptor, F_GETPATH, &path) == 0 else { return nil }
    let end = path.firstIndex(of: 0) ?? path.endIndex
    return URL(
        fileURLWithPath: String(
            decoding: path[..<end].map { UInt8(bitPattern: $0) },
            as: UTF8.self
        )
    )
}

private func validator(
    custodyDirectory: URL,
    approve: Bool,
    respond: Bool = true,
    mutate: (@Sendable (URL) -> Void)? = nil
) throws -> (
    Int32,
    DispatchSemaphore,
    @Sendable () -> (request: String, content: Data?)
) {
    var descriptors: [Int32] = [0, 0]
    guard socketpair(AF_UNIX, SOCK_STREAM, 0, &descriptors) == 0 else {
        throw POSIXError(.ENOTSOCK)
    }
    let done = DispatchSemaphore(value: 0)
    let box = RequestBox()
    let server = descriptors[1]
    DispatchQueue.global().async {
        defer {
            _ = Darwin.close(server)
            done.signal()
        }
        let received = receiveDescriptor(socket: server)
        box.request = received.request
        if let descriptor = received.descriptor {
            defer { _ = Darwin.close(descriptor) }
            box.receivedContent = readDescriptor(descriptor)
            if let staged = pathForDescriptor(descriptor) {
                mutate?(staged)
            }
        }
        guard respond else {
            usleep(200_000)
            return
        }
        let response = approve && received.descriptor != nil
            ? Array("ok\n".utf8)
            : Array("no\n".utf8)
        _ = response.withUnsafeBytes {
            Darwin.write(server, $0.baseAddress, response.count)
        }
    }
    return (
        descriptors[0],
        done,
        { (request: box.request, content: box.receivedContent) }
    )
}

private func firstInstallStatusAndLocalRemovalStaySecretFree() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let custody = root.appendingPathComponent(
        TokenCustodyPaths.directoryName,
        isDirectory: true
    )
    let sentinel = "ops_SENTINEL_U1_NEVER_PRINT"
    let channel = try validator(custodyDirectory: custody, approve: true)
    var bytes = Array((sentinel + "\n").utf8)

    let installed = installForTest(
        configRoot: root.path,
        tokenBytes: &bytes,
        validatorDescriptor: channel.0,
        replacing: false
    )
    _ = Darwin.close(channel.0)
    try check(channel.1.wait(timeout: .now() + 2) == .success, "validator timed out")
    try check(
        installed.state == .installed,
        "first install did not succeed: \(installed.state.rawValue) "
            + "\(installed.cause?.rawValue ?? "no-cause"); "
            + "request=\(channel.2().request.debugDescription); "
            + "content=\(channel.2().content?.count ?? -1)"
    )
    try check(Set(bytes) == [0], "native input buffer was not zeroed")
    try check(!channel.2().request.contains(sentinel), "validator request leaked token")
    try check(
        channel.2().content == Data(sentinel.utf8),
        "validator did not receive the opened staged descriptor"
    )
    let resultJSON = String(
        data: try JSONEncoder().encode(installed),
        encoding: .utf8
    )!
    try check(!resultJSON.contains(sentinel), "result leaked token")

    let token = custody.appendingPathComponent("op-service-account-token")
    let metadata = try FileManager.default.attributesOfItem(atPath: token.path)
    try check(
        (metadata[.posixPermissions] as? NSNumber)?.intValue == 0o600,
        "installed mode is not 0600"
    )
    try check(
        (metadata[.referenceCount] as? NSNumber)?.intValue == 1,
        "installed token has another hard link"
    )
    try check(
        statusForTest(configRoot: root.path).state == .ready,
        "installed token is not ready"
    )

    let removed = removeForTest(configRoot: root.path)
    try check(removed.state == .removed, "remove did not succeed")
    try check(
        removed.remoteAuthority == "may-remain-live",
        "local removal claimed remote revocation"
    )
    try check(
        removed.nextAction == "revoke-service-account-token-remotely",
        "remove omitted remote revocation action"
    )
    try check(
        !FileManager.default.fileExists(atPath: token.path),
        "exact token file remains"
    )
}

private func failedReplacementPreservesPriorInodeAndBytes() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let custody = root.appendingPathComponent(
        TokenCustodyPaths.directoryName,
        isDirectory: true
    )
    var original = Array("ops_ORIGINAL_SENTINEL\n".utf8)
    let first = try validator(custodyDirectory: custody, approve: true)
    try check(
        installForTest(
            configRoot: root.path,
            tokenBytes: &original,
            validatorDescriptor: first.0,
            replacing: false
        ).state == .installed,
        "fixture install failed"
    )
    _ = Darwin.close(first.0)
    _ = first.1.wait(timeout: .now() + 2)
    let token = custody.appendingPathComponent("op-service-account-token")
    let before = try FileManager.default.attributesOfItem(atPath: token.path)
    let beforeInode = before[.systemFileNumber] as? NSNumber

    var replacement = Array("ops_REPLACEMENT_SENTINEL\n".utf8)
    let rejected = try validator(custodyDirectory: custody, approve: false)
    let result = installForTest(
        configRoot: root.path,
        tokenBytes: &replacement,
        validatorDescriptor: rejected.0,
        replacing: true
    )
    _ = Darwin.close(rejected.0)
    _ = rejected.1.wait(timeout: .now() + 2)
    try check(result.cause == .validationFailed, "rejection was not typed")
    let after = try FileManager.default.attributesOfItem(atPath: token.path)
    try check(
        after[.systemFileNumber] as? NSNumber == beforeInode,
        "failed replacement changed prior inode"
    )
    try check(
        try Data(contentsOf: token) == Data("ops_ORIGINAL_SENTINEL".utf8),
        "failed replacement changed prior bytes"
    )
}

private func pathSwapAndCrashResidueBlock() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let custody = root.appendingPathComponent(
        TokenCustodyPaths.directoryName,
        isDirectory: true
    )
    var token = Array("ops_PATH_SWAP_SENTINEL\n".utf8)
    let swapping = try validator(
        custodyDirectory: custody,
        approve: true,
        mutate: { staged in
            let moved = staged.appendingPathExtension("moved")
            try? FileManager.default.moveItem(at: staged, to: moved)
            _ = FileManager.default.createFile(
                atPath: staged.path,
                contents: Data("different".utf8),
                attributes: [.posixPermissions: 0o600]
            )
        }
    )
    let swapped = installForTest(
        configRoot: root.path,
        tokenBytes: &token,
        validatorDescriptor: swapping.0,
        replacing: false
    )
    _ = Darwin.close(swapping.0)
    _ = swapping.1.wait(timeout: .now() + 2)
    try check(swapped.cause == .pathIdentityChanged, "path swap was not refused")

    try FileManager.default.createDirectory(
        at: custody,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
    )
    let residue = custody.appendingPathComponent(
        ".op-service-account-token.stage.crash"
    )
    _ = FileManager.default.createFile(
        atPath: residue.path,
        contents: Data("residue".utf8),
        attributes: [.posixPermissions: 0o600]
    )
    let status = statusForTest(configRoot: root.path)
    try check(
        status.state == .cleanupRequired,
        "residue was not surfaced: \(status.state.rawValue) "
            + "\(status.cause?.rawValue ?? "no-cause")"
    )
    try check(status.cause == .stagingResidue, "residue cause was not typed")
}

private func emptyInputCancelsWithoutDamage() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    var empty: [UInt8] = []
    let result = installForTest(
        configRoot: root.path,
        tokenBytes: &empty,
        validatorDescriptor: -1,
        replacing: false
    )
    try check(result.cause == .inputInvalid, "empty input was not refused")
    try check(
        statusForTest(configRoot: root.path).state == .missing,
        "cancelled install left usable state"
    )
}

private func rejectingBackupProofBlocksBeforePublish() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    var token = Array("ops_BACKUP_PROOF_REJECTION\n".utf8)
    let rejectingProof = TokenCustodyBackupExclusionProof(
        setAndProve: { _ in
            throw TokenCustodyCause.backupExclusionUnproven
        },
        prove: { _ in
            throw TokenCustodyCause.backupExclusionUnproven
        }
    )

    let result = installForTest(
        configRoot: root.path,
        tokenBytes: &token,
        validatorDescriptor: -1,
        replacing: false,
        backupExclusionProof: rejectingProof
    )

    try check(
        result.cause == .backupExclusionUnproven,
        "rejecting backup proof did not fail closed"
    )
    let tokenPath = root
        .appendingPathComponent(TokenCustodyPaths.directoryName)
        .appendingPathComponent(TokenCustodyPaths.tokenName)
    try check(
        !FileManager.default.fileExists(atPath: tokenPath.path),
        "backup proof rejection published a token"
    )
}

private func validatorTimeoutCleansStagingPath() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let custody = root.appendingPathComponent(
        TokenCustodyPaths.directoryName,
        isDirectory: true
    )
    let channel = try validator(
        custodyDirectory: custody,
        approve: true,
        respond: false
    )
    var token = Array("ops_VALIDATOR_TIMEOUT\n".utf8)

    let result = installForTest(
        configRoot: root.path,
        tokenBytes: &token,
        validatorDescriptor: channel.0,
        replacing: false,
        validatorTimeoutMilliseconds: 25
    )
    _ = Darwin.close(channel.0)
    try check(
        channel.1.wait(timeout: .now() + 2) == .success,
        "timeout validator did not close"
    )
    try check(
        result.cause == .validationTimeout,
        "validator deadline did not return the typed timeout"
    )
    let entries = try FileManager.default.contentsOfDirectory(
        atPath: custody.path
    )
    try check(
        !entries.contains(where: {
            $0.hasPrefix(TokenCustodyPaths.stagingPrefix)
        }),
        "validator timeout left a staging pathname"
    )
    try check(
        !entries.contains(TokenCustodyPaths.tokenName),
        "validator timeout published a token"
    )
}

private func removalPathSwapNeverUnlinksEitherIdentity() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let custody = root.appendingPathComponent(
        TokenCustodyPaths.directoryName,
        isDirectory: true
    )
    var token = Array("ops_REMOVE_ORIGINAL\n".utf8)
    let channel = try validator(custodyDirectory: custody, approve: true)
    try check(
        installForTest(
            configRoot: root.path,
            tokenBytes: &token,
            validatorDescriptor: channel.0,
            replacing: false
        ).state == .installed,
        "remove-race fixture install failed"
    )
    _ = Darwin.close(channel.0)
    _ = channel.1.wait(timeout: .now() + 2)
    let fixed = custody.appendingPathComponent(TokenCustodyPaths.tokenName)
    let held = custody.appendingPathComponent("attacker-held-token")
    let controls = TokenCustodyRemovalControls(
        beforeQuarantine: { path in
            try FileManager.default.moveItem(
                at: URL(fileURLWithPath: path),
                to: held
            )
            _ = FileManager.default.createFile(
                atPath: path,
                contents: Data("ops_REMOVE_REPLACEMENT".utf8),
                attributes: [.posixPermissions: 0o600]
            )
        },
        beforeUnlinkQuarantine: { _ in },
        syncParent: { fsync($0) == 0 }
    )

    let result = removeForTest(configRoot: root.path, controls: controls)
    try check(
        result.cause == .pathIdentityChanged,
        "removal path swap was not refused"
    )
    try check(
        try Data(contentsOf: fixed) == Data("ops_REMOVE_REPLACEMENT".utf8),
        "removal deleted the swapped fixed-path identity"
    )
    try check(
        try Data(contentsOf: held) == Data("ops_REMOVE_ORIGINAL".utf8),
        "removal deleted the admitted identity after it moved"
    )
}

private func removalSyncFailurePreservesRemoteRevocationSemantics() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let custody = root.appendingPathComponent(
        TokenCustodyPaths.directoryName,
        isDirectory: true
    )
    var token = Array("ops_REMOVE_SYNC_FAILURE\n".utf8)
    let channel = try validator(custodyDirectory: custody, approve: true)
    try check(
        installForTest(
            configRoot: root.path,
            tokenBytes: &token,
            validatorDescriptor: channel.0,
            replacing: false
        ).state == .installed,
        "sync-failure fixture install failed"
    )
    _ = Darwin.close(channel.0)
    _ = channel.1.wait(timeout: .now() + 2)
    let controls = TokenCustodyRemovalControls(
        beforeQuarantine: { _ in },
        beforeUnlinkQuarantine: { _ in },
        syncParent: { _ in false }
    )

    let result = removeForTest(configRoot: root.path, controls: controls)
    try check(
        result.state == .removedSyncUnproven,
        "post-unlink sync failure did not get a split state"
    )
    try check(
        result.cause == .parentSyncFailed,
        "post-unlink sync failure cause was not retained"
    )
    try check(
        result.remoteAuthority == "may-remain-live",
        "post-unlink sync failure lost remote authority truth"
    )
    try check(
        result.nextAction == "revoke-service-account-token-remotely",
        "post-unlink sync failure lost remote revocation action"
    )
    try check(
        !FileManager.default.fileExists(
            atPath: custody
                .appendingPathComponent(TokenCustodyPaths.tokenName)
                .path
        ),
        "post-unlink sync fixture still has the fixed token"
    )
}

private func removalPreUnlinkSwapNeverUnlinksEitherIdentity() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let custody = root.appendingPathComponent(
        TokenCustodyPaths.directoryName,
        isDirectory: true
    )
    var token = Array("ops_REMOVE_PRE_UNLINK_ORIGINAL\n".utf8)
    let channel = try validator(custodyDirectory: custody, approve: true)
    try check(
        installForTest(
            configRoot: root.path,
            tokenBytes: &token,
            validatorDescriptor: channel.0,
            replacing: false
        ).state == .installed,
        "pre-unlink fixture install failed"
    )
    _ = Darwin.close(channel.0)
    _ = channel.1.wait(timeout: .now() + 2)

    let held = custody.appendingPathComponent("attacker-held-quarantine")
    let replacement = URLBox()
    let controls = TokenCustodyRemovalControls(
        beforeQuarantine: { _ in },
        beforeUnlinkQuarantine: { path in
            let quarantine = URL(fileURLWithPath: path)
            replacement.value = quarantine
            try FileManager.default.moveItem(at: quarantine, to: held)
            _ = FileManager.default.createFile(
                atPath: quarantine.path,
                contents: Data("ops_REMOVE_PRE_UNLINK_REPLACEMENT".utf8),
                attributes: [.posixPermissions: 0o600]
            )
        },
        syncParent: { fsync($0) == 0 }
    )

    let result = removeForTest(configRoot: root.path, controls: controls)
    try check(
        result.cause == .pathIdentityChanged,
        "pre-unlink quarantine swap was not refused"
    )
    try check(
        try Data(contentsOf: held)
            == Data("ops_REMOVE_PRE_UNLINK_ORIGINAL".utf8),
        "pre-unlink swap deleted the admitted identity"
    )
    let replacementData = try replacement.value.map { try Data(contentsOf: $0) }
    try check(
        replacementData == Data("ops_REMOVE_PRE_UNLINK_REPLACEMENT".utf8),
        "pre-unlink swap deleted the substitute identity"
    )
}

private func removalCrashResidueRequiresRemoteRevocation() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let custody = root.appendingPathComponent(
        TokenCustodyPaths.directoryName,
        isDirectory: true
    )
    var token = Array("ops_REMOVE_CRASH_RESIDUE\n".utf8)
    let channel = try validator(custodyDirectory: custody, approve: true)
    try check(
        installForTest(
            configRoot: root.path,
            tokenBytes: &token,
            validatorDescriptor: channel.0,
            replacing: false
        ).state == .installed,
        "removal-residue fixture install failed"
    )
    _ = Darwin.close(channel.0)
    _ = channel.1.wait(timeout: .now() + 2)

    let fixed = custody.appendingPathComponent(TokenCustodyPaths.tokenName)
    let residue = custody.appendingPathComponent(
        TokenCustodyPaths.removalPrefix + "crash"
    )
    try FileManager.default.moveItem(at: fixed, to: residue)

    let status = statusForTest(configRoot: root.path)
    try check(
        status.state == .cleanupRequired && status.cause == .removalResidue,
        "removal crash residue was not surfaced"
    )
    try check(
        status.remoteAuthority == "may-remain-live",
        "removal crash residue lost remote authority truth"
    )

    var replacement = Array("ops_REMOVE_CRASH_REPLACEMENT\n".utf8)
    let blockedInstall = installForTest(
        configRoot: root.path,
        tokenBytes: &replacement,
        validatorDescriptor: -1,
        replacing: false
    )
    try check(
        blockedInstall.cause == .removalResidue,
        "removal residue did not block a new install"
    )
    try check(
        blockedInstall.nextAction == "complete-local-token-removal"
            && blockedInstall.remoteAuthority == "may-remain-live",
        "blocked install lost removal repair and remote authority truth"
    )
    try check(
        !FileManager.default.fileExists(atPath: fixed.path),
        "blocked install published a second token"
    )

    let cleaned = cleanupForTest(configRoot: root.path)
    try check(cleaned.state == .cleaned, "removal residue cleanup failed")
    try check(
        cleaned.nextAction == "revoke-service-account-token-remotely",
        "removal residue cleanup lost remote revocation"
    )
    try check(
        cleaned.remoteAuthority == "may-remain-live",
        "removal residue cleanup claimed remote revocation"
    )
    try check(
        !FileManager.default.fileExists(atPath: residue.path),
        "removal residue bytes remain after cleanup"
    )
}

private func coreLimitAdmissionFailsClosed() throws {
    var readbackCalled = false
    do {
        try TokenCustodyProcessSafety.proveForTesting(
            setLimit: { false },
            readLimit: {
                readbackCalled = true
                return (0, 0)
            }
        )
        throw TestFailure(description: "core-limit failure was admitted")
    } catch let cause as TokenCustodyCause {
        try check(
            cause == .coreDumpDisableFailed,
            "core-limit failure returned the wrong cause"
        )
    }
    try check(
        !readbackCalled,
        "core-limit admission continued after setrlimit failure"
    )
}

private func syncProviderAncestorBlocksBeforeValidation() throws {
    let testBase = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        .appendingPathComponent(".test-tmp", isDirectory: true)
        .appendingPathComponent("CloudStorage", isDirectory: true)
    try FileManager.default.createDirectory(
        at: testBase,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: testBase.path
    )
    let root = testBase.appendingPathComponent(
        UUID().uuidString,
        isDirectory: true
    )
    try FileManager.default.createDirectory(
        at: root,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    defer {
        try? FileManager.default.removeItem(at: root)
        try? FileManager.default.removeItem(at: testBase)
    }
    var token = Array("ops_SYNC_PROVIDER_REJECT\n".utf8)

    let result = installForTest(
        configRoot: root.path,
        tokenBytes: &token,
        validatorDescriptor: -1,
        replacing: false
    )

    try check(
        result.cause == .syncExclusionUnproven,
        "known sync-provider ancestor was not refused"
    )
    try check(
        !FileManager.default.fileExists(
            atPath: root
                .appendingPathComponent(TokenCustodyPaths.directoryName)
                .appendingPathComponent(TokenCustodyPaths.tokenName)
                .path
        ),
        "sync-provider refusal published a token"
    )
}

private func environmentOpAdmissionRequiresAbsoluteSupportedBinary() throws {
    let admitted = EnvironmentOpExecutableAdmission.admit(
        executablePath: "/opt/homebrew/bin/op",
        versionOutput: "2.31.0\n"
    )
    try check(admitted == .admitted(path: "/opt/homebrew/bin/op", version: "2.31.0"),
              "supported absolute OP executable was not admitted")
    try check(
        EnvironmentOpExecutableAdmission.admit(
            executablePath: "op",
            versionOutput: "2.31.0\n"
        ) == .blocked(.pathNotAbsolute),
        "relative OP executable was admitted"
    )
    try check(
        EnvironmentOpExecutableAdmission.admit(
            executablePath: "/opt/homebrew/bin/op",
            versionOutput: "2.17.0\n"
        ) == .blocked(.versionUnsupported),
        "unsupported OP executable was admitted"
    )
}

private func emitFakeOpJSON(_ value: Any) {
    let bytes = try! JSONSerialization.data(
        withJSONObject: value,
        options: [.sortedKeys]
    )
    FileHandle.standardOutput.write(bytes)
    FileHandle.standardOutput.write(Data([0x0a]))
}

private func runAsFakeOp() {
    let arguments = Array(CommandLine.arguments.dropFirst())
    if arguments == ["--version"] {
        if URL(fileURLWithPath: CommandLine.arguments[0]).lastPathComponent
            == "browser-use-fake-op-replacing"
        {
            let current = URL(fileURLWithPath: CommandLine.arguments[0])
            let replacement = current.appendingPathExtension("next")
            try! FileManager.default.copyItem(at: current, to: replacement)
            try! FileManager.default.setAttributes(
                [.posixPermissions: 0o700],
                ofItemAtPath: replacement.path
            )
            _ = try! FileManager.default.replaceItemAt(
                current,
                withItemAt: replacement
            )
        }
        print("2.31.0")
        return
    }
    if arguments == ["test-environment"] {
        let environment = ProcessInfo.processInfo.environment
        var openDescriptors: [Int32] = []
        for descriptor in Int32(3)..<Int32(64) {
            if fcntl(descriptor, F_GETFD) >= 0 {
                openDescriptors.append(descriptor)
            }
        }
        emitFakeOpJSON([
            "environment_keys": environment.keys.sorted(),
            "token_matches": environment["OP_SERVICE_ACCOUNT_TOKEN"]
                == "ops_U2_SENTINEL_TOKEN",
            "pid": getpid(),
            "parent_pid": getppid(),
            "open_descriptors": openDescriptors,
        ])
        return
    }
    if arguments == ["test-timeout"] {
        usleep(300_000)
        return
    }
    if arguments == ["test-huge"] {
        FileHandle.standardOutput.write(Data(repeating: 65, count: 300_000))
        return
    }
    if arguments == ["test-malformed"] {
        FileHandle.standardOutput.write(Data([0xff, 0x00, 0x7b]))
        return
    }
    if arguments == ["test-signal"] {
        _ = raise(SIGTERM)
        return
    }
    if arguments.count == 2, arguments[0] == "test-descendant" {
        let descendant = testFork()
        if descendant == 0 {
            usleep(10_000_000)
            _exit(0)
        }
        guard descendant > 0 else { Foundation.exit(41) }
        try! String(descendant).write(
            toFile: arguments[1],
            atomically: true,
            encoding: .utf8
        )
        usleep(5_000_000)
        return
    }
    if arguments.starts(with: ["user", "get"]) {
        emitFakeOpJSON([
            "id": "user-1",
            "state": "ACTIVE",
            "email": "not-projected@example.com",
        ])
        return
    }
    if arguments.starts(with: ["vault", "list"]) {
        emitFakeOpJSON([
            ["id": "vault-1", "name": "not-projected"],
        ])
        return
    }
    if arguments.starts(with: ["item", "list"]) {
        if arguments.contains("malformed") {
            FileHandle.standardOutput.write(Data([0xff, 0x00, 0x7b]))
            return
        }
        FileHandle.standardError.write(Data("ops_SECRET_STDERR_SENTINEL\n".utf8))
        let href = arguments.contains("secret-url")
            ? "https://portal.example.com/login?token=ops_SECRET_URL_SENTINEL"
            : "https://portal.example.com/login"
        emitFakeOpJSON([
            [
                "id": "item-1",
                "vault": ["id": "vault-1", "name": "not-projected"],
                "category": "LOGIN",
                "urls": [["href": href]],
                "title": "not-projected",
            ],
        ])
        return
    }
    if arguments.starts(with: ["item", "get"]) {
        if arguments.contains("stderr-secret") {
            FileHandle.standardError.write(Data("ops_SECRET_STDERR_SENTINEL\n".utf8))
        }
        emitFakeOpJSON([
            "id": arguments.count > 2 ? arguments[2] : "item-1",
            "vault": ["id": "vault-1", "name": "not-projected"],
            "category": "LOGIN",
            "urls": [["href": "https://portal.example.com/login"]],
            "title": "not-projected",
            "fields": [
                ["label": "password", "value": "ops_SECRET_OUTPUT_SENTINEL"],
            ],
        ])
        return
    }
    Foundation.exit(40)
}

private func makeFakeOp(
    name: String = "browser-use-fake-op"
) throws -> URL {
    let root = try makeConfigRoot()
    let fake = root.appendingPathComponent(name)
    try FileManager.default.copyItem(
        at: URL(fileURLWithPath: CommandLine.arguments[0]),
        to: fake
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: fake.path
    )
    return fake
}

private func withTokenDescriptor<T>(
    _ body: (Int32) throws -> T
) throws -> T {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let token = root.appendingPathComponent("token")
    FileManager.default.createFile(
        atPath: token.path,
        contents: Data("ops_U2_SENTINEL_TOKEN".utf8),
        attributes: [.posixPermissions: 0o600]
    )
    let descriptor = Darwin.open(token.path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    guard descriptor >= 0 else { throw POSIXError(.ENOENT) }
    defer { _ = Darwin.close(descriptor) }
    return try body(descriptor)
}

private func environmentOpChildGetsOnlyExactEnvironment() throws {
    let fake = try makeFakeOp()
    defer { try? FileManager.default.removeItem(at: fake.deletingLastPathComponent()) }
    setenv("OP_CONNECT_HOST", "https://ambient.invalid", 1)
    setenv("OP_CONNECT_TOKEN", "ambient-connect-token", 1)
    setenv("OP_SERVICE_ACCOUNT_TOKEN", "ambient-token", 1)
    defer {
        unsetenv("OP_CONNECT_HOST")
        unsetenv("OP_CONNECT_TOKEN")
        unsetenv("OP_SERVICE_ACCOUNT_TOKEN")
    }
    try withTokenDescriptor { descriptor in
        let result = EnvironmentOpProcessRunner.run(
            executablePath: fake.path,
            arguments: ["test-environment"],
            tokenDescriptor: descriptor
        )
        guard case let .success(output) = result,
              let object = try JSONSerialization.jsonObject(with: Data(output.stdout))
                as? [String: Any]
        else {
            throw TestFailure(description: "fake OP exact-environment probe failed")
        }
        let environmentKeys = object["environment_keys"] as? [String] ?? []
        try check(
            environmentKeys == [
                "LANG",
                "OP_SERVICE_ACCOUNT_TOKEN",
                "PATH",
                // CoreFoundation synthesizes this process-local locale key at
                // startup even when execve receives the three-entry envp.
                "__CF_USER_TEXT_ENCODING",
            ],
            "fake OP inherited an ambient environment key: \(environmentKeys)"
        )
        try check(
            object["token_matches"] as? Bool == true,
            "fake OP did not receive the fixed descriptor token"
        )
        try check(
            (object["parent_pid"] as? NSNumber)?.int32Value == getpid(),
            "an intermediate process appeared between supervisor and OP"
        )
        try check(
            object["open_descriptors"] as? [Int] == [],
            "fake OP inherited an unrelated descriptor"
        )
    }
}

private func environmentOpOutputIsBoundedAndProjected() throws {
    let fake = try makeFakeOp()
    defer { try? FileManager.default.removeItem(at: fake.deletingLastPathComponent()) }
    try withTokenDescriptor { descriptor in
        let projected = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .itemGet(vaultID: "vault-1", itemID: "item-1"),
            tokenDescriptor: descriptor
        )
        let text = String(decoding: projected, as: UTF8.self)
        try check(text.contains("\"ok\":true"), "valid item metadata was blocked")
        try check(!text.contains("SECRET"), "secret-bearing OP output escaped projection")
        try check(!text.contains("title"), "non-allowlisted item metadata escaped projection")

        try check(
            EnvironmentOpProcessRunner.run(
                executablePath: fake.path,
                arguments: ["test-timeout"],
                tokenDescriptor: descriptor,
                timeoutMilliseconds: 25
            ) == .blocked(.timeout),
            "OP timeout was not typed"
        )
        try check(
            EnvironmentOpProcessRunner.run(
                executablePath: fake.path,
                arguments: ["test-huge"],
                tokenDescriptor: descriptor,
                maximumStdoutBytes: 32_768
            ) == .blocked(.outputTooLarge),
            "oversize OP output was not typed"
        )
        try check(
            EnvironmentOpProcessRunner.run(
                executablePath: fake.path,
                arguments: ["test-signal"],
                tokenDescriptor: descriptor
            ) == .blocked(.processSignalled),
            "OP signal was not typed"
        )
        let malformed = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .itemList(vaultID: "malformed"),
            tokenDescriptor: descriptor,
            timeoutMilliseconds: 1_000
        )
        try check(
            String(decoding: malformed, as: UTF8.self)
                .contains("\"code\":\"output-shape-invalid\""),
            "malformed metadata was not classified without byte relay"
        )
        let secretURL = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .itemList(vaultID: "secret-url"),
            tokenDescriptor: descriptor
        )
        let secretURLText = String(decoding: secretURL, as: UTF8.self)
        try check(
            secretURLText.contains("\"code\":\"output-shape-invalid\"")
                && !secretURLText.contains("SECRET_URL"),
            "secret-bearing metadata crossed the native projection"
        )
    }
}

private func environmentOpReplacementBlocksBeforeTokenUse() throws {
    let fake = try makeFakeOp(name: "browser-use-fake-op-replacing")
    defer { try? FileManager.default.removeItem(at: fake.deletingLastPathComponent()) }
    try withTokenDescriptor { descriptor in
        let result = EnvironmentOpSupervisor
            .executeIdentityBoundMetadataForTesting(
            executablePath: fake.path,
            operation: .vaultList,
            tokenDescriptor: descriptor
        )
        let text = String(decoding: result, as: UTF8.self)
        try check(
            text.contains("\"code\":\"op-executable-unavailable\""),
            "OP replacement during admission was not blocked"
        )
    }
}

private func environmentOpTimeoutKillsTokenBearingDescendants() throws {
    let fake = try makeFakeOp()
    defer { try? FileManager.default.removeItem(at: fake.deletingLastPathComponent()) }
    let pidFile = fake.deletingLastPathComponent().appendingPathComponent("descendant.pid")
    try withTokenDescriptor { descriptor in
        let result = EnvironmentOpProcessRunner.run(
            executablePath: fake.path,
            arguments: ["test-descendant", pidFile.path],
            tokenDescriptor: descriptor,
            timeoutMilliseconds: 1_000
        )
        try check(result == .blocked(.timeout), "descendant probe did not time out")
        guard let text = try? String(contentsOf: pidFile, encoding: .utf8),
              let descendant = Int32(text)
        else {
            throw TestFailure(description: "descendant PID evidence was not written")
        }
        var gone = false
        for _ in 0..<50 {
            if kill(descendant, 0) < 0, errno == ESRCH {
                gone = true
                break
            }
            usleep(10_000)
        }
        try check(gone, "token-bearing OP descendant survived group cleanup")
    }
}

private func environmentOpOfficialIdentityBlocksUnapprovedBinary() throws {
    let fake = try makeFakeOp()
    defer { try? FileManager.default.removeItem(at: fake.deletingLastPathComponent()) }
    try withTokenDescriptor { descriptor in
        let result = EnvironmentOpSupervisor.executeAdmittedMetadata(
            executablePath: fake.path,
            operation: .vaultList,
            tokenDescriptor: descriptor
        )
        try check(
            String(decoding: result, as: UTF8.self)
                .contains("\"code\":\"op-path-unapproved\""),
            "unapproved OP path reached the token execution boundary"
        )
    }
}

private func installedOfficialEnvironmentOpPassesPinnedIdentity() throws {
    let candidates = ["/opt/homebrew/bin/op", "/usr/local/bin/op"]
    guard let installed = candidates.first(where: {
        FileManager.default.isExecutableFile(atPath: $0)
    }) else {
        return
    }
    guard case .admitted = EnvironmentOpSupervisor
        .admitOfficialExecutableForTesting(executablePath: installed)
    else {
        throw TestFailure(
            description: "installed official OP failed pinned identity admission"
        )
    }
}

private func environmentOpValidatorUsesReceivedDescriptor() throws {
    let fake = try makeFakeOp()
    defer { try? FileManager.default.removeItem(at: fake.deletingLastPathComponent()) }
    let configRoot = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: configRoot) }

    var sockets: [Int32] = [0, 0]
    guard socketpair(AF_UNIX, SOCK_STREAM, 0, &sockets) == 0 else {
        throw POSIXError(.ENOTSOCK)
    }
    let done = DispatchSemaphore(value: 0)
    let server = sockets[1]
    DispatchQueue.global().async {
        defer {
            _ = Darwin.close(server)
            done.signal()
        }
        guard let descriptor = try? EnvironmentOpSupervisor.receiveTokenDescriptor(
            socket: server
        ) else {
            let response = Array("no\n".utf8)
            _ = response.withUnsafeBytes {
                Darwin.write(server, $0.baseAddress, response.count)
            }
            return
        }
        defer { _ = Darwin.close(descriptor) }
        let approved = EnvironmentOpSupervisor.validateStagedTokenForTesting(
            executablePath: fake.path,
            tokenDescriptor: descriptor
        )
        let response = approved ? Array("ok\n".utf8) : Array("no\n".utf8)
        _ = response.withUnsafeBytes {
            Darwin.write(server, $0.baseAddress, response.count)
        }
    }
    var token = Array("ops_U2_SENTINEL_TOKEN".utf8)
    let result = installForTest(
        configRoot: configRoot.path,
        tokenBytes: &token,
        validatorDescriptor: sockets[0],
        replacing: false
    )
    _ = Darwin.close(sockets[0])
    try check(done.wait(timeout: .now() + 3) == .success, "native validator stalled")
    try check(result.state == .installed, "native validator rejected valid OP scope")
}

@main
enum BrowserUseEnvironmentAuthTests {
    static func main() throws {
        if URL(fileURLWithPath: CommandLine.arguments[0]).lastPathComponent
            .hasPrefix("browser-use-fake-op")
        {
            runAsFakeOp()
            return
        }
        _ = signal(SIGPIPE, SIG_IGN)
        let tests: [(String, () throws -> Void)] = [
            (
                "first install/status/remove is secret-free",
                firstInstallStatusAndLocalRemovalStaySecretFree
            ),
            (
                "failed replace preserves old inode",
                failedReplacementPreservesPriorInodeAndBytes
            ),
            ("path swap and residue block", pathSwapAndCrashResidueBlock),
            ("empty input cancels cleanly", emptyInputCancelsWithoutDamage),
            (
                "rejecting backup proof blocks before publish",
                rejectingBackupProofBlocksBeforePublish
            ),
            (
                "validator timeout cleans staging",
                validatorTimeoutCleansStagingPath
            ),
            (
                "removal path swap unlinks neither identity",
                removalPathSwapNeverUnlinksEitherIdentity
            ),
            (
                "removal sync failure keeps revocation semantics",
                removalSyncFailurePreservesRemoteRevocationSemantics
            ),
            (
                "pre-unlink removal swap preserves both identities",
                removalPreUnlinkSwapNeverUnlinksEitherIdentity
            ),
            (
                "removal crash residue requires remote revocation",
                removalCrashResidueRequiresRemoteRevocation
            ),
            ("core limit admission fails closed", coreLimitAdmissionFailsClosed),
            (
                "sync-provider ancestor blocks before validation",
                syncProviderAncestorBlocksBeforeValidation
            ),
            (
                "environment OP admission requires absolute supported binary",
                environmentOpAdmissionRequiresAbsoluteSupportedBinary
            ),
            (
                "environment OP child gets only exact environment",
                environmentOpChildGetsOnlyExactEnvironment
            ),
            (
                "environment OP output is bounded and projected",
                environmentOpOutputIsBoundedAndProjected
            ),
            (
                "environment OP replacement blocks before token use",
                environmentOpReplacementBlocksBeforeTokenUse
            ),
            (
                "environment OP timeout kills token-bearing descendants",
                environmentOpTimeoutKillsTokenBearingDescendants
            ),
            (
                "environment OP official identity blocks unapproved binary",
                environmentOpOfficialIdentityBlocksUnapprovedBinary
            ),
            (
                "installed official environment OP passes pinned identity",
                installedOfficialEnvironmentOpPassesPinnedIdentity
            ),
            (
                "environment OP validator uses received descriptor",
                environmentOpValidatorUsesReceivedDescriptor
            ),
        ]
        for (name, test) in tests {
            try test()
            print("pass: \(name)")
        }
    }
}
