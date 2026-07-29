@_spi(Executor) import BrowserUseEnvironmentAuth
import Darwin
import Foundation

private enum SupervisorArguments {
    case admit(opPath: String)
    case metadata(
        configRoot: String,
        opPath: String,
        operation: EnvironmentOpMetadataOperation
    )
    case validate(validatorDescriptor: Int32, opPath: String)
}

private func exactOptions(_ values: ArraySlice<String>) -> [String: String]? {
    var options: [String: String] = [:]
    var index = values.startIndex
    while index < values.endIndex {
        let flag = values[index]
        guard flag.hasPrefix("--") else { return nil }
        let valueIndex = values.index(after: index)
        guard valueIndex < values.endIndex, options[flag] == nil else {
            return nil
        }
        options[flag] = values[valueIndex]
        index = values.index(after: valueIndex)
    }
    return options
}

private func safeCoordinate(_ value: String) -> Bool {
    guard !value.isEmpty, value.utf8.count <= 256 else { return false }
    return value.utf8.allSatisfy {
        ($0 >= 48 && $0 <= 57)
            || ($0 >= 65 && $0 <= 90)
            || ($0 >= 97 && $0 <= 122)
            || $0 == 45 || $0 == 46 || $0 == 58 || $0 == 95
    }
}

private func parseArguments(_ values: [String]) -> SupervisorArguments? {
    guard let mode = values.first,
          let options = exactOptions(values.dropFirst())
    else {
        return nil
    }
    switch mode {
    case "admit":
        guard options.count == 1,
              let opPath = options["--op-path"]
        else {
            return nil
        }
        return .admit(opPath: opPath)
    case "metadata":
        guard let configRoot = options["--config-root"],
              let opPath = options["--op-path"],
              let operationName = options["--operation"]
        else {
            return nil
        }
        let operation: EnvironmentOpMetadataOperation
        switch operationName {
        case "user-get":
            guard options.count == 3 else { return nil }
            operation = .userGet
        case "vault-list":
            guard options.count == 3 else { return nil }
            operation = .vaultList
        case "item-list":
            guard options.count == 4,
                  let vaultID = options["--vault-id"],
                  safeCoordinate(vaultID)
            else {
                return nil
            }
            operation = .itemList(vaultID: vaultID)
        case "item-get":
            guard options.count == 5,
                  let vaultID = options["--vault-id"],
                  let itemID = options["--item-id"],
                  safeCoordinate(vaultID),
                  safeCoordinate(itemID)
            else {
                return nil
            }
            operation = .itemGet(vaultID: vaultID, itemID: itemID)
        case "binding-evidence":
            let expectedVaultID = options["--expected-vault-id"]
            let itemID = options["--item-id"]
            let requiredKeys: Set<String> = [
                "--config-root",
                "--op-path",
                "--operation",
            ]
            let expectedKeys = expectedVaultID == nil
                ? requiredKeys
                : requiredKeys.union(["--expected-vault-id", "--item-id"])
            guard (expectedVaultID == nil || safeCoordinate(expectedVaultID!)),
                  (itemID == nil || safeCoordinate(itemID!)),
                  (itemID == nil) == (expectedVaultID == nil),
                  Set(options.keys) == expectedKeys
            else {
                return nil
            }
            operation = .bindingEvidence(
                expectedVaultID: expectedVaultID,
                itemID: itemID
            )
        default:
            return nil
        }
        return .metadata(
            configRoot: configRoot,
            opPath: opPath,
            operation: operation
        )
    case "validate":
        guard options.count == 2,
              let rawDescriptor = options["--validator-fd"],
              let descriptor = Int32(rawDescriptor),
              descriptor >= 0,
              let opPath = options["--op-path"]
        else {
            return nil
        }
        return .validate(validatorDescriptor: descriptor, opPath: opPath)
    default:
        return nil
    }
}

private let helpText = """
Usage:
  browser-use-op-supervisor admit --op-path <absolute-path>
  browser-use-op-supervisor metadata --config-root <absolute-path> --op-path <absolute-path> --operation <name>
  browser-use-op-supervisor validate --validator-fd <fd> --op-path <absolute-path>

Commands:
  admit      Check the fixed official OP path without reading a token.
  metadata   Execute one admitted projected metadata operation.
  validate   Validate one token received through an inherited socket.
"""

private func rejection(_ code: String) -> Data {
    let object: [String: Any] = [
        "schema_version": 1,
        "ok": false,
        "rejection": [
            "code": code,
            "message": "native OP supervisor blocked; inspect the typed code and repair the local capability.",
        ],
    ]
    return (try? JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys]
    )) ?? Data("{\"ok\":false,\"schema_version\":1}".utf8)
}

private func admissionEnvelope(_ result: EnvironmentOpAdmissionResult) -> Data {
    let object: [String: Any]
    switch result {
    case .admitted:
        object = [
            "schema_version": 1,
            "ok": true,
            "state": "ready",
        ]
    case let .blocked(cause):
        let state: String
        switch cause {
        case .pathUnavailable:
            state = "missing"
        case .stagingFailed:
            state = "unproven"
        default:
            state = "unsafe"
        }
        object = [
            "schema_version": 1,
            "ok": false,
            "state": state,
            "rejection": ["code": cause.rawValue],
        ]
    }
    return (try? JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys]
    )) ?? Data(
        "{\"ok\":false,\"schema_version\":1,\"state\":\"unproven\",\"rejection\":{\"code\":\"op-staging-failed\"}}".utf8
    )
}

private func emit(_ data: Data, exitCode: Int32) -> Never {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
    Foundation.exit(exitCode)
}

private func emitValidator(_ approved: Bool, socket: Int32) -> Never {
    let bytes = approved ? Array("ok\n".utf8) : Array("no\n".utf8)
    _ = bytes.withUnsafeBytes {
        Darwin.write(socket, $0.baseAddress, bytes.count)
    }
    Foundation.exit(approved ? 0 : 20)
}

_ = signal(SIGPIPE, SIG_IGN)
let rawArguments = Array(CommandLine.arguments.dropFirst())
if rawArguments == ["--help"] || rawArguments == ["help"] {
    FileHandle.standardOutput.write(Data(helpText.utf8))
    FileHandle.standardOutput.write(Data([0x0a]))
    Foundation.exit(0)
}
do {
    try TokenCustodyProcessSafety.disableCoreDumps()
} catch {
    emit(rejection("core-dump-disable-failed"), exitCode: 20)
}

let forbiddenEnvironmentKeys = [
    "OP_SERVICE_ACCOUNT_TOKEN",
    "OP_CONNECT_HOST",
    "OP_CONNECT_TOKEN",
    "BROWSER_USE_TOKEN",
    "BROWSER_USE_OP_TOKEN",
]
guard !forbiddenEnvironmentKeys.contains(where: {
    ProcessInfo.processInfo.environment[$0] != nil
}) else {
    emit(rejection("ambient-op-environment"), exitCode: 20)
}

guard let arguments = parseArguments(rawArguments) else {
    emit(rejection("invalid-arguments"), exitCode: 20)
}

switch arguments {
case let .admit(opPath):
    let result = EnvironmentOpSupervisor.admitOfficialExecutable(
        executablePath: opPath
    )
    switch result {
    case .admitted:
        emit(admissionEnvelope(result), exitCode: 0)
    case .blocked:
        emit(admissionEnvelope(result), exitCode: 20)
    }
case let .metadata(configRoot, opPath, operation):
    do {
        let tokenDescriptor = try openEnvironmentTokenDescriptor(configRoot: configRoot)
        defer { _ = Darwin.close(tokenDescriptor) }
        let result = EnvironmentOpSupervisor.executeAdmittedMetadata(
            executablePath: opPath,
            operation: operation,
            tokenDescriptor: tokenDescriptor
        )
        let decoded = try? JSONSerialization.jsonObject(with: result)
            as? [String: Any]
        emit(result, exitCode: decoded?["ok"] as? Bool == true ? 0 : 20)
    } catch let cause as TokenCustodyCause {
        emit(rejection(cause.rawValue), exitCode: 20)
    } catch {
        emit(rejection("token-custody-unavailable"), exitCode: 20)
    }
case let .validate(validatorDescriptor, opPath):
    do {
        let tokenDescriptor = try EnvironmentOpSupervisor.receiveTokenDescriptor(
            socket: validatorDescriptor
        )
        defer { _ = Darwin.close(tokenDescriptor) }
        emitValidator(
            EnvironmentOpSupervisor.validateStagedToken(
                executablePath: opPath,
                tokenDescriptor: tokenDescriptor
            ),
            socket: validatorDescriptor
        )
    } catch {
        emitValidator(false, socket: validatorDescriptor)
    }
}
