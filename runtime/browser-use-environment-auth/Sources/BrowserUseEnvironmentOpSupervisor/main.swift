@_spi(Executor) import BrowserUseEnvironmentAuth
import Darwin
import Foundation

private enum SupervisorArguments {
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

guard let arguments = parseArguments(Array(CommandLine.arguments.dropFirst())) else {
    emit(rejection("invalid-arguments"), exitCode: 20)
}

switch arguments {
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
