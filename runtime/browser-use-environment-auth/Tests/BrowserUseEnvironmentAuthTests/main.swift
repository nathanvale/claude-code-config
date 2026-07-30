@_spi(Testing) import BrowserUseEnvironmentAuth
@_spi(Executor) import BrowserUseEnvironmentAuth
import CryptoKit
import Darwin
import Foundation

@_silgen_name("fork")
private func testFork() -> pid_t

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private struct TestSkip: Error, CustomStringConvertible {
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
    validatorTimeoutMilliseconds: Int32 = 45_000,
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
    response: String? = nil,
    responseDelayMicroseconds: useconds_t = 0,
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
        if responseDelayMicroseconds > 0 {
            usleep(responseDelayMicroseconds)
        }
        let responseBytes = Array(
            (response ?? (
                approve && received.descriptor != nil ? "ok\n" : "no\n"
            )).utf8
        )
        _ = responseBytes.withUnsafeBytes {
            Darwin.write(server, $0.baseAddress, responseBytes.count)
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

private func validatorExecutionTimeoutRemainsTyped() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let custody = root.appendingPathComponent(
        TokenCustodyPaths.directoryName,
        isDirectory: true
    )
    let timedOut = try validator(
        custodyDirectory: custody,
        approve: false,
        response: "timeout\n"
    )
    var token = Array("ops_VALIDATOR_EXECUTION_TIMEOUT\n".utf8)
    let result = installForTest(
        configRoot: root.path,
        tokenBytes: &token,
        validatorDescriptor: timedOut.0,
        replacing: false
    )
    _ = Darwin.close(timedOut.0)
    _ = timedOut.1.wait(timeout: .now() + 2)
    try check(
        result.cause == .validationTimeout,
        "downstream OP timeout collapsed into validation-failed"
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

private let hiddenTerminalSentinel = "ops_HIDDEN_TTY_SENTINEL"

private func spawnHiddenTerminalReader()
    throws -> (master: Int32, slave: Int32, pid: pid_t)
{
    var master: Int32 = -1
    let executable = CommandLine.arguments[0]
    var arguments: [UnsafeMutablePointer<CChar>?] = [
        strdup(executable),
        strdup("--hidden-terminal-reader"),
        nil,
    ]
    defer {
        for pointer in arguments.compactMap({ $0 }) { free(pointer) }
    }
    let pid = forkpty(&master, nil, nil, nil)
    guard pid >= 0 else {
        throw POSIXError(.EAGAIN)
    }
    if pid == 0 {
        _ = arguments.withUnsafeMutableBufferPointer { argv in
            execv(executable, argv.baseAddress!)
        }
        _exit(70)
    }
    guard let slavePath = ptsname(master) else {
        _ = kill(pid, SIGKILL)
        _ = Darwin.close(master)
        throw POSIXError(.ENXIO)
    }
    let slave = Darwin.open(
        slavePath,
        O_RDWR | O_CLOEXEC | O_NOCTTY
    )
    guard slave >= 0 else {
        _ = kill(pid, SIGKILL)
        _ = Darwin.close(master)
        throw POSIXError(.ENXIO)
    }
    return (master, slave, pid)
}

private func waitForHiddenTerminalEcho(
    descriptor: Int32,
    enabled: Bool,
    timeoutMilliseconds: Int
) -> Bool {
    let attempts = max(1, timeoutMilliseconds / 10)
    for _ in 0..<attempts {
        var state = termios()
        if tcgetattr(descriptor, &state) == 0,
           (state.c_lflag & tcflag_t(ECHO) != 0) == enabled
        {
            return true
        }
        usleep(10_000)
    }
    return false
}

private func waitForHiddenTerminalChild(
    _ pid: pid_t,
    timeoutMilliseconds: Int
) -> Int32? {
    let attempts = max(1, timeoutMilliseconds / 10)
    for _ in 0..<attempts {
        var status: Int32 = 0
        let result = waitpid(pid, &status, WNOHANG)
        if result == pid { return status }
        if result < 0, errno != EINTR { return nil }
        usleep(10_000)
    }
    return nil
}

private func requireHiddenTerminalEchoDisabled(
    descriptor: Int32,
    pid: pid_t,
    context: String
) throws {
    guard waitForHiddenTerminalEcho(
        descriptor: descriptor,
        enabled: false,
        timeoutMilliseconds: 1_000
    ) else {
        let status = waitForHiddenTerminalChild(
            pid,
            timeoutMilliseconds: 100
        )
        if status == (100 + EPERM) << 8 {
            throw TestSkip(
                description: "sandbox denied the forkpty child /dev/tty"
            )
        }
        throw TestFailure(
            description:
                "hidden terminal did not disable echo before \(context); child status \(String(describing: status))"
        )
    }
}

private func hiddenTerminalPromptsBeforeReadingAndNeverEchoesInput() throws {
    let spawned = try spawnHiddenTerminalReader()
    defer {
        _ = Darwin.close(spawned.master)
        _ = Darwin.close(spawned.slave)
    }
    try check(
        TokenCustodyHiddenTerminal.prompt
            == "Paste the 1Password service account token (input hidden): ",
        "hidden terminal prompt drifted"
    )
    try requireHiddenTerminalEchoDisabled(
        descriptor: spawned.slave,
        pid: spawned.pid,
        context: "reading"
    )

    let input = Array((hiddenTerminalSentinel + "\n").utf8)
    let written = input.withUnsafeBytes {
        Darwin.write(spawned.master, $0.baseAddress, input.count)
    }
    try check(written == input.count, "hidden terminal input write failed")
    guard let status = waitForHiddenTerminalChild(
        spawned.pid,
        timeoutMilliseconds: 2_000
    ) else {
        _ = kill(spawned.pid, SIGKILL)
        _ = waitForHiddenTerminalChild(
            spawned.pid,
            timeoutMilliseconds: 1_000
        )
        throw TestFailure(
            description: "hidden terminal input did not complete"
        )
    }
    try check(status == 0, "hidden terminal input failed")
    try check(
        waitForHiddenTerminalEcho(
            descriptor: spawned.slave,
            enabled: true,
            timeoutMilliseconds: 1_000
        ),
        "hidden terminal did not restore echo after input"
    )

    _ = fcntl(spawned.master, F_SETFL, O_NONBLOCK)
    var terminalCapture: [UInt8] = []
    while true {
        var buffer = [UInt8](repeating: 0, count: 256)
        let capacity = buffer.count
        let count = buffer.withUnsafeMutableBytes {
            Darwin.read(spawned.master, $0.baseAddress, capacity)
        }
        guard count > 0 else { break }
        terminalCapture.append(contentsOf: buffer.prefix(count))
    }
    try check(
        terminalCapture.starts(
            with: Array(TokenCustodyHiddenTerminal.prompt.utf8)
        ),
        "hidden terminal did not emit its prompt"
    )
    try check(
        !String(decoding: terminalCapture, as: UTF8.self)
            .contains(hiddenTerminalSentinel),
        "hidden terminal echoed token input"
    )
}

private func hiddenTerminalRestoresEchoBeforeSignalTermination() throws {
    let spawned = try spawnHiddenTerminalReader()
    defer {
        _ = Darwin.close(spawned.master)
        _ = Darwin.close(spawned.slave)
    }
    try requireHiddenTerminalEchoDisabled(
        descriptor: spawned.slave,
        pid: spawned.pid,
        context: "signal"
    )

    try check(
        kill(spawned.pid, SIGTERM) == 0,
        "hidden terminal child could not be terminated"
    )
    guard let status = waitForHiddenTerminalChild(
        spawned.pid,
        timeoutMilliseconds: 2_000
    ) else {
        _ = kill(spawned.pid, SIGKILL)
        _ = waitForHiddenTerminalChild(
            spawned.pid,
            timeoutMilliseconds: 1_000
        )
        throw TestFailure(
            description: "hidden terminal signal did not complete"
        )
    }
    try check(
        status & 0x7f == SIGTERM,
        "hidden terminal did not preserve SIGTERM termination"
    )

    var restored = termios()
    try check(
        tcgetattr(spawned.slave, &restored) == 0,
        "restored terminal state was unreadable"
    )
    try check(
        restored.c_lflag & tcflag_t(ECHO) != 0,
        "hidden terminal did not restore echo before termination"
    )
}

private func hiddenTerminalAlarmReturnsTypedCancellation() throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    process.arguments = ["--hidden-terminal-timeout-reader"]
    let input = Pipe()
    defer { try? input.fileHandleForWriting.close() }
    process.standardInput = input
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    let done = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in done.signal() }
    try process.run()
    guard done.wait(timeout: .now() + 3) == .success else {
        process.terminate()
        throw TestFailure(
            description: "hidden terminal alarm did not stay bounded"
        )
    }
    try check(
        process.terminationStatus == 0,
        "hidden terminal alarm bypassed typed cancellation"
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

private func validatorBudgetContainsLegalDownstreamWork() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let custody = root.appendingPathComponent(
        TokenCustodyPaths.directoryName,
        isDirectory: true
    )
    let channel = try validator(
        custodyDirectory: custody,
        approve: true,
        responseDelayMicroseconds: 5_100_000
    )
    var token = Array("ops_SLOW_VALIDATOR\n".utf8)

    let result = installForTest(
        configRoot: root.path,
        tokenBytes: &token,
        validatorDescriptor: channel.0,
        replacing: false
    )
    _ = Darwin.close(channel.0)
    try check(
        channel.1.wait(timeout: .now() + 2) == .success,
        "slow validator did not close"
    )
    try check(
        result.state == .installed,
        "custody deadline could not contain legal validator work"
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
        if arguments.starts(with: ["whoami"]) {
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
    if arguments.starts(with: ["whoami"]) {
        if executable.lastPathComponent.contains("cold-service-account") {
            usleep(5_500_000)
        }
        emitFakeOpJSON([
            "user_uuid": principalTwo ? "user-2" : "user-1",
            "user_type": executable.lastPathComponent.contains(
                "invalid-service-account"
            ) ? "USER" : "SERVICE_ACCOUNT",
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
        if executable.lastPathComponent.contains("cold-service-account") {
            usleep(5_500_000)
        }
        if executable.lastPathComponent.contains("zero-vault") {
            emitFakeOpJSON([])
            return
        }
        if executable.lastPathComponent.contains("multi-vault") {
            emitFakeOpJSON([
                ["id": "vault-1"],
                ["id": "vault-2"],
            ])
            return
        }
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
        if arguments.contains("--reveal") {
            FileHandle.standardOutput.write(
                Data("U7_PRIVATE_PIPE_PASSWORD_SENTINEL\n".utf8)
            )
            return
        }
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
                vaultID: "cross-vault-item",
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
            secretPathText.contains("\"code\":\"output-shape-invalid\"")
                && !secretPathText.contains("SECRET_PATH"),
            "secret-bearing URL path was not rejected by the native projection"
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
            phases.starts(with: ["user-start", "user-done", "vault-start"])
                && !phases.contains("item-done"),
            "shared deadline did not stop cumulative binding work: \(phases)"
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

private func environmentOpFixtureDigest(_ path: String) throws -> String {
    let data = try Data(contentsOf: URL(fileURLWithPath: path))
    return SHA256.hash(data: data)
        .map { String(format: "%02x", $0) }
        .joined()
}

private func writeEnvironmentOpFixture(
    _ path: String,
    version: String = "2.35.0",
    mode: Int = 0o700
) throws {
    let script = "#!/bin/sh\nprintf '\(version)\\n'\n"
    guard FileManager.default.createFile(
        atPath: path,
        contents: Data(script.utf8),
        attributes: [.posixPermissions: mode]
    ) else {
        throw TestFailure(description: "failed to create OP fixture")
    }
}

private func environmentOpTrustedHomebrewSymlinkPasses() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let bin = root.appendingPathComponent("bin", isDirectory: true)
    let cask = root
        .appendingPathComponent("Caskroom", isDirectory: true)
        .appendingPathComponent("1password-cli", isDirectory: true)
        .appendingPathComponent("2.35.0", isDirectory: true)
    try FileManager.default.createDirectory(
        at: bin,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o770]
    )
    try FileManager.default.createDirectory(
        at: cask,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
    )
    let target = cask.appendingPathComponent("op")
    let link = bin.appendingPathComponent("op")
    try writeEnvironmentOpFixture(target.path)
    try FileManager.default.createSymbolicLink(
        atPath: link.path,
        withDestinationPath: target.path
    )
    let digest = try environmentOpFixtureDigest(target.path)
    let result = EnvironmentOpSupervisor.admitFixtureExecutableForTesting(
        executablePath: link.path,
        expectedDigest: digest,
        expectedVersion: "2.35.0"
    )

    try check(
        {
            if case .admitted = result {
                return true
            }
            return false
        }(),
        "trusted Homebrew-like OP symlink was not admitted: \(result)"
    )
}

private func environmentOpHostileSymlinkShapesBlock() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let target = root.appendingPathComponent("trusted-op")
    try writeEnvironmentOpFixture(target.path)
    let digest = try environmentOpFixtureDigest(target.path)

    let relativeDirectory = root.appendingPathComponent(
        "relative",
        isDirectory: true
    )
    try FileManager.default.createDirectory(
        at: relativeDirectory,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o700]
    )
    let relative = relativeDirectory.appendingPathComponent("op")
    try FileManager.default.createSymbolicLink(
        atPath: relative.path,
        withDestinationPath: "../trusted-op"
    )
    try check(
        EnvironmentOpSupervisor.admitFixtureExecutableForTesting(
            executablePath: relative.path,
            expectedDigest: digest,
            expectedVersion: "2.35.0"
        ) == .blocked(.pathUnsafe),
        "relative symlink escape was admitted"
    )

    let cycleA = root.appendingPathComponent("cycle-a")
    let cycleB = root.appendingPathComponent("cycle-b")
    try FileManager.default.createSymbolicLink(
        atPath: cycleA.path,
        withDestinationPath: cycleB.path
    )
    try FileManager.default.createSymbolicLink(
        atPath: cycleB.path,
        withDestinationPath: cycleA.path
    )
    try check(
        EnvironmentOpSupervisor.admitFixtureExecutableForTesting(
            executablePath: cycleA.path,
            expectedDigest: digest,
            expectedVersion: "2.35.0"
        ) == .blocked(.pathUnsafe),
        "symlink cycle was admitted"
    )

    let writableDirectory = root.appendingPathComponent(
        "world-writable",
        isDirectory: true
    )
    try FileManager.default.createDirectory(
        at: writableDirectory,
        withIntermediateDirectories: false,
        attributes: [.posixPermissions: 0o777]
    )
    let writableLink = writableDirectory.appendingPathComponent("op")
    try FileManager.default.createSymbolicLink(
        atPath: writableLink.path,
        withDestinationPath: target.path
    )
    try check(
        EnvironmentOpSupervisor.admitFixtureExecutableForTesting(
            executablePath: writableLink.path,
            expectedDigest: digest,
            expectedVersion: "2.35.0"
        ) == .blocked(.pathUnsafe),
        "world-writable symlink ancestry was admitted"
    )

    let writableTarget = root.appendingPathComponent("writable-target")
    try writeEnvironmentOpFixture(writableTarget.path, mode: 0o720)
    try check(
        EnvironmentOpSupervisor.admitFixtureExecutableForTesting(
            executablePath: writableTarget.path,
            expectedDigest: try environmentOpFixtureDigest(writableTarget.path),
            expectedVersion: "2.35.0"
        ) == .blocked(.pathUnsafe),
        "group-writable OP target was admitted"
    )

    let hardLinkedTarget = root.appendingPathComponent("hard-linked-target")
    let secondLink = root.appendingPathComponent("hard-linked-alias")
    try writeEnvironmentOpFixture(hardLinkedTarget.path)
    try FileManager.default.linkItem(at: hardLinkedTarget, to: secondLink)
    try check(
        EnvironmentOpSupervisor.admitFixtureExecutableForTesting(
            executablePath: hardLinkedTarget.path,
            expectedDigest: try environmentOpFixtureDigest(hardLinkedTarget.path),
            expectedVersion: "2.35.0"
        ) == .blocked(.pathUnsafe),
        "hard-linked OP target was admitted"
    )
}

private func environmentOpChangedLinkAndStagedBytesBlock() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let first = root.appendingPathComponent("op-first")
    let second = root.appendingPathComponent("op-second")
    let link = root.appendingPathComponent("op")
    try writeEnvironmentOpFixture(first.path)
    try writeEnvironmentOpFixture(second.path)
    try FileManager.default.createSymbolicLink(
        atPath: link.path,
        withDestinationPath: first.path
    )
    let digest = try environmentOpFixtureDigest(first.path)

    try check(
        EnvironmentOpSupervisor.admitFixtureExecutableForTesting(
            executablePath: link.path,
            expectedDigest: digest,
            expectedVersion: "2.35.0",
            afterSourceResolved: {
                try? FileManager.default.removeItem(at: link)
                try? FileManager.default.createSymbolicLink(
                    atPath: link.path,
                    withDestinationPath: second.path
                )
            }
        ) == .blocked(.pathUnsafe),
        "changed OP symlink was admitted"
    )

    try? FileManager.default.removeItem(at: link)
    try FileManager.default.createSymbolicLink(
        atPath: link.path,
        withDestinationPath: first.path
    )
    try check(
        EnvironmentOpSupervisor.admitFixtureExecutableForTesting(
            executablePath: link.path,
            expectedDigest: digest,
            expectedVersion: "2.35.0",
            afterStagedCopy: { stagedPath in
                try? Data("changed".utf8).write(
                    to: URL(fileURLWithPath: stagedPath)
                )
            }
        ) == .blocked(.binaryUntrusted),
        "changed staged OP bytes were admitted"
    )
}

private func environmentOpDigestAndVersionMismatchBlock() throws {
    let root = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: root) }
    let unsupported = root.appendingPathComponent("op")
    try writeEnvironmentOpFixture(unsupported.path, version: "2.17.9")
    let digest = try environmentOpFixtureDigest(unsupported.path)
    try check(
        EnvironmentOpSupervisor.admitFixtureExecutableForTesting(
            executablePath: unsupported.path,
            expectedDigest: digest,
            expectedVersion: "2.17.9"
        ) == .blocked(.versionUnsupported),
        "unsupported OP version was admitted"
    )
    try check(
        EnvironmentOpSupervisor.admitFixtureExecutableForTesting(
            executablePath: unsupported.path,
            expectedDigest: String(repeating: "0", count: 64),
            expectedVersion: "2.17.9"
        ) == .blocked(.binaryUntrusted),
        "unpinned OP digest was admitted"
    )
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

private func environmentOpSupervisorAdmissionSurfaceAligns() throws {
    let supervisor = URL(fileURLWithPath: CommandLine.arguments[0])
        .deletingLastPathComponent()
        .appendingPathComponent("browser-use-op-supervisor")
    let stagingRoot = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: stagingRoot) }
    try check(
        FileManager.default.isExecutableFile(atPath: supervisor.path),
        "packaged supervisor executable is unavailable; run swift build first"
    )

    func run(_ arguments: [String]) throws -> (Int32, Data) {
        let output = Pipe()
        let process = Process()
        process.executableURL = supervisor
        process.arguments = arguments
        process.environment = ["TMPDIR": stagingRoot.path]
        process.standardOutput = output
        process.standardError = Pipe()
        try process.run()
        process.waitUntilExit()
        return (
            process.terminationStatus,
            output.fileHandleForReading.readDataToEndOfFile()
        )
    }

    let help = try run(["--help"])
    let helpText = String(decoding: help.1, as: UTF8.self)
    try check(help.0 == 0, "supervisor help did not exit successfully")
    try check(
        helpText.contains(
            "browser-use-op-supervisor admit --op-path <absolute-path>"
        ),
        "supervisor help omitted the admitted parser shape"
    )

    let unknown = try run([
        "admit",
        "--op-path", "/opt/homebrew/bin/op",
        "--unknown", "value",
    ])
    try check(unknown.0 == 20, "unknown admission option did not fail closed")
    try check(
        String(decoding: unknown.1, as: UTF8.self)
            .contains("\"code\":\"invalid-arguments\""),
        "unknown admission option returned the wrong rejection"
    )

    let unapproved = try run(["admit", "--op-path", "/usr/bin/false"])
    let unapprovedObject = try JSONSerialization.jsonObject(with: unapproved.1)
        as? [String: Any]
    let unapprovedRejection = unapprovedObject?["rejection"] as? [String: Any]
    try check(unapproved.0 == 20, "unapproved admission path exited successfully")
    try check(
        Set(unapprovedObject?.keys.map { $0 } ?? []) == [
            "schema_version", "ok", "state", "rejection",
        ],
        "blocked admission envelope keys drifted"
    )
    try check(
        unapprovedObject?["state"] as? String == "unsafe"
            && unapprovedRejection?["code"] as? String == "op-path-unapproved",
        "unapproved admission path returned the wrong typed state"
    )

    let candidates = ["/opt/homebrew/bin/op", "/usr/local/bin/op"]
    guard let installed = candidates.first(where: {
        FileManager.default.isExecutableFile(atPath: $0)
    }) else {
        return
    }
    let admitted = try run(["admit", "--op-path", installed])
    let admittedObject = try JSONSerialization.jsonObject(with: admitted.1)
        as? [String: Any]
    try check(admitted.0 == 0, "installed official OP CLI admission failed")
    try check(
        Set(admittedObject?.keys.map { $0 } ?? [])
            == ["schema_version", "ok", "state"],
        "ready admission envelope keys drifted"
    )
    try check(
        admittedObject?["ok"] as? Bool == true
            && admittedObject?["state"] as? String == "ready",
        "installed official OP CLI admission did not report ready"
    )
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
        let validation = EnvironmentOpSupervisor.validateStagedTokenForTesting(
            executablePath: fake.path,
            tokenDescriptor: descriptor
        )
        let response = validation == .approved
            ? Array("ok\n".utf8)
            : Array("no\n".utf8)
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

private func environmentOpValidatorReturnsTypedIdentityAndScope() throws {
    for (name, expected) in [
        (
            "browser-use-fake-op-invalid-service-account",
            EnvironmentTokenValidationResult.invalidServiceAccount
        ),
        (
            "browser-use-fake-op-zero-vault",
            EnvironmentTokenValidationResult.invalidVaultScope
        ),
        (
            "browser-use-fake-op-multi-vault",
            EnvironmentTokenValidationResult.invalidVaultScope
        ),
    ] {
        let fake = try makeFakeOp(name: name)
        defer {
            try? FileManager.default.removeItem(
                at: fake.deletingLastPathComponent()
            )
        }
        try withTokenDescriptor { descriptor in
            try check(
                EnvironmentOpSupervisor.validateStagedTokenForTesting(
                    executablePath: fake.path,
                    tokenDescriptor: descriptor
                ) == expected,
                "\(name) did not return its typed validation result"
            )
        }
    }
}

private func tokenCustodyRoutesVaultScopeRepair() throws {
    let configRoot = try makeConfigRoot()
    defer { try? FileManager.default.removeItem(at: configRoot) }
    let custody = configRoot.appendingPathComponent(
        TokenCustodyPaths.directoryName,
        isDirectory: true
    )
    let tokenPath = custody.appendingPathComponent(TokenCustodyPaths.tokenName)
    var original = Array("ops_U5_SCOPE_ORIGINAL".utf8)
    let approved = try validator(custodyDirectory: custody, approve: true)
    try check(
        installForTest(
            configRoot: configRoot.path,
            tokenBytes: &original,
            validatorDescriptor: approved.0,
            replacing: false
        ).state == .installed,
        "vault repair fixture install failed"
    )
    _ = Darwin.close(approved.0)
    _ = approved.1.wait(timeout: .now() + 2)
    let originalMetadata = try FileManager.default.attributesOfItem(
        atPath: tokenPath.path
    )
    let originalInode = originalMetadata[.systemFileNumber] as? NSNumber

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
            return
        }
        _ = Darwin.close(descriptor)
        let response = Array("vault\n".utf8)
        _ = response.withUnsafeBytes {
            Darwin.write(server, $0.baseAddress, response.count)
        }
    }
    var replacement = Array("ops_U5_SCOPE_REPLACEMENT".utf8)
    let result = installForTest(
        configRoot: configRoot.path,
        tokenBytes: &replacement,
        validatorDescriptor: sockets[0],
        replacing: true
    )
    _ = Darwin.close(sockets[0])
    try check(done.wait(timeout: .now() + 3) == .success, "vault repair fixture stalled")
    try check(
        result.state == .blocked
            && result.cause == .invalidVaultScope
            && result.nextAction == "repair-vault-grant",
        "invalid vault scope did not route to the vault grant repair"
    )
    let preservedMetadata = try FileManager.default.attributesOfItem(
        atPath: tokenPath.path
    )
    try check(
        preservedMetadata[.systemFileNumber] as? NSNumber == originalInode,
        "invalid vault scope replaced the prior token inode"
    )
    try check(
        try Data(contentsOf: tokenPath) == Data("ops_U5_SCOPE_ORIGINAL".utf8),
        "invalid vault scope replaced the prior token bytes"
    )
    let residue = try FileManager.default.contentsOfDirectory(atPath: custody.path)
        .filter { $0.hasPrefix(TokenCustodyPaths.stagingPrefix) }
    try check(residue.isEmpty, "invalid vault scope left staging residue")
    let encoded = try JSONEncoder().encode(result)
    let projection = String(decoding: encoded, as: UTF8.self)
    try check(
        !projection.contains("ops_U5_SCOPE_ORIGINAL")
            && !projection.contains("ops_U5_SCOPE_REPLACEMENT"),
        "invalid vault scope serialized token bytes"
    )
}

private func environmentOpValidatorAllowsBoundedColdServiceAccount() throws {
    let fake = try makeFakeOp(
        name: "browser-use-fake-op-cold-service-account"
    )
    defer {
        try? FileManager.default.removeItem(
            at: fake.deletingLastPathComponent()
        )
    }
    try withTokenDescriptor { descriptor in
        try check(
            EnvironmentOpSupervisor.validateStagedTokenForTesting(
                executablePath: fake.path,
                tokenDescriptor: descriptor
            ) == .approved,
            "bounded cold service-account metadata exceeded its legal budget"
        )
    }
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
        "TMPDIR",
        "__CF_USER_TEXT_ENCODING",
    ],
          let stagingRoot = ProcessInfo.processInfo.environment["TMPDIR"],
          (stagingRoot as NSString).isAbsolutePath
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

private func confidentialDeliveryHelperIsPackaged() throws {
    let executableDirectory = URL(fileURLWithPath: CommandLine.arguments[0])
        .deletingLastPathComponent()
    let helper = executableDirectory
        .appendingPathComponent("browser-use-confidential-delivery")
    try check(
        FileManager.default.isExecutableFile(atPath: helper.path),
        "confidential delivery helper executable is missing: \(helper.path)"
    )
}

private enum ConfidentialSemanticMatchMode {
    case exact
    case missing
    case multiple
}

private enum ConfidentialReviewedReadEvaluation {
    case success(Any)
    case exception
    case invalid
}

private final class ConfidentialDeliveryTraceBox: @unchecked Sendable {
    let matchMode: ConfidentialSemanticMatchMode
    let targetURLs: [String]
    let rootFrameLoaderIDs: [String?]
    let reviewedReadContextID: Int?
    let reviewedReadEvaluation: ConfidentialReviewedReadEvaluation
    let reviewedReadResetSucceeds: Bool
    let reviewedReadHistoryCurrentIndex: Int
    let reviewedReadHistoryEntries: [[String: Any]]
    let suppressInsertResponse: Bool
    let atomicWriteAllowed: Bool
    var methods: [String] = []
    var targetProofCount = 0
    var frameProofCount = 0
    var insertedText: String?
    var reviewedReadWorldParameters: [String: Any]?
    var reviewedReadExpression: String?
    var reviewedReadParameters: [String: Any]?
    var atomicFunctionRechecksOrigins = false
    var failure: String?

    init(
        matchMode: ConfidentialSemanticMatchMode = .exact,
        targetURL: String = "https://oncore.test/login",
        targetURLs: [String]? = nil,
        rootFrameLoaderIDs: [String?] = ["loader-1"],
        reviewedReadContextID: Int? = 71,
        reviewedReadEvaluation: ConfidentialReviewedReadEvaluation =
            .success(["rows": 7]),
        reviewedReadResetSucceeds: Bool = true,
        reviewedReadHistoryCurrentIndex: Int = 0,
        reviewedReadHistoryEntries: [[String: Any]] = [
            ["id": 1, "url": "https://oncore.test/login"],
        ],
        suppressInsertResponse: Bool = false,
        atomicWriteAllowed: Bool = true
    ) {
        self.matchMode = matchMode
        self.targetURLs = targetURLs ?? [targetURL]
        self.rootFrameLoaderIDs = rootFrameLoaderIDs
        self.reviewedReadContextID = reviewedReadContextID
        self.reviewedReadEvaluation = reviewedReadEvaluation
        self.reviewedReadResetSucceeds = reviewedReadResetSucceeds
        self.reviewedReadHistoryCurrentIndex =
            reviewedReadHistoryCurrentIndex
        self.reviewedReadHistoryEntries = reviewedReadHistoryEntries
        self.suppressInsertResponse = suppressInsertResponse
        self.atomicWriteAllowed = atomicWriteAllowed
    }

    var targetURL: String {
        targetURLs.first ?? "https://oncore.test/login"
    }

    func nextTargetURL() -> String {
        let index = min(targetProofCount, max(0, targetURLs.count - 1))
        targetProofCount += 1
        return targetURLs.isEmpty
            ? "https://invalid.test"
            : targetURLs[index]
    }

    func nextRootFrameLoaderID() -> String? {
        let index = min(
            frameProofCount,
            max(0, rootFrameLoaderIDs.count - 1)
        )
        frameProofCount += 1
        return rootFrameLoaderIDs.isEmpty ? nil : rootFrameLoaderIDs[index]
    }
}

private func readConfidentialProtocolLine(
    _ descriptor: Int32,
    maximumBytes: Int = 65_536
) -> Data? {
    var output = Data()
    var byte: UInt8 = 0
    while output.count < maximumBytes {
        let count = Darwin.read(descriptor, &byte, 1)
        if count == 0 {
            return output.isEmpty ? nil : output
        }
        if count < 0 {
            if errno == EINTR { continue }
            return nil
        }
        if byte == 0x0a { return output }
        output.append(byte)
    }
    return nil
}

private func readConfidentialPipe(_ descriptor: Int32) -> Data {
    var output = Data()
    var buffer = [UInt8](repeating: 0, count: 4_096)
    while true {
        let capacity = buffer.count
        let count = buffer.withUnsafeMutableBytes {
            Darwin.read(descriptor, $0.baseAddress, capacity)
        }
        if count == 0 { return output }
        if count < 0 {
            if errno == EINTR { continue }
            return output
        }
        output.append(contentsOf: buffer.prefix(count))
    }
}

private func writeConfidentialProtocolJSON(
    _ descriptor: Int32,
    _ object: [String: Any]
) -> Bool {
    guard var bytes = try? JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys]
    ) else {
        return false
    }
    bytes.append(0x0a)
    var offset = 0
    while offset < bytes.count {
        let written = bytes.withUnsafeBytes {
            Darwin.write(
                descriptor,
                $0.baseAddress!.advanced(by: offset),
                bytes.count - offset
            )
        }
        if written < 0, errno == EINTR { continue }
        guard written > 0 else { return false }
        offset += written
    }
    return true
}

private func readExactTestBytes(
    _ descriptor: Int32,
    count: Int
) -> [UInt8]? {
    var bytes = [UInt8](repeating: 0, count: count)
    var offset = 0
    while offset < count {
        let received = bytes.withUnsafeMutableBytes {
            Darwin.read(
                descriptor,
                $0.baseAddress!.advanced(by: offset),
                count - offset
            )
        }
        if received < 0, errno == EINTR { continue }
        guard received > 0 else { return nil }
        offset += received
    }
    return bytes
}

private func writeAllTestBytes(
    _ descriptor: Int32,
    _ bytes: [UInt8]
) -> Bool {
    var offset = 0
    while offset < bytes.count {
        let written = bytes.withUnsafeBytes {
            Darwin.write(
                descriptor,
                $0.baseAddress!.advanced(by: offset),
                bytes.count - offset
            )
        }
        if written < 0, errno == EINTR { continue }
        guard written > 0 else { return false }
        offset += written
    }
    return true
}

private func readTestHTTPHeaders(_ descriptor: Int32) -> String? {
    var bytes: [UInt8] = []
    while bytes.count < 16_384 {
        guard let next = readExactTestBytes(descriptor, count: 1) else {
            return nil
        }
        bytes.append(next[0])
        if bytes.suffix(4) == [13, 10, 13, 10] {
            return String(bytes: bytes, encoding: .utf8)
        }
    }
    return nil
}

private func acceptTestSocket(
    _ listener: Int32,
    timeoutMilliseconds: Int32 = 3_000
) -> Int32? {
    var polled = pollfd(fd: listener, events: Int16(POLLIN), revents: 0)
    guard poll(&polled, 1, timeoutMilliseconds) == 1,
          polled.revents & Int16(POLLIN) != 0
    else {
        return nil
    }
    let accepted = Darwin.accept(listener, nil, nil)
    return accepted >= 0 ? accepted : nil
}

private func readTestWebSocketFrame(
    _ descriptor: Int32
) -> (opcode: UInt8, payload: [UInt8], masked: Bool)? {
    guard let header = readExactTestBytes(descriptor, count: 2) else {
        return nil
    }
    let opcode = header[0] & 0x0f
    let masked = header[1] & 0x80 != 0
    var length = Int(header[1] & 0x7f)
    if length == 126 {
        guard let extended = readExactTestBytes(descriptor, count: 2) else {
            return nil
        }
        length = Int(extended[0]) << 8 | Int(extended[1])
    } else if length == 127 {
        guard let extended = readExactTestBytes(descriptor, count: 8),
              extended.prefix(4).allSatisfy({ $0 == 0 })
        else {
            return nil
        }
        length = extended.suffix(4).reduce(0) {
            ($0 << 8) | Int($1)
        }
    }
    guard length <= 65_536 else { return nil }
    let mask = masked ? readExactTestBytes(descriptor, count: 4) : nil
    guard !masked || mask != nil,
          var payload = readExactTestBytes(descriptor, count: length)
    else {
        return nil
    }
    if let mask {
        for index in payload.indices {
            payload[index] ^= mask[index % 4]
        }
    }
    return (opcode, payload, masked)
}

private func writeTestWebSocketFrame(
    _ descriptor: Int32,
    opcode: UInt8,
    payload: [UInt8]
) -> Bool {
    var bytes: [UInt8] = [0x80 | opcode]
    if payload.count < 126 {
        bytes.append(UInt8(payload.count))
    } else {
        bytes.append(126)
        bytes.append(UInt8((payload.count >> 8) & 0xff))
        bytes.append(UInt8(payload.count & 0xff))
    }
    bytes.append(contentsOf: payload)
    return writeAllTestBytes(descriptor, bytes)
}

private func fakeConfidentialCDPResult(
    method: String,
    request: [String: Any],
    trace: ConfidentialDeliveryTraceBox
) -> [String: Any]? {
    trace.methods.append(method)
    switch method {
    case "Target.getTargetInfo":
        return [
            "targetInfo": [
                "targetId": "target-1",
                "type": "page",
                "url": trace.nextTargetURL(),
            ],
        ]
    case "Page.getFrameTree":
        var frame: [String: Any] = [
            "id": "frame-1",
            "url": "https://oncore.test/login",
        ]
        if let loaderID = trace.nextRootFrameLoaderID() {
            frame["loaderId"] = loaderID
        }
        return [
            "frameTree": [
                "frame": frame,
            ],
        ]
    case "Page.createIsolatedWorld":
        trace.reviewedReadWorldParameters =
            request["params"] as? [String: Any]
        guard let contextID = trace.reviewedReadContextID else {
            return [:]
        }
        return ["executionContextId": contextID]
    case "Runtime.evaluate":
        let parameters = request["params"] as? [String: Any]
        trace.reviewedReadParameters = parameters
        trace.reviewedReadExpression = parameters?["expression"] as? String
        switch trace.reviewedReadEvaluation {
        case let .success(value):
            return [
                "result": [
                    "type": value is [String: Any] ? "object" : "string",
                    "value": value,
                ],
            ]
        case .exception:
            return [
                "result": ["type": "object"],
                "exceptionDetails": [
                    "text": "SENSITIVE_SCRIPT_EXCEPTION",
                ],
            ]
        case .invalid:
            return [
                "result": [
                    "type": "undefined",
                ],
            ]
        }
    case "Page.resetNavigationHistory":
        return trace.reviewedReadResetSucceeds ? [:] : nil
    case "Page.getNavigationHistory":
        return [
            "currentIndex": trace.reviewedReadHistoryCurrentIndex,
            "entries": trace.reviewedReadHistoryEntries,
        ]
    case "Accessibility.getFullAXTree":
        return [
            "nodes": [
                [
                    "backendDOMNodeId": 42,
                    "role": ["value": "textbox"],
                    "name": ["value": "Password"],
                ],
            ],
        ]
    case "DOM.describeNode":
        return [
            "node": [
                "backendNodeId": 42,
                "nodeName": "INPUT",
                "frameId": "frame-1",
                "attributes": ["type", "password"],
            ],
        ]
    case "DOM.resolveNode":
        return ["object": ["objectId": "object-42"]]
    case "Runtime.callFunctionOn":
        let parameters = request["params"] as? [String: Any]
        let arguments = parameters?["arguments"] as? [[String: Any]]
        let declaration = parameters?["functionDeclaration"] as? String ?? ""
        trace.atomicFunctionRechecksOrigins =
            declaration.contains("view.location.origin !== expectedFrameOrigin")
            && declaration.contains(
                "view.top.location.origin !== expectedTopOrigin"
            )
            && declaration.contains("this.isConnected")
        if trace.atomicWriteAllowed {
            trace.insertedText = arguments?.last?["value"] as? String
        }
        return [
            "result": [
                "type": "object",
                "value": ["written": trace.atomicWriteAllowed],
            ],
        ]
    default:
        trace.failure = "forbidden method: \(method)"
        return nil
    }
}

private struct ConfidentialWebSocketFixture {
    let endpoint: String
    let done: DispatchSemaphore
    let trace: ConfidentialDeliveryTraceBox
}

private func startConfidentialWebSocketFixture(
    rootFrameLoaderID: String? = "loader-1",
    rootFrameLoaderIDs: [String?]? = nil,
    reviewedReadContextID: Int? = 71,
    reviewedReadEvaluation: ConfidentialReviewedReadEvaluation =
        .success(["rows": 7]),
    targetURLs: [String]? = nil,
    reviewedReadResetSucceeds: Bool = true,
    reviewedReadHistoryCurrentIndex: Int = 0,
    reviewedReadHistoryEntries: [[String: Any]] = [
        ["id": 1, "url": "https://oncore.test/login"],
    ]
) throws
    -> ConfidentialWebSocketFixture
{
    let listener = socket(AF_INET, SOCK_STREAM, 0)
    guard listener >= 0 else { throw POSIXError(.EMFILE) }
    var reuse: Int32 = 1
    _ = setsockopt(
        listener,
        SOL_SOCKET,
        SO_REUSEADDR,
        &reuse,
        socklen_t(MemoryLayout.size(ofValue: reuse))
    )
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = 0
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
    let bound = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.bind(
                listener,
                $0,
                socklen_t(MemoryLayout<sockaddr_in>.size)
            )
        }
    }
    guard bound == 0, listen(listener, 2) == 0 else {
        _ = Darwin.close(listener)
        throw POSIXError(.EADDRINUSE)
    }
    var observed = sockaddr_in()
    var observedLength = socklen_t(MemoryLayout<sockaddr_in>.size)
    let named = withUnsafeMutablePointer(to: &observed) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            getsockname(listener, $0, &observedLength)
        }
    }
    guard named == 0 else {
        _ = Darwin.close(listener)
        throw POSIXError(.EINVAL)
    }
    let port = Int(UInt16(bigEndian: observed.sin_port))
    let endpoint = "ws://127.0.0.1:\(port)/devtools/browser/browser-id"
    let pageEndpoint = "ws://127.0.0.1:\(port)/devtools/page/target-1"
    let done = DispatchSemaphore(value: 0)
    let trace = ConfidentialDeliveryTraceBox(
        targetURLs: targetURLs,
        rootFrameLoaderIDs: rootFrameLoaderIDs ?? [rootFrameLoaderID],
        reviewedReadContextID: reviewedReadContextID,
        reviewedReadEvaluation: reviewedReadEvaluation,
        reviewedReadResetSucceeds: reviewedReadResetSucceeds,
        reviewedReadHistoryCurrentIndex:
            reviewedReadHistoryCurrentIndex,
        reviewedReadHistoryEntries: reviewedReadHistoryEntries
    )
    DispatchQueue.global().async {
        defer {
            _ = Darwin.close(listener)
            done.signal()
        }
        guard let listClient = acceptTestSocket(listener),
              readTestHTTPHeaders(listClient) != nil
        else {
            trace.failure = "json list request missing"
            return
        }
        let list = try! JSONSerialization.data(
            withJSONObject: [
                [
                    "id": "target-1",
                    "type": "page",
                    "url": "https://oncore.test/login",
                    "webSocketDebuggerUrl": pageEndpoint,
                ],
            ],
            options: [.sortedKeys]
        )
        let listHeader = [
            "HTTP/1.1 200 OK",
            "Content-Type: application/json",
            "Content-Length: \(list.count)",
            "Connection: close",
            "",
            "",
        ].joined(separator: "\r\n")
        _ = writeAllTestBytes(
            listClient,
            Array(listHeader.utf8) + Array(list)
        )
        _ = Darwin.close(listClient)

        guard let socket = acceptTestSocket(
            listener,
            timeoutMilliseconds: 10_000
        ) else {
            trace.failure = "websocket connection missing"
            return
        }
        guard let headers = readTestHTTPHeaders(socket) else {
            trace.failure = "websocket headers missing errno=\(errno)"
            _ = Darwin.close(socket)
            return
        }
        guard let keyLine = headers
                .components(separatedBy: "\r\n")
                .map({
                    $0.trimmingCharacters(in: .whitespacesAndNewlines)
                })
                .first(where: {
                    $0.lowercased().hasPrefix("sec-websocket-key:")
                })
        else {
            trace.failure = "websocket key missing headers=\(headers)"
            _ = Darwin.close(socket)
            return
        }
        let key = keyLine
            .split(separator: ":", maxSplits: 1)
            .last?
            .trimmingCharacters(in: .whitespaces) ?? ""
        let digest = Insecure.SHA1.hash(
            data: Data(
                (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8
            )
        )
        let accept = Data(digest).base64EncodedString()
        let response = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Accept: \(accept)",
            "",
            "",
        ].joined(separator: "\r\n")
        guard writeAllTestBytes(socket, Array(response.utf8)) else {
            trace.failure = "websocket handshake response failed"
            _ = Darwin.close(socket)
            return
        }
        defer { _ = Darwin.close(socket) }
        while let frame = readTestWebSocketFrame(socket) {
            if frame.opcode == 0x8 { return }
            if frame.opcode == 0x9 {
                _ = writeTestWebSocketFrame(
                    socket,
                    opcode: 0xA,
                    payload: frame.payload
                )
                continue
            }
            guard frame.opcode == 0x1,
                  let request = try? JSONSerialization.jsonObject(
                    with: Data(frame.payload)
                  ) as? [String: Any],
                  let id = request["id"] as? NSNumber,
                  let method = request["method"] as? String,
                  let result = fakeConfidentialCDPResult(
                    method: method,
                    request: request,
                    trace: trace
                  )
            else {
                trace.failure = "websocket request invalid"
                return
            }
            if method == "Target.getTargetInfo" {
                let event = try! JSONSerialization.data(
                    withJSONObject: [
                        "method": "Page.lifecycleEvent",
                        "params": ["name": "init"],
                    ],
                    options: [.sortedKeys]
                )
                guard writeTestWebSocketFrame(
                    socket,
                    opcode: 0x1,
                    payload: Array(event)
                ),
                    writeTestWebSocketFrame(
                        socket,
                        opcode: 0x9,
                        payload: Array("probe".utf8)
                    ),
                    let pong = readTestWebSocketFrame(socket),
                    pong.opcode == 0xA,
                    pong.masked,
                    pong.payload == Array("probe".utf8)
                else {
                    trace.failure = "client did not send a masked pong"
                    return
                }
            }
            guard
                  let bytes = try? JSONSerialization.data(
                    withJSONObject: ["id": id, "result": result],
                    options: [.sortedKeys]
                  ),
                  writeTestWebSocketFrame(
                    socket,
                    opcode: 0x1,
                    payload: Array(bytes)
                  )
            else {
                trace.failure = "websocket response failed"
                return
            }
            if method == "Runtime.callFunctionOn" { return }
        }
    }
    return ConfidentialWebSocketFixture(
        endpoint: endpoint,
        done: done,
        trace: trace
    )
}

private func serveConfidentialBrowserProtocol(
    descriptor: Int32,
    trace: ConfidentialDeliveryTraceBox,
    done: DispatchSemaphore
) {
    defer {
        _ = Darwin.close(descriptor)
        done.signal()
    }
    while let line = readConfidentialProtocolLine(descriptor) {
        guard let request = try? JSONSerialization.jsonObject(with: line)
                as? [String: Any],
              let id = request["id"] as? NSNumber,
              let method = request["method"] as? String
        else {
            trace.failure = "invalid request"
            return
        }
        trace.methods.append(method)
        let result: [String: Any]
        switch method {
        case "Target.getTargetInfo":
            result = [
                "targetInfo": [
                    "targetId": "target-1",
                    "type": "page",
                    "url": trace.targetURL,
                ],
            ]
        case "Page.getFrameTree":
            result = [
                "frameTree": [
                    "frame": [
                        "id": "frame-1",
                        "url": "https://oncore.test/login",
                    ],
                ],
            ]
        case "Accessibility.getFullAXTree":
            let exactNode: [String: Any] = [
                "backendDOMNodeId": 42,
                "role": ["value": "textbox"],
                "name": ["value": "Password"],
            ]
            let nodes: [[String: Any]]
            switch trace.matchMode {
            case .exact:
                nodes = [exactNode]
            case .missing:
                nodes = []
            case .multiple:
                nodes = [
                    exactNode,
                    [
                        "backendDOMNodeId": 43,
                        "role": ["value": "textbox"],
                        "name": ["value": "Password"],
                    ],
                ]
            }
            result = [
                "nodes": nodes,
            ]
        case "DOM.describeNode":
            result = [
                "node": [
                    "backendNodeId": 42,
                    "nodeName": "INPUT",
                    "frameId": "frame-1",
                    "attributes": ["type", "password"],
                ],
            ]
        case "DOM.resolveNode":
            result = ["object": ["objectId": "object-42"]]
        case "Runtime.callFunctionOn":
            let parameters = request["params"] as? [String: Any]
            let arguments = parameters?["arguments"] as? [[String: Any]]
            let declaration =
                parameters?["functionDeclaration"] as? String ?? ""
            trace.atomicFunctionRechecksOrigins =
                declaration.contains(
                    "view.location.origin !== expectedFrameOrigin"
                )
                && declaration.contains(
                    "view.top.location.origin !== expectedTopOrigin"
                )
                && declaration.contains("this.isConnected")
            if trace.atomicWriteAllowed {
                trace.insertedText = arguments?.last?["value"] as? String
            }
            if trace.suppressInsertResponse { return }
            result = [
                "result": [
                    "type": "object",
                    "value": ["written": trace.atomicWriteAllowed],
                ],
            ]
        default:
            trace.failure = "forbidden method: \(method)"
            return
        }
        guard writeConfidentialProtocolJSON(
            descriptor,
            ["id": id, "result": result]
        ) else {
            trace.failure = "response write failed"
            return
        }
        if method == "Runtime.callFunctionOn" { return }
    }
}

private struct SpawnedConfidentialDelivery {
    let pid: pid_t
    let metadataWriter: Int32
    let credentialWriter: Int32
    let browserPeer: Int32
    let stdoutReader: Int32
    let stderrReader: Int32
}

private func spawnConfidentialDeliveryHelper(
    executable: String
) throws -> SpawnedConfidentialDelivery {
    var metadata: [Int32] = [-1, -1]
    var credential: [Int32] = [-1, -1]
    var output: [Int32] = [-1, -1]
    var errorOutput: [Int32] = [-1, -1]
    var browser: [Int32] = [-1, -1]
    guard pipe(&metadata) == 0,
          pipe(&credential) == 0,
          pipe(&output) == 0,
          pipe(&errorOutput) == 0,
          socketpair(AF_UNIX, SOCK_STREAM, 0, &browser) == 0
    else {
        throw POSIXError(.EMFILE)
    }

    var actions: posix_spawn_file_actions_t?
    guard posix_spawn_file_actions_init(&actions) == 0 else {
        throw POSIXError(.EINVAL)
    }
    defer { posix_spawn_file_actions_destroy(&actions) }
    for (source, destination) in [
        (credential[0], Int32(3)),
        (metadata[0], Int32(4)),
        (browser[1], Int32(5)),
        (output[1], STDOUT_FILENO),
        (errorOutput[1], STDERR_FILENO),
    ] {
        guard posix_spawn_file_actions_adddup2(
            &actions,
            source,
            destination
        ) == 0 else {
            throw POSIXError(.EINVAL)
        }
    }

    var arguments: [UnsafeMutablePointer<CChar>?] = [
        strdup(executable),
        strdup("--credential-fd"),
        strdup("3"),
        strdup("--metadata-fd"),
        strdup("4"),
        strdup("--browser-fd"),
        strdup("5"),
        nil,
    ]
    var environment: [UnsafeMutablePointer<CChar>?] = [
        strdup("LANG=C.UTF-8"),
        strdup("PATH=/usr/bin:/bin"),
        nil,
    ]
    defer {
        for pointer in arguments.compactMap({ $0 }) { free(pointer) }
        for pointer in environment.compactMap({ $0 }) { free(pointer) }
    }
    var pid: pid_t = 0
    let spawnResult = arguments.withUnsafeMutableBufferPointer { argv in
        environment.withUnsafeMutableBufferPointer { envp in
            posix_spawn(
                &pid,
                executable,
                &actions,
                nil,
                argv.baseAddress!,
                envp.baseAddress!
            )
        }
    }
    guard spawnResult == 0 else { throw POSIXError(POSIXErrorCode(rawValue: spawnResult) ?? .EINVAL) }

    for descriptor in [
        metadata[0],
        credential[0],
        output[1],
        errorOutput[1],
        browser[1],
    ] {
        _ = Darwin.close(descriptor)
    }
    return SpawnedConfidentialDelivery(
        pid: pid,
        metadataWriter: metadata[1],
        credentialWriter: credential[1],
        browserPeer: browser[0],
        stdoutReader: output[0],
        stderrReader: errorOutput[0]
    )
}

private func confidentialDeliveryHelperWritesOneSemanticField() throws {
    let helper = URL(fileURLWithPath: CommandLine.arguments[0])
        .deletingLastPathComponent()
        .appendingPathComponent("browser-use-confidential-delivery")
    let spawned = try spawnConfidentialDeliveryHelper(executable: helper.path)
    let trace = ConfidentialDeliveryTraceBox()
    let browserDone = DispatchSemaphore(value: 0)
    DispatchQueue.global().async {
        serveConfidentialBrowserProtocol(
            descriptor: spawned.browserPeer,
            trace: trace,
            done: browserDone
        )
    }

    let metadata: [String: Any] = [
        "schema_version": 1,
        "target": [
            "target_id": "target-1",
            "frame_id": "frame-1",
            "top_level_origin": "https://oncore.test",
            "frame_origin": "https://oncore.test",
        ],
        "locator": [
            "role": "textbox",
            "accessible_name": "Password",
            "input_kind": "password",
        ],
    ]
    try check(
        writeConfidentialProtocolJSON(spawned.metadataWriter, metadata),
        "metadata write failed"
    )
    _ = Darwin.close(spawned.metadataWriter)
    let sentinel = "U7_HELPER_PASSWORD_SENTINEL"
    let secretBytes = Array((sentinel + "\n").utf8)
    let secretWritten = secretBytes.withUnsafeBytes {
        Darwin.write(
            spawned.credentialWriter,
            $0.baseAddress,
            secretBytes.count
        )
    }
    _ = Darwin.close(spawned.credentialWriter)
    try check(secretWritten == secretBytes.count, "credential write failed")

    var status: Int32 = 0
    while waitpid(spawned.pid, &status, 0) < 0, errno == EINTR {}
    let stdout = readConfidentialPipe(spawned.stdoutReader)
    let stderr = readConfidentialPipe(spawned.stderrReader)
    _ = Darwin.close(spawned.stdoutReader)
    _ = Darwin.close(spawned.stderrReader)
    try check(
        browserDone.wait(timeout: .now() + 2) == .success,
        "fake browser channel did not finish"
    )
    let stdoutText = String(decoding: stdout, as: UTF8.self)
    try check(status == 0, "confidential helper failed: \(stdoutText)")
    try check(trace.failure == nil, "fake browser rejected helper: \(trace.failure ?? "")")
    try check(trace.insertedText == sentinel, "helper did not deliver the exact field")
    try check(
        trace.methods == [
            "Target.getTargetInfo",
            "Page.getFrameTree",
            "Accessibility.getFullAXTree",
            "DOM.describeNode",
            "DOM.resolveNode",
            "Runtime.callFunctionOn",
        ],
        "helper method trace drifted: \(trace.methods)"
    )
    try check(
        stdoutText.contains("\"write_state\":\"delivered\"")
            && stdoutText.contains("\"byte_length\":27"),
        "helper did not emit structural delivery truth: \(stdoutText)"
    )
    try check(!stdout.contains(Data(sentinel.utf8)), "helper stdout leaked credential")
    try check(!stderr.contains(Data(sentinel.utf8)), "helper stderr leaked credential")
}

private func confidentialDeliveryHelperRejectsNonUniqueFieldBeforeCredentialRead()
    throws
{
    let helper = URL(fileURLWithPath: CommandLine.arguments[0])
        .deletingLastPathComponent()
        .appendingPathComponent("browser-use-confidential-delivery")
    for (mode, expectedCode) in [
        (ConfidentialSemanticMatchMode.missing, "field-missing"),
        (ConfidentialSemanticMatchMode.multiple, "field-ambiguous"),
    ] {
        let spawned = try spawnConfidentialDeliveryHelper(
            executable: helper.path
        )
        let trace = ConfidentialDeliveryTraceBox(matchMode: mode)
        let browserDone = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            serveConfidentialBrowserProtocol(
                descriptor: spawned.browserPeer,
                trace: trace,
                done: browserDone
            )
        }
        let metadata: [String: Any] = [
            "schema_version": 1,
            "target": [
                "target_id": "target-1",
                "frame_id": "frame-1",
                "top_level_origin": "https://oncore.test",
                "frame_origin": "https://oncore.test",
            ],
            "locator": [
                "role": "textbox",
                "accessible_name": "Password",
                "input_kind": "password",
            ],
        ]
        try check(
            writeConfidentialProtocolJSON(spawned.metadataWriter, metadata),
            "metadata write failed"
        )
        _ = Darwin.close(spawned.metadataWriter)

        var status: Int32 = 0
        while waitpid(spawned.pid, &status, 0) < 0, errno == EINTR {}
        _ = Darwin.close(spawned.credentialWriter)
        let stdout = readConfidentialPipe(spawned.stdoutReader)
        let stderr = readConfidentialPipe(spawned.stderrReader)
        _ = Darwin.close(spawned.stdoutReader)
        _ = Darwin.close(spawned.stderrReader)
        try check(
            browserDone.wait(timeout: .now() + 2) == .success,
            "fake browser channel did not finish"
        )
        let stdoutText = String(decoding: stdout, as: UTF8.self)
        try check(
            status != 0
                && stdoutText.contains("\"code\":\"\(expectedCode)\"")
                && stdoutText.contains(
                    "\"write_state\":\"blocked-before-write\""
                ),
            "non-unique semantic field did not block before write: \(stdoutText)"
        )
        try check(
            trace.methods == [
                "Target.getTargetInfo",
                "Page.getFrameTree",
                "Accessibility.getFullAXTree",
            ],
            "non-unique field crossed the semantic lookup boundary: \(trace.methods)"
        )
        try check(
            trace.insertedText == nil,
            "non-unique semantic field received credential text"
        )
        try check(stderr.isEmpty, "non-unique field emitted stderr")
    }
}

private func confidentialDeliveryHelperClassifiesTargetDriftAndUnknownWrite()
    throws
{
    let helper = URL(fileURLWithPath: CommandLine.arguments[0])
        .deletingLastPathComponent()
        .appendingPathComponent("browser-use-confidential-delivery")
    let metadata: [String: Any] = [
        "schema_version": 1,
        "target": [
            "target_id": "target-1",
            "frame_id": "frame-1",
            "top_level_origin": "https://oncore.test",
            "frame_origin": "https://oncore.test",
        ],
        "locator": [
            "role": "textbox",
            "accessible_name": "Password",
            "input_kind": "password",
        ],
    ]

    do {
        let spawned = try spawnConfidentialDeliveryHelper(
            executable: helper.path
        )
        let trace = ConfidentialDeliveryTraceBox(
            targetURL: "https://drift.test/login"
        )
        let browserDone = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            serveConfidentialBrowserProtocol(
                descriptor: spawned.browserPeer,
                trace: trace,
                done: browserDone
            )
        }
        try check(
            writeConfidentialProtocolJSON(spawned.metadataWriter, metadata),
            "target-drift metadata write failed"
        )
        _ = Darwin.close(spawned.metadataWriter)
        var status: Int32 = 0
        while waitpid(spawned.pid, &status, 0) < 0, errno == EINTR {}
        _ = Darwin.close(spawned.credentialWriter)
        let stdout = readConfidentialPipe(spawned.stdoutReader)
        let stderr = readConfidentialPipe(spawned.stderrReader)
        _ = Darwin.close(spawned.stdoutReader)
        _ = Darwin.close(spawned.stderrReader)
        try check(
            browserDone.wait(timeout: .now() + 2) == .success,
            "target-drift browser channel did not finish"
        )
        let stdoutText = String(decoding: stdout, as: UTF8.self)
        try check(
            status != 0
                && stdoutText.contains("\"code\":\"target-unproven\"")
                && stdoutText.contains(
                    "\"write_state\":\"blocked-before-write\""
                ),
            "target drift was not blocked before credential read: \(stdoutText)"
        )
        try check(
            trace.methods == ["Target.getTargetInfo"]
                && trace.insertedText == nil,
            "target drift crossed the target proof boundary: \(trace.methods)"
        )
        try check(stderr.isEmpty, "target drift emitted stderr")
    }

    do {
        let spawned = try spawnConfidentialDeliveryHelper(
            executable: helper.path
        )
        let trace = ConfidentialDeliveryTraceBox(
            suppressInsertResponse: true
        )
        let browserDone = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            serveConfidentialBrowserProtocol(
                descriptor: spawned.browserPeer,
                trace: trace,
                done: browserDone
            )
        }
        try check(
            writeConfidentialProtocolJSON(spawned.metadataWriter, metadata),
            "unknown-write metadata write failed"
        )
        _ = Darwin.close(spawned.metadataWriter)
        let sentinel = "U7_UNKNOWN_WRITE_SENTINEL"
        let credential = Array((sentinel + "\n").utf8)
        let written = credential.withUnsafeBytes {
            Darwin.write(
                spawned.credentialWriter,
                $0.baseAddress,
                credential.count
            )
        }
        _ = Darwin.close(spawned.credentialWriter)
        try check(written == credential.count, "unknown-write credential write failed")
        var status: Int32 = 0
        while waitpid(spawned.pid, &status, 0) < 0, errno == EINTR {}
        let stdout = readConfidentialPipe(spawned.stdoutReader)
        let stderr = readConfidentialPipe(spawned.stderrReader)
        _ = Darwin.close(spawned.stdoutReader)
        _ = Darwin.close(spawned.stderrReader)
        try check(
            browserDone.wait(timeout: .now() + 2) == .success,
            "unknown-write browser channel did not finish"
        )
        let stdoutText = String(decoding: stdout, as: UTF8.self)
        try check(
            status != 0
                && stdoutText.contains("\"code\":\"write-outcome-unknown\"")
                && stdoutText.contains(
                    "\"write_state\":\"write-outcome-unknown\""
                ),
            "missing write response was not classified unknown: \(stdoutText)"
        )
        try check(
            trace.insertedText == sentinel
                && trace.methods.last == "Runtime.callFunctionOn",
            "unknown-write fixture did not reach the one allowed write"
        )
        try check(
            !stdout.contains(Data(sentinel.utf8))
                && !stderr.contains(Data(sentinel.utf8)),
            "unknown-write result leaked credential"
        )
    }

    do {
        let spawned = try spawnConfidentialDeliveryHelper(
            executable: helper.path
        )
        let trace = ConfidentialDeliveryTraceBox(atomicWriteAllowed: false)
        let browserDone = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            serveConfidentialBrowserProtocol(
                descriptor: spawned.browserPeer,
                trace: trace,
                done: browserDone
            )
        }
        try check(
            writeConfidentialProtocolJSON(spawned.metadataWriter, metadata),
            "atomic-drift metadata write failed"
        )
        _ = Darwin.close(spawned.metadataWriter)
        let sentinel = "U7_ATOMIC_DRIFT_SENTINEL"
        _ = writeAllTestBytes(
            spawned.credentialWriter,
            Array((sentinel + "\n").utf8)
        )
        _ = Darwin.close(spawned.credentialWriter)
        var status: Int32 = 0
        while waitpid(spawned.pid, &status, 0) < 0, errno == EINTR {}
        let stdout = readConfidentialPipe(spawned.stdoutReader)
        let stderr = readConfidentialPipe(spawned.stderrReader)
        _ = Darwin.close(spawned.stdoutReader)
        _ = Darwin.close(spawned.stderrReader)
        try check(
            browserDone.wait(timeout: .now() + 2) == .success,
            "atomic-drift browser channel did not finish"
        )
        let stdoutText = String(decoding: stdout, as: UTF8.self)
        try check(
            status != 0
                && stdoutText.contains("\"code\":\"target-unproven\"")
                && stdoutText.contains(
                    "\"write_state\":\"blocked-before-write\""
                ),
            "atomic navigation drift was not blocked: \(stdoutText)"
        )
        try check(
            trace.atomicFunctionRechecksOrigins
                && trace.insertedText == nil
                && trace.methods.last == "Runtime.callFunctionOn",
            "atomic write did not bind live origins and exact node"
        )
        try check(
            !stdout.contains(Data(sentinel.utf8))
                && !stderr.contains(Data(sentinel.utf8)),
            "atomic-drift result leaked credential"
        )
    }
}

private func environmentOpPrivatePipeFeedsOnlyNativeWriter() throws {
    let fake = try makeFakeOp(name: "browser-use-fake-op-private-delivery")
    defer {
        try? FileManager.default.removeItem(
            at: fake.deletingLastPathComponent()
        )
    }
    try withTokenDescriptor { tokenDescriptor in
        var browser: [Int32] = [-1, -1]
        try check(
            socketpair(AF_UNIX, SOCK_STREAM, 0, &browser) == 0,
            "private delivery browser socket failed"
        )
        defer {
            _ = Darwin.close(browser[0])
            _ = Darwin.close(browser[1])
        }
        let trace = ConfidentialDeliveryTraceBox()
        let browserDone = DispatchSemaphore(value: 0)
        let browserPeer = browser[1]
        DispatchQueue.global().async {
            serveConfidentialBrowserProtocol(
                descriptor: browserPeer,
                trace: trace,
                done: browserDone
            )
        }
        let result =
            EnvironmentOpSupervisor
                .executeIdentityBoundPrivateFieldForTesting(
                    executablePath: fake.path,
                    vaultID: "vault-1",
                    itemID: "item-1",
                    field: .password,
                    tokenDescriptor: tokenDescriptor
                ) { credentialDescriptor, timeoutMilliseconds in
                    var metadata: [Int32] = [-1, -1]
                    guard pipe(&metadata) == 0 else {
                        return Data()
                    }
                    let request: [String: Any] = [
                        "schema_version": 1,
                        "target": [
                            "target_id": "target-1",
                            "frame_id": "frame-1",
                            "top_level_origin": "https://oncore.test",
                            "frame_origin": "https://oncore.test",
                        ],
                        "locator": [
                            "role": "textbox",
                            "accessible_name": "Password",
                            "input_kind": "password",
                        ],
                    ]
                    let wrote = writeConfidentialProtocolJSON(
                        metadata[1],
                        request
                    )
                    _ = Darwin.close(metadata[1])
                    guard wrote else {
                        _ = Darwin.close(metadata[0])
                        return Data()
                    }
                    let delivery = ConfidentialFieldDeliveryProcess.run(
                        metadataDescriptor: metadata[0],
                        credentialDescriptor: credentialDescriptor,
                        browserDescriptor: browser[0],
                        timeoutMilliseconds: timeoutMilliseconds
                    )
                    _ = Darwin.close(metadata[0])
                    return delivery
                }
        guard case let .success(output) = result else {
            throw TestFailure(
                description: "private OP pipe did not complete"
            )
        }
        try check(
            browserDone.wait(timeout: .now() + 2) == .success,
            "private delivery browser did not finish"
        )
        let outputText = String(decoding: output, as: UTF8.self)
        try check(
            outputText.contains("\"write_state\":\"delivered\""),
            "private OP pipe did not deliver: \(outputText)"
        )
        try check(
            trace.insertedText == "U7_PRIVATE_PIPE_PASSWORD_SENTINEL",
            "private OP output did not reach native writer"
        )
        try check(
            !output.contains(
                Data("U7_PRIVATE_PIPE_PASSWORD_SENTINEL".utf8)
            ),
            "private delivery result leaked credential"
        )
    }
}

private func confidentialPrivateModeOwnsAttachedPageWebSocket() throws {
    let fake = try makeFakeOp(name: "browser-use-fake-op-private-websocket")
    defer {
        try? FileManager.default.removeItem(
            at: fake.deletingLastPathComponent()
        )
    }
    let fixture = try startConfidentialWebSocketFixture()
    let request: [String: Any] = [
        "schema_version": 1,
        "browser_ws_endpoint": fixture.endpoint,
        "browser_pid": getpid(),
        "binding": [
            "vault_id": "vault-1",
            "item_id": "item-1",
        ],
        "target": [
            "lane_id": "agent-browser",
            "run_id": "run-u7-native-websocket",
            "target_id": "target-1",
            "page_id": "page-1",
            "frame_id": "frame-1",
            "top_level_origin": "https://oncore.test",
            "frame_origin": "https://oncore.test",
            "target_proof_digest": String(repeating: "d", count: 64),
        ],
        "locator": [
            "role": "textbox",
            "accessible_name": "Password",
            "input_kind": "password",
        ],
    ]
    let requestData = try JSONSerialization.data(
        withJSONObject: request,
        options: [.sortedKeys]
    )
    try withTokenDescriptor { tokenDescriptor in
        let result = ConfidentialFieldDeliveryProcess.runPrivateForTesting(
            requestData: requestData,
            opExecutablePath: fake.path,
            tokenDescriptor: tokenDescriptor
        )
        try check(
            fixture.done.wait(timeout: .now() + 3) == .success,
            "native websocket fixture did not finish"
        )
        let text = String(decoding: result, as: UTF8.self)
        try check(
            text.contains("\"write_state\":\"delivered\""),
            "native private websocket delivery failed: \(text); fixture: \(fixture.trace.failure ?? "none")"
        )
        try check(
            fixture.trace.insertedText
                == "U7_PRIVATE_PIPE_PASSWORD_SENTINEL",
            "native websocket did not receive exact private OP output"
        )
        try check(
            fixture.trace.methods == [
                "Target.getTargetInfo",
                "Page.getFrameTree",
                "Accessibility.getFullAXTree",
                "DOM.describeNode",
                "DOM.resolveNode",
                "Runtime.callFunctionOn",
            ],
            "native websocket method allowlist drifted: \(fixture.trace.methods)"
        )
        try check(
            !result.contains(
                Data("U7_PRIVATE_PIPE_PASSWORD_SENTINEL".utf8)
            ),
            "native websocket result leaked credential"
        )
    }
}

private func confidentialPrivateModeRejectsMismatchedBrowserPID() throws {
    let fixture = try startConfidentialWebSocketFixture()
    let request: [String: Any] = [
        "schema_version": 1,
        "browser_ws_endpoint": fixture.endpoint,
        "browser_pid": getppid(),
        "binding": [
            "vault_id": "vault-1",
            "item_id": "item-1",
        ],
        "target": [
            "lane_id": "agent-browser",
            "run_id": "run-u7-native-pid-mismatch",
            "target_id": "target-1",
            "page_id": "page-1",
            "frame_id": "frame-1",
            "top_level_origin": "https://oncore.test",
            "frame_origin": "https://oncore.test",
            "target_proof_digest": String(repeating: "d", count: 64),
        ],
        "locator": [
            "role": "textbox",
            "accessible_name": "Password",
            "input_kind": "password",
        ],
    ]
    let requestData = try JSONSerialization.data(
        withJSONObject: request,
        options: [.sortedKeys]
    )
    try withTokenDescriptor { tokenDescriptor in
        let result = ConfidentialFieldDeliveryProcess.runPrivateForTesting(
            requestData: requestData,
            opExecutablePath: "/does/not/run",
            tokenDescriptor: tokenDescriptor,
            timeoutMilliseconds: 1_000
        )
        let text = String(decoding: result, as: UTF8.self)
        try check(
            text.contains("\"code\":\"invalid-request\"")
                && text.contains("\"write_state\":\"blocked-before-write\""),
            "mismatched browser PID was not blocked: \(text)"
        )
        try check(
            fixture.trace.methods.isEmpty
                && fixture.trace.insertedText == nil,
            "mismatched browser PID reached CDP"
        )
    }
    _ = fixture.done.wait(timeout: .now() + 4)
}

private func confidentialTargetProofDerivesClosedNativeObservation() throws {
    let fixture = try startConfidentialWebSocketFixture()
    let request: [String: Any] = [
        "schema_version": 1,
        "browser_ws_endpoint": fixture.endpoint,
        "browser_pid": getpid(),
        "target_id": "target-1",
    ]
    let requestData = try JSONSerialization.data(
        withJSONObject: request,
        options: [.sortedKeys]
    )
    let result = ConfidentialFieldDeliveryProcess.proveTargetForTesting(
        requestData: requestData
    )
    try check(
        fixture.done.wait(timeout: .now() + 3) == .success,
        "native target proof fixture did not finish"
    )
    guard let envelope = try JSONSerialization.jsonObject(with: result)
        as? [String: Any],
        Set(envelope.keys) == ["schema_version", "ok", "proof"],
        envelope["schema_version"] as? Int == 1,
        envelope["ok"] as? Bool == true,
        let proof = envelope["proof"] as? [String: Any],
        Set(proof.keys) == [
            "lane_id",
            "target_id",
            "page_id",
            "frame_id",
            "document_id",
            "top_level_origin",
            "frame_origin",
            "target_proof_digest",
        ]
    else {
        throw TestFailure(
            description: "native target proof envelope was not closed"
        )
    }
    let canonical = try JSONSerialization.data(
        withJSONObject: [
            1,
            "agent-browser",
            "target-1",
            "target-1",
            "frame-1",
            "loader-1",
            "https://oncore.test",
            "https://oncore.test",
        ]
    )
    let expectedDigest = SHA256.hash(data: canonical)
        .map { String(format: "%02x", $0) }
        .joined()
    try check(
        proof["lane_id"] as? String == "agent-browser"
            && proof["target_id"] as? String == "target-1"
            && proof["page_id"] as? String == "target-1"
            && proof["frame_id"] as? String == "frame-1"
            && proof["document_id"] as? String == "loader-1"
            && proof["top_level_origin"] as? String
                == "https://oncore.test"
            && proof["frame_origin"] as? String == "https://oncore.test"
            && proof["target_proof_digest"] as? String == expectedDigest,
        "native target proof did not derive exact CDP coordinates: \(proof)"
    )
    try check(
        fixture.trace.methods == [
            "Target.getTargetInfo",
            "Page.getFrameTree",
        ],
        "target proof crossed its read-only CDP allowlist: \(fixture.trace.methods)"
    )
    try check(
        !String(decoding: result, as: UTF8.self).contains(fixture.endpoint),
        "target proof leaked the browser endpoint"
    )
}

private func confidentialTargetProofBindsRootDocumentIdentity() throws {
    var proofs: [[String: Any]] = []
    for loaderID in ["loader-1", "loader-2"] {
        let fixture = try startConfidentialWebSocketFixture(
            rootFrameLoaderID: loaderID
        )
        let requestData = try JSONSerialization.data(
            withJSONObject: [
                "schema_version": 1,
                "browser_ws_endpoint": fixture.endpoint,
                "browser_pid": getpid(),
                "target_id": "target-1",
            ],
            options: [.sortedKeys]
        )
        let result = ConfidentialFieldDeliveryProcess.proveTargetForTesting(
            requestData: requestData
        )
        try check(
            fixture.done.wait(timeout: .now() + 3) == .success,
            "document identity target proof fixture did not finish"
        )
        guard let envelope = try JSONSerialization.jsonObject(with: result)
                as? [String: Any],
              envelope["ok"] as? Bool == true,
              let proof = envelope["proof"] as? [String: Any]
        else {
            throw TestFailure(
                description: "document identity target proof was rejected"
            )
        }
        proofs.append(proof)
    }
    try check(
        proofs[0]["target_id"] as? String
            == proofs[1]["target_id"] as? String
            && proofs[0]["frame_id"] as? String
                == proofs[1]["frame_id"] as? String
            && proofs[0]["top_level_origin"] as? String
                == proofs[1]["top_level_origin"] as? String
            && proofs[0]["frame_origin"] as? String
                == proofs[1]["frame_origin"] as? String
            && proofs[0]["document_id"] as? String == "loader-1"
            && proofs[1]["document_id"] as? String == "loader-2"
            && proofs[0]["target_proof_digest"] as? String
                != proofs[1]["target_proof_digest"] as? String,
        "root document change did not change the exact target proof"
    )
}

private func confidentialTargetProofRejectsMissingOrInvalidDocumentIdentity()
    throws
{
    for loaderID in [nil, "", "loader id"] as [String?] {
        let fixture = try startConfidentialWebSocketFixture(
            rootFrameLoaderID: loaderID
        )
        let requestData = try JSONSerialization.data(
            withJSONObject: [
                "schema_version": 1,
                "browser_ws_endpoint": fixture.endpoint,
                "browser_pid": getpid(),
                "target_id": "target-1",
            ],
            options: [.sortedKeys]
        )
        let result = ConfidentialFieldDeliveryProcess.proveTargetForTesting(
            requestData: requestData
        )
        try check(
            fixture.done.wait(timeout: .now() + 3) == .success,
            "invalid document identity target proof fixture did not finish"
        )
        guard let envelope = try JSONSerialization.jsonObject(with: result)
                as? [String: Any],
              envelope["ok"] as? Bool == false,
              let rejection = envelope["rejection"] as? [String: Any],
              rejection["code"] as? String == "target-unproven"
        else {
            throw TestFailure(
                description:
                    "missing or invalid root loader identity was admitted"
            )
        }
    }
}

private func reviewedReadRequest(
    fixture: ConfidentialWebSocketFixture,
    documentID: String = "loader-1",
    targetProofDigest: String? = nil,
    resetNavigationHistory: Bool = false,
    script: String = "async () => ({ rows: 7 })",
    scriptDigest: String? = nil
) throws -> Data {
    let digest = scriptDigest ?? SHA256.hash(data: Data(script.utf8))
        .map { String(format: "%02x", $0) }
        .joined()
    let proofCanonical = try JSONSerialization.data(
        withJSONObject: [
            1,
            "agent-browser",
            "target-1",
            "target-1",
            "frame-1",
            documentID,
            "https://oncore.test",
            "https://oncore.test",
        ]
    )
    let proofDigest = targetProofDigest
        ?? SHA256.hash(data: proofCanonical)
            .map { String(format: "%02x", $0) }
            .joined()
    return try JSONSerialization.data(
        withJSONObject: [
            "schema_version": 1,
            "browser_ws_endpoint": fixture.endpoint,
            "browser_pid": getpid(),
            "target_id": "target-1",
            "document_id": documentID,
            "top_level_origin": "https://oncore.test",
            "frame_origin": "https://oncore.test",
            "target_proof_digest": proofDigest,
            "reset_navigation_history": resetNavigationHistory,
            "script": script,
            "script_sha256": digest,
        ],
        options: [.sortedKeys]
    )
}

private func reviewedReadRejectionCode(_ data: Data) throws -> String {
    guard let envelope = try JSONSerialization.jsonObject(with: data)
            as? [String: Any],
          Set(envelope.keys) == ["schema_version", "ok", "rejection"],
          envelope["schema_version"] as? Int == 1,
          envelope["ok"] as? Bool == false,
          let rejection = envelope["rejection"] as? [String: Any],
          Set(rejection.keys) == ["code", "message"],
          let code = rejection["code"] as? String,
          !String(decoding: data, as: UTF8.self).contains(
            "SENSITIVE_SCRIPT_EXCEPTION"
          )
    else {
        throw TestFailure(
            description: "reviewed read rejection was not closed and secret-free"
        )
    }
    return code
}

private func confidentialReviewedReadIsDocumentBoundAndClosed() throws {
    let fixture = try startConfidentialWebSocketFixture(
        rootFrameLoaderIDs: ["loader-1", "loader-1", "loader-1"]
    )
    let script = "async ({ inputs }) => ({ rows: Object.keys(inputs).length + 7 })"
    let digest = SHA256.hash(data: Data(script.utf8))
        .map { String(format: "%02x", $0) }
        .joined()
    let result = ConfidentialFieldDeliveryProcess.readReviewedForTesting(
        requestData: try reviewedReadRequest(
            fixture: fixture,
            script: script
        )
    )
    try check(
        fixture.done.wait(timeout: .now() + 3) == .success,
        "reviewed read fixture did not finish"
    )
    guard let envelope = try JSONSerialization.jsonObject(with: result)
            as? [String: Any],
          Set(envelope.keys) == [
            "schema_version",
            "ok",
            "proof",
            "result",
            "navigation_history_sealed",
          ],
          envelope["schema_version"] as? Int == 1,
          envelope["ok"] as? Bool == true,
          envelope["navigation_history_sealed"] as? Bool == false,
          let proof = envelope["proof"] as? [String: Any],
          Set(proof.keys) == [
            "lane_id",
            "target_id",
            "page_id",
            "frame_id",
            "document_id",
            "top_level_origin",
            "frame_origin",
            "target_proof_digest",
          ],
          proof["document_id"] as? String == "loader-1",
          let observation = envelope["result"] as? [String: Any],
          observation["rows"] as? Int == 7
    else {
        throw TestFailure(
            description: "reviewed read success envelope was not closed"
        )
    }
    try check(
        fixture.trace.methods == [
            "Target.getTargetInfo",
            "Page.getFrameTree",
            "Page.createIsolatedWorld",
            "Target.getTargetInfo",
            "Page.getFrameTree",
            "Runtime.evaluate",
            "Target.getTargetInfo",
            "Page.getFrameTree",
        ],
        "reviewed read protocol allowlist drifted: \(fixture.trace.methods)"
    )
    try check(
        fixture.trace.reviewedReadWorldParameters?["frameId"] as? String
            == "frame-1"
            && fixture.trace.reviewedReadWorldParameters?[
                "grantUniveralAccess"
            ] as? Bool == false
            && fixture.trace.reviewedReadWorldParameters?["worldName"]
                as? String
                == "browser-use-reviewed-\(digest.prefix(16))"
            && Set(
                fixture.trace.reviewedReadWorldParameters?.keys.map { $0 }
                    ?? []
            ) == [
                "frameId",
                "worldName",
                "grantUniveralAccess",
            ],
        "reviewed read isolated-world contract drifted"
    )
    try check(
        (
            fixture.trace.reviewedReadParameters?["contextId"] as? NSNumber
        )?.intValue == 71
            && fixture.trace.reviewedReadParameters?["awaitPromise"] as? Bool
                == true
            && fixture.trace.reviewedReadParameters?["returnByValue"] as? Bool
                == true
            && fixture.trace.reviewedReadParameters?["userGesture"] as? Bool
                == false
            && fixture.trace.reviewedReadParameters?["includeCommandLineAPI"]
                as? Bool == false
            && fixture.trace.reviewedReadParameters?[
                "allowUnsafeEvalBlockedByCSP"
            ] as? Bool == false
            && Set(
                fixture.trace.reviewedReadParameters?.keys.map { $0 } ?? []
            ) == [
                "expression",
                "contextId",
                "awaitPromise",
                "returnByValue",
                "userGesture",
                "includeCommandLineAPI",
                "allowUnsafeEvalBlockedByCSP",
            ]
            && fixture.trace.reviewedReadExpression?.contains(script) == true
            && fixture.trace.reviewedReadExpression?.contains(digest) == true,
        "reviewed read did not bind the approved script to one isolated context"
    )
    try check(
        fixture.trace.reviewedReadExpression?.contains(
            "action({ inputs: Object.freeze({}) })"
        ) == true,
        "reviewed read did not preserve the input-envelope action ABI"
    )
}

private func confidentialReviewedReadSealsNavigationHistory() throws {
    let fixture = try startConfidentialWebSocketFixture(
        rootFrameLoaderIDs: [
            "loader-1",
            "loader-1",
            "loader-1",
            "loader-1",
        ]
    )
    let result = ConfidentialFieldDeliveryProcess.readReviewedForTesting(
        requestData: try reviewedReadRequest(
            fixture: fixture,
            resetNavigationHistory: true
        )
    )
    try check(
        fixture.done.wait(timeout: .now() + 3) == .success,
        "navigation-history sealing fixture did not finish"
    )
    guard let envelope = try JSONSerialization.jsonObject(with: result)
            as? [String: Any],
          envelope["ok"] as? Bool == true,
          envelope["navigation_history_sealed"] as? Bool == true
    else {
        throw TestFailure(
            description: "reviewed read did not seal navigation history"
        )
    }
    try check(
        fixture.trace.methods == [
            "Target.getTargetInfo",
            "Page.getFrameTree",
            "Page.createIsolatedWorld",
            "Target.getTargetInfo",
            "Page.getFrameTree",
            "Runtime.evaluate",
            "Target.getTargetInfo",
            "Page.getFrameTree",
            "Page.resetNavigationHistory",
            "Page.getNavigationHistory",
            "Target.getTargetInfo",
            "Page.getFrameTree",
        ],
        "history-sealed reviewed-read protocol drifted: \(fixture.trace.methods)"
    )
}

private func confidentialReviewedReadRejectsUnsealedHistory() throws {
    let cases: [
        (
            String,
            Bool,
            Int,
            [[String: Any]],
            String
        )
    ] = [
        (
            "reset error",
            false,
            0,
            [["id": 1, "url": "https://oncore.test/login"]],
            "Page.resetNavigationHistory"
        ),
        (
            "retained entry",
            true,
            1,
            [
                ["id": 1, "url": "https://oncore.test/previous"],
                ["id": 2, "url": "https://oncore.test/login"],
            ],
            "Page.getNavigationHistory"
        ),
        (
            "history origin mismatch",
            true,
            0,
            [["id": 1, "url": "https://drift.test/login"]],
            "Page.getNavigationHistory"
        ),
    ]
    for (name, resetSucceeds, currentIndex, entries, lastMethod) in cases {
        let fixture = try startConfidentialWebSocketFixture(
            rootFrameLoaderIDs: [
                "loader-1",
                "loader-1",
                "loader-1",
                "loader-1",
            ],
            reviewedReadResetSucceeds: resetSucceeds,
            reviewedReadHistoryCurrentIndex: currentIndex,
            reviewedReadHistoryEntries: entries
        )
        let result = ConfidentialFieldDeliveryProcess.readReviewedForTesting(
            requestData: try reviewedReadRequest(
                fixture: fixture,
                resetNavigationHistory: true
            )
        )
        try check(
            fixture.done.wait(timeout: .now() + 3) == .success,
            "\(name) history-sealing fixture did not finish"
        )
        try check(
            try reviewedReadRejectionCode(result)
                == "navigation-history-unsealed",
            "\(name) did not discard the reviewed-read result"
        )
        try check(
            fixture.trace.methods.last == lastMethod,
            "\(name) crossed the history-sealing failure boundary"
        )
    }
}

private func confidentialReviewedReadRejectsHistorySealRaces() throws {
    let stable = "https://oncore.test/login"
    let drift = "https://drift.test/login"
    let cases: [
        (
            String,
            [String?],
            [String],
            Bool
        )
    ] = [
        (
            "loader before reset",
            ["loader-1", "loader-1", "loader-2"],
            [stable, stable, stable],
            false
        ),
        (
            "origin before reset",
            ["loader-1", "loader-1", "loader-1"],
            [stable, stable, drift],
            false
        ),
        (
            "loader after reset",
            ["loader-1", "loader-1", "loader-1", "loader-2"],
            [stable, stable, stable, stable],
            true
        ),
        (
            "origin after reset",
            ["loader-1", "loader-1", "loader-1", "loader-1"],
            [stable, stable, stable, drift],
            true
        ),
    ]
    for (name, loaders, targetURLs, resetRan) in cases {
        let fixture = try startConfidentialWebSocketFixture(
            rootFrameLoaderIDs: loaders,
            targetURLs: targetURLs
        )
        let result = ConfidentialFieldDeliveryProcess.readReviewedForTesting(
            requestData: try reviewedReadRequest(
                fixture: fixture,
                resetNavigationHistory: true
            )
        )
        try check(
            fixture.done.wait(timeout: .now() + 3) == .success,
            "\(name) history race fixture did not finish"
        )
        try check(
            try reviewedReadRejectionCode(result) == "target-unproven",
            "\(name) history race was admitted"
        )
        try check(
            fixture.trace.methods.contains("Page.resetNavigationHistory")
                == resetRan,
            "\(name) crossed the wrong history reset boundary"
        )
    }
}

private func confidentialReviewedReadRejectsStaleTargetProofDigest() throws {
    let fixture = try startConfidentialWebSocketFixture()
    let result = ConfidentialFieldDeliveryProcess.readReviewedForTesting(
        requestData: try reviewedReadRequest(
            fixture: fixture,
            targetProofDigest: String(repeating: "0", count: 64)
        )
    )
    try check(
        fixture.done.wait(timeout: .now() + 3) == .success,
        "stale target-proof digest fixture did not finish"
    )
    try check(
        try reviewedReadRejectionCode(result) == "target-unproven",
        "stale target-proof digest was admitted"
    )
    try check(
        fixture.trace.methods == [
            "Target.getTargetInfo",
            "Page.getFrameTree",
        ],
        "stale target-proof digest crossed into isolated execution"
    )
}

private func confidentialReviewedReadRejectsDocumentRaces() throws {
    for (name, expectedDocument, loaders, evaluated) in [
        (
            "before isolated context",
            "loader-expected",
            ["loader-observed"] as [String?],
            false
        ),
        (
            "before evaluation",
            "loader-1",
            ["loader-1", "loader-2"] as [String?],
            false
        ),
        (
            "after evaluation",
            "loader-1",
            ["loader-1", "loader-1", "loader-2"] as [String?],
            true
        ),
    ] {
        let fixture = try startConfidentialWebSocketFixture(
            rootFrameLoaderIDs: loaders
        )
        let result = ConfidentialFieldDeliveryProcess.readReviewedForTesting(
            requestData: try reviewedReadRequest(
                fixture: fixture,
                documentID: expectedDocument
            )
        )
        try check(
            fixture.done.wait(timeout: .now() + 3) == .success,
            "\(name) loader-race fixture did not finish"
        )
        try check(
            try reviewedReadRejectionCode(result) == "target-unproven",
            "\(name) loader race was not rejected"
        )
        try check(
            fixture.trace.methods.contains("Runtime.evaluate") == evaluated,
            "\(name) loader race crossed the wrong evaluation boundary"
        )
    }
}

private func confidentialReviewedReadMasksEvaluationFailures() throws {
    for (name, contextID, evaluation, expectedCode) in [
        (
            "missing context",
            nil,
            ConfidentialReviewedReadEvaluation.success(["rows": 7]),
            "isolated-world-unavailable"
        ),
        (
            "stale context",
            71,
            ConfidentialReviewedReadEvaluation.exception,
            "evaluation-failed"
        ),
    ] {
        let fixture = try startConfidentialWebSocketFixture(
            rootFrameLoaderIDs: ["loader-1", "loader-1", "loader-1"],
            reviewedReadContextID: contextID,
            reviewedReadEvaluation: evaluation
        )
        let result = ConfidentialFieldDeliveryProcess.readReviewedForTesting(
            requestData: try reviewedReadRequest(fixture: fixture)
        )
        try check(
            fixture.done.wait(timeout: .now() + 3) == .success,
            "\(name) reviewed-read fixture did not finish"
        )
        try check(
            try reviewedReadRejectionCode(result) == expectedCode,
            "\(name) reviewed-read failure was misclassified"
        )
    }
}

private func confidentialReviewedReadRejectsInvalidResults() throws {
    for evaluation in [
        ConfidentialReviewedReadEvaluation.invalid,
        .success(String(repeating: "x", count: 40_000)),
    ] {
        let fixture = try startConfidentialWebSocketFixture(
            rootFrameLoaderIDs: ["loader-1", "loader-1", "loader-1"],
            reviewedReadEvaluation: evaluation
        )
        let result = ConfidentialFieldDeliveryProcess.readReviewedForTesting(
            requestData: try reviewedReadRequest(fixture: fixture)
        )
        try check(
            fixture.done.wait(timeout: .now() + 3) == .success,
            "invalid reviewed-read result fixture did not finish"
        )
        try check(
            try reviewedReadRejectionCode(result) == "result-invalid",
            "invalid or oversized reviewed-read result was admitted"
        )
    }
}

private func confidentialReviewedReadRejectsEditedScripts() throws {
    let fixture = try startConfidentialWebSocketFixture()
    let result = ConfidentialFieldDeliveryProcess.readReviewedForTesting(
        requestData: try reviewedReadRequest(
            fixture: fixture,
            scriptDigest: String(repeating: "0", count: 64)
        ),
        timeoutMilliseconds: 100
    )
    try check(
        try reviewedReadRejectionCode(result) == "invalid-request",
        "edited reviewed-read script was admitted"
    )
    try check(
        fixture.trace.methods.isEmpty,
        "edited reviewed-read script reached CDP"
    )
}

private func confidentialReviewedReadCLIRejectsInvalidInput() throws {
    let executable = URL(fileURLWithPath: CommandLine.arguments[0])
        .deletingLastPathComponent()
        .appendingPathComponent("browser-use-confidential-delivery")
    let input = Pipe()
    let output = Pipe()
    let process = Process()
    process.executableURL = executable
    process.arguments = ["read-reviewed"]
    process.environment = [
        "LANG": "C.UTF-8",
        "PATH": "/usr/bin:/bin",
    ]
    process.standardInput = input
    process.standardOutput = output
    process.standardError = Pipe()
    try process.run()
    input.fileHandleForWriting.write(Data("{}".utf8))
    try input.fileHandleForWriting.close()
    process.waitUntilExit()
    let result = output.fileHandleForReading.readDataToEndOfFile()
    try check(
        process.terminationStatus == 20
            && (try reviewedReadRejectionCode(result))
                == "invalid-request",
        "read-reviewed CLI did not expose its closed failure contract"
    )
}

private func confidentialTargetProofRejectsUntrustedRequests() throws {
    for request in [
        [
            "schema_version": 1,
            "browser_ws_endpoint":
                "ws://localhost:9222/devtools/browser/browser-id",
            "browser_pid": Int(getpid()),
            "target_id": "target-1",
        ],
        [
            "schema_version": 1,
            "browser_ws_endpoint":
                "ws://127.0.0.1:9222/devtools/browser/browser-id",
            "browser_pid": Int(getpid()),
            "target_id": "target-1",
            "unexpected": "field",
        ],
    ] {
        let result = ConfidentialFieldDeliveryProcess.proveTargetForTesting(
            requestData: try JSONSerialization.data(
                withJSONObject: request,
                options: [.sortedKeys]
            ),
            timeoutMilliseconds: 100
        )
        guard let envelope = try JSONSerialization.jsonObject(with: result)
            as? [String: Any],
            Set(envelope.keys) == ["schema_version", "ok", "rejection"],
            envelope["schema_version"] as? Int == 1,
            envelope["ok"] as? Bool == false,
            let rejection = envelope["rejection"] as? [String: Any],
            Set(rejection.keys) == ["code", "message"],
            rejection["code"] as? String == "invalid-request"
        else {
            throw TestFailure(
                description: "untrusted target proof request did not fail closed"
            )
        }
    }
}

private func confidentialChromeExecutablePathRejectsLookalike() throws {
    try check(
        ConfidentialFieldDeliveryProcess
            .acceptsChromeExecutablePathForTesting(
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
            ),
        "canonical Chrome path was rejected"
    )
    try check(
        !ConfidentialFieldDeliveryProcess
            .acceptsChromeExecutablePathForTesting(
                "/Users/attacker/com.google.Chrome.code_sign_clone/fake/Google Chrome.app.bundle/Contents/MacOS/Google Chrome"
            ),
        "user-created Chrome lookalike path was admitted"
    )
}

@main
enum BrowserUseEnvironmentAuthTests {
    static func main() throws {
        if CommandLine.arguments.dropFirst() == ["--hidden-terminal-reader"] {
            let probe = Darwin.open(
                "/dev/tty",
                O_RDWR | O_CLOEXEC | O_NOCTTY
            )
            guard probe >= 0 else { _exit(100 + errno) }
            _ = Darwin.close(probe)
            do {
                let input = try TokenCustodyHiddenTerminal.read()
                _exit(
                    input == Array(hiddenTerminalSentinel.utf8)
                        ? EXIT_SUCCESS
                        : 71
                )
            } catch {
                _exit(errno == 0 ? 72 : errno)
            }
        }
        if CommandLine.arguments.dropFirst()
            == ["--hidden-terminal-timeout-reader"]
        {
            do {
                _ =
                    try TokenCustodyHiddenTerminal
                        .readStandardInputForTesting(
                            timeoutSeconds: 1
                        )
                _exit(71)
            } catch TokenCustodyCause.inputCancelled {
                _exit(EXIT_SUCCESS)
            } catch {
                _exit(72)
            }
        }
        if CommandLine.arguments.dropFirst() == ["--hidden-terminal-tests"] {
            for (name, test) in [
                (
                    "hidden terminal prompts before reading without echo",
                    hiddenTerminalPromptsBeforeReadingAndNeverEchoesInput
                ),
                (
                    "hidden terminal restores echo before signal termination",
                    hiddenTerminalRestoresEchoBeforeSignalTermination
                ),
                (
                    "hidden terminal alarm returns typed cancellation",
                    hiddenTerminalAlarmReturnsTypedCancellation
                ),
            ] {
                do {
                    try test()
                    print("pass: \(name)")
                } catch let skip as TestSkip {
                    print("skip: \(name): \(skip.description)")
                }
            }
            return
        }
        if CommandLine.arguments.dropFirst()
            == ["--validator-timeout-typing-test"]
        {
            try validatorExecutionTimeoutRemainsTyped()
            print("pass: validator execution timeout remains typed")
            return
        }
        if CommandLine.arguments.dropFirst()
            == ["--validator-identity-scope-typing-test"]
        {
            try environmentOpValidatorReturnsTypedIdentityAndScope()
            print("pass: validator identity and scope remain typed")
            return
        }
        if CommandLine.arguments.dropFirst()
            == ["--vault-scope-repair-routing-test"]
        {
            try tokenCustodyRoutesVaultScopeRepair()
            print("pass: invalid vault scope routes to vault grant repair")
            return
        }
        if CommandLine.arguments.dropFirst()
            == ["--validator-cold-service-account-test"]
        {
            try environmentOpValidatorAllowsBoundedColdServiceAccount()
            print("pass: validator allows bounded cold service account")
            return
        }
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
                "hidden terminal prompts before reading without echo",
                hiddenTerminalPromptsBeforeReadingAndNeverEchoesInput
            ),
            (
                "hidden terminal restores echo before signal termination",
                hiddenTerminalRestoresEchoBeforeSignalTermination
            ),
            (
                "hidden terminal alarm returns typed cancellation",
                hiddenTerminalAlarmReturnsTypedCancellation
            ),
            (
                "rejecting backup proof blocks before publish",
                rejectingBackupProofBlocksBeforePublish
            ),
            (
                "validator timeout cleans staging",
                validatorTimeoutCleansStagingPath
            ),
            (
                "validator execution timeout remains typed",
                validatorExecutionTimeoutRemainsTyped
            ),
            (
                "custody deadline contains legal validator work",
                validatorBudgetContainsLegalDownstreamWork
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
                "environment OP trusted Homebrew symlink passes",
                environmentOpTrustedHomebrewSymlinkPasses
            ),
            (
                "environment OP hostile symlink shapes block",
                environmentOpHostileSymlinkShapesBlock
            ),
            (
                "environment OP changed link and staged bytes block",
                environmentOpChangedLinkAndStagedBytesBlock
            ),
            (
                "environment OP digest and version mismatch block",
                environmentOpDigestAndVersionMismatchBlock
            ),
            (
                "installed official environment OP passes pinned identity",
                installedOfficialEnvironmentOpPassesPinnedIdentity
            ),
            (
                "environment OP supervisor admission surface aligns",
                environmentOpSupervisorAdmissionSurfaceAligns
            ),
            (
                "environment OP validator uses received descriptor",
                environmentOpValidatorUsesReceivedDescriptor
            ),
            (
                "environment OP validator returns typed identity and scope",
                environmentOpValidatorReturnsTypedIdentityAndScope
            ),
            (
                "invalid vault scope routes to vault grant repair",
                tokenCustodyRoutesVaultScopeRepair
            ),
            (
                "environment OP validator allows bounded cold service account",
                environmentOpValidatorAllowsBoundedColdServiceAccount
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
            (
                "confidential delivery helper is packaged",
                confidentialDeliveryHelperIsPackaged
            ),
            (
                "confidential delivery helper writes one semantic field",
                confidentialDeliveryHelperWritesOneSemanticField
            ),
            (
                "confidential delivery helper rejects non-unique field before credential read",
                confidentialDeliveryHelperRejectsNonUniqueFieldBeforeCredentialRead
            ),
            (
                "confidential delivery helper classifies target drift and unknown write",
                confidentialDeliveryHelperClassifiesTargetDriftAndUnknownWrite
            ),
            (
                "environment OP private pipe feeds only native writer",
                environmentOpPrivatePipeFeedsOnlyNativeWriter
            ),
            (
                "confidential private mode owns attached page websocket",
                confidentialPrivateModeOwnsAttachedPageWebSocket
            ),
            (
                "confidential private mode rejects mismatched browser pid",
                confidentialPrivateModeRejectsMismatchedBrowserPID
            ),
            (
                "confidential target proof derives closed native observation",
                confidentialTargetProofDerivesClosedNativeObservation
            ),
            (
                "confidential target proof binds root document identity",
                confidentialTargetProofBindsRootDocumentIdentity
            ),
            (
                "confidential target proof rejects invalid document identity",
                confidentialTargetProofRejectsMissingOrInvalidDocumentIdentity
            ),
            (
                "confidential reviewed read is document-bound and closed",
                confidentialReviewedReadIsDocumentBoundAndClosed
            ),
            (
                "confidential reviewed read seals navigation history",
                confidentialReviewedReadSealsNavigationHistory
            ),
            (
                "confidential reviewed read rejects unsealed history",
                confidentialReviewedReadRejectsUnsealedHistory
            ),
            (
                "confidential reviewed read rejects history seal races",
                confidentialReviewedReadRejectsHistorySealRaces
            ),
            (
                "confidential reviewed read rejects stale target digest",
                confidentialReviewedReadRejectsStaleTargetProofDigest
            ),
            (
                "confidential reviewed read rejects document races",
                confidentialReviewedReadRejectsDocumentRaces
            ),
            (
                "confidential reviewed read masks evaluation failures",
                confidentialReviewedReadMasksEvaluationFailures
            ),
            (
                "confidential reviewed read rejects invalid results",
                confidentialReviewedReadRejectsInvalidResults
            ),
            (
                "confidential reviewed read rejects edited scripts",
                confidentialReviewedReadRejectsEditedScripts
            ),
            (
                "confidential reviewed read CLI rejects invalid input",
                confidentialReviewedReadCLIRejectsInvalidInput
            ),
            (
                "confidential target proof rejects untrusted requests",
                confidentialTargetProofRejectsUntrustedRequests
            ),
            (
                "confidential chrome path rejects lookalike",
                confidentialChromeExecutablePathRejectsLookalike
            ),
        ]
        for (name, test) in tests {
            do {
                try test()
                print("pass: \(name)")
            } catch let skip as TestSkip {
                print("skip: \(name): \(skip.description)")
            }
        }
    }
}
