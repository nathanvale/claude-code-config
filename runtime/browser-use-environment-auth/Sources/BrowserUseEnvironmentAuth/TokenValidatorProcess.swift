import Darwin
import Foundation

@_silgen_name("fork")
private func validatorFork() -> pid_t

nonisolated(unsafe) private var activeValidatorProcessGroup: pid_t = 0
nonisolated(unsafe) private var pendingValidatorTerminationSignal: Int32 = 0

private func validatorParentSignalHandler(_ signal: Int32) {
    pendingValidatorTerminationSignal = signal
    let child = activeValidatorProcessGroup
    if child > 0 {
        _ = kill(-child, SIGTERM)
        _ = kill(child, SIGTERM)
    }
}

private func closeDescriptor(_ descriptor: Int32) {
    if descriptor >= 0 {
        _ = Darwin.close(descriptor)
    }
}

private struct StagedValidatorExecutable {
    let directory: String
    let executablePath: String
}

private func stringBeforeNull(_ bytes: [CChar]) -> String {
    let end = bytes.firstIndex(of: 0) ?? bytes.endIndex
    return String(
        decoding: bytes[..<end].map { UInt8(bitPattern: $0) },
        as: UTF8.self
    )
}

private func copyOpenedValidator(
    sourceDescriptor: Int32,
    destinationDescriptor: Int32
) throws {
    guard lseek(sourceDescriptor, 0, SEEK_SET) == 0 else {
        throw TokenCustodyCause.validationUnavailable
    }
    var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
    while true {
        let count = buffer.withUnsafeMutableBytes {
            Darwin.read(sourceDescriptor, $0.baseAddress, $0.count)
        }
        if count == 0 { break }
        guard count > 0 else {
            if errno == EINTR { continue }
            throw TokenCustodyCause.validationUnavailable
        }
        var written = 0
        while written < count {
            let result = buffer.withUnsafeBytes {
                Darwin.write(
                    destinationDescriptor,
                    $0.baseAddress?.advanced(by: written),
                    count - written
                )
            }
            guard result > 0 else {
                if result < 0, errno == EINTR { continue }
                throw TokenCustodyCause.validationUnavailable
            }
            written += result
        }
    }
}

private func stageOpenedValidator(
    sourceDescriptor: Int32,
    stagingRoot: String
) throws -> StagedValidatorExecutable {
    var rootMetadata = stat()
    guard (stagingRoot as NSString).isAbsolutePath,
          lstat(stagingRoot, &rootMetadata) == 0,
          rootMetadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
          rootMetadata.st_uid == geteuid(),
          rootMetadata.st_mode & mode_t(0o777) == mode_t(0o700),
          secureValidatorAncestry(
              (stagingRoot as NSString).appendingPathComponent("candidate")
          )
    else {
        throw TokenCustodyCause.validationUnavailable
    }
    let template = (stagingRoot as NSString)
        .appendingPathComponent("browser-use-validator-XXXXXXXX")
    var templateBytes = Array(template.utf8CString)
    guard mkdtemp(&templateBytes) != nil else {
        throw TokenCustodyCause.validationUnavailable
    }
    let directory = stringBeforeNull(templateBytes)
    let executablePath = (directory as NSString)
        .appendingPathComponent("browser-use-op-supervisor")
    let destinationDescriptor = Darwin.open(
        executablePath,
        O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC,
        0o500
    )
    guard destinationDescriptor >= 0 else {
        try? FileManager.default.removeItem(atPath: directory)
        throw TokenCustodyCause.validationUnavailable
    }
    do {
        try copyOpenedValidator(
            sourceDescriptor: sourceDescriptor,
            destinationDescriptor: destinationDescriptor
        )
        guard fsync(destinationDescriptor) == 0 else {
            throw TokenCustodyCause.validationUnavailable
        }
        var metadata = stat()
        guard fstat(destinationDescriptor, &metadata) == 0,
              metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
              metadata.st_nlink == 1,
              metadata.st_uid == geteuid(),
              metadata.st_mode & mode_t(0o022) == 0
        else {
            throw TokenCustodyCause.validationUnavailable
        }
        closeDescriptor(destinationDescriptor)
        return StagedValidatorExecutable(
            directory: directory,
            executablePath: executablePath
        )
    } catch {
        closeDescriptor(destinationDescriptor)
        try? FileManager.default.removeItem(atPath: directory)
        throw error
    }
}

private func secureValidatorAncestry(_ executablePath: String) -> Bool {
    var current = URL(fileURLWithPath: executablePath).deletingLastPathComponent()
    while true {
        var metadata = stat()
        guard lstat(current.path, &metadata) == 0,
              metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
              metadata.st_uid == 0 || metadata.st_uid == geteuid(),
              metadata.st_mode & mode_t(0o022) == 0
        else {
            return false
        }
        if current.path == "/" { return true }
        let parent = current.deletingLastPathComponent()
        guard parent.path != current.path else { return false }
        current = parent
    }
}

private func openAdmittedValidator(
    executablePath: String,
    requiredExecutablePath: String
) throws -> Int32 {
    guard executablePath == requiredExecutablePath,
          (executablePath as NSString).isAbsolutePath,
          !executablePath.contains("\0"),
          URL(fileURLWithPath: executablePath).lastPathComponent
            == "browser-use-op-supervisor",
          URL(fileURLWithPath: executablePath)
            .resolvingSymlinksInPath().path == executablePath,
          secureValidatorAncestry(executablePath)
    else {
        throw TokenCustodyCause.invalidArguments
    }
    let descriptor = Darwin.open(
        executablePath,
        O_RDONLY | O_CLOEXEC | O_NOFOLLOW
    )
    guard descriptor >= 0 else {
        throw TokenCustodyCause.validationUnavailable
    }
    var metadata = stat()
    guard fstat(descriptor, &metadata) == 0,
          metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG),
          metadata.st_nlink == 1,
          metadata.st_uid == 0 || metadata.st_uid == geteuid(),
          metadata.st_mode & mode_t(0o022) == 0,
          access(executablePath, X_OK) == 0
    else {
        closeDescriptor(descriptor)
        throw TokenCustodyCause.validationUnavailable
    }
    return descriptor
}

private func closeChildDescriptors(preserving preserved: Int32) {
    let observed = sysconf(_SC_OPEN_MAX)
    let maximum = observed > 0 ? min(observed, Int(Int32.max)) : 1_024
    for descriptor in Int32(3)..<Int32(maximum)
    where descriptor != preserved {
        _ = Darwin.close(descriptor)
    }
}

private func execValidator(
    stagedExecutablePath: String,
    executableArgument: String,
    socket: Int32,
    opPath: String
) -> Never {
    let arguments = [
        executableArgument,
        "validate",
        "--validator-fd",
        String(socket),
        "--op-path",
        opPath,
    ]
    let environment = [
        "PATH=/usr/bin:/bin",
        "LANG=C.UTF-8",
    ]
    var argv: [UnsafeMutablePointer<CChar>?] = arguments.map { strdup($0) }
    argv.append(nil)
    var envp: [UnsafeMutablePointer<CChar>?] = environment.map { strdup($0) }
    envp.append(nil)
    stagedExecutablePath.withCString { path in
        argv.withUnsafeMutableBufferPointer { argvBuffer in
            envp.withUnsafeMutableBufferPointer { envBuffer in
                _ = execve(path, argvBuffer.baseAddress, envBuffer.baseAddress)
            }
        }
    }
    _exit(126)
}

private func validatorChild(
    executablePath: String,
    stagedExecutablePath: String,
    socket: Int32,
    parentSocket: Int32,
    opPath: String,
    inheritedSignalMask: sigset_t
) -> Never {
    closeDescriptor(parentSocket)
    guard setpgid(0, 0) == 0 else { _exit(125) }
    var childSignalMask = inheritedSignalMask
    guard pthread_sigmask(SIG_SETMASK, &childSignalMask, nil) == 0 else {
        _exit(125)
    }
    let socketFlags = fcntl(socket, F_GETFD)
    guard socketFlags >= 0,
          fcntl(socket, F_SETFD, socketFlags & ~FD_CLOEXEC) == 0
    else {
        _exit(125)
    }
    let nullDescriptor = Darwin.open("/dev/null", O_RDWR | O_CLOEXEC)
    guard nullDescriptor >= 0,
          dup2(nullDescriptor, STDIN_FILENO) >= 0,
          dup2(nullDescriptor, STDOUT_FILENO) >= 0,
          dup2(nullDescriptor, STDERR_FILENO) >= 0
    else {
        _exit(125)
    }
    closeDescriptor(nullDescriptor)
    var zeroLimit = rlimit(rlim_cur: 0, rlim_max: 0)
    guard setrlimit(RLIMIT_CORE, &zeroLimit) == 0 else { _exit(125) }
    closeChildDescriptors(preserving: socket)
    execValidator(
        stagedExecutablePath: stagedExecutablePath,
        executableArgument: executablePath,
        socket: socket,
        opPath: opPath
    )
}

private func terminateValidatorGroup(_ processIdentifier: pid_t) {
    _ = kill(-processIdentifier, SIGTERM)
    _ = kill(processIdentifier, SIGTERM)
    usleep(20_000)
    _ = kill(-processIdentifier, SIGKILL)
    _ = kill(processIdentifier, SIGKILL)
}

/// Owns one exact validator child and its descriptor-only custody channel.
@_spi(Executor)
public struct EnvironmentTokenValidatorProcess: Sendable {
    public let socket: Int32
    public let processIdentifier: pid_t
    private let stagingDirectory: String

    private init(
        socket: Int32,
        processIdentifier: pid_t,
        stagingDirectory: String
    ) {
        self.socket = socket
        self.processIdentifier = processIdentifier
        self.stagingDirectory = stagingDirectory
    }

    /// Starts the exact packaged sibling from its already-admitted open inode.
    public static func start(
        executablePath: String,
        requiredExecutablePath: String,
        opPath: String,
        stagingRoot: String
    ) throws -> EnvironmentTokenValidatorProcess {
        try start(
            executablePath: executablePath,
            requiredExecutablePath: requiredExecutablePath,
            opPath: opPath,
            stagingRoot: stagingRoot,
            afterOpen: {}
        )
    }

    /// Test seam that swaps the pathname after admission without changing the opened inode.
    @_spi(Testing)
    public static func startForTesting(
        executablePath: String,
        requiredExecutablePath: String,
        opPath: String,
        stagingRoot: String,
        afterOpen: @Sendable () throws -> Void
    ) throws -> EnvironmentTokenValidatorProcess {
        try start(
            executablePath: executablePath,
            requiredExecutablePath: requiredExecutablePath,
            opPath: opPath,
            stagingRoot: stagingRoot,
            afterOpen: afterOpen
        )
    }

    private static func start(
        executablePath: String,
        requiredExecutablePath: String,
        opPath: String,
        stagingRoot: String,
        afterOpen: @Sendable () throws -> Void
    ) throws -> EnvironmentTokenValidatorProcess {
        guard (opPath as NSString).isAbsolutePath, !opPath.contains("\0") else {
            throw TokenCustodyCause.invalidArguments
        }
        let executableDescriptor = try openAdmittedValidator(
            executablePath: executablePath,
            requiredExecutablePath: requiredExecutablePath
        )
        do {
            try afterOpen()
        } catch {
            closeDescriptor(executableDescriptor)
            throw error
        }
        let staged: StagedValidatorExecutable
        do {
            staged = try stageOpenedValidator(
                sourceDescriptor: executableDescriptor,
                stagingRoot: stagingRoot
            )
        } catch {
            closeDescriptor(executableDescriptor)
            throw error
        }
        closeDescriptor(executableDescriptor)
        var sockets: [Int32] = [-1, -1]
        guard socketpair(AF_UNIX, SOCK_STREAM, 0, &sockets) == 0 else {
            try? FileManager.default.removeItem(atPath: staged.directory)
            throw TokenCustodyCause.validationUnavailable
        }
        for socket in sockets {
            let flags = fcntl(socket, F_GETFD)
            guard flags >= 0,
                  fcntl(socket, F_SETFD, flags | FD_CLOEXEC) == 0
            else {
                sockets.forEach(closeDescriptor)
                try? FileManager.default.removeItem(atPath: staged.directory)
                throw TokenCustodyCause.validationUnavailable
            }
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
            sockets.forEach(closeDescriptor)
            try? FileManager.default.removeItem(atPath: staged.directory)
            throw TokenCustodyCause.validationUnavailable
        }
        _ = signal(SIGTERM, validatorParentSignalHandler)
        _ = signal(SIGINT, validatorParentSignalHandler)
        _ = signal(SIGHUP, validatorParentSignalHandler)
        let child = validatorFork()
        guard child >= 0 else {
            _ = pthread_sigmask(SIG_SETMASK, &inheritedSignalMask, nil)
            sockets.forEach(closeDescriptor)
            try? FileManager.default.removeItem(atPath: staged.directory)
            throw TokenCustodyCause.validationUnavailable
        }
        if child == 0 {
            validatorChild(
                executablePath: executablePath,
                stagedExecutablePath: staged.executablePath,
                socket: sockets[1],
                parentSocket: sockets[0],
                opPath: opPath,
                inheritedSignalMask: inheritedSignalMask
            )
        }
        closeDescriptor(sockets[1])
        _ = setpgid(child, child)
        activeValidatorProcessGroup = child
        guard pthread_sigmask(
            SIG_SETMASK,
            &inheritedSignalMask,
            nil
        ) == 0 else {
            closeDescriptor(sockets[0])
            terminateValidatorGroup(child)
            var status: Int32 = 0
            while waitpid(child, &status, 0) < 0, errno == EINTR {}
            activeValidatorProcessGroup = 0
            try? FileManager.default.removeItem(atPath: staged.directory)
            throw TokenCustodyCause.validationUnavailable
        }
        return EnvironmentTokenValidatorProcess(
            socket: sockets[0],
            processIdentifier: child,
            stagingDirectory: staged.directory
        )
    }

    /// True after a top-level termination request has begun cleanup.
    public static var terminationWasRequested: Bool {
        pendingValidatorTerminationSignal != 0
    }

    /// Closes the channel, waits for a bounded exit, and clears the full group.
    public func finish(timeoutMilliseconds: Int32 = 1_000) -> Int32? {
        closeDescriptor(socket)
        let deadline = Int64(DispatchTime.now().uptimeNanoseconds / 1_000_000)
            + Int64(timeoutMilliseconds)
        var status: Int32 = 0
        while true {
            let waited = waitpid(processIdentifier, &status, WNOHANG)
            if waited == processIdentifier {
                terminateValidatorGroup(processIdentifier)
                activeValidatorProcessGroup = 0
                try? FileManager.default.removeItem(atPath: stagingDirectory)
                guard status & 0x7f == 0 else { return nil }
                return (status >> 8) & 0xff
            }
            if waited < 0, errno != EINTR {
                terminateValidatorGroup(processIdentifier)
                activeValidatorProcessGroup = 0
                try? FileManager.default.removeItem(atPath: stagingDirectory)
                return nil
            }
            let now = Int64(DispatchTime.now().uptimeNanoseconds / 1_000_000)
            if now >= deadline {
                terminateValidatorGroup(processIdentifier)
                while waitpid(processIdentifier, &status, 0) < 0, errno == EINTR {}
                activeValidatorProcessGroup = 0
                try? FileManager.default.removeItem(atPath: stagingDirectory)
                return nil
            }
            usleep(10_000)
        }
    }

    /// Terminates the group and reaps an unfinished direct child.
    public func cancel() {
        closeDescriptor(socket)
        terminateValidatorGroup(processIdentifier)
        var status: Int32 = 0
        while waitpid(processIdentifier, &status, 0) < 0, errno == EINTR {}
        activeValidatorProcessGroup = 0
        try? FileManager.default.removeItem(atPath: stagingDirectory)
    }
}
