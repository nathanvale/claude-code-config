@_spi(Executor) import BrowserUseEnvironmentAuth
import Darwin
import Foundation

private struct Arguments {
    let action: String
    let configRoot: String
    let inputDescriptor: Int32?
    let hiddenTTY: Bool
    let validatorDescriptor: Int32?
    let validatorExecutable: String?
    let opPath: String?
}

private func parseArguments(_ values: [String]) throws -> Arguments {
    guard let action = values.first,
          ["status", "install", "replace", "remove", "cleanup"].contains(action)
    else {
        throw TokenCustodyCause.invalidArguments
    }
    var configRoot: String?
    var inputDescriptor: Int32?
    var hiddenTTY = false
    var validatorDescriptor: Int32?
    var validatorExecutable: String?
    var opPath: String?
    var index = 1
    while index < values.count {
        let flag = values[index]
        switch flag {
        case "--config-root":
            index += 1
            guard index < values.count else { throw TokenCustodyCause.invalidArguments }
            configRoot = values[index]
        case "--input-fd":
            index += 1
            guard index < values.count, let value = Int32(values[index]), value >= 0 else {
                throw TokenCustodyCause.invalidArguments
            }
            inputDescriptor = value
        case "--hidden-tty":
            hiddenTTY = true
        case "--validator-fd":
            index += 1
            guard index < values.count, let value = Int32(values[index]), value >= 0 else {
                throw TokenCustodyCause.invalidArguments
            }
            validatorDescriptor = value
        case "--validator-executable":
            index += 1
            guard index < values.count else { throw TokenCustodyCause.invalidArguments }
            validatorExecutable = values[index]
        case "--op-path":
            index += 1
            guard index < values.count else { throw TokenCustodyCause.invalidArguments }
            opPath = values[index]
        default:
            throw TokenCustodyCause.invalidArguments
        }
        index += 1
    }
    guard let configRoot else { throw TokenCustodyCause.invalidArguments }
    let mutation = action == "install" || action == "replace"
    if mutation {
        let descriptorValidation = validatorDescriptor != nil
        let executableValidation = validatorExecutable != nil && opPath != nil
        guard (inputDescriptor != nil) != hiddenTTY,
              descriptorValidation != executableValidation
        else {
            throw TokenCustodyCause.invalidArguments
        }
    } else if inputDescriptor != nil || hiddenTTY || validatorDescriptor != nil
        || validatorExecutable != nil || opPath != nil
    {
        throw TokenCustodyCause.invalidArguments
    }
    return Arguments(
        action: action,
        configRoot: configRoot,
        inputDescriptor: inputDescriptor,
        hiddenTTY: hiddenTTY,
        validatorDescriptor: validatorDescriptor,
        validatorExecutable: validatorExecutable,
        opPath: opPath
    )
}

private func readBoundedInput(
    descriptor: Int32,
    stopAtNewline: Bool = false
) throws -> [UInt8] {
    var bytes: [UInt8] = []
    var buffer = [UInt8](repeating: 0, count: 4096)
    defer {
        _ = buffer.withUnsafeMutableBytes {
            $0.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }
    while true {
        let capacity = buffer.count
        let count = buffer.withUnsafeMutableBytes {
            Darwin.read(descriptor, $0.baseAddress, capacity)
        }
        if count == 0 { break }
        guard count > 0 else {
            if errno == EINTR { continue }
            throw TokenCustodyCause.inputCancelled
        }
        guard bytes.count + count <= 65_536 else {
            throw TokenCustodyCause.inputInvalid
        }
        let chunk = buffer.prefix(count)
        if stopAtNewline, let newline = chunk.firstIndex(of: 10) {
            bytes.append(contentsOf: chunk[...newline])
            break
        }
        bytes.append(contentsOf: chunk)
    }
    return bytes
}

private func readHiddenTTY() throws -> [UInt8] {
    try TokenCustodyHiddenTerminal.read()
}

private func blocked(_ cause: TokenCustodyCause) -> TokenCustodyResult {
    TokenCustodyResult(
        state: .blocked,
        cause: cause,
        nextAction: "repair-token-custody"
    )
}

private func emit(_ result: TokenCustodyResult) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    guard let encoded = try? encoder.encode(result) else {
        Foundation.exit(70)
    }
    FileHandle.standardOutput.write(encoded)
    FileHandle.standardOutput.write(Data([0x0a]))
    Foundation.exit(result.state == .blocked ? 20 : 0)
}

private final class ValidationCompletionBox: @unchecked Sendable {
    var reached = false
}

private func packagedValidatorExecutablePath() throws -> String {
    var buffer = [CChar](repeating: 0, count: 4_096)
    guard proc_pidpath(getpid(), &buffer, UInt32(buffer.count)) > 0 else {
        throw TokenCustodyCause.validationUnavailable
    }
    let end = buffer.firstIndex(of: 0) ?? buffer.endIndex
    let executablePath = String(
        decoding: buffer[..<end].map { UInt8(bitPattern: $0) },
        as: UTF8.self
    )
    let custodyExecutable = URL(
        fileURLWithPath: executablePath
    ).resolvingSymlinksInPath()
    return custodyExecutable
        .deletingLastPathComponent()
        .appendingPathComponent("browser-use-op-supervisor")
        .path
}

private func runMutation(_ arguments: Arguments) throws -> TokenCustodyResult {
    var bytes = try arguments.hiddenTTY
        ? readHiddenTTY()
        : readBoundedInput(descriptor: arguments.inputDescriptor!)
    defer {
        _ = bytes.withUnsafeMutableBytes {
            $0.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }
    let replacing = arguments.action == "replace"
    if let validatorDescriptor = arguments.validatorDescriptor {
        return TokenCustody.install(
            configRoot: arguments.configRoot,
            tokenBytes: &bytes,
            validatorDescriptor: validatorDescriptor,
            replacing: replacing
        )
    }
    guard arguments.validatorExecutable != nil,
          let opPath = arguments.opPath
    else {
        throw TokenCustodyCause.invalidArguments
    }
    let packagedValidator = try packagedValidatorExecutablePath()
    let child = try EnvironmentTokenValidatorProcess.start(
        executablePath: packagedValidator,
        requiredExecutablePath: packagedValidator,
        opPath: opPath,
        stagingRoot: arguments.configRoot
    )
    let completion = ValidationCompletionBox()
    let result = TokenCustody.installWithValidationCompletion(
        configRoot: arguments.configRoot,
        tokenBytes: &bytes,
        validatorDescriptor: child.socket,
        replacing: replacing,
        validationCompletion: {
            completion.reached = true
            guard child.finish() == 0,
                  !EnvironmentTokenValidatorProcess.terminationWasRequested
            else {
                throw TokenCustodyCause.validationUnavailable
            }
        }
    )
    if !completion.reached {
        child.cancel()
    }
    return result
}

_ = signal(SIGPIPE, SIG_IGN)

do {
    try TokenCustodyProcessSafety.disableCoreDumps()
} catch let cause as TokenCustodyCause {
    emit(blocked(cause))
} catch {
    emit(blocked(.coreDumpDisableFailed))
}

let forbiddenEnvironmentKeys = [
    "OP_SERVICE_ACCOUNT_TOKEN",
    "BROWSER_USE_TOKEN",
    "BROWSER_USE_OP_TOKEN",
]
if forbiddenEnvironmentKeys.contains(where: { ProcessInfo.processInfo.environment[$0] != nil }) {
    emit(blocked(.invalidArguments))
}

do {
    let arguments = try parseArguments(Array(CommandLine.arguments.dropFirst()))
    switch arguments.action {
    case "status":
        emit(TokenCustody.status(configRoot: arguments.configRoot))
    case "install", "replace":
        emit(try runMutation(arguments))
    case "remove":
        emit(TokenCustody.remove(configRoot: arguments.configRoot))
    case "cleanup":
        emit(TokenCustody.cleanup(configRoot: arguments.configRoot))
    default:
        emit(blocked(.invalidArguments))
    }
} catch let cause as TokenCustodyCause {
    emit(blocked(cause))
} catch {
    emit(blocked(.invalidArguments))
}
