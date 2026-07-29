import Darwin
import CoreFoundation
import CryptoKit
import Foundation

@_silgen_name("fork")
private func opFork() -> pid_t

nonisolated(unsafe) private var activeEnvironmentOpProcessGroup: pid_t = 0

private func environmentOpParentSignalHandler(_ signal: Int32) {
    let group = activeEnvironmentOpProcessGroup
    if group > 0 {
        _ = kill(-group, SIGKILL)
        _ = kill(group, SIGKILL)
    }
    _exit(128 + signal)
}

public enum EnvironmentOpAdmissionCause: String, Codable, Error, Sendable {
    case pathNotAbsolute = "op-path-not-absolute"
    case pathUnapproved = "op-path-unapproved"
    case pathUnavailable = "op-path-unavailable"
    case pathUnsafe = "op-path-unsafe"
    case pathNotExecutable = "op-path-not-executable"
    case binaryUntrusted = "op-binary-untrusted"
    case stagingFailed = "op-staging-failed"
    case versionInvalid = "op-version-invalid"
    case versionUnsupported = "op-version-unsupported"
}

private struct StagedEnvironmentOp {
    let directory: String
    let executablePath: String
    let expectedVersion: String
}

private let officialEnvironmentOpPaths = [
    "/opt/homebrew/bin/op",
    "/usr/local/bin/op",
]

private let officialEnvironmentOpDigests = [
    // 1Password CLI 2.35.0, Darwin arm64. Update only from the pinned
    // Homebrew cask artifact after recording its exact extracted binary hash.
    "1b55776253466a73af55403f1496d85c30ea201e250e89ee01af0c7a59d2f0f6":
        "2.35.0",
]

private func stringBeforeNull(_ bytes: [CChar]) -> String {
    let end = bytes.firstIndex(of: 0) ?? bytes.endIndex
    return String(
        decoding: bytes[..<end].map { UInt8(bitPattern: $0) },
        as: UTF8.self
    )
}

private func environmentOpDigest(_ path: String) -> String? {
    guard let data = try? Data(
        contentsOf: URL(fileURLWithPath: path),
        options: [.mappedIfSafe]
    ) else {
        return nil
    }
    return SHA256.hash(data: data)
        .map { String(format: "%02x", $0) }
        .joined()
}

private func privateEnvironmentOpStagingRoot() -> String? {
    let size = confstr(_CS_DARWIN_USER_TEMP_DIR, nil, 0)
    guard size > 0 else { return nil }
    var buffer = [CChar](repeating: 0, count: size)
    guard confstr(_CS_DARWIN_USER_TEMP_DIR, &buffer, size) == size else {
        return nil
    }
    let path = stringBeforeNull(buffer)
    return path.isEmpty ? nil : path
}

private func stageOfficialEnvironmentOp(
    _ requestedPath: String
) throws -> StagedEnvironmentOp {
    guard officialEnvironmentOpPaths.contains(requestedPath) else {
        throw EnvironmentOpAdmissionCause.pathUnapproved
    }
    let sourcePath = URL(fileURLWithPath: requestedPath)
        .resolvingSymlinksInPath()
        .path
    guard EnvironmentOpExecutableAdmission.proveExecutable(sourcePath) == nil else {
        throw EnvironmentOpAdmissionCause.pathUnavailable
    }
    guard let sourceDigest = environmentOpDigest(sourcePath),
          let expectedVersion = officialEnvironmentOpDigests[sourceDigest]
    else {
        throw EnvironmentOpAdmissionCause.binaryUntrusted
    }
    guard let base = privateEnvironmentOpStagingRoot() else {
        throw EnvironmentOpAdmissionCause.stagingFailed
    }
    let template = (base as NSString)
        .appendingPathComponent("browser-use-op-XXXXXXXX")
    var templateBytes = Array(template.utf8CString)
    guard mkdtemp(&templateBytes) != nil else {
        throw EnvironmentOpAdmissionCause.stagingFailed
    }
    let directory = stringBeforeNull(templateBytes)
    var directoryMetadata = stat()
    guard lstat(directory, &directoryMetadata) == 0,
          directoryMetadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
          directoryMetadata.st_mode & mode_t(0o777) == mode_t(0o700),
          directoryMetadata.st_uid == geteuid()
    else {
        try? FileManager.default.removeItem(atPath: directory)
        throw EnvironmentOpAdmissionCause.stagingFailed
    }
    let stagedPath = (directory as NSString).appendingPathComponent("op")
    guard copyfile(
        sourcePath,
        stagedPath,
        nil,
        copyfile_flags_t(COPYFILE_ALL)
    ) == 0,
        EnvironmentOpExecutableAdmission.proveExecutable(stagedPath) == nil,
        environmentOpDigest(stagedPath) == sourceDigest
    else {
        try? FileManager.default.removeItem(atPath: directory)
        throw EnvironmentOpAdmissionCause.binaryUntrusted
    }
    return StagedEnvironmentOp(
        directory: directory,
        executablePath: stagedPath,
        expectedVersion: expectedVersion
    )
}

public enum EnvironmentOpAdmissionResult: Equatable, Sendable {
    case admitted(path: String, version: String)
    case blocked(EnvironmentOpAdmissionCause)
}

public enum EnvironmentOpExecutableAdmission {
    private static let minimum = [2, 18, 0]

    public static func admit(
        executablePath: String,
        versionOutput: String
    ) -> EnvironmentOpAdmissionResult {
        guard executablePath.hasPrefix("/"), !executablePath.contains("\0") else {
            return .blocked(.pathNotAbsolute)
        }
        let trimmed = versionOutput.trimmingCharacters(in: .newlines)
        let parts = trimmed.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 3,
              parts.allSatisfy({ !$0.isEmpty && $0.allSatisfy(\.isNumber) }),
              let major = Int(parts[0]),
              let minor = Int(parts[1]),
              let patch = Int(parts[2])
        else {
            return .blocked(.versionInvalid)
        }
        let observed = [major, minor, patch]
        guard !observed.lexicographicallyPrecedes(minimum) else {
            return .blocked(.versionUnsupported)
        }
        return .admitted(
            path: executablePath,
            version: observed.map(String.init).joined(separator: ".")
        )
    }

    public static func proveExecutable(_ executablePath: String) -> EnvironmentOpAdmissionCause? {
        guard executablePath.hasPrefix("/"), !executablePath.contains("\0") else {
            return .pathNotAbsolute
        }
        var metadata = stat()
        guard lstat(executablePath, &metadata) == 0 else {
            return .pathUnavailable
        }
        guard metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              metadata.st_nlink == 1
        else {
            return .pathUnsafe
        }
        guard access(executablePath, X_OK) == 0 else {
            return .pathNotExecutable
        }
        return nil
    }
}

private struct EnvironmentOpExecutableIdentity: Equatable {
    let device: dev_t
    let inode: ino_t
    let size: off_t
    let modifiedSeconds: Int
    let modifiedNanoseconds: Int
}

private func environmentOpExecutableIdentity(
    _ executablePath: String
) -> EnvironmentOpExecutableIdentity? {
    guard EnvironmentOpExecutableAdmission.proveExecutable(executablePath) == nil else {
        return nil
    }
    var metadata = stat()
    guard lstat(executablePath, &metadata) == 0 else { return nil }
    return EnvironmentOpExecutableIdentity(
        device: metadata.st_dev,
        inode: metadata.st_ino,
        size: metadata.st_size,
        modifiedSeconds: metadata.st_mtimespec.tv_sec,
        modifiedNanoseconds: metadata.st_mtimespec.tv_nsec
    )
}

public enum EnvironmentOpExecutionCause: String, Codable, Error, Sendable {
    case executableUnavailable = "op-executable-unavailable"
    case tokenInvalid = "token-invalid"
    case timeout
    case outputTooLarge = "output-too-large"
    case processFailed = "process-failed"
    case processSignalled = "process-signalled"
    case ioFailure = "io-failure"
    case outputShapeInvalid = "output-shape-invalid"
    case itemMissing = "item-missing"
    case validatorProtocolInvalid = "validator-protocol-invalid"
}

public struct EnvironmentOpProcessOutput: Equatable, Sendable {
    public let stdout: [UInt8]
    public let stderrByteCount: Int
    public let exitCode: Int32

    public init(stdout: [UInt8], stderrByteCount: Int, exitCode: Int32) {
        self.stdout = stdout
        self.stderrByteCount = stderrByteCount
        self.exitCode = exitCode
    }
}

public enum EnvironmentOpProcessResult: Equatable, Sendable {
    case success(EnvironmentOpProcessOutput)
    case blocked(EnvironmentOpExecutionCause)
}

private func opMonotonicMilliseconds() -> Int64 {
    var value = timespec()
    guard clock_gettime(CLOCK_MONOTONIC, &value) == 0 else { return 0 }
    return Int64(value.tv_sec) * 1_000 + Int64(value.tv_nsec) / 1_000_000
}

private func closeOpDescriptor(_ descriptor: Int32) {
    if descriptor >= 0 {
        _ = Darwin.close(descriptor)
    }
}

private func childExit(_ code: Int32) -> Never {
    _exit(code)
}

private func closeUnrelatedChildDescriptors() {
    let observed = sysconf(_SC_OPEN_MAX)
    let maximum = observed > 0 ? min(observed, Int(Int32.max)) : 1_024
    for descriptor in 3..<Int32(maximum) {
        _ = Darwin.close(descriptor)
    }
}

private func readChildToken(_ descriptor: Int32) -> [UInt8]? {
    var token: [UInt8] = []
    var buffer = [UInt8](repeating: 0, count: 4_096)
    defer {
        _ = buffer.withUnsafeMutableBytes {
            $0.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }
    var offset: off_t = 0
    while true {
        let capacity = buffer.count
        let count = buffer.withUnsafeMutableBytes {
            pread(descriptor, $0.baseAddress, capacity, offset)
        }
        if count == 0 { break }
        guard count > 0, token.count + count <= 65_536 else { return nil }
        token.append(contentsOf: buffer.prefix(count))
        offset += off_t(count)
    }
    guard !token.isEmpty,
          !token.contains(0),
          !token.contains(10),
          !token.contains(13),
          String(bytes: token, encoding: .utf8) != nil
    else {
        _ = token.withUnsafeMutableBytes {
            $0.initializeMemory(as: UInt8.self, repeating: 0)
        }
        return nil
    }
    return token
}

private struct EnvironmentTokenDescriptorIdentity: Equatable {
    let device: dev_t
    let inode: ino_t
    let size: off_t
    let changedSeconds: Int
    let changedNanoseconds: Int
    let modifiedSeconds: Int
    let modifiedNanoseconds: Int
}

private func environmentTokenDescriptorIdentity(
    _ descriptor: Int32
) -> EnvironmentTokenDescriptorIdentity? {
    guard proveEnvironmentTokenDescriptor(descriptor) else { return nil }
    var metadata = stat()
    guard fstat(descriptor, &metadata) == 0,
          metadata.st_size > 0,
          metadata.st_size <= 65_536
    else {
        return nil
    }
    return EnvironmentTokenDescriptorIdentity(
        device: metadata.st_dev,
        inode: metadata.st_ino,
        size: metadata.st_size,
        changedSeconds: metadata.st_ctimespec.tv_sec,
        changedNanoseconds: metadata.st_ctimespec.tv_nsec,
        modifiedSeconds: metadata.st_mtimespec.tv_sec,
        modifiedNanoseconds: metadata.st_mtimespec.tv_nsec
    )
}

/// Copy token custody through the kernel into one unlinked descriptor.
///
/// The supervisor handles descriptors and metadata only. Token bytes never
/// enter its address space. Every OP child in a binding proof reads the same
/// immutable-by-unreachability snapshot, so an in-place source-file ABA cannot
/// compose evidence from different principals.
private func snapshotEnvironmentTokenDescriptor(
    _ sourceDescriptor: Int32,
    absoluteDeadlineMilliseconds: Int64
) -> Result<Int32, EnvironmentOpExecutionCause> {
    guard opMonotonicMilliseconds() < absoluteDeadlineMilliseconds else {
        return .failure(.timeout)
    }
    guard let sourceIdentity = environmentTokenDescriptorIdentity(sourceDescriptor),
          let base = privateEnvironmentOpStagingRoot()
    else {
        return .failure(.tokenInvalid)
    }
    let template = (base as NSString)
        .appendingPathComponent("browser-use-token-snapshot.XXXXXXXX")
    var templateBytes = Array(template.utf8CString)
    var writerDescriptor = mkstemp(&templateBytes)
    guard writerDescriptor >= 0 else {
        return .failure(.ioFailure)
    }
    let snapshotPath = stringBeforeNull(templateBytes)
    var readerDescriptor: Int32 = -1
    var unlinked = false
    defer {
        if writerDescriptor >= 0 { closeOpDescriptor(writerDescriptor) }
        if readerDescriptor >= 0 { closeOpDescriptor(readerDescriptor) }
        if !unlinked { _ = unlink(snapshotPath) }
    }
    guard fcopyfile(
        sourceDescriptor,
        writerDescriptor,
        nil,
        copyfile_flags_t(COPYFILE_DATA)
    ) == 0
    else {
        return .failure(.tokenInvalid)
    }
    guard opMonotonicMilliseconds() < absoluteDeadlineMilliseconds else {
        return .failure(.timeout)
    }
    guard
        environmentTokenDescriptorIdentity(sourceDescriptor) == sourceIdentity,
        fchmod(writerDescriptor, mode_t(0o400)) == 0
    else {
        return .failure(.tokenInvalid)
    }
    guard fsync(writerDescriptor) == 0 else {
        return .failure(.tokenInvalid)
    }
    guard opMonotonicMilliseconds() < absoluteDeadlineMilliseconds else {
        return .failure(.timeout)
    }
    readerDescriptor = Darwin.open(
        snapshotPath,
        O_RDONLY | O_NOFOLLOW | O_CLOEXEC
    )
    var writerMetadata = stat()
    var readerMetadata = stat()
    guard readerDescriptor >= 0,
          fstat(writerDescriptor, &writerMetadata) == 0,
          fstat(readerDescriptor, &readerMetadata) == 0,
          writerMetadata.st_dev == readerMetadata.st_dev,
          writerMetadata.st_ino == readerMetadata.st_ino,
          readerMetadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
          readerMetadata.st_mode & mode_t(0o777) == mode_t(0o400),
          readerMetadata.st_uid == geteuid(),
          readerMetadata.st_nlink == 1,
          readerMetadata.st_size == sourceIdentity.size,
          unlink(snapshotPath) == 0
    else {
        return .failure(.tokenInvalid)
    }
    unlinked = true
    closeOpDescriptor(writerDescriptor)
    writerDescriptor = -1
    guard opMonotonicMilliseconds() < absoluteDeadlineMilliseconds else {
        return .failure(.timeout)
    }
    var unlinkedMetadata = stat()
    guard fstat(readerDescriptor, &unlinkedMetadata) == 0,
          unlinkedMetadata.st_nlink == 0,
          lseek(readerDescriptor, 0, SEEK_SET) == 0
    else {
        return .failure(.tokenInvalid)
    }
    let admittedDescriptor = readerDescriptor
    readerDescriptor = -1
    return .success(admittedDescriptor)
}

private func execExact(
    executablePath: String,
    arguments: [String],
    environment: [String]
) -> Never {
    var argv: [UnsafeMutablePointer<CChar>?] =
        ([executablePath] + arguments).map { strdup($0) }
    argv.append(nil)
    var envp: [UnsafeMutablePointer<CChar>?] = environment.map { strdup($0) }
    envp.append(nil)
    executablePath.withCString { path in
        argv.withUnsafeMutableBufferPointer { argvBuffer in
            envp.withUnsafeMutableBufferPointer { envBuffer in
                _ = execve(path, argvBuffer.baseAddress, envBuffer.baseAddress)
            }
        }
    }
    for pointer in argv.compactMap({ $0 }) { free(pointer) }
    for pointer in envp.compactMap({ $0 }) { free(pointer) }
    childExit(126)
}

private func opChild(
    executablePath: String,
    arguments: [String],
    tokenDescriptor: Int32?,
    stdoutWrite: Int32,
    stderrWrite: Int32,
    stdoutRead: Int32,
    stderrRead: Int32,
    inheritedSignalMask: sigset_t
) -> Never {
    guard setpgid(0, 0) == 0 else {
        childExit(125)
    }
    var childSignalMask = inheritedSignalMask
    guard pthread_sigmask(SIG_SETMASK, &childSignalMask, nil) == 0 else {
        childExit(125)
    }
    closeOpDescriptor(stdoutRead)
    closeOpDescriptor(stderrRead)
    let nullInput = Darwin.open("/dev/null", O_RDONLY | O_CLOEXEC)
    guard nullInput >= 0, dup2(nullInput, STDIN_FILENO) >= 0 else {
        childExit(125)
    }
    closeOpDescriptor(nullInput)
    guard dup2(stdoutWrite, STDOUT_FILENO) >= 0,
          dup2(stderrWrite, STDERR_FILENO) >= 0
    else {
        childExit(125)
    }
    closeOpDescriptor(stdoutWrite)
    closeOpDescriptor(stderrWrite)

    var zeroLimit = rlimit(rlim_cur: 0, rlim_max: 0)
    guard setrlimit(RLIMIT_CORE, &zeroLimit) == 0 else {
        childExit(125)
    }

    var environment = [
        "PATH=/usr/bin:/bin",
        "LANG=C.UTF-8",
    ]
    if let tokenDescriptor {
        guard var admitted = readChildToken(tokenDescriptor),
              let tokenValue = String(bytes: admitted, encoding: .utf8)
        else {
            childExit(124)
        }
        environment.append("OP_SERVICE_ACCOUNT_TOKEN=\(tokenValue)")
        _ = admitted.withUnsafeMutableBytes {
            $0.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }
    closeUnrelatedChildDescriptors()
    execExact(
        executablePath: executablePath,
        arguments: arguments,
        environment: environment
    )
}

private func terminateEnvironmentOpGroup(
    child: pid_t,
    status: inout Int32,
    reapChild: Bool
) {
    _ = kill(-child, SIGKILL)
    if reapChild {
        _ = kill(child, SIGKILL)
        while waitpid(child, &status, 0) < 0, errno == EINTR {}
    }
    activeEnvironmentOpProcessGroup = 0
}

private func setNonBlocking(_ descriptor: Int32) -> Bool {
    let flags = fcntl(descriptor, F_GETFL)
    return flags >= 0 && fcntl(descriptor, F_SETFL, flags | O_NONBLOCK) == 0
}

private func drainDescriptor(
    _ descriptor: Int32,
    bytes: inout [UInt8]?,
    count: inout Int,
    maximum: Int
) -> EnvironmentOpExecutionCause? {
    var buffer = [UInt8](repeating: 0, count: 4_096)
    while true {
        let capacity = buffer.count
        let received = buffer.withUnsafeMutableBytes {
            Darwin.read(descriptor, $0.baseAddress, capacity)
        }
        if received == 0 { return nil }
        if received < 0 {
            if errno == EINTR { continue }
            if errno == EAGAIN || errno == EWOULDBLOCK { return nil }
            return .ioFailure
        }
        count += received
        guard count <= maximum else { return .outputTooLarge }
        bytes?.append(contentsOf: buffer.prefix(received))
    }
}

/// Fork one token-reading child and execute OP with a closed, exact environment.
///
/// The calling supervisor never reads the token descriptor. Only the forked
/// child reads it, constructs the one token variable, closes unrelated file
/// descriptors, and immediately execs the admitted OP binary.
@_spi(Executor)
public enum EnvironmentOpProcessRunner {
    public static func run(
        executablePath: String,
        arguments: [String],
        tokenDescriptor: Int32?,
        timeoutMilliseconds: Int32 = 10_000,
        maximumStdoutBytes: Int = 262_144,
        maximumStderrBytes: Int = 65_536,
        absoluteDeadlineMilliseconds: Int64? = nil
    ) -> EnvironmentOpProcessResult {
        guard EnvironmentOpExecutableAdmission.proveExecutable(executablePath) == nil,
              timeoutMilliseconds > 0,
              maximumStdoutBytes > 0,
              maximumStderrBytes > 0
        else {
            return .blocked(.executableUnavailable)
        }
        let startedAt = opMonotonicMilliseconds()
        let deadline = min(
            absoluteDeadlineMilliseconds ?? Int64.max,
            startedAt + Int64(timeoutMilliseconds)
        )
        guard deadline > startedAt else {
            return .blocked(.timeout)
        }
        var stdoutPipe: [Int32] = [-1, -1]
        var stderrPipe: [Int32] = [-1, -1]
        guard pipe(&stdoutPipe) == 0, pipe(&stderrPipe) == 0 else {
            closeOpDescriptor(stdoutPipe[0])
            closeOpDescriptor(stdoutPipe[1])
            closeOpDescriptor(stderrPipe[0])
            closeOpDescriptor(stderrPipe[1])
            return .blocked(.ioFailure)
        }
        var handledSignals = sigset_t()
        sigemptyset(&handledSignals)
        sigaddset(&handledSignals, SIGTERM)
        sigaddset(&handledSignals, SIGINT)
        sigaddset(&handledSignals, SIGHUP)
        var inheritedSignalMask = sigset_t()
        guard pthread_sigmask(
            SIG_BLOCK,
            &handledSignals,
            &inheritedSignalMask
        ) == 0 else {
            stdoutPipe.forEach(closeOpDescriptor)
            stderrPipe.forEach(closeOpDescriptor)
            return .blocked(.ioFailure)
        }
        _ = signal(SIGTERM, environmentOpParentSignalHandler)
        _ = signal(SIGINT, environmentOpParentSignalHandler)
        _ = signal(SIGHUP, environmentOpParentSignalHandler)
        let child = opFork()
        guard child >= 0 else {
            _ = pthread_sigmask(SIG_SETMASK, &inheritedSignalMask, nil)
            stdoutPipe.forEach(closeOpDescriptor)
            stderrPipe.forEach(closeOpDescriptor)
            return .blocked(.ioFailure)
        }
        if child == 0 {
            opChild(
                executablePath: executablePath,
                arguments: arguments,
                tokenDescriptor: tokenDescriptor,
                stdoutWrite: stdoutPipe[1],
                stderrWrite: stderrPipe[1],
                stdoutRead: stdoutPipe[0],
                stderrRead: stderrPipe[0],
                inheritedSignalMask: inheritedSignalMask
            )
        }
        _ = setpgid(child, child)
        activeEnvironmentOpProcessGroup = child
        guard pthread_sigmask(
            SIG_SETMASK,
            &inheritedSignalMask,
            nil
        ) == 0 else {
            var status: Int32 = 0
            terminateEnvironmentOpGroup(
                child: child,
                status: &status,
                reapChild: true
            )
            stdoutPipe.forEach(closeOpDescriptor)
            stderrPipe.forEach(closeOpDescriptor)
            return .blocked(.ioFailure)
        }

        closeOpDescriptor(stdoutPipe[1])
        closeOpDescriptor(stderrPipe[1])
        guard setNonBlocking(stdoutPipe[0]), setNonBlocking(stderrPipe[0]) else {
            var status: Int32 = 0
            terminateEnvironmentOpGroup(
                child: child,
                status: &status,
                reapChild: true
            )
            closeOpDescriptor(stdoutPipe[0])
            closeOpDescriptor(stderrPipe[0])
            return .blocked(.ioFailure)
        }
        defer {
            closeOpDescriptor(stdoutPipe[0])
            closeOpDescriptor(stderrPipe[0])
        }

        var stdout: [UInt8]? = []
        var discardedStderr: [UInt8]? = nil
        var stdoutCount = 0
        var stderrCount = 0
        var status: Int32 = 0
        while true {
            if opMonotonicMilliseconds() >= deadline {
                terminateEnvironmentOpGroup(
                    child: child,
                    status: &status,
                    reapChild: true
                )
                return .blocked(.timeout)
            }
            if let cause = drainDescriptor(
                stdoutPipe[0],
                bytes: &stdout,
                count: &stdoutCount,
                maximum: maximumStdoutBytes
            ) ?? drainDescriptor(
                stderrPipe[0],
                bytes: &discardedStderr,
                count: &stderrCount,
                maximum: maximumStderrBytes
            ) {
                terminateEnvironmentOpGroup(
                    child: child,
                    status: &status,
                    reapChild: true
                )
                return .blocked(cause)
            }

            let waited = waitpid(child, &status, WNOHANG)
            if waited == child {
                if let cause = drainDescriptor(
                    stdoutPipe[0],
                    bytes: &stdout,
                    count: &stdoutCount,
                    maximum: maximumStdoutBytes
                ) ?? drainDescriptor(
                    stderrPipe[0],
                    bytes: &discardedStderr,
                    count: &stderrCount,
                    maximum: maximumStderrBytes
                ) {
                    terminateEnvironmentOpGroup(
                        child: child,
                        status: &status,
                        reapChild: false
                    )
                    return .blocked(cause)
                }
                terminateEnvironmentOpGroup(
                    child: child,
                    status: &status,
                    reapChild: false
                )
                let signal = status & 0x7f
                guard signal == 0 else {
                    return .blocked(.processSignalled)
                }
                let exitCode = (status >> 8) & 0xff
                guard exitCode == 0 else {
                    return .blocked(exitCode == 124 ? .tokenInvalid : .processFailed)
                }
                return .success(
                    EnvironmentOpProcessOutput(
                        stdout: stdout ?? [],
                        stderrByteCount: stderrCount,
                        exitCode: exitCode
                    )
                )
            }
            if waited < 0 {
                if errno == EINTR { continue }
                terminateEnvironmentOpGroup(
                    child: child,
                    status: &status,
                    reapChild: true
                )
                return .blocked(.ioFailure)
            }
            if opMonotonicMilliseconds() >= deadline {
                terminateEnvironmentOpGroup(
                    child: child,
                    status: &status,
                    reapChild: true
                )
                return .blocked(.timeout)
            }
            var descriptors = [
                pollfd(fd: stdoutPipe[0], events: Int16(POLLIN), revents: 0),
                pollfd(fd: stderrPipe[0], events: Int16(POLLIN), revents: 0),
            ]
            _ = poll(&descriptors, 2, 20)
        }
    }
}

public enum EnvironmentOpMetadataOperation: Equatable, Sendable {
    case userGet
    case vaultList
    case itemList(vaultID: String)
    case itemGet(vaultID: String, itemID: String)
    case bindingEvidence(expectedVaultID: String?, itemID: String?)

    fileprivate var arguments: [String] {
        switch self {
        case .userGet:
            return ["user", "get", "--me", "--format=json"]
        case .vaultList:
            return ["vault", "list", "--format=json"]
        case let .itemList(vaultID):
            return [
                "item", "list", "--vault", vaultID,
                "--categories", "Login", "--format=json",
            ]
        case let .itemGet(vaultID, _):
            return [
                "item", "list", "--vault", vaultID,
                "--categories", "Login", "--format=json",
            ]
        case .bindingEvidence:
            return []
        }
    }
}

private func boundedString(_ value: Any?) -> String? {
    guard let value = value as? String,
          !value.isEmpty,
          value.utf8.count <= 256,
          !value.contains("\0"),
          !value.contains("\n"),
          !value.contains("\r"),
          !metadataStringIsSecretShaped(value)
    else {
        return nil
    }
    return value
}

private func metadataStringIsSecretShaped(_ value: String) -> Bool {
    let lowercased = value.lowercased()
    if lowercased.contains("op://")
        || lowercased.contains("ws://")
        || lowercased.contains("wss://")
        || lowercased.contains("otpauth://")
        || lowercased.contains("ops_")
    {
        return true
    }
    return value.range(
        of: #"\b[A-Z2-7]{32,}\b"#,
        options: [.regularExpression, .caseInsensitive]
    ) != nil
}

private func safeMetadataURL(_ value: Any?) -> String? {
    guard let raw = boundedString(value),
          var components = URLComponents(string: raw),
          ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
          components.host != nil,
          components.user == nil,
          components.password == nil,
          components.query == nil,
          components.fragment == nil
    else {
        return nil
    }
    components.scheme = components.scheme?.lowercased()
    components.host = components.host?.lowercased()
    components.path = "/"
    return components.url?.absoluteString
}

private func projectVault(_ raw: Any) -> [String: Any]? {
    guard let row = raw as? [String: Any],
          let id = boundedString(row["id"])
    else {
        return nil
    }
    return ["id": id]
}

private func projectItem(_ raw: Any) -> [String: Any]? {
    guard let row = raw as? [String: Any],
          let id = boundedString(row["id"]),
          let category = boundedString(row["category"]),
          let version = row["version"] as? NSNumber,
          CFGetTypeID(version) != CFBooleanGetTypeID(),
          version.int64Value > 0,
          NSNumber(value: version.int64Value) == version,
          let vault = row["vault"] as? [String: Any],
          let vaultID = boundedString(vault["id"])
    else {
        return nil
    }
    let rawURLs = row["urls"] as? [Any] ?? []
    var urls: [[String: String]] = []
    for rawURL in rawURLs {
        guard let url = rawURL as? [String: Any],
              let href = safeMetadataURL(url["href"])
        else {
            return nil
        }
        urls.append(["href": href])
    }
    var projected: [String: Any] = [
        "id": id,
        "version": version,
        "category": category,
        "vault": ["id": vaultID],
        "urls": urls,
    ]
    if let state = row["state"] {
        guard let boundedState = boundedString(state) else { return nil }
        projected["state"] = boundedState
    }
    return projected
}

private func projectMetadata(
    operation: EnvironmentOpMetadataOperation,
    bytes: [UInt8]
) -> Any? {
    guard let raw = try? JSONSerialization.jsonObject(with: Data(bytes)) else {
        return nil
    }
    switch operation {
    case .userGet:
        guard let row = raw as? [String: Any],
              let id = boundedString(row["id"]),
              let state = boundedString(row["state"]),
              let type = boundedString(row["type"])
        else {
            return nil
        }
        return ["id": id, "state": state, "type": type]
    case .vaultList:
        guard let rows = raw as? [Any] else { return nil }
        let projected = rows.compactMap(projectVault)
        return projected.count == rows.count ? projected : nil
    case .itemList:
        guard let rows = raw as? [Any] else { return nil }
        let projected = rows.compactMap(projectItem)
        return projected.count == rows.count ? projected : nil
    case .itemGet:
        return nil
    case .bindingEvidence:
        return nil
    }
}

private func envelope(
    value: Any? = nil,
    cause: EnvironmentOpExecutionCause? = nil
) -> Data {
    var object: [String: Any] = [
        "schema_version": 1,
        "ok": cause == nil,
    ]
    if let value {
        object["value"] = value
    }
    if let cause {
        object["rejection"] = [
            "code": cause.rawValue,
            "message": "native OP execution blocked; inspect the typed code and repair the local capability.",
        ]
    }
    return (try? JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys]
    )) ?? Data("{\"ok\":false,\"schema_version\":1}".utf8)
}

private func admissionEnvelope(_ cause: EnvironmentOpAdmissionCause) -> Data {
    let object: [String: Any] = [
        "schema_version": 1,
        "ok": false,
        "rejection": [
            "code": cause.rawValue,
            "message": "native OP executable admission blocked; repair the typed cause.",
        ],
    ]
    return (try? JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys]
    )) ?? Data("{\"ok\":false,\"schema_version\":1}".utf8)
}

@_spi(Executor)
public enum EnvironmentOpSupervisor {
    private static func projectedOperation(
        executablePath: String,
        operation: EnvironmentOpMetadataOperation,
        tokenDescriptor: Int32,
        timeoutMilliseconds: Int32,
        absoluteDeadlineMilliseconds: Int64? = nil
    ) -> Result<Any, EnvironmentOpExecutionCause> {
        switch EnvironmentOpProcessRunner.run(
            executablePath: executablePath,
            arguments: operation.arguments,
            tokenDescriptor: tokenDescriptor,
            timeoutMilliseconds: timeoutMilliseconds,
            absoluteDeadlineMilliseconds: absoluteDeadlineMilliseconds
        ) {
        case let .blocked(cause):
            return .failure(cause)
        case let .success(output):
            if case let .itemGet(vaultID, itemID) = operation {
                guard let raw = try? JSONSerialization.jsonObject(
                    with: Data(output.stdout)
                ) as? [Any]
                else {
                    return .failure(.outputShapeInvalid)
                }
                let projectedRows = raw.compactMap(projectItem)
                guard projectedRows.count == raw.count else {
                    return .failure(.outputShapeInvalid)
                }
                let matches = projectedRows.filter {
                    boundedString($0["id"]) == itemID
                }
                if matches.isEmpty {
                    return .failure(.itemMissing)
                }
                guard matches.count == 1,
                      let projected = matches.first,
                      let vault = projected["vault"] as? [String: Any],
                      boundedString(vault["id"]) == vaultID
                else {
                    return .failure(.outputShapeInvalid)
                }
                return .success(projected)
            }
            guard let projected = projectMetadata(
                operation: operation,
                bytes: output.stdout
            ) else {
                return .failure(.outputShapeInvalid)
            }
            return .success(projected)
        }
    }

    private static func executeBindingEvidence(
        executablePath: String,
        expectedVaultID: String?,
        itemID: String?,
        tokenDescriptor: Int32,
        timeoutMilliseconds: Int32
    ) -> Data {
        let deadline = opMonotonicMilliseconds() + Int64(timeoutMilliseconds)
        let snapshotDescriptor: Int32
        switch snapshotEnvironmentTokenDescriptor(
            tokenDescriptor,
            absoluteDeadlineMilliseconds: deadline
        ) {
        case let .success(descriptor):
            snapshotDescriptor = descriptor
        case let .failure(cause):
            return envelope(cause: cause)
        }
        defer { closeOpDescriptor(snapshotDescriptor) }
        guard opMonotonicMilliseconds() < deadline else {
            return envelope(cause: .timeout)
        }
        func remainingTimeout() -> Int32? {
            let remaining = deadline - opMonotonicMilliseconds()
            guard remaining > 0 else { return nil }
            return Int32(min(remaining, Int64(Int32.max)))
        }

        guard let identityTimeout = remainingTimeout() else {
            return envelope(cause: .timeout)
        }
        let identity: Any
        switch projectedOperation(
            executablePath: executablePath,
            operation: .userGet,
            tokenDescriptor: snapshotDescriptor,
            timeoutMilliseconds: identityTimeout,
            absoluteDeadlineMilliseconds: deadline
        ) {
        case let .success(value):
            guard opMonotonicMilliseconds() < deadline else {
                return envelope(cause: .timeout)
            }
            identity = value
        case let .failure(cause):
            return envelope(cause: cause)
        }

        guard let vaultTimeout = remainingTimeout() else {
            return envelope(cause: .timeout)
        }
        let vaults: [Any]
        switch projectedOperation(
            executablePath: executablePath,
            operation: .vaultList,
            tokenDescriptor: snapshotDescriptor,
            timeoutMilliseconds: vaultTimeout,
            absoluteDeadlineMilliseconds: deadline
        ) {
        case let .success(value):
            guard opMonotonicMilliseconds() < deadline else {
                return envelope(cause: .timeout)
            }
            guard let projectedVaults = value as? [Any] else {
                return envelope(cause: .outputShapeInvalid)
            }
            vaults = projectedVaults
        case let .failure(cause):
            return envelope(cause: cause)
        }

        var itemEvidence: Any = NSNull()
        if vaults.count == 1,
           let onlyVault = vaults[0] as? [String: Any],
           let liveVaultID = onlyVault["id"] as? String
        {
            if let expectedVaultID, expectedVaultID != liveVaultID {
                return envelope(value: [
                    "identity": identity,
                    "vaults": vaults,
                    "item_evidence": itemEvidence,
                ])
            }
            let itemOperation: EnvironmentOpMetadataOperation
            if let itemID {
                itemOperation = .itemGet(vaultID: liveVaultID, itemID: itemID)
            } else {
                itemOperation = .itemList(vaultID: liveVaultID)
            }
            guard let itemTimeout = remainingTimeout() else {
                return envelope(cause: .timeout)
            }
            switch projectedOperation(
                executablePath: executablePath,
                operation: itemOperation,
                tokenDescriptor: snapshotDescriptor,
                timeoutMilliseconds: itemTimeout,
                absoluteDeadlineMilliseconds: deadline
            ) {
            case let .success(value):
                guard opMonotonicMilliseconds() < deadline else {
                    return envelope(cause: .timeout)
                }
                itemEvidence = itemID == nil
                    ? ["kind": "list", "items": value]
                    : ["kind": "exact", "item": value]
            case let .failure(cause):
                return envelope(cause: cause)
            }
        }
        guard opMonotonicMilliseconds() < deadline else {
            return envelope(cause: .timeout)
        }
        return envelope(value: [
            "identity": identity,
            "vaults": vaults,
            "item_evidence": itemEvidence,
        ])
    }

    @_spi(Testing)
    public static func admitOfficialExecutableForTesting(
        executablePath: String
    ) -> EnvironmentOpAdmissionResult {
        let staged: StagedEnvironmentOp
        do {
            staged = try stageOfficialEnvironmentOp(executablePath)
        } catch let cause as EnvironmentOpAdmissionCause {
            return .blocked(cause)
        } catch {
            return .blocked(.stagingFailed)
        }
        defer { try? FileManager.default.removeItem(atPath: staged.directory) }
        let admission = admitExecutable(executablePath: staged.executablePath)
        guard case let .admitted(path, version) = admission,
              version == staged.expectedVersion
        else {
            return .blocked(.binaryUntrusted)
        }
        return .admitted(path: path, version: version)
    }

    private static func executeIdentityBoundMetadata(
        executablePath: String,
        operation: EnvironmentOpMetadataOperation,
        tokenDescriptor: Int32,
        timeoutMilliseconds: Int32,
        expectedVersion: String? = nil
    ) -> Data {
        guard let admittedIdentity = environmentOpExecutableIdentity(executablePath) else {
            return envelope(cause: .executableUnavailable)
        }
        switch admitExecutable(executablePath: executablePath) {
        case let .blocked(cause):
            return admissionEnvelope(cause)
        case let .admitted(_, version):
            guard expectedVersion == nil || version == expectedVersion else {
                return admissionEnvelope(.binaryUntrusted)
            }
        }
        guard environmentOpExecutableIdentity(executablePath) == admittedIdentity else {
            return envelope(cause: .executableUnavailable)
        }
        let result = executeMetadata(
            executablePath: executablePath,
            operation: operation,
            tokenDescriptor: tokenDescriptor,
            timeoutMilliseconds: timeoutMilliseconds
        )
        guard environmentOpExecutableIdentity(executablePath) == admittedIdentity else {
            return envelope(cause: .executableUnavailable)
        }
        return result
    }

    public static func executeAdmittedMetadata(
        executablePath: String,
        operation: EnvironmentOpMetadataOperation,
        tokenDescriptor: Int32,
        timeoutMilliseconds: Int32 = 10_000
    ) -> Data {
        let staged: StagedEnvironmentOp
        do {
            staged = try stageOfficialEnvironmentOp(executablePath)
        } catch let cause as EnvironmentOpAdmissionCause {
            return admissionEnvelope(cause)
        } catch {
            return admissionEnvelope(.stagingFailed)
        }
        defer { try? FileManager.default.removeItem(atPath: staged.directory) }
        return executeIdentityBoundMetadata(
            executablePath: staged.executablePath,
            operation: operation,
            tokenDescriptor: tokenDescriptor,
            timeoutMilliseconds: timeoutMilliseconds,
            expectedVersion: staged.expectedVersion
        )
    }

    @_spi(Testing)
    public static func executeIdentityBoundMetadataForTesting(
        executablePath: String,
        operation: EnvironmentOpMetadataOperation,
        tokenDescriptor: Int32,
        timeoutMilliseconds: Int32 = 10_000
    ) -> Data {
        executeIdentityBoundMetadata(
            executablePath: executablePath,
            operation: operation,
            tokenDescriptor: tokenDescriptor,
            timeoutMilliseconds: timeoutMilliseconds
        )
    }

    public static func executeMetadata(
        executablePath: String,
        operation: EnvironmentOpMetadataOperation,
        tokenDescriptor: Int32,
        timeoutMilliseconds: Int32 = 10_000
    ) -> Data {
        if case let .bindingEvidence(expectedVaultID, itemID) = operation {
            return executeBindingEvidence(
                executablePath: executablePath,
                expectedVaultID: expectedVaultID,
                itemID: itemID,
                tokenDescriptor: tokenDescriptor,
                timeoutMilliseconds: timeoutMilliseconds
            )
        }
        switch projectedOperation(
            executablePath: executablePath,
            operation: operation,
            tokenDescriptor: tokenDescriptor,
            timeoutMilliseconds: timeoutMilliseconds
        ) {
        case let .failure(cause):
            return envelope(cause: cause)
        case let .success(projected):
            return envelope(value: projected)
        }
    }

    public static func admitExecutable(
        executablePath: String
    ) -> EnvironmentOpAdmissionResult {
        if let cause = EnvironmentOpExecutableAdmission.proveExecutable(executablePath) {
            return .blocked(cause)
        }
        switch EnvironmentOpProcessRunner.run(
            executablePath: executablePath,
            arguments: ["--version"],
            tokenDescriptor: nil,
            timeoutMilliseconds: 2_000,
            maximumStdoutBytes: 128,
            maximumStderrBytes: 1_024
        ) {
        case .blocked:
            return .blocked(.versionInvalid)
        case let .success(output):
            guard let version = String(bytes: output.stdout, encoding: .utf8) else {
                return .blocked(.versionInvalid)
            }
            return EnvironmentOpExecutableAdmission.admit(
                executablePath: executablePath,
                versionOutput: version
            )
        }
    }

    public static func receiveTokenDescriptor(
        socket: Int32,
        timeoutMilliseconds: Int32 = 5_000
    ) throws -> Int32 {
        var polled = pollfd(fd: socket, events: Int16(POLLIN), revents: 0)
        guard poll(&polled, 1, timeoutMilliseconds) == 1,
              polled.revents & Int16(POLLIN) != 0
        else {
            throw EnvironmentOpExecutionCause.timeout
        }
        let headerSize = (MemoryLayout<cmsghdr>.size
            + MemoryLayout<cmsghdr>.alignment - 1)
            & ~(MemoryLayout<cmsghdr>.alignment - 1)
        let controlSize = headerSize
            + ((MemoryLayout<Int32>.size + MemoryLayout<cmsghdr>.alignment - 1)
                & ~(MemoryLayout<cmsghdr>.alignment - 1))
        var payload = [UInt8](repeating: 0, count: 64)
        var control = [UInt8](repeating: 0, count: controlSize)
        var receivedFlags: Int32 = 0
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
                    let result = recvmsg(socket, &message, 0)
                    receivedFlags = message.msg_flags
                    return result
                }
            }
        }
        guard received == "browser-use-token-validator/v2\n".utf8.count,
              payload.prefix(received).elementsEqual(
                  "browser-use-token-validator/v2\n".utf8
              ),
              receivedFlags & MSG_CTRUNC == 0
        else {
            throw EnvironmentOpExecutionCause.validatorProtocolInvalid
        }
        let descriptor = control.withUnsafeBytes { bytes -> Int32? in
            guard let base = bytes.baseAddress else { return nil }
            let header = base.assumingMemoryBound(to: cmsghdr.self).pointee
            guard header.cmsg_level == SOL_SOCKET,
                  header.cmsg_type == SCM_RIGHTS,
                  Int(header.cmsg_len) == headerSize + MemoryLayout<Int32>.size
            else {
                return nil
            }
            return base.advanced(by: headerSize)
                .assumingMemoryBound(to: Int32.self)
                .pointee
        }
        guard let descriptor,
              fcntl(descriptor, F_SETFD, FD_CLOEXEC) == 0,
              proveEnvironmentTokenDescriptor(descriptor)
        else {
            if let descriptor { closeOpDescriptor(descriptor) }
            throw EnvironmentOpExecutionCause.validatorProtocolInvalid
        }
        return descriptor
    }

    public static func validateStagedToken(
        executablePath: String,
        tokenDescriptor: Int32
    ) -> Bool {
        guard let staged = try? stageOfficialEnvironmentOp(executablePath) else {
            return false
        }
        defer { try? FileManager.default.removeItem(atPath: staged.directory) }
        return validateTokenUsingExecutable(
            staged.executablePath,
            tokenDescriptor: tokenDescriptor,
            expectedVersion: staged.expectedVersion
        )
    }

    @_spi(Testing)
    public static func validateStagedTokenForTesting(
        executablePath: String,
        tokenDescriptor: Int32
    ) -> Bool {
        validateTokenUsingExecutable(
            executablePath,
            tokenDescriptor: tokenDescriptor
        )
    }

    private static func validateTokenUsingExecutable(
        _ executablePath: String,
        tokenDescriptor: Int32,
        expectedVersion: String? = nil
    ) -> Bool {
        guard let admittedIdentity = environmentOpExecutableIdentity(
                  executablePath
              ),
              case let .admitted(_, version) = admitExecutable(
                  executablePath: executablePath
              ),
              expectedVersion == nil || version == expectedVersion,
              environmentOpExecutableIdentity(executablePath)
                == admittedIdentity
        else {
            return false
        }
        let user = executeMetadata(
            executablePath: executablePath,
            operation: .userGet,
            tokenDescriptor: tokenDescriptor,
            timeoutMilliseconds: 5_000
        )
        guard environmentOpExecutableIdentity(executablePath)
            == admittedIdentity
        else {
            return false
        }
        let vaults = executeMetadata(
            executablePath: executablePath,
            operation: .vaultList,
            tokenDescriptor: tokenDescriptor,
            timeoutMilliseconds: 5_000
        )
        guard environmentOpExecutableIdentity(executablePath)
            == admittedIdentity
        else {
            return false
        }
        guard let userObject = try? JSONSerialization.jsonObject(with: user)
                as? [String: Any],
              userObject["ok"] as? Bool == true,
              let userValue = userObject["value"] as? [String: Any],
              boundedString(userValue["id"]) != nil,
              let vaultObject = try? JSONSerialization.jsonObject(with: vaults)
                as? [String: Any],
              vaultObject["ok"] as? Bool == true,
              let vaultValue = vaultObject["value"] as? [Any],
              vaultValue.count == 1
        else {
            return false
        }
        return true
    }
}
