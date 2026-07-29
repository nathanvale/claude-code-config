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
    validatorTimeoutMilliseconds: Int32 = 5_000,
    validationCompletion: @escaping @Sendable () throws -> Void = {}
) -> TokenCustodyResult {
    TokenCustody.installForTesting(
        configRoot: configRoot,
        tokenBytes: &tokenBytes,
        validatorDescriptor: validatorDescriptor,
        replacing: replacing,
        backupExclusionProof: backupExclusionProof,
        validatorTimeoutMilliseconds: validatorTimeoutMilliseconds,
        validationCompletion: validationCompletion
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

private final class ExitCodeBox: @unchecked Sendable {
    var value: Int32?
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

private func appendFakeOpBindingPhase(
    _ phase: String,
    executable: URL
) {
    let marker = executable.deletingLastPathComponent()
        .appendingPathComponent(".binding-phases")
    let descriptor = Darwin.open(
        marker.path,
        O_WRONLY | O_APPEND | O_CLOEXEC
    )
    guard descriptor >= 0 else { Foundation.exit(42) }
    defer { _ = Darwin.close(descriptor) }
    let bytes = Array("\(phase)\n".utf8)
    let written = bytes.withUnsafeBytes { buffer in
        Darwin.write(descriptor, buffer.baseAddress, buffer.count)
    }
    guard written == bytes.count else { Foundation.exit(42) }
}

private func runAsFakeOp() {
    let arguments = Array(CommandLine.arguments.dropFirst())
    let executable = URL(fileURLWithPath: CommandLine.arguments[0])
    let principalTwo = ProcessInfo.processInfo.environment[
        "OP_SERVICE_ACCOUNT_TOKEN"
    ] == "ops_OTHER_PRINCIPAL"
    if arguments == ["--version"] {
        if executable.lastPathComponent
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
    if executable.lastPathComponent.contains("slow-binding") {
        let phase: String?
        if arguments.starts(with: ["user", "get"]) {
            phase = "user"
        } else if arguments.starts(with: ["vault", "list"]) {
            phase = "vault"
        } else if arguments.starts(with: ["item", "list"]) {
            phase = "item"
        } else {
            phase = nil
        }
        if let phase {
            appendFakeOpBindingPhase("\(phase)-start", executable: executable)
            usleep(400_000)
            appendFakeOpBindingPhase("\(phase)-done", executable: executable)
        }
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
            "id": principalTwo ? "user-2" : "user-1",
            "state": "ACTIVE",
            "type": "SERVICE_ACCOUNT",
            "email": "not-projected@example.com",
        ])
        let mutationMarker = executable.deletingLastPathComponent()
            .appendingPathComponent(".mutate-token-after-user")
        if FileManager.default.fileExists(atPath: mutationMarker.path) {
            let token = executable.deletingLastPathComponent()
                .appendingPathComponent("token")
            let handle = try! FileHandle(forWritingTo: token)
            try! handle.truncate(atOffset: 0)
            try! handle.write(contentsOf: Data("ops_OTHER_PRINCIPAL".utf8))
            try! handle.synchronize()
            try! handle.close()
        }
        return
    }
    if arguments.starts(with: ["vault", "list"]) {
        emitFakeOpJSON([
            [
                "id": principalTwo ? "vault-2" : "vault-1",
                "name": "not-projected",
            ],
        ])
        return
    }
    if arguments.starts(with: ["item", "list"]) {
        if arguments.contains("permission-denied") {
            Foundation.exit(41)
        }
        if arguments.contains("duplicate-item") {
            emitFakeOpJSON([
                [
                    "id": "item-1",
                    "version": 7,
                    "vault": ["id": "duplicate-item"],
                    "category": "LOGIN",
                    "urls": [["href": "https://portal.example.com/login"]],
                ],
                [
                    "id": "item-1",
                    "version": 8,
                    "vault": ["id": "duplicate-item"],
                    "category": "LOGIN",
                    "urls": [["href": "https://portal.example.com/login"]],
                ],
            ])
            return
        }
        if arguments.contains("malformed-item") {
            emitFakeOpJSON([
                [
                    "id": "item-1",
                    "version": 0,
                    "vault": ["id": "vault-1"],
                    "category": "LOGIN",
                    "urls": [["href": "https://portal.example.com/login"]],
                ],
            ])
            return
        }
        if arguments.contains("boolean-version") {
            emitFakeOpJSON([
                [
                    "id": "item-1",
                    "version": true,
                    "vault": ["id": "boolean-version"],
                    "category": "LOGIN",
                    "urls": [["href": "https://portal.example.com/login"]],
                ],
            ])
            return
        }
        if arguments.contains("malformed-unrelated") {
            emitFakeOpJSON([
                [
                    "id": "item-1",
                    "version": 7,
                    "vault": ["id": "malformed-unrelated"],
                    "category": "LOGIN",
                    "urls": [["href": "https://portal.example.com/login"]],
                ],
                [
                    "id": "unrelated-item",
                    "version": 0,
                    "vault": ["id": "malformed-unrelated"],
                    "category": "LOGIN",
                    "urls": [],
                ],
            ])
            return
        }
        if arguments.contains("cross-vault-item") {
            emitFakeOpJSON([
                [
                    "id": "cross-vault-item",
                    "version": 7,
                    "vault": ["id": "other-vault"],
                    "category": "LOGIN",
                    "urls": [["href": "https://portal.example.com/login"]],
                ],
            ])
            return
        }
        if arguments.contains("malformed") {
            FileHandle.standardOutput.write(Data([0xff, 0x00, 0x7b]))
            return
        }
        FileHandle.standardError.write(Data("ops_SECRET_STDERR_SENTINEL\n".utf8))
        let href = arguments.contains("secret-url")
            ? "https://portal.example.com/login?token=ops_SECRET_URL_SENTINEL"
            : arguments.contains("secret-path")
                ? "https://portal.example.com/reset/ops_SECRET_PATH_SENTINEL"
            : "https://portal.example.com/login"
        emitFakeOpJSON([
            [
                "id": principalTwo ? "item-2" : "item-1",
                "version": 7,
                "vault": [
                    "id": principalTwo ? "vault-2" : "vault-1",
                    "name": "not-projected",
                ],
                "category": "LOGIN",
                "urls": [["href": href]],
                "title": "not-projected",
            ],
        ])
        return
    }
    if arguments.starts(with: ["item", "get"]) {
        let marker = executable.deletingLastPathComponent()
            .appendingPathComponent(".item-get-invoked")
        FileManager.default.createFile(
            atPath: marker.path,
            contents: Data(),
            attributes: [.posixPermissions: 0o600]
        )
        if arguments.contains("missing-item") {
            Foundation.exit(40)
        }
        if arguments.contains("permission-denied") {
            Foundation.exit(41)
        }
        if arguments.contains("stderr-secret") {
            FileHandle.standardError.write(Data("ops_SECRET_STDERR_SENTINEL\n".utf8))
        }
        emitFakeOpJSON([
            "id": arguments.count > 2 ? arguments[2] : "item-1",
            "version": 7,
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
        let missing = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .itemGet(vaultID: "vault-1", itemID: "missing-item"),
            tokenDescriptor: descriptor
        )
        try check(
            String(decoding: missing, as: UTF8.self)
                .contains("\"code\":\"item-missing\""),
            "confirmed exact item absence did not reach binding repair"
        )
        let permissionDenied = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .itemList(vaultID: "permission-denied"),
            tokenDescriptor: descriptor
        )
        try check(
            String(decoding: permissionDenied, as: UTF8.self)
                .contains("\"code\":\"process-failed\""),
            "permission failure was mislabeled as item missing"
        )
        let malformedItem = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .itemGet(vaultID: "malformed-item", itemID: "item-1"),
            tokenDescriptor: descriptor
        )
        try check(
            String(decoding: malformedItem, as: UTF8.self)
                .contains("\"code\":\"output-shape-invalid\""),
            "malformed matching item was mislabeled as item missing"
        )
        let booleanVersion = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .itemGet(vaultID: "boolean-version", itemID: "item-1"),
            tokenDescriptor: descriptor
        )
        try check(
            String(decoding: booleanVersion, as: UTF8.self)
                .contains("\"code\":\"output-shape-invalid\""),
            "boolean item version was admitted as an integer"
        )
        let duplicateItem = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .itemGet(vaultID: "duplicate-item", itemID: "item-1"),
            tokenDescriptor: descriptor
        )
        try check(
            String(decoding: duplicateItem, as: UTF8.self)
                .contains("\"code\":\"output-shape-invalid\""),
            "duplicate exact item matches were admitted as binding evidence"
        )
        let malformedUnrelated = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .itemGet(
                vaultID: "malformed-unrelated",
                itemID: "item-1"
            ),
            tokenDescriptor: descriptor
        )
        try check(
            String(decoding: malformedUnrelated, as: UTF8.self)
                .contains("\"code\":\"output-shape-invalid\""),
            "malformed unrelated item row was misreported as exact evidence"
        )
        let crossVaultItem = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .itemGet(
                vaultID: "vault-1",
                itemID: "cross-vault-item"
            ),
            tokenDescriptor: descriptor
        )
        try check(
            String(decoding: crossVaultItem, as: UTF8.self)
                .contains("\"code\":\"output-shape-invalid\""),
            "exact item evidence was not bound to the requested vault"
        )
        let principalBound = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .bindingEvidence(
                expectedVaultID: "vault-1",
                itemID: "item-1"
            ),
            tokenDescriptor: descriptor
        )
        let principalBoundText = String(decoding: principalBound, as: UTF8.self)
        try check(
            principalBoundText.contains("\"ok\":true")
                && principalBoundText.contains("\"item_evidence\"")
                && principalBoundText.contains("\"user-1\""),
            "one-descriptor binding evidence was not projected"
        )
        try check(
            !principalBoundText.contains("SECRET")
                && !principalBoundText.contains("title"),
            "one-descriptor binding evidence leaked non-allowlisted metadata"
        )
        try check(
            !FileManager.default.fileExists(
                atPath: fake.deletingLastPathComponent()
                    .appendingPathComponent(".item-get-invoked").path
            ),
            "binding metadata proof invoked credential-bearing item get"
        )

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
        let secretPath = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .itemList(vaultID: "secret-path"),
            tokenDescriptor: descriptor
        )
        let secretPathText = String(decoding: secretPath, as: UTF8.self)
        try check(
            secretPathText.contains("\"ok\":true")
                && secretPathText.contains("https:\\/\\/portal.example.com\\/")
                && !secretPathText.contains("SECRET_PATH"),
            "secret-bearing URL path crossed the native projection"
        )
    }
}

private func environmentOpBindingEvidenceUsesOneTokenSnapshot() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let fake = root.appendingPathComponent("browser-use-fake-op")
    try FileManager.default.copyItem(
        at: URL(fileURLWithPath: CommandLine.arguments[0]),
        to: fake
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: fake.path
    )
    let token = root.appendingPathComponent("token")
    FileManager.default.createFile(
        atPath: token.path,
        contents: Data("ops_U2_SENTINEL_TOKEN".utf8),
        attributes: [.posixPermissions: 0o600]
    )
    FileManager.default.createFile(
        atPath: root.appendingPathComponent(".mutate-token-after-user").path,
        contents: Data(),
        attributes: [.posixPermissions: 0o600]
    )
    let descriptor = Darwin.open(token.path, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    guard descriptor >= 0 else { throw POSIXError(.ENOENT) }
    defer { _ = Darwin.close(descriptor) }

    let evidence = EnvironmentOpSupervisor.executeMetadata(
        executablePath: fake.path,
        operation: .bindingEvidence(
            expectedVaultID: "vault-1",
            itemID: "item-1"
        ),
        tokenDescriptor: descriptor
    )
    let text = String(decoding: evidence, as: UTF8.self)
    try check(
        text.contains("\"ok\":true")
            && text.contains("\"user-1\"")
            && text.contains("\"vault-1\"")
            && text.contains("\"item-1\""),
        "in-place source mutation changed the principal-bound snapshot"
    )
    try check(
        !text.contains("\"user-2\"")
            && !text.contains("\"vault-2\"")
            && !text.contains("\"item-2\""),
        "binding evidence composed two token principals"
    )
}

private func environmentOpBindingEvidenceUsesOneTotalDeadline() throws {
    let fake = try makeFakeOp(name: "browser-use-fake-op-slow-binding")
    defer { try? FileManager.default.removeItem(at: fake.deletingLastPathComponent()) }
    let marker = fake.deletingLastPathComponent()
        .appendingPathComponent(".binding-phases")
    FileManager.default.createFile(
        atPath: marker.path,
        contents: Data(),
        attributes: [.posixPermissions: 0o600]
    )
    try withTokenDescriptor { descriptor in
        let evidence = EnvironmentOpSupervisor.executeMetadata(
            executablePath: fake.path,
            operation: .bindingEvidence(
                expectedVaultID: "vault-1",
                itemID: "item-1"
            ),
            tokenDescriptor: descriptor,
            timeoutMilliseconds: 1_000
        )
        try check(
            String(decoding: evidence, as: UTF8.self)
                .contains("\"code\":\"timeout\""),
            "binding evidence reset the deadline for each OP child"
        )
        let phases = try String(contentsOf: marker, encoding: .utf8)
            .split(separator: "\n")
            .map(String.init)
        try check(
            phases == [
                "user-start",
                "user-done",
                "vault-start",
                "vault-done",
                "item-start",
            ],
            "shared deadline did not expire during the cumulative third child: \(phases)"
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

private func runAsFakeValidator() -> Never {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard arguments.count == 5 else { Foundation.exit(41) }
    guard arguments[0] == "validate" else { Foundation.exit(42) }
    guard arguments[1] == "--validator-fd",
          let socket = Int32(arguments[2]),
          socket >= 0
    else { Foundation.exit(43) }
    guard arguments[3] == "--op-path",
          (arguments[4] as NSString).isAbsolutePath
    else { Foundation.exit(44) }
    guard Set(ProcessInfo.processInfo.environment.keys) == [
        "LANG",
        "PATH",
        "__CF_USER_TEXT_ENCODING",
    ]
    else { Foundation.exit(45) }
    let opPath = arguments[4]
    if opPath.hasSuffix(".descendant.pid") {
        let descendant = testFork()
        if descendant == 0 {
            usleep(10_000_000)
            _exit(0)
        }
        guard descendant > 0 else { Foundation.exit(46) }
        try! String(descendant).write(
            toFile: opPath,
            atomically: true,
            encoding: .utf8
        )
    }
    let received = receiveDescriptor(socket: socket)
    defer {
        if let descriptor = received.descriptor {
            _ = Darwin.close(descriptor)
        }
    }
    let approved = received.request == "browser-use-token-validator/v2\n"
        && received.descriptor.map {
            readDescriptor($0) == Data("ops_U3_NATIVE_LIFECYCLE".utf8)
        } == true
    let response = approved ? Array("ok\n".utf8) : Array("no\n".utf8)
    _ = response.withUnsafeBytes {
        Darwin.write(socket, $0.baseAddress, response.count)
    }
    if opPath.hasSuffix(".nonzero") {
        Foundation.exit(47)
    }
    if opPath.hasSuffix(".stall") {
        usleep(10_000_000)
    }
    Foundation.exit(approved ? 0 : 20)
}

private func makeFakeValidator(at root: URL) throws -> URL {
    let executable = root.appendingPathComponent("browser-use-op-supervisor")
    try FileManager.default.copyItem(
        at: URL(fileURLWithPath: CommandLine.arguments[0]),
        to: executable
    )
    try FileManager.default.setAttributes(
        [.posixPermissions: 0o700],
        ofItemAtPath: executable.path
    )
    return executable
}

private func bindingEvidenceRejectsUnknownOptions() throws {
    let executable = URL(fileURLWithPath: CommandLine.arguments[0])
        .deletingLastPathComponent()
        .appendingPathComponent("browser-use-op-supervisor")
    try check(
        FileManager.default.isExecutableFile(atPath: executable.path),
        "packaged supervisor executable is unavailable; run swift build first"
    )
    let output = Pipe()
    let process = Process()
    process.executableURL = executable
    process.arguments = [
        "metadata",
        "--config-root", "/tmp",
        "--op-path", "/usr/bin/false",
        "--operation", "binding-evidence",
        "--unknown", "value",
    ]
    process.standardOutput = output
    process.standardError = Pipe()
    try process.run()
    process.waitUntilExit()
    let bytes = output.fileHandleForReading.readDataToEndOfFile()
    let envelope = try JSONSerialization.jsonObject(with: bytes)
        as? [String: Any]
    let rejection = envelope?["rejection"] as? [String: Any]
    try check(process.terminationStatus == 20, "unknown option did not fail closed")
    try check(
        rejection?["code"] as? String == "invalid-arguments",
        "unknown option returned the wrong refusal"
    )
}

private func arbitrarySameNameValidatorIsRejectedBeforeSpawn() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let arbitrary = try makeFakeValidator(at: root)
    let packagedSibling = URL(fileURLWithPath: CommandLine.arguments[0])
        .deletingLastPathComponent()
        .appendingPathComponent("browser-use-op-supervisor")
    do {
        let child = try EnvironmentTokenValidatorProcess.start(
            executablePath: arbitrary.path,
            requiredExecutablePath: packagedSibling.path,
            opPath: "/opt/homebrew/bin/op",
            stagingRoot: root.path
        )
        child.cancel()
        throw TestFailure(
            description: "arbitrary owner-only same-name validator was admitted"
        )
    } catch is TestFailure {
        throw TestFailure(
            description: "arbitrary owner-only same-name validator was admitted"
        )
    } catch let cause as TokenCustodyCause {
        try check(
            cause == .invalidArguments,
            "arbitrary validator returned the wrong refusal"
        )
    }
}

private func validatorFinishKillsDescendantsAfterCleanExit() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let validator = try makeFakeValidator(at: root)
    let pidFile = root.appendingPathComponent("validator.descendant.pid")
    let child = try EnvironmentTokenValidatorProcess.start(
        executablePath: validator.path,
        requiredExecutablePath: validator.path,
        opPath: pidFile.path,
        stagingRoot: root.path
    )
    let configRoot = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: configRoot) }
    var token = Array("ops_U3_NATIVE_LIFECYCLE".utf8)
    let exitCode = ExitCodeBox()
    let result = installForTest(
        configRoot: configRoot.path,
        tokenBytes: &token,
        validatorDescriptor: child.socket,
        replacing: false,
        validationCompletion: {
            exitCode.value = child.finish()
            guard exitCode.value == 0 else {
                throw TokenCustodyCause.validationUnavailable
            }
        }
    )
    try check(result.state == .installed, "descendant fixture validation failed")
    try check(exitCode.value == 0, "clean validator exit was not observed")
    guard let pidText = try? String(contentsOf: pidFile, encoding: .utf8),
          let descendant = Int32(pidText)
    else {
        throw TestFailure(description: "validator descendant PID was not captured")
    }
    var gone = false
    for _ in 0..<50 {
        if kill(descendant, 0) < 0, errno == ESRCH {
            gone = true
            break
        }
        usleep(10_000)
    }
    if !gone {
        _ = kill(descendant, SIGKILL)
    }
    try check(gone, "validator descendant survived clean direct-child exit")
}

private func validatorNonzeroAfterOkayNeverPublishesToken() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let validator = try makeFakeValidator(at: root)
    let child = try EnvironmentTokenValidatorProcess.start(
        executablePath: validator.path,
        requiredExecutablePath: validator.path,
        opPath: root.appendingPathComponent("validator.nonzero").path,
        stagingRoot: root.path
    )
    let configRoot = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: configRoot) }
    var token = Array("ops_U3_NATIVE_LIFECYCLE".utf8)
    let exitCode = ExitCodeBox()
    let result = installForTest(
        configRoot: configRoot.path,
        tokenBytes: &token,
        validatorDescriptor: child.socket,
        replacing: false,
        validationCompletion: {
            exitCode.value = child.finish()
            guard exitCode.value == 0 else {
                throw TokenCustodyCause.validationUnavailable
            }
        }
    )
    let installed = configRoot
        .appendingPathComponent(TokenCustodyPaths.directoryName)
        .appendingPathComponent(TokenCustodyPaths.tokenName)
    try check(exitCode.value == 47, "post-okay nonzero exit was not observed")
    try check(
        result.state == .blocked
            && !FileManager.default.fileExists(atPath: installed.path),
        "post-okay nonzero validator left a published token"
    )
}

private func productionCustodySpawnsValidatorWithoutLeakingToken() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let buildDirectory = URL(fileURLWithPath: CommandLine.arguments[0])
        .deletingLastPathComponent()
    let custodyExecutable = buildDirectory.appendingPathComponent(
        "browser-use-token-custody"
    )
    try check(
        FileManager.default.isExecutableFile(atPath: custodyExecutable.path),
        "custody executable is unavailable; run swift build before the harness"
    )
    let packagedValidatorExecutable = buildDirectory.appendingPathComponent(
        "browser-use-op-supervisor"
    ).resolvingSymlinksInPath()
    try check(
        FileManager.default.isExecutableFile(
            atPath: packagedValidatorExecutable.path
        ),
        "packaged validator executable is unavailable; run swift build first"
    )
    do {
        let packagedProbe = try EnvironmentTokenValidatorProcess.start(
            executablePath: packagedValidatorExecutable.path,
            requiredExecutablePath: packagedValidatorExecutable.path,
            opPath: "/usr/bin/false",
            stagingRoot: root.path
        )
        let probeRoot = try makeConfigRoot()
        defer { try? FileManager.default.removeItem(at: probeRoot) }
        var probeBytes = Array("ops_U3_PACKAGED_PROBE".utf8)
        let probeResult = installForTest(
            configRoot: probeRoot.path,
            tokenBytes: &probeBytes,
            validatorDescriptor: packagedProbe.socket,
            replacing: false
        )
        let probeExit = packagedProbe.finish()
        try check(
            probeResult.cause == .validationFailed && probeExit == 20,
            "packaged validator protocol failed: cause=\(String(describing: probeResult.cause)) exit=\(String(describing: probeExit))"
        )
    } catch {
        throw TestFailure(
            description: "packaged validator admission failed: \(error)"
        )
    }

    let input = Pipe()
    let output = Pipe()
    let errorOutput = Pipe()
    let process = Process()
    process.executableURL = custodyExecutable
    process.arguments = [
        "install",
        "--config-root", root.path,
        "--input-fd", "0",
        "--validator-executable", packagedValidatorExecutable.path,
        "--op-path", "/usr/bin/false",
    ]
    process.environment = [
        "PATH": "/usr/bin:/bin",
        "LANG": "C.UTF-8",
    ]
    process.standardInput = input
    process.standardOutput = output
    process.standardError = errorOutput
    try process.run()
    let sentinel = "ops_U3_NATIVE_LIFECYCLE"
    input.fileHandleForWriting.write(Data((sentinel + "\n").utf8))
    try input.fileHandleForWriting.close()
    let finished = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in finished.signal() }
    if !process.isRunning {
        finished.signal()
    }
    try check(
        finished.wait(timeout: .now() + 8) == .success,
        "production custody and validator process stalled"
    )
    let stdout = output.fileHandleForReading.readDataToEndOfFile()
    let stderr = errorOutput.fileHandleForReading.readDataToEndOfFile()
    let text = String(decoding: stdout, as: UTF8.self)
    // Some filesystems reject backup-exclusion metadata before validation;
    // others reach the deliberately unapproved hermetic OP fixture. Either
    // typed gate proves the public executable accepted the production
    // validator topology without invoking real 1Password.
    try check(
        process.terminationStatus == 20
            && (
                text.contains("\"cause\":\"backup-exclusion-unproven\"")
                    || text.contains("\"cause\":\"validation-failed\"")
            ),
        "production custody did not reach the hermetic downstream gate: \(text)"
    )
    try check(!text.contains(sentinel), "custody stdout leaked token")
    try check(!stderr.contains(Data(sentinel.utf8)), "custody stderr leaked token")

    // Prove the descriptor-only child orchestration against the hermetic
    // install seam, which injects the already-covered backup proof.
    let hermeticRoot = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: hermeticRoot) }
    let validatorExecutable = try makeFakeValidator(at: root)
    let child = try EnvironmentTokenValidatorProcess.start(
        executablePath: validatorExecutable.path,
        requiredExecutablePath: validatorExecutable.path,
        opPath: "/opt/homebrew/bin/op",
        stagingRoot: hermeticRoot.path
    )
    var bytes = Array(sentinel.utf8)
    let validatorExit = ExitCodeBox()
    let result = installForTest(
        configRoot: hermeticRoot.path,
        tokenBytes: &bytes,
        validatorDescriptor: child.socket,
        replacing: false,
        validationCompletion: {
            validatorExit.value = child.finish()
            guard validatorExit.value == 0 else {
                throw TokenCustodyCause.validationUnavailable
            }
        }
    )
    try check(
        result.state == .installed,
        "validator process rejected the staged descriptor: \(result.state) \(String(describing: result.cause)) exit=\(String(describing: validatorExit.value))"
    )
    try check(
        validatorExit.value == 0,
        "validator process did not exit cleanly: \(String(describing: validatorExit.value))"
    )
    let installed = hermeticRoot
        .appendingPathComponent(TokenCustodyPaths.directoryName)
        .appendingPathComponent(TokenCustodyPaths.tokenName)
    try check(
        try Data(contentsOf: installed) == Data(sentinel.utf8),
        "hermetic custody did not publish the validated bytes"
    )
}

@main
enum BrowserUseEnvironmentAuthTests {
    static func main() throws {
        let executableName = URL(fileURLWithPath: CommandLine.arguments[0])
            .lastPathComponent
        if executableName == "browser-use-op-supervisor" {
            runAsFakeValidator()
        }
        if executableName.hasPrefix("browser-use-fake-op") {
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
                "environment OP binding evidence uses one token snapshot",
                environmentOpBindingEvidenceUsesOneTokenSnapshot
            ),
            (
                "environment OP binding evidence uses one total deadline",
                environmentOpBindingEvidenceUsesOneTotalDeadline
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
            (
                "binding evidence rejects unknown options",
                bindingEvidenceRejectsUnknownOptions
            ),
            (
                "arbitrary same-name validator is rejected before spawn",
                arbitrarySameNameValidatorIsRejectedBeforeSpawn
            ),
            (
                "validator finish kills descendants after clean exit",
                validatorFinishKillsDescendantsAfterCleanExit
            ),
            (
                "validator nonzero after okay never publishes token",
                validatorNonzeroAfterOkayNeverPublishesToken
            ),
            (
                "production custody spawns validator without leaking token",
                productionCustodySpawnsValidatorWithoutLeakingToken
            ),
        ]
        for (name, test) in tests {
            try test()
            print("pass: \(name)")
        }
    }
}
