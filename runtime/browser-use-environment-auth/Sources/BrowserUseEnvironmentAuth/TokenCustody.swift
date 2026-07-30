import Darwin
import Foundation

private func tokenCustodyHiddenTerminalAlarmHandler(_: Int32) {}

public enum TokenCustodyState: String, Codable, Sendable {
    case missing
    case ready
    case installed
    case replaced
    case removed
    case removedSyncUnproven = "removed-sync-unproven"
    case cleaned
    case cleanupRequired = "cleanup-required"
    case blocked
}

public enum TokenCustodyCause: String, Codable, Error, Sendable {
    case invalidArguments = "invalid-arguments"
    case unsafeAncestry = "unsafe-ancestry"
    case unsafeConfigRoot = "unsafe-config-root"
    case unsafeCustodyDirectory = "unsafe-custody-directory"
    case backupExclusionUnproven = "backup-exclusion-unproven"
    case syncExclusionUnproven = "sync-exclusion-unproven"
    case tokenMissing = "token-missing"
    case tokenAlreadyInstalled = "token-already-installed"
    case tokenUnsafe = "token-unsafe"
    case stagingResidue = "staging-residue"
    case removalResidue = "removal-residue"
    case inputCancelled = "input-cancelled"
    case inputInvalid = "input-invalid"
    case writeFailed = "write-failed"
    case invalidServiceAccount = "invalid-service-account"
    case invalidVaultScope = "invalid-vault-scope"
    case validationFailed = "validation-failed"
    case validationTimeout = "validation-timeout"
    case validationUnavailable = "validation-unavailable"
    case pathIdentityChanged = "path-identity-changed"
    case atomicReplaceFailed = "atomic-replace-failed"
    case cleanupFailed = "cleanup-failed"
    case parentSyncFailed = "parent-sync-failed"
    case coreDumpDisableFailed = "core-dump-disable-failed"
}

public struct TokenCustodyResult: Codable, Equatable, Sendable {
    public let state: TokenCustodyState
    public let cause: TokenCustodyCause?
    public let nextAction: String
    public let remoteAuthority: String?

    enum CodingKeys: String, CodingKey {
        case state
        case cause
        case nextAction = "next_action"
        case remoteAuthority = "remote_authority"
    }

    public init(
        state: TokenCustodyState,
        cause: TokenCustodyCause? = nil,
        nextAction: String,
        remoteAuthority: String? = nil
    ) {
        self.state = state
        self.cause = cause
        self.nextAction = nextAction
        self.remoteAuthority = remoteAuthority
    }
}

public struct TokenCustodyPaths: Equatable, Sendable {
    public static let directoryName = "auth.nosync"
    public static let tokenName = "op-service-account-token"
    public static let stagingPrefix = ".op-service-account-token.stage."
    public static let removalPrefix = ".op-service-account-token.remove."

    public let configRoot: String
    public let custodyDirectory: String
    public let tokenFile: String

    public init(configRoot: String) throws {
        guard configRoot.hasPrefix("/"), !configRoot.contains("\0") else {
            throw TokenCustodyCause.invalidArguments
        }
        let normalized = URL(fileURLWithPath: configRoot).standardizedFileURL.path
        guard normalized == configRoot || normalized + "/" == configRoot else {
            throw TokenCustodyCause.invalidArguments
        }
        self.configRoot = normalized
        custodyDirectory = normalized + "/" + Self.directoryName
        tokenFile = custodyDirectory + "/" + Self.tokenName
    }
}

/// Process-level admission that must pass before native code reads token input.
public enum TokenCustodyProcessSafety {
    public static func disableCoreDumps() throws {
        var zeroLimit = rlimit(rlim_cur: 0, rlim_max: 0)
        guard setrlimit(RLIMIT_CORE, &zeroLimit) == 0 else {
            throw TokenCustodyCause.coreDumpDisableFailed
        }
        var provedLimit = rlimit()
        guard getrlimit(RLIMIT_CORE, &provedLimit) == 0,
              provedLimit.rlim_cur == 0,
              provedLimit.rlim_max == 0
        else {
            throw TokenCustodyCause.coreDumpDisableFailed
        }
    }

    @_spi(Testing)
    public static func proveForTesting(
        setLimit: () -> Bool,
        readLimit: () -> (current: UInt64, maximum: UInt64)?
    ) throws {
        guard setLimit(),
              let proved = readLimit(),
              proved.current == 0,
              proved.maximum == 0
        else {
            throw TokenCustodyCause.coreDumpDisableFailed
        }
    }
}

@_spi(Executor)
public enum TokenCustodyHiddenTerminal {
    public static let prompt =
        "Paste the 1Password service account token (input hidden): "

    public static func read() throws -> [UInt8] {
        try read(flags: RPP_REQUIRE_TTY, timeoutSeconds: 300)
    }

    @_spi(Testing)
    public static func readStandardInputForTesting(
        timeoutSeconds: UInt32
    ) throws -> [UInt8] {
        try read(flags: RPP_STDIN, timeoutSeconds: timeoutSeconds)
    }

    private static func read(
        flags: Int32,
        timeoutSeconds: UInt32
    ) throws -> [UInt8] {
        guard timeoutSeconds > 0 else {
            throw TokenCustodyCause.inputInvalid
        }
        var buffer = [CChar](repeating: 0, count: 65_537)
        let previousAlarmHandler = signal(
            SIGALRM,
            tokenCustodyHiddenTerminalAlarmHandler
        )
        _ = alarm(timeoutSeconds)
        defer {
            _ = alarm(0)
            _ = signal(SIGALRM, previousAlarmHandler)
            _ = buffer.withUnsafeMutableBytes {
                $0.initializeMemory(as: UInt8.self, repeating: 0)
            }
        }
        let result = prompt.withCString { promptPointer in
            buffer.withUnsafeMutableBufferPointer { bufferPointer in
                readpassphrase(
                    promptPointer,
                    bufferPointer.baseAddress,
                    bufferPointer.count,
                    flags
                )
            }
        }
        guard result != nil else {
            throw TokenCustodyCause.inputCancelled
        }
        let end = buffer.firstIndex(of: 0) ?? buffer.endIndex
        return buffer[..<end].map { UInt8(bitPattern: $0) }
    }
}

private struct FileIdentity: Equatable {
    let device: dev_t
    let inode: ino_t
}

private func fileIdentity(_ value: stat) -> FileIdentity {
    FileIdentity(device: value.st_dev, inode: value.st_ino)
}

private func modeBits(_ value: stat) -> mode_t {
    value.st_mode & mode_t(0o777)
}

private func isDirectory(_ value: stat) -> Bool {
    value.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR)
}

private func isRegularFile(_ value: stat) -> Bool {
    value.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
}

private func closeIfOpen(_ descriptor: Int32) {
    if descriptor >= 0 {
        _ = Darwin.close(descriptor)
    }
}

private func directoryComponents(_ absolutePath: String) -> [Substring] {
    absolutePath.split(separator: "/", omittingEmptySubsequences: true)
}

private func openAdmittedConfigRoot(_ path: String) throws -> Int32 {
    let components = directoryComponents(path)
    guard !components.isEmpty else {
        throw TokenCustodyCause.unsafeConfigRoot
    }
    var current = Darwin.open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC)
    guard current >= 0 else {
        throw TokenCustodyCause.unsafeAncestry
    }
    let effectiveUser = geteuid()
    do {
        for (index, component) in components.enumerated() {
            let next = openat(
                current,
                String(component),
                O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
            )
            guard next >= 0 else {
                throw index == components.count - 1
                    ? TokenCustodyCause.unsafeConfigRoot
                    : TokenCustodyCause.unsafeAncestry
            }
            closeIfOpen(current)
            current = next
            var metadata = stat()
            guard fstat(current, &metadata) == 0, isDirectory(metadata) else {
                throw TokenCustodyCause.unsafeAncestry
            }
            if index == components.count - 1 {
                guard metadata.st_uid == effectiveUser, modeBits(metadata) == 0o700 else {
                    throw TokenCustodyCause.unsafeConfigRoot
                }
            } else {
                let trustedOwner = metadata.st_uid == 0 || metadata.st_uid == effectiveUser
                guard trustedOwner, modeBits(metadata) & 0o022 == 0 else {
                    throw TokenCustodyCause.unsafeAncestry
                }
            }
        }
        return current
    } catch {
        closeIfOpen(current)
        throw error
    }
}

private func setAndProveBackupExclusion(_ path: String) throws {
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    var url = URL(fileURLWithPath: path)
    do {
        try url.setResourceValues(values)
        let proved = try url.resourceValues(forKeys: [.isExcludedFromBackupKey])
        guard proved.isExcludedFromBackup == true else {
            throw TokenCustodyCause.backupExclusionUnproven
        }
    } catch let cause as TokenCustodyCause {
        throw cause
    } catch {
        throw TokenCustodyCause.backupExclusionUnproven
    }
}

private func proveBackupExclusion(_ path: String) throws {
    do {
        let proof = try URL(fileURLWithPath: path)
            .resourceValues(forKeys: [.isExcludedFromBackupKey])
        guard proof.isExcludedFromBackup == true else {
            throw TokenCustodyCause.backupExclusionUnproven
        }
    } catch let cause as TokenCustodyCause {
        throw cause
    } catch {
        throw TokenCustodyCause.backupExclusionUnproven
    }
}

/// Test-only injection seam for filesystems that cannot persist macOS backup metadata.
///
/// The production executable cannot import this SPI and always uses the real
/// set-plus-readback proof. Tests may substitute only the proof operation; all
/// descriptor, inode, mode, link, sync, rename, and cleanup checks remain live.
@_spi(Testing)
public struct TokenCustodyBackupExclusionProof: Sendable {
    fileprivate let setAndProve: @Sendable (String) throws -> Void
    fileprivate let prove: @Sendable (String) throws -> Void

    public init(
        setAndProve: @escaping @Sendable (String) throws -> Void,
        prove: @escaping @Sendable (String) throws -> Void
    ) {
        self.setAndProve = setAndProve
        self.prove = prove
    }

    fileprivate static let production = TokenCustodyBackupExclusionProof(
        setAndProve: setAndProveBackupExclusion,
        prove: proveBackupExclusion
    )
}

/// Test-only controls for deterministic removal races and durability failures.
@_spi(Testing)
public struct TokenCustodyRemovalControls: Sendable {
    fileprivate let beforeQuarantine: @Sendable (String) throws -> Void
    fileprivate let beforeUnlinkQuarantine: @Sendable (String) throws -> Void
    fileprivate let syncParent: @Sendable (Int32) -> Bool

    public init(
        beforeQuarantine: @escaping @Sendable (String) throws -> Void,
        beforeUnlinkQuarantine: @escaping @Sendable (String) throws -> Void,
        syncParent: @escaping @Sendable (Int32) -> Bool
    ) {
        self.beforeQuarantine = beforeQuarantine
        self.beforeUnlinkQuarantine = beforeUnlinkQuarantine
        self.syncParent = syncParent
    }

    fileprivate static let production = TokenCustodyRemovalControls(
        beforeQuarantine: { _ in },
        beforeUnlinkQuarantine: { _ in },
        syncParent: { fsync($0) == 0 }
    )
}

private let knownSyncProviderComponents = [
    "CloudStorage",
    "Mobile Documents",
    "Dropbox",
    "OneDrive",
    "Google Drive",
    "SynologyDrive",
]

private func proveLocalNonUbiquitousCustody(_ path: String) throws {
    // This proves the fixed .nosync convention, rejects platform/provider
    // roots, and requires a local non-ubiquitous volume. It cannot detect an
    // arbitrary same-UID process that chooses to copy local files; ADR 0030
    // retains that lower-assurance residual.
    let url = URL(fileURLWithPath: path).standardizedFileURL
    let components = Set(url.pathComponents)
    guard url.lastPathComponent == TokenCustodyPaths.directoryName
            || url.deletingLastPathComponent().lastPathComponent
                == TokenCustodyPaths.directoryName,
          components.isDisjoint(with: knownSyncProviderComponents)
    else {
        throw TokenCustodyCause.syncExclusionUnproven
    }
    do {
        let volume = try url.resourceValues(forKeys: [.volumeIsLocalKey])
        guard volume.volumeIsLocal == true,
              !FileManager.default.isUbiquitousItem(at: url)
        else {
            throw TokenCustodyCause.syncExclusionUnproven
        }
    } catch let cause as TokenCustodyCause {
        throw cause
    } catch {
        throw TokenCustodyCause.syncExclusionUnproven
    }
}

private func openCustodyDirectory(
    configDescriptor: Int32,
    paths: TokenCustodyPaths,
    create: Bool,
    backupExclusionProof: TokenCustodyBackupExclusionProof
) throws -> Int32? {
    var descriptor = openat(
        configDescriptor,
        TokenCustodyPaths.directoryName,
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    if descriptor < 0, errno == ENOENT, create {
        guard mkdirat(configDescriptor, TokenCustodyPaths.directoryName, 0o700) == 0 else {
            throw TokenCustodyCause.unsafeCustodyDirectory
        }
        descriptor = openat(
            configDescriptor,
            TokenCustodyPaths.directoryName,
            O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
        )
    }
    if descriptor < 0 {
        if errno == ENOENT {
            return nil
        }
        throw TokenCustodyCause.unsafeCustodyDirectory
    }
    do {
        var metadata = stat()
        guard fstat(descriptor, &metadata) == 0,
              isDirectory(metadata),
              metadata.st_uid == geteuid(),
              modeBits(metadata) == 0o700
        else {
            throw TokenCustodyCause.unsafeCustodyDirectory
        }
        try proveLocalNonUbiquitousCustody(paths.custodyDirectory)
        try backupExclusionProof.setAndProve(paths.custodyDirectory)
        return descriptor
    } catch {
        closeIfOpen(descriptor)
        throw error
    }
}

private func entries(
    _ directoryDescriptor: Int32,
    withPrefix prefix: String
) throws -> [String] {
    let independent = openat(
        directoryDescriptor,
        ".",
        O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC
    )
    guard independent >= 0, let directory = fdopendir(independent) else {
        closeIfOpen(independent)
        throw TokenCustodyCause.cleanupFailed
    }
    defer { closedir(directory) }
    var entries: [String] = []
    while let entry = readdir(directory) {
        let name = withUnsafePointer(to: &entry.pointee.d_name) {
            $0.withMemoryRebound(to: CChar.self, capacity: Int(MAXNAMLEN) + 1) {
                String(cString: $0)
            }
        }
        if name.hasPrefix(prefix) {
            entries.append(name)
        }
    }
    return entries.sorted()
}

private func stagingEntries(_ directoryDescriptor: Int32) throws -> [String] {
    try entries(
        directoryDescriptor,
        withPrefix: TokenCustodyPaths.stagingPrefix
    )
}

private func removalEntries(_ directoryDescriptor: Int32) throws -> [String] {
    try entries(
        directoryDescriptor,
        withPrefix: TokenCustodyPaths.removalPrefix
    )
}

private func proveTokenDescriptor(_ descriptor: Int32) throws -> stat {
    var metadata = stat()
    guard fstat(descriptor, &metadata) == 0,
          isRegularFile(metadata),
          metadata.st_uid == geteuid(),
          modeBits(metadata) == 0o600,
          metadata.st_nlink == 1
    else {
        throw TokenCustodyCause.tokenUnsafe
    }
    return metadata
}

private func openAndProveToken(
    directoryDescriptor: Int32,
    paths: TokenCustodyPaths,
    backupExclusionProof: TokenCustodyBackupExclusionProof
) throws -> (Int32, stat)? {
    let descriptor = openat(
        directoryDescriptor,
        TokenCustodyPaths.tokenName,
        O_RDONLY | O_NOFOLLOW | O_CLOEXEC
    )
    if descriptor < 0 {
        if errno == ENOENT {
            return nil
        }
        throw TokenCustodyCause.tokenUnsafe
    }
    do {
        let metadata = try proveTokenDescriptor(descriptor)
        try proveLocalNonUbiquitousCustody(paths.tokenFile)
        try backupExclusionProof.prove(paths.tokenFile)
        return (descriptor, metadata)
    } catch {
        closeIfOpen(descriptor)
        throw error
    }
}

/// Open the fixed admitted token for an immediate native child handoff.
///
/// The caller receives only a descriptor. It must never read the bytes in the
/// supervisor process; the forked wrapper child reads and immediately execs
/// the official OP executable.
@_spi(Executor)
public func openEnvironmentTokenDescriptor(configRoot: String) throws -> Int32 {
    let paths = try TokenCustodyPaths(configRoot: configRoot)
    let configDescriptor = try openAdmittedConfigRoot(paths.configRoot)
    defer { closeIfOpen(configDescriptor) }
    guard let custodyDescriptor = try openCustodyDirectory(
        configDescriptor: configDescriptor,
        paths: paths,
        create: false,
        backupExclusionProof: .production
    ) else {
        throw TokenCustodyCause.tokenMissing
    }
    defer { closeIfOpen(custodyDescriptor) }
    guard (try removalEntries(custodyDescriptor)).isEmpty,
          (try stagingEntries(custodyDescriptor)).isEmpty,
          let (tokenDescriptor, _) = try openAndProveToken(
              directoryDescriptor: custodyDescriptor,
              paths: paths,
              backupExclusionProof: .production
          )
    else {
        throw TokenCustodyCause.tokenUnsafe
    }
    return tokenDescriptor
}

@_spi(Executor)
public func proveEnvironmentTokenDescriptor(_ descriptor: Int32) -> Bool {
    guard fcntl(descriptor, F_GETFL) & O_ACCMODE == O_RDONLY else {
        return false
    }
    return (try? proveTokenDescriptor(descriptor)) != nil
}

private func writeAll(_ descriptor: Int32, bytes: [UInt8]) throws {
    var offset = 0
    while offset < bytes.count {
        let written = bytes.withUnsafeBytes {
            Darwin.write(
                descriptor,
                $0.baseAddress!.advanced(by: offset),
                bytes.count - offset
            )
        }
        guard written > 0 else {
            throw TokenCustodyCause.writeFailed
        }
        offset += written
    }
}

private func monotonicMilliseconds() -> Int64 {
    var value = timespec()
    guard clock_gettime(CLOCK_MONOTONIC, &value) == 0 else { return 0 }
    return Int64(value.tv_sec) * 1_000 + Int64(value.tv_nsec) / 1_000_000
}

private func waitForSocket(
    _ descriptor: Int32,
    events: Int16,
    deadlineMilliseconds: Int64
) throws {
    while true {
        let remaining = deadlineMilliseconds - monotonicMilliseconds()
        guard remaining > 0 else {
            throw TokenCustodyCause.validationTimeout
        }
        var polled = pollfd(fd: descriptor, events: events, revents: 0)
        let result = poll(
            &polled,
            1,
            Int32(min(remaining, Int64(Int32.max)))
        )
        if result == 0 {
            throw TokenCustodyCause.validationTimeout
        }
        if result < 0 {
            if errno == EINTR { continue }
            throw TokenCustodyCause.validationUnavailable
        }
        if polled.revents & events != 0 { return }
        throw TokenCustodyCause.validationUnavailable
    }
}

private func controlAlignment(_ size: Int) -> Int {
    let alignment = MemoryLayout<cmsghdr>.alignment
    return (size + alignment - 1) & ~(alignment - 1)
}

private func sendDescriptor(
    socket: Int32,
    descriptor: Int32,
    deadlineMilliseconds: Int64
) throws {
    try waitForSocket(
        socket,
        events: Int16(POLLOUT),
        deadlineMilliseconds: deadlineMilliseconds
    )
    var payload = Array("browser-use-token-validator/v2\n".utf8)
    let headerSize = controlAlignment(MemoryLayout<cmsghdr>.size)
    let contentLength = headerSize + MemoryLayout<Int32>.size
    let controlSize = headerSize + controlAlignment(MemoryLayout<Int32>.size)
    var control = [UInt8](repeating: 0, count: controlSize)
    let sent = payload.withUnsafeMutableBytes { payloadBytes in
        control.withUnsafeMutableBytes { controlBytes in
            guard let controlBase = controlBytes.baseAddress else { return -1 }
            let header = controlBase.assumingMemoryBound(to: cmsghdr.self)
            header.pointee.cmsg_len = socklen_t(contentLength)
            header.pointee.cmsg_level = SOL_SOCKET
            header.pointee.cmsg_type = SCM_RIGHTS
            controlBase.advanced(by: headerSize)
                .assumingMemoryBound(to: Int32.self)
                .pointee = descriptor
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
                    msg_control: controlBase,
                    msg_controllen: socklen_t(controlBytes.count),
                    msg_flags: 0
                )
                return sendmsg(socket, &message, MSG_DONTWAIT)
            }
        }
    }
    guard sent == payload.count else {
        if errno == EAGAIN || errno == EWOULDBLOCK {
            throw TokenCustodyCause.validationTimeout
        }
        throw TokenCustodyCause.validationUnavailable
    }
}

private func contentMatches(
    descriptor: Int32,
    expected: [UInt8]
) -> Bool {
    var offset = 0
    var buffer = [UInt8](repeating: 0, count: 4_096)
    defer {
        _ = buffer.withUnsafeMutableBytes {
            $0.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }
    while offset < expected.count {
        let countToRead = min(buffer.count, expected.count - offset)
        let received = buffer.withUnsafeMutableBytes {
            pread(descriptor, $0.baseAddress, countToRead, off_t(offset))
        }
        guard received == countToRead,
              buffer.prefix(countToRead)
                .elementsEqual(expected[offset..<(offset + countToRead)])
        else {
            return false
        }
        offset += received
    }
    var trailing: UInt8 = 0
    return pread(descriptor, &trailing, 1, off_t(expected.count)) == 0
}

private func validateStagedFile(
    validatorDescriptor: Int32,
    stagedReadDescriptor: Int32,
    timeoutMilliseconds: Int32
) throws {
    let deadline = monotonicMilliseconds() + Int64(timeoutMilliseconds)
    try sendDescriptor(
        socket: validatorDescriptor,
        descriptor: stagedReadDescriptor,
        deadlineMilliseconds: deadline
    )
    var response: [UInt8] = []
    while response.count < 16 {
        try waitForSocket(
            validatorDescriptor,
            events: Int16(POLLIN),
            deadlineMilliseconds: deadline
        )
        var byte: UInt8 = 0
        let count = recv(validatorDescriptor, &byte, 1, MSG_DONTWAIT)
        if count == 0 {
            throw TokenCustodyCause.validationUnavailable
        }
        guard count > 0 else {
            if errno == EINTR { continue }
            if errno == EAGAIN || errno == EWOULDBLOCK { continue }
            throw TokenCustodyCause.validationUnavailable
        }
        response.append(byte)
        if byte == UInt8(ascii: "\n") { break }
    }
    if response == Array("ok\n".utf8) { return }
    if response == Array("timeout\n".utf8) {
        throw TokenCustodyCause.validationTimeout
    }
    if response == Array("identity\n".utf8) {
        throw TokenCustodyCause.invalidServiceAccount
    }
    if response == Array("vault\n".utf8) {
        throw TokenCustodyCause.invalidVaultScope
    }
    guard response == Array("no\n".utf8) else {
        throw TokenCustodyCause.validationUnavailable
    }
    throw TokenCustodyCause.validationFailed
}

private func reproveStagedPath(
    directoryDescriptor: Int32,
    stagingName: String,
    expected: FileIdentity
) throws {
    var metadata = stat()
    guard fstatat(
        directoryDescriptor,
        stagingName,
        &metadata,
        AT_SYMLINK_NOFOLLOW
    ) == 0,
        fileIdentity(metadata) == expected,
        isRegularFile(metadata),
        metadata.st_uid == geteuid(),
        modeBits(metadata) == 0o600,
        metadata.st_nlink == 1
    else {
        throw TokenCustodyCause.pathIdentityChanged
    }
}

private func unlinkExactOwnedEntry(
    directoryDescriptor: Int32,
    name: String
) throws {
    let descriptor = openat(
        directoryDescriptor,
        name,
        O_RDONLY | O_NOFOLLOW | O_CLOEXEC
    )
    guard descriptor >= 0 else {
        throw TokenCustodyCause.cleanupFailed
    }
    defer { closeIfOpen(descriptor) }
    let metadata = try proveTokenDescriptor(descriptor)
    try reproveStagedPath(
        directoryDescriptor: directoryDescriptor,
        stagingName: name,
        expected: fileIdentity(metadata)
    )
    guard unlinkat(directoryDescriptor, name, 0) == 0 else {
        throw TokenCustodyCause.cleanupFailed
    }
}

private func proveExactOwnedEntry(
    directoryDescriptor: Int32,
    name: String
) throws {
    let descriptor = openat(
        directoryDescriptor,
        name,
        O_RDONLY | O_NOFOLLOW | O_CLOEXEC
    )
    guard descriptor >= 0 else {
        throw TokenCustodyCause.cleanupFailed
    }
    defer { closeIfOpen(descriptor) }
    let metadata = try proveTokenDescriptor(descriptor)
    try reproveStagedPath(
        directoryDescriptor: directoryDescriptor,
        stagingName: name,
        expected: fileIdentity(metadata)
    )
}

private func syncFile(_ descriptor: Int32) throws {
    guard fsync(descriptor) == 0 else {
        throw TokenCustodyCause.writeFailed
    }
#if os(macOS)
    guard fcntl(descriptor, F_FULLFSYNC) == 0 else {
        throw TokenCustodyCause.writeFailed
    }
#endif
}

public enum TokenCustody {
    private static let validatorTimeoutMilliseconds: Int32 = 45_000

    public static func status(configRoot: String) -> TokenCustodyResult {
        status(
            configRoot: configRoot,
            backupExclusionProof: .production
        )
    }

    @_spi(Testing)
    public static func statusForTesting(
        configRoot: String,
        backupExclusionProof: TokenCustodyBackupExclusionProof
    ) -> TokenCustodyResult {
        status(
            configRoot: configRoot,
            backupExclusionProof: backupExclusionProof
        )
    }

    private static func status(
        configRoot: String,
        backupExclusionProof: TokenCustodyBackupExclusionProof
    ) -> TokenCustodyResult {
        do {
            let paths = try TokenCustodyPaths(configRoot: configRoot)
            let configDescriptor = try openAdmittedConfigRoot(paths.configRoot)
            defer { closeIfOpen(configDescriptor) }
            guard let directoryDescriptor = try openCustodyDirectory(
                configDescriptor: configDescriptor,
                paths: paths,
                create: false,
                backupExclusionProof: backupExclusionProof
            ) else {
                return TokenCustodyResult(
                    state: .missing,
                    nextAction: "install-local-token"
                )
            }
            defer { closeIfOpen(directoryDescriptor) }
            let removals = try removalEntries(directoryDescriptor)
            if !removals.isEmpty {
                for name in removals {
                    try proveExactOwnedEntry(
                        directoryDescriptor: directoryDescriptor,
                        name: name
                    )
                }
                return TokenCustodyResult(
                    state: .cleanupRequired,
                    cause: .removalResidue,
                    nextAction: "complete-local-token-removal",
                    remoteAuthority: "may-remain-live"
                )
            }
            if !(try stagingEntries(directoryDescriptor)).isEmpty {
                return TokenCustodyResult(
                    state: .cleanupRequired,
                    cause: .stagingResidue,
                    nextAction: "cleanup-token-staging"
                )
            }
            guard let (tokenDescriptor, _) = try openAndProveToken(
                directoryDescriptor: directoryDescriptor,
                paths: paths,
                backupExclusionProof: backupExclusionProof
            ) else {
                return TokenCustodyResult(
                    state: .missing,
                    nextAction: "install-local-token"
                )
            }
            closeIfOpen(tokenDescriptor)
            return TokenCustodyResult(
                state: .ready,
                nextAction: "validate-service-account"
            )
        } catch let cause as TokenCustodyCause {
            return TokenCustodyResult(
                state: .blocked,
                cause: cause,
                nextAction: "repair-token-custody"
            )
        } catch {
            return TokenCustodyResult(
                state: .blocked,
                cause: .tokenUnsafe,
                nextAction: "repair-token-custody"
            )
        }
    }

    public static func install(
        configRoot: String,
        tokenBytes: inout [UInt8],
        validatorDescriptor: Int32,
        replacing: Bool
    ) -> TokenCustodyResult {
        install(
            configRoot: configRoot,
            tokenBytes: &tokenBytes,
            validatorDescriptor: validatorDescriptor,
            replacing: replacing,
            backupExclusionProof: .production,
            validatorTimeoutMilliseconds: validatorTimeoutMilliseconds,
            validationCompletion: {}
        )
    }

    @_spi(Executor)
    public static func installWithValidationCompletion(
        configRoot: String,
        tokenBytes: inout [UInt8],
        validatorDescriptor: Int32,
        replacing: Bool,
        validationCompletion: @escaping @Sendable () throws -> Void
    ) -> TokenCustodyResult {
        install(
            configRoot: configRoot,
            tokenBytes: &tokenBytes,
            validatorDescriptor: validatorDescriptor,
            replacing: replacing,
            backupExclusionProof: .production,
            validatorTimeoutMilliseconds: validatorTimeoutMilliseconds,
            validationCompletion: validationCompletion
        )
    }

    @_spi(Testing)
    public static func installForTesting(
        configRoot: String,
        tokenBytes: inout [UInt8],
        validatorDescriptor: Int32,
        replacing: Bool,
        backupExclusionProof: TokenCustodyBackupExclusionProof,
        validatorTimeoutMilliseconds: Int32 = 20_000,
        validationCompletion: @escaping @Sendable () throws -> Void = {}
    ) -> TokenCustodyResult {
        install(
            configRoot: configRoot,
            tokenBytes: &tokenBytes,
            validatorDescriptor: validatorDescriptor,
            replacing: replacing,
            backupExclusionProof: backupExclusionProof,
            validatorTimeoutMilliseconds: validatorTimeoutMilliseconds,
            validationCompletion: validationCompletion
        )
    }

    private static func install(
        configRoot: String,
        tokenBytes: inout [UInt8],
        validatorDescriptor: Int32,
        replacing: Bool,
        backupExclusionProof: TokenCustodyBackupExclusionProof,
        validatorTimeoutMilliseconds: Int32,
        validationCompletion: @escaping @Sendable () throws -> Void
    ) -> TokenCustodyResult {
        defer {
            _ = tokenBytes.withUnsafeMutableBytes {
                $0.initializeMemory(as: UInt8.self, repeating: 0)
            }
        }
        do {
            guard !tokenBytes.isEmpty,
                  tokenBytes.count <= 65_536,
                  !tokenBytes.contains(0)
            else {
                throw TokenCustodyCause.inputInvalid
            }
            while tokenBytes.last == 10 || tokenBytes.last == 13 {
                tokenBytes.removeLast()
            }
            guard !tokenBytes.isEmpty,
                  !tokenBytes.contains(10),
                  !tokenBytes.contains(13)
            else {
                throw TokenCustodyCause.inputCancelled
            }
            let paths = try TokenCustodyPaths(configRoot: configRoot)
            let configDescriptor = try openAdmittedConfigRoot(paths.configRoot)
            defer { closeIfOpen(configDescriptor) }
            guard let directoryDescriptor = try openCustodyDirectory(
                configDescriptor: configDescriptor,
                paths: paths,
                create: true,
                backupExclusionProof: backupExclusionProof
            ) else {
                throw TokenCustodyCause.unsafeCustodyDirectory
            }
            defer { closeIfOpen(directoryDescriptor) }
            guard (try removalEntries(directoryDescriptor)).isEmpty else {
                throw TokenCustodyCause.removalResidue
            }
            guard (try stagingEntries(directoryDescriptor)).isEmpty else {
                throw TokenCustodyCause.stagingResidue
            }
            let existing = try openAndProveToken(
                directoryDescriptor: directoryDescriptor,
                paths: paths,
                backupExclusionProof: backupExclusionProof
            )
            if let existing {
                closeIfOpen(existing.0)
                guard replacing else {
                    throw TokenCustodyCause.tokenAlreadyInstalled
                }
            } else if replacing {
                throw TokenCustodyCause.tokenMissing
            }

            let stagingName = TokenCustodyPaths.stagingPrefix
                + String(getpid()) + "." + UUID().uuidString.lowercased()
            let stagingDescriptor = openat(
                directoryDescriptor,
                stagingName,
                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                0o600
            )
            guard stagingDescriptor >= 0 else {
                throw TokenCustodyCause.writeFailed
            }
            var published = false
            defer {
                closeIfOpen(stagingDescriptor)
                if !published {
                    _ = unlinkat(directoryDescriptor, stagingName, 0)
                }
            }
            try writeAll(stagingDescriptor, bytes: tokenBytes)
            let stagedMetadata = try proveTokenDescriptor(stagingDescriptor)
            try backupExclusionProof.setAndProve(
                paths.custodyDirectory + "/" + stagingName
            )
            try syncFile(stagingDescriptor)
            let stagedReadDescriptor = openat(
                directoryDescriptor,
                stagingName,
                O_RDONLY | O_NOFOLLOW | O_CLOEXEC
            )
            guard stagedReadDescriptor >= 0 else {
                throw TokenCustodyCause.pathIdentityChanged
            }
            defer { closeIfOpen(stagedReadDescriptor) }
            let stagedReadMetadata = try proveTokenDescriptor(stagedReadDescriptor)
            guard fileIdentity(stagedReadMetadata) == fileIdentity(stagedMetadata),
                  contentMatches(descriptor: stagedReadDescriptor, expected: tokenBytes)
            else {
                throw TokenCustodyCause.pathIdentityChanged
            }
            try validateStagedFile(
                validatorDescriptor: validatorDescriptor,
                stagedReadDescriptor: stagedReadDescriptor,
                timeoutMilliseconds: validatorTimeoutMilliseconds
            )
            try validationCompletion()
            try reproveStagedPath(
                directoryDescriptor: directoryDescriptor,
                stagingName: stagingName,
                expected: fileIdentity(stagedMetadata)
            )
            guard contentMatches(
                descriptor: stagedReadDescriptor,
                expected: tokenBytes
            ) else {
                throw TokenCustodyCause.pathIdentityChanged
            }
            // The validator now receives the exact opened read-only inode and
            // content is re-proved after its response. A malicious process with
            // the same UID can still mutate the inode after this last check and
            // before rename; ADR 0030 accepts that lower-assurance same-UID risk.
            let renameResult = replacing
                ? renameat(
                    directoryDescriptor,
                    stagingName,
                    directoryDescriptor,
                    TokenCustodyPaths.tokenName
                )
                : renameatx_np(
                    directoryDescriptor,
                    stagingName,
                    directoryDescriptor,
                    TokenCustodyPaths.tokenName,
                    UInt32(RENAME_EXCL)
                )
            guard renameResult == 0 else {
                throw TokenCustodyCause.atomicReplaceFailed
            }
            published = true
            guard fsync(directoryDescriptor) == 0 else {
                throw TokenCustodyCause.atomicReplaceFailed
            }
            guard let (installedDescriptor, installedMetadata) = try openAndProveToken(
                directoryDescriptor: directoryDescriptor,
                paths: paths,
                backupExclusionProof: backupExclusionProof
            ) else {
                throw TokenCustodyCause.pathIdentityChanged
            }
            defer { closeIfOpen(installedDescriptor) }
            guard fileIdentity(installedMetadata) == fileIdentity(stagedMetadata) else {
                throw TokenCustodyCause.pathIdentityChanged
            }
            return TokenCustodyResult(
                state: replacing ? .replaced : .installed,
                nextAction: "validate-service-account"
            )
        } catch let cause as TokenCustodyCause {
            let removalResidue = cause == .removalResidue
            return TokenCustodyResult(
                state: .blocked,
                cause: cause,
                nextAction: removalResidue
                    ? "complete-local-token-removal"
                    : cause == .stagingResidue
                        ? "cleanup-token-staging"
                        : "repair-token-custody",
                remoteAuthority: removalResidue ? "may-remain-live" : nil
            )
        } catch {
            return TokenCustodyResult(
                state: .blocked,
                cause: .writeFailed,
                nextAction: "repair-token-custody"
            )
        }
    }

    public static func remove(configRoot: String) -> TokenCustodyResult {
        remove(
            configRoot: configRoot,
            backupExclusionProof: .production,
            controls: .production
        )
    }

    @_spi(Testing)
    public static func removeForTesting(
        configRoot: String,
        backupExclusionProof: TokenCustodyBackupExclusionProof,
        controls: TokenCustodyRemovalControls
    ) -> TokenCustodyResult {
        remove(
            configRoot: configRoot,
            backupExclusionProof: backupExclusionProof,
            controls: controls
        )
    }

    private static func remove(
        configRoot: String,
        backupExclusionProof: TokenCustodyBackupExclusionProof,
        controls: TokenCustodyRemovalControls
    ) -> TokenCustodyResult {
        do {
            let paths = try TokenCustodyPaths(configRoot: configRoot)
            let configDescriptor = try openAdmittedConfigRoot(paths.configRoot)
            defer { closeIfOpen(configDescriptor) }
            guard let directoryDescriptor = try openCustodyDirectory(
                configDescriptor: configDescriptor,
                paths: paths,
                create: false,
                backupExclusionProof: backupExclusionProof
            ) else {
                throw TokenCustodyCause.tokenMissing
            }
            defer { closeIfOpen(directoryDescriptor) }
            guard let (tokenDescriptor, tokenMetadata) = try openAndProveToken(
                directoryDescriptor: directoryDescriptor,
                paths: paths,
                backupExclusionProof: backupExclusionProof
            ) else {
                throw TokenCustodyCause.tokenMissing
            }
            defer { closeIfOpen(tokenDescriptor) }
            let admittedIdentity = fileIdentity(tokenMetadata)
            try controls.beforeQuarantine(paths.tokenFile)
            try reproveStagedPath(
                directoryDescriptor: directoryDescriptor,
                stagingName: TokenCustodyPaths.tokenName,
                expected: admittedIdentity
            )

            let quarantineName = TokenCustodyPaths.removalPrefix
                + UUID().uuidString.lowercased()
            guard renameatx_np(
                directoryDescriptor,
                TokenCustodyPaths.tokenName,
                directoryDescriptor,
                quarantineName,
                UInt32(RENAME_EXCL)
            ) == 0 else {
                throw TokenCustodyCause.pathIdentityChanged
            }

            let quarantinedDescriptor = openat(
                directoryDescriptor,
                quarantineName,
                O_RDONLY | O_NOFOLLOW | O_CLOEXEC
            )
            guard quarantinedDescriptor >= 0 else {
                _ = renameatx_np(
                    directoryDescriptor,
                    quarantineName,
                    directoryDescriptor,
                    TokenCustodyPaths.tokenName,
                    UInt32(RENAME_EXCL)
                )
                throw TokenCustodyCause.pathIdentityChanged
            }
            defer { closeIfOpen(quarantinedDescriptor) }
            do {
                let quarantinedMetadata = try proveTokenDescriptor(
                    quarantinedDescriptor
                )
                guard fileIdentity(quarantinedMetadata) == admittedIdentity else {
                    throw TokenCustodyCause.pathIdentityChanged
                }
            } catch {
                _ = renameatx_np(
                    directoryDescriptor,
                    quarantineName,
                    directoryDescriptor,
                    TokenCustodyPaths.tokenName,
                    UInt32(RENAME_EXCL)
                )
                throw error
            }

            try controls.beforeUnlinkQuarantine(
                paths.custodyDirectory + "/" + quarantineName
            )
            try reproveStagedPath(
                directoryDescriptor: directoryDescriptor,
                stagingName: quarantineName,
                expected: admittedIdentity
            )
            // Darwin has no unlink-by-fd or inode-conditioned unlink. This is
            // the last pathname reproof before unlinkat; a same-UID process can
            // still swap in the syscall-width gap. ADR 0030 explicitly accepts
            // that lower-assurance residual, so this code claims no stronger
            // atomic guarantee.
            let unlinkResult = unlinkat(directoryDescriptor, quarantineName, 0)
            if unlinkResult != 0 {
                var remaining = stat()
                if fstatat(
                    directoryDescriptor,
                    quarantineName,
                    &remaining,
                    AT_SYMLINK_NOFOLLOW
                ) != 0, errno == ENOENT {
                    return TokenCustodyResult(
                        state: .removedSyncUnproven,
                        cause: .parentSyncFailed,
                        nextAction: "revoke-service-account-token-remotely",
                        remoteAuthority: "may-remain-live"
                    )
                }
                throw TokenCustodyCause.cleanupFailed
            }
            guard controls.syncParent(directoryDescriptor) else {
                return TokenCustodyResult(
                    state: .removedSyncUnproven,
                    cause: .parentSyncFailed,
                    nextAction: "revoke-service-account-token-remotely",
                    remoteAuthority: "may-remain-live"
                )
            }
            return TokenCustodyResult(
                state: .removed,
                nextAction: "revoke-service-account-token-remotely",
                remoteAuthority: "may-remain-live"
            )
        } catch let cause as TokenCustodyCause {
            return TokenCustodyResult(
                state: .blocked,
                cause: cause,
                nextAction: "repair-token-custody"
            )
        } catch {
            return TokenCustodyResult(
                state: .blocked,
                cause: .cleanupFailed,
                nextAction: "repair-token-custody"
            )
        }
    }

    public static func cleanup(configRoot: String) -> TokenCustodyResult {
        cleanup(
            configRoot: configRoot,
            backupExclusionProof: .production
        )
    }

    @_spi(Testing)
    public static func cleanupForTesting(
        configRoot: String,
        backupExclusionProof: TokenCustodyBackupExclusionProof
    ) -> TokenCustodyResult {
        cleanup(
            configRoot: configRoot,
            backupExclusionProof: backupExclusionProof
        )
    }

    private static func cleanup(
        configRoot: String,
        backupExclusionProof: TokenCustodyBackupExclusionProof
    ) -> TokenCustodyResult {
        do {
            let paths = try TokenCustodyPaths(configRoot: configRoot)
            let configDescriptor = try openAdmittedConfigRoot(paths.configRoot)
            defer { closeIfOpen(configDescriptor) }
            guard let directoryDescriptor = try openCustodyDirectory(
                configDescriptor: configDescriptor,
                paths: paths,
                create: false,
                backupExclusionProof: backupExclusionProof
            ) else {
                return TokenCustodyResult(
                    state: .cleaned,
                    nextAction: "inspect-token-status"
                )
            }
            defer { closeIfOpen(directoryDescriptor) }
            let removals = try removalEntries(directoryDescriptor)
            let staging = try stagingEntries(directoryDescriptor)
            for name in removals + staging {
                try unlinkExactOwnedEntry(
                    directoryDescriptor: directoryDescriptor,
                    name: name
                )
            }
            guard fsync(directoryDescriptor) == 0 else {
                if !removals.isEmpty {
                    return TokenCustodyResult(
                        state: .removedSyncUnproven,
                        cause: .parentSyncFailed,
                        nextAction: "revoke-service-account-token-remotely",
                        remoteAuthority: "may-remain-live"
                    )
                }
                throw TokenCustodyCause.cleanupFailed
            }
            if !removals.isEmpty {
                return TokenCustodyResult(
                    state: .cleaned,
                    nextAction: "revoke-service-account-token-remotely",
                    remoteAuthority: "may-remain-live"
                )
            }
            return TokenCustodyResult(
                state: .cleaned,
                nextAction: "inspect-token-status"
            )
        } catch let cause as TokenCustodyCause {
            return TokenCustodyResult(
                state: .blocked,
                cause: cause,
                nextAction: "repair-token-custody"
            )
        } catch {
            return TokenCustodyResult(
                state: .blocked,
                cause: .cleanupFailed,
                nextAction: "repair-token-custody"
            )
        }
    }
}
