@_spi(Executor) @_spi(Testing) import BrowserUseEnvironmentAuth
import Darwin
import Foundation
import SQLite3

@_silgen_name("fork")
private func supervisorFork() -> pid_t

private enum SupervisorArguments {
    case admit(opPath: String)
    case metadata(
        configRoot: String,
        opPath: String,
        operation: EnvironmentOpMetadataOperation
    )
    case bindingSelection(BindingSelectionRequest)
    case validate(validatorDescriptor: Int32, opPath: String)
    case install(TokenInstallRequest)
    case remove(configRoot: String)
    case status(TokenStatusRequest)
    case deliver(DeliveryRequest)
}

private struct BindingSelectionRequest {
    let configRoot: String
    let opPath: String
    let vaultID: String
    let origin: String
    let expectedDigest: String
    let expectedCount: Int
}

private struct TokenInstallRequest {
    let configRoot: String
    let opPath: String
    let input: String
    let replacing: Bool
}

private struct TokenStatusRequest {
    let configRoot: String
    let opPath: String
    let profilePath: String
}

private struct DeliveryRequest {
    let configRoot: String?
    let tokenDescriptor: Int32?
    let tokenPath: String?
    let opPath: String
    let deliveryPath: String?
    let vaultID: String
    let itemID: String
    let field: EnvironmentOpPrivateField
    let webSocketURL: String
    let targetURL: String
    let targetOrigin: String
    let fieldRole: String
    let fieldName: String
    let activationRole: String?
    let activationName: String?
    let timeoutMilliseconds: Int32
    let useUnadmittedOp: Bool
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

private func safeDescriptorPart(
    _ value: String,
    allowEmpty: Bool
) -> Bool {
    (allowEmpty || !value.isEmpty)
        && value.utf8.count <= 512
        && !value.contains("\0")
        && !value.contains("\n")
        && !value.contains("\r")
}

private func normalizedOrigin(_ raw: String) -> String? {
    EnvironmentDeliveryOriginSafety.normalizedOrigin(raw)
}

private func origin(of raw: String) -> String? {
    EnvironmentDeliveryOriginSafety.origin(of: raw)
}

private func safeWebSocketURL(_ raw: String) -> Bool {
    guard raw.utf8.count <= 2_048,
          let url = URL(string: raw),
          ["ws", "wss"].contains(url.scheme?.lowercased() ?? ""),
          url.host != nil,
          url.user == nil,
          url.password == nil,
          url.query == nil,
          url.fragment == nil
    else {
        return false
    }
    return true
}

private func safeTarget(
    url rawURL: String,
    origin rawOrigin: String
) -> Bool {
    guard rawURL.utf8.count <= 2_048,
          let url = URL(string: rawURL),
          ["http", "https"].contains(url.scheme?.lowercased() ?? ""),
          url.host != nil,
          url.user == nil,
          url.password == nil,
          url.fragment == nil,
          let expectedOrigin = normalizedOrigin(rawOrigin),
          origin(of: rawURL) == expectedOrigin
    else {
        return false
    }
    return true
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
    case "binding-selection":
        guard options.count == 6,
              let configRoot = options["--config-root"],
              let opPath = options["--op-path"],
              let vaultID = options["--vault-id"],
              let rawOrigin = options["--origin"],
              let expectedDigest = options["--expected-candidate-digest"],
              let rawCount = options["--candidate-count"],
              let expectedCount = Int(rawCount),
              expectedCount > 0,
              expectedCount <= 1_000,
              safeCoordinate(vaultID),
              expectedDigest.count == 64,
              expectedDigest.allSatisfy({ $0.isHexDigit }),
              normalizedOrigin(rawOrigin) == rawOrigin
        else { return nil }
        return .bindingSelection(
            BindingSelectionRequest(
                configRoot: configRoot,
                opPath: opPath,
                vaultID: vaultID,
                origin: rawOrigin,
                expectedDigest: expectedDigest,
                expectedCount: expectedCount
            )
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
    case "install":
        guard options.count == 4,
              let configRoot = options["--config-root"],
              let opPath = options["--op-path"],
              let input = options["--input"],
              input == "stdin" || input == "prompt",
              let rawReplacing = options["--replace"],
              rawReplacing == "true" || rawReplacing == "false"
        else {
            return nil
        }
        return .install(
            TokenInstallRequest(
                configRoot: configRoot,
                opPath: opPath,
                input: input,
                replacing: rawReplacing == "true"
            )
        )
    case "remove":
        guard options.count == 1,
              let configRoot = options["--config-root"]
        else {
            return nil
        }
        return .remove(configRoot: configRoot)
    case "status":
        guard options.count == 3,
              let configRoot = options["--config-root"],
              let opPath = options["--op-path"],
              let profilePath = options["--profile-path"]
        else {
            return nil
        }
        return .status(
            TokenStatusRequest(
                configRoot: configRoot,
                opPath: opPath,
                profilePath: profilePath
            )
        )
    case "deliver":
        guard let opPath = options["--op-path"],
              let vaultID = options["--vault-id"],
              let itemID = options["--item-id"],
              let fieldName = options["--field"],
              let field = EnvironmentOpPrivateField(rawValue: fieldName),
              let webSocketURL = options["--ws-url"],
              let targetURL = options["--target-url"],
              let targetOrigin = options["--target-origin"],
              let fieldRole = options["--field-role"],
              let accessibleName = options["--field-name"],
              let rawTimeout = options["--timeout-ms"],
              let timeout = Int32(rawTimeout),
              (500...30_000).contains(timeout),
              safeCoordinate(vaultID),
              safeCoordinate(itemID),
              safeWebSocketURL(webSocketURL),
              safeTarget(url: targetURL, origin: targetOrigin),
              safeDescriptorPart(fieldRole, allowEmpty: false),
              safeDescriptorPart(accessibleName, allowEmpty: true)
        else {
            return nil
        }
        let activationRole = options["--activate-role"]
        let activationName = options["--activate-name"]
        guard (activationRole == nil) == (activationName == nil),
              activationRole.map({
                  safeDescriptorPart($0, allowEmpty: false)
              }) ?? true,
              activationName.map({
                  safeDescriptorPart($0, allowEmpty: true)
              }) ?? true
        else {
            return nil
        }

        var requiredKeys: Set<String> = [
            "--config-root",
            "--op-path",
            "--vault-id",
            "--item-id",
            "--field",
            "--ws-url",
            "--target-url",
            "--target-origin",
            "--field-role",
            "--field-name",
            "--timeout-ms",
        ]
        if activationRole != nil {
            requiredKeys.formUnion(["--activate-role", "--activate-name"])
        }
        let configRoot = options["--config-root"]
        var tokenDescriptor: Int32?
        var tokenPath: String?
        var deliveryPath: String?
        var useUnadmittedOp = false
#if DEBUG
        if let rawDescriptor = options["--test-token-fd"],
           let descriptor = Int32(rawDescriptor),
           descriptor >= 3
        {
            guard configRoot == nil else { return nil }
            tokenDescriptor = descriptor
            requiredKeys.remove("--config-root")
            requiredKeys.insert("--test-token-fd")
        }
        if let path = options["--test-token-path"] {
            guard configRoot == nil, tokenDescriptor == nil, path.hasPrefix("/") else {
                return nil
            }
            tokenPath = path
            requiredKeys.remove("--config-root")
            requiredKeys.insert("--test-token-path")
        }
        if let path = options["--test-delivery-path"] {
            deliveryPath = path
            requiredKeys.insert("--test-delivery-path")
        }
        if let testMode = options["--test-unadmitted-op"] {
            guard testMode == "true" else { return nil }
            useUnadmittedOp = true
            requiredKeys.insert("--test-unadmitted-op")
        }
#endif
        guard Set(options.keys) == requiredKeys,
              configRoot != nil || tokenDescriptor != nil || tokenPath != nil
        else {
            return nil
        }
        return .deliver(
            DeliveryRequest(
                configRoot: configRoot,
                tokenDescriptor: tokenDescriptor,
                tokenPath: tokenPath,
                opPath: opPath,
                deliveryPath: deliveryPath,
                vaultID: vaultID,
                itemID: itemID,
                field: field,
                webSocketURL: webSocketURL,
                targetURL: targetURL,
                targetOrigin: normalizedOrigin(targetOrigin) ?? targetOrigin,
                fieldRole: fieldRole,
                fieldName: accessibleName,
                activationRole: activationRole,
                activationName: activationName,
                timeoutMilliseconds: timeout,
                useUnadmittedOp: useUnadmittedOp
            )
        )
    default:
        return nil
    }
}

private let helpText = """
Usage:
  browser-use-op-supervisor admit --op-path <absolute-path>
  browser-use-op-supervisor metadata --config-root <absolute-path> --op-path <absolute-path> --operation <name>
  browser-use-op-supervisor binding-selection --config-root <absolute-path> --op-path <absolute-path> --vault-id <id> --origin <origin> --expected-candidate-digest <sha256> --candidate-count <count>
  browser-use-op-supervisor validate --validator-fd <fd> --op-path <absolute-path>
  browser-use-op-supervisor install --config-root <absolute-path> --op-path <absolute-path> --input <stdin|prompt> --replace <true|false>
  browser-use-op-supervisor remove --config-root <absolute-path>
  browser-use-op-supervisor status --config-root <absolute-path> --op-path <absolute-path> --profile-path <absolute-path>
  browser-use-op-supervisor deliver --config-root <absolute-path> --op-path <absolute-path> --vault-id <id> --item-id <id> --field <name> --ws-url <url> --target-url <url> --target-origin <origin> --field-role <role> --field-name <name> --timeout-ms <milliseconds> [--activate-role <role> --activate-name <name>]

Commands:
  admit      Check the fixed official OP path without reading a token.
  metadata   Execute one admitted projected metadata operation.
  binding-selection  Show one local descriptor-private picker and return only the selected redacted evidence.
  validate   Validate one token received through an inherited socket.
  install    Read hidden or piped input and atomically install validated custody.
  remove     Remove only the exact admitted local custody file.
  status     Report the five secret-free environment-lane admission checks.
  deliver    Deliver one admitted private field through the disposable child.
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

private func jsonData(_ object: [String: Any]) -> Data {
    (try? JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys]
    )) ?? rejection("token-supervisor-json-failed")
}

private func publicNextAction(_ result: TokenCustodyResult) -> String {
    switch result.nextAction {
    case "validate-service-account":
        return "auth-status"
    case "install-local-token":
        return "install-token"
    case "repair-vault-grant":
        return "repair-vault-grant"
    case "repair-op-admission":
        return "repair-op-admission"
    case "revoke-service-account-token-remotely":
        return "revoke-service-account-token-remotely"
    default:
        return "repair-token-custody"
    }
}

private func custodyEnvelope(_ result: TokenCustodyResult) -> Data {
    let successfulStates: Set<TokenCustodyState> = [
        .ready,
        .installed,
        .replaced,
        .removed,
    ]
    var object: [String: Any] = [
        "schema_version": 1,
        "ok": successfulStates.contains(result.state),
        "state": result.state.rawValue,
        "next_action": publicNextAction(result),
    ]
    if let cause = result.cause {
        object["cause"] = cause.rawValue
    }
    if let remoteAuthority = result.remoteAuthority {
        object["remote_authority"] = remoteAuthority
    }
    return jsonData(object)
}

private func blockedCustodyEnvelope(
    cause: String,
    nextAction: String
) -> Data {
    jsonData([
        "schema_version": 1,
        "ok": false,
        "state": "blocked",
        "cause": cause,
        "next_action": nextAction,
    ])
}

private func readBoundedStandardInput() throws -> [UInt8] {
    var bytes: [UInt8] = []
    var buffer = [UInt8](repeating: 0, count: 4_096)
    defer {
        _ = buffer.withUnsafeMutableBytes {
            $0.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }
    while true {
        let capacity = buffer.count
        let count = buffer.withUnsafeMutableBytes {
            Darwin.read(STDIN_FILENO, $0.baseAddress, capacity)
        }
        if count == 0 { return bytes }
        guard count > 0 else {
            if errno == EINTR { continue }
            throw TokenCustodyCause.inputInvalid
        }
        guard bytes.count + count <= 65_536 else {
            throw TokenCustodyCause.inputInvalid
        }
        bytes.append(contentsOf: buffer.prefix(count))
    }
}

private func reapValidator(_ child: pid_t) {
    var status: Int32 = 0
    let waited = waitpid(child, &status, WNOHANG)
    if waited == 0 {
        _ = kill(child, SIGKILL)
        while waitpid(child, &status, 0) < 0, errno == EINTR {}
    }
}

private func installToken(_ request: TokenInstallRequest) -> TokenCustodyResult {
    switch EnvironmentOpSupervisor.admitOfficialExecutable(
        executablePath: request.opPath
    ) {
    case let .blocked(cause):
        return TokenCustodyResult(
            state: .blocked,
            cause: cause == .pathUnavailable ? .validationUnavailable : .validationFailed,
            nextAction: "repair-op-admission"
        )
    case .admitted:
        break
    }
    var tokenBytes: [UInt8]
    do {
        tokenBytes = try request.input == "stdin"
            ? readBoundedStandardInput()
            : TokenCustodyHiddenTerminal.read()
    } catch let cause as TokenCustodyCause {
        return TokenCustodyResult(
            state: .blocked,
            cause: cause,
            nextAction: "repair-token-custody"
        )
    } catch {
        return TokenCustodyResult(
            state: .blocked,
            cause: .inputInvalid,
            nextAction: "repair-token-custody"
        )
    }
    defer {
        _ = tokenBytes.withUnsafeMutableBytes {
            $0.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }
    var validatorSockets: [Int32] = [-1, -1]
    guard socketpair(AF_UNIX, SOCK_STREAM, 0, &validatorSockets) == 0 else {
        return TokenCustodyResult(
            state: .blocked,
            cause: .validationUnavailable,
            nextAction: "repair-token-custody"
        )
    }
    let child = supervisorFork()
    guard child >= 0 else {
        validatorSockets.forEach { _ = Darwin.close($0) }
        return TokenCustodyResult(
            state: .blocked,
            cause: .validationUnavailable,
            nextAction: "repair-token-custody"
        )
    }
    if child == 0 {
        _ = Darwin.close(validatorSockets[0])
        do {
            let tokenDescriptor = try EnvironmentOpSupervisor.receiveTokenDescriptor(
                socket: validatorSockets[1],
                timeoutMilliseconds: 45_000
            )
            defer { _ = Darwin.close(tokenDescriptor) }
            emitValidator(
                EnvironmentOpSupervisor.validateStagedToken(
                    executablePath: request.opPath,
                    tokenDescriptor: tokenDescriptor
                ),
                socket: validatorSockets[1]
            )
        } catch {
            emitValidator(.rejected, socket: validatorSockets[1])
        }
    }
    _ = Darwin.close(validatorSockets[1])
    let result = TokenCustody.install(
        configRoot: request.configRoot,
        tokenBytes: &tokenBytes,
        validatorDescriptor: validatorSockets[0],
        replacing: request.replacing
    )
    _ = Darwin.close(validatorSockets[0])
    reapValidator(child)
    return result
}

private func profilePolicyCheck(
    _ profilePath: String,
    afterInitialLoginDataSidecarCheck: () -> Void = {}
) -> [String: Any] {
    guard profilePath.hasPrefix("/"),
          !profilePath.contains("\0"),
          URL(fileURLWithPath: profilePath).standardizedFileURL.path == profilePath
    else {
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }
    var profileMetadata = stat()
    guard lstat(profilePath, &profileMetadata) == 0,
          profileMetadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
          profileMetadata.st_uid == geteuid(),
          profileMetadata.st_mode & mode_t(0o777) == mode_t(0o700)
    else {
        return ["status": "blocked", "cause": "profile-policy-unproven"]
    }
    let preferencesPath = URL(fileURLWithPath: profilePath)
        .appendingPathComponent("Default")
        .appendingPathComponent("Preferences")
        .path
    guard let data = try? Data(
              contentsOf: URL(fileURLWithPath: preferencesPath),
              options: [.mappedIfSafe]
          ),
          data.count <= 1_048_576,
          let preferences = try? JSONSerialization.jsonObject(with: data)
              as? [String: Any],
          preferences["credentials_enable_service"] as? Bool == false,
          let profile = preferences["profile"] as? [String: Any],
          profile["password_manager_enabled"] as? Bool == false,
          let autofill = preferences["autofill"] as? [String: Any],
          autofill["profile_enabled"] as? Bool == false,
          autofill["credit_card_enabled"] as? Bool == false,
          let sync = preferences["sync"] as? [String: Any],
          sync["requested"] as? Bool == false
    else {
        return ["status": "blocked", "cause": "profile-policy-unproven"]
    }
    let loginDataPath = URL(fileURLWithPath: profilePath)
        .appendingPathComponent("Default")
        .appendingPathComponent("Login Data")
        .path
    var loginMetadata = stat()
    guard lstat(loginDataPath, &loginMetadata) == 0 else {
        return errno == ENOENT
            ? ["status": "ready"]
            : ["status": "blocked", "cause": "profile-policy-unsafe"]
    }
    guard loginMetadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG) else {
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }
    guard loginDataSidecarIsEmptyOrMissing(loginDataPath + "-wal") else {
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }
    afterInitialLoginDataSidecarCheck()

    let temporaryRoot = FileManager.default.temporaryDirectory.path
    let template = (temporaryRoot as NSString)
        .appendingPathComponent("browser-use-profile-policy-XXXXXXXX")
    var templateBytes = Array(template.utf8CString)
    guard mkdtemp(&templateBytes) != nil else {
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }
    let snapshotDirectory = templateBytes.withUnsafeBufferPointer {
        String(cString: $0.baseAddress!)
    }
    defer { try? FileManager.default.removeItem(atPath: snapshotDirectory) }
    var snapshotDirectoryMetadata = stat()
    guard lstat(snapshotDirectory, &snapshotDirectoryMetadata) == 0,
          snapshotDirectoryMetadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFDIR),
          snapshotDirectoryMetadata.st_uid == geteuid(),
          snapshotDirectoryMetadata.st_mode & mode_t(0o777) == mode_t(0o700)
    else {
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }

    var liveDatabase: OpaquePointer?
    guard sqlite3_open_v2(
              loginDataPath,
              &liveDatabase,
              SQLITE_OPEN_READONLY,
              nil
          ) == SQLITE_OK,
          let liveDatabase
    else {
        if let liveDatabase { sqlite3_close(liveDatabase) }
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }
    defer { sqlite3_close(liveDatabase) }

    let backupSnapshotPath = (snapshotDirectory as NSString)
        .appendingPathComponent("Login Data")
    var backupDatabase: OpaquePointer?
    guard sqlite3_open_v2(
              backupSnapshotPath,
              &backupDatabase,
              SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_EXCLUSIVE,
              nil
          ) == SQLITE_OK,
          let backupDatabase
    else {
        if let backupDatabase { sqlite3_close(backupDatabase) }
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }
    guard chmod(backupSnapshotPath, 0o600) == 0 else {
        sqlite3_close(backupDatabase)
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }
    var backupStep = SQLITE_ERROR
    var backupFinished = SQLITE_ERROR
    if let backup = sqlite3_backup_init(
        backupDatabase,
        "main",
        liveDatabase,
        "main"
    ) {
        backupStep = sqlite3_backup_step(backup, -1)
        backupFinished = sqlite3_backup_finish(backup)
    }

    let database: OpaquePointer
    if backupStep == SQLITE_DONE,
       backupFinished == SQLITE_OK,
       profileSnapshotFileIsOwned(backupSnapshotPath)
    {
        database = backupDatabase
    } else {
        sqlite3_close(backupDatabase)
        let lockedSnapshotPath = (snapshotDirectory as NSString)
            .appendingPathComponent("Locked Login Data")
        guard let lockedDatabase = openStableLockedLoginDataSnapshot(
            sourcePath: loginDataPath,
            expectedMetadata: loginMetadata,
            snapshotPath: lockedSnapshotPath
        ) else {
            return ["status": "blocked", "cause": "profile-policy-unsafe"]
        }
        database = lockedDatabase
    }
    defer { sqlite3_close(database) }

    var schemaStatement: OpaquePointer?
    guard sqlite3_prepare_v2(
              database,
              "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'logins' COLLATE NOCASE LIMIT 1",
              -1,
              &schemaStatement,
              nil
          ) == SQLITE_OK,
          let schemaStatement
    else {
        if let schemaStatement { sqlite3_finalize(schemaStatement) }
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }
    let schemaStep = sqlite3_step(schemaStatement)
    let schemaFinalized = sqlite3_finalize(schemaStatement)
    if schemaStep == SQLITE_DONE, schemaFinalized == SQLITE_OK {
        return ["status": "ready"]
    }
    guard schemaStep == SQLITE_ROW, schemaFinalized == SQLITE_OK else {
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }

    var countStatement: OpaquePointer?
    guard sqlite3_prepare_v2(
              database,
              "SELECT count(*) FROM logins",
              -1,
              &countStatement,
              nil
          ) == SQLITE_OK,
          let countStatement
    else {
        if let countStatement { sqlite3_finalize(countStatement) }
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }
    let countStep = sqlite3_step(countStatement)
    let loginCount = countStep == SQLITE_ROW
        ? sqlite3_column_int64(countStatement, 0)
        : -1
    let countComplete = sqlite3_step(countStatement)
    let countFinalized = sqlite3_finalize(countStatement)
    guard countStep == SQLITE_ROW,
          countComplete == SQLITE_DONE,
          countFinalized == SQLITE_OK,
          loginCount == 0
    else {
        return ["status": "blocked", "cause": "profile-policy-unsafe"]
    }
    return ["status": "ready"]
}

private func loginDataSidecarIsEmptyOrMissing(_ path: String) -> Bool {
    var metadata = stat()
    if lstat(path, &metadata) == 0 {
        return metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
            && metadata.st_size == 0
    }
    return errno == ENOENT
}

private func profileSnapshotFileIsOwned(_ path: String) -> Bool {
    var metadata = stat()
    return lstat(path, &metadata) == 0
        && metadata.st_mode & mode_t(S_IFMT) == mode_t(S_IFREG)
        && metadata.st_uid == geteuid()
        && metadata.st_mode & mode_t(0o077) == 0
}

private func loginDataMetadataIsStable(_ lhs: stat, _ rhs: stat) -> Bool {
    lhs.st_dev == rhs.st_dev
        && lhs.st_ino == rhs.st_ino
        && lhs.st_mode == rhs.st_mode
        && lhs.st_uid == rhs.st_uid
        && lhs.st_size == rhs.st_size
        && lhs.st_mtimespec.tv_sec == rhs.st_mtimespec.tv_sec
        && lhs.st_mtimespec.tv_nsec == rhs.st_mtimespec.tv_nsec
        && lhs.st_ctimespec.tv_sec == rhs.st_ctimespec.tv_sec
        && lhs.st_ctimespec.tv_nsec == rhs.st_ctimespec.tv_nsec
}

private func openStableLockedLoginDataSnapshot(
    sourcePath: String,
    expectedMetadata: stat,
    snapshotPath: String
) -> OpaquePointer? {
    let sidecarPaths = [sourcePath + "-wal", sourcePath + "-journal"]
    guard sidecarPaths.allSatisfy(loginDataSidecarIsEmptyOrMissing) else {
        return nil
    }
    let sourceDescriptor = open(sourcePath, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
    guard sourceDescriptor >= 0 else { return nil }
    defer { close(sourceDescriptor) }
    var sourceBefore = stat()
    guard fstat(sourceDescriptor, &sourceBefore) == 0,
          loginDataMetadataIsStable(expectedMetadata, sourceBefore)
    else {
        return nil
    }
    var snapshotDescriptor = open(
        snapshotPath,
        O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC,
        mode_t(0o600)
    )
    guard snapshotDescriptor >= 0 else { return nil }
    defer {
        if snapshotDescriptor >= 0 { close(snapshotDescriptor) }
    }
    guard fcopyfile(
              sourceDescriptor,
              snapshotDescriptor,
              nil,
              copyfile_flags_t(COPYFILE_DATA)
          ) == 0
    else {
        return nil
    }
    var sourceAfter = stat()
    var sourcePathAfter = stat()
    guard fstat(sourceDescriptor, &sourceAfter) == 0,
          lstat(sourcePath, &sourcePathAfter) == 0,
          loginDataMetadataIsStable(sourceBefore, sourceAfter),
          loginDataMetadataIsStable(sourceBefore, sourcePathAfter),
          sidecarPaths.allSatisfy(loginDataSidecarIsEmptyOrMissing)
    else {
        return nil
    }
    let snapshotCloseResult = close(snapshotDescriptor)
    snapshotDescriptor = -1
    guard snapshotCloseResult == 0 else { return nil }
    guard profileSnapshotFileIsOwned(snapshotPath) else { return nil }

    var database: OpaquePointer?
    guard sqlite3_open_v2(
              snapshotPath,
              &database,
              SQLITE_OPEN_READONLY,
              nil
          ) == SQLITE_OK,
          let database
    else {
        if let database { sqlite3_close(database) }
        return nil
    }
    return database
}

private func tokenStatusEnvelope(_ request: TokenStatusRequest) -> Data {
    let custody = TokenCustody.status(configRoot: request.configRoot)
    var checks: [String: Any] = [
        "token_file": ["status": "unproven"],
        "op": ["status": "unproven"],
        "token": ["status": "unproven"],
        "vault_scope": ["status": "unproven"],
        "profile_policy": ["status": "unproven"],
    ]
    guard custody.state == .ready else {
        let status = custody.state == .missing ? "missing" : "blocked"
        var tokenFile: [String: Any] = ["status": status]
        if let cause = custody.cause { tokenFile["cause"] = cause.rawValue }
        checks["token_file"] = tokenFile
        return jsonData([
            "schema_version": 1,
            "ok": false,
            "state": custody.state.rawValue,
            "cause": custody.cause?.rawValue ?? "token-missing",
            "lane": [
                "selected": "environment-injected-op",
                "status": "blocked",
            ],
            "checks": checks,
            "next_action": custody.state == .missing
                ? "install-token"
                : "repair-token-custody",
        ])
    }
    checks["token_file"] = ["status": "ready"]
    switch EnvironmentOpSupervisor.admitOfficialExecutable(
        executablePath: request.opPath
    ) {
    case let .blocked(cause):
        checks["op"] = ["status": "blocked", "cause": cause.rawValue]
        return jsonData([
            "schema_version": 1,
            "ok": false,
            "state": "blocked",
            "cause": cause.rawValue,
            "lane": [
                "selected": "environment-injected-op",
                "status": "blocked",
            ],
            "checks": checks,
            "next_action": "repair-op-admission",
        ])
    case .admitted:
        checks["op"] = ["status": "ready"]
    }
    let tokenDescriptor: Int32
    do {
        tokenDescriptor = try openEnvironmentTokenDescriptor(
            configRoot: request.configRoot
        )
    } catch let cause as TokenCustodyCause {
        checks["token"] = ["status": "blocked", "cause": cause.rawValue]
        return jsonData([
            "schema_version": 1,
            "ok": false,
            "state": "blocked",
            "cause": cause.rawValue,
            "lane": [
                "selected": "environment-injected-op",
                "status": "blocked",
            ],
            "checks": checks,
            "next_action": "repair-token-custody",
        ])
    } catch {
        return blockedCustodyEnvelope(
            cause: "token-unsafe",
            nextAction: "repair-token-custody"
        )
    }
    defer { _ = Darwin.close(tokenDescriptor) }
    let vaultResult = EnvironmentOpSupervisor.executeAdmittedMetadata(
        executablePath: request.opPath,
        operation: .vaultList,
        tokenDescriptor: tokenDescriptor
    )
    guard let envelope = try? JSONSerialization.jsonObject(with: vaultResult)
              as? [String: Any],
          envelope["ok"] as? Bool == true,
          let vaults = envelope["value"] as? [Any]
    else {
        let rejection = (try? JSONSerialization.jsonObject(with: vaultResult)
            as? [String: Any])?["rejection"] as? [String: Any]
        let cause = rejection?["code"] as? String ?? "validation-failed"
        checks["token"] = ["status": "blocked", "cause": cause]
        return jsonData([
            "schema_version": 1,
            "ok": false,
            "state": "blocked",
            "cause": cause,
            "lane": [
                "selected": "environment-injected-op",
                "status": "blocked",
            ],
            "checks": checks,
            "next_action": "install-token",
        ])
    }
    checks["token"] = ["status": "ready"]
    guard vaults.count == 1 else {
        checks["vault_scope"] = [
            "status": "blocked",
            "cause": "invalid-vault-scope",
            "visible_count": vaults.count,
        ]
        return jsonData([
            "schema_version": 1,
            "ok": false,
            "state": "blocked",
            "cause": "invalid-vault-scope",
            "lane": [
                "selected": "environment-injected-op",
                "status": "blocked",
            ],
            "checks": checks,
            "next_action": "repair-vault-grant",
        ])
    }
    checks["vault_scope"] = ["status": "ready", "visible_count": 1]
    let profile = profilePolicyCheck(request.profilePath)
    checks["profile_policy"] = profile
    guard profile["status"] as? String == "ready" else {
        let cause = profile["cause"] as? String ?? "profile-policy-unproven"
        return jsonData([
            "schema_version": 1,
            "ok": false,
            "state": "blocked",
            "cause": cause,
            "lane": [
                "selected": "environment-injected-op",
                "status": "blocked",
            ],
            "checks": checks,
            "next_action": "create-credential-clean-profile",
        ])
    }
    return jsonData([
        "schema_version": 1,
        "ok": true,
        "state": "ready",
        "lane": [
            "selected": "environment-injected-op",
            "status": "ready",
        ],
        "checks": checks,
        "next_action": "rerun-confidential-command",
    ])
}

private func emit(_ data: Data, exitCode: Int32) -> Never {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
    Foundation.exit(exitCode)
}

private func emitValidator(
    _ result: EnvironmentTokenValidationResult,
    socket: Int32
) -> Never {
    let bytes: [UInt8]
    switch result {
    case .approved:
        bytes = Array("ok\n".utf8)
    case .timeout:
        bytes = Array("timeout\n".utf8)
    case .invalidServiceAccount:
        bytes = Array("identity\n".utf8)
    case .invalidVaultScope:
        bytes = Array("vault\n".utf8)
    case .rejected:
        bytes = Array("no\n".utf8)
    }
    _ = bytes.withUnsafeBytes {
        Darwin.write(socket, $0.baseAddress, bytes.count)
    }
    Foundation.exit(result == .approved ? 0 : 20)
}

/// Resolve the actually loaded supervisor image through dyld, never argv[0]:
/// argv[0] is caller-controlled, so trusting it would let a caller steer the
/// sibling lookup at an attacker-chosen directory. Fails closed (nil) when the
/// loaded image cannot be resolved to a canonical absolute path.
private func loadedSupervisorExecutable() -> String? {
    var capacity = UInt32(MAXPATHLEN)
    var buffer = [CChar](repeating: 0, count: Int(capacity))
    if _NSGetExecutablePath(&buffer, &capacity) != 0 {
        buffer = [CChar](repeating: 0, count: Int(capacity))
        guard _NSGetExecutablePath(&buffer, &capacity) == 0 else {
            return nil
        }
    }
    var resolved = [CChar](repeating: 0, count: Int(PATH_MAX))
    guard realpath(buffer, &resolved) != nil else {
        return nil
    }
    return resolved.withUnsafeBufferPointer { pointer in
        pointer.baseAddress.map { String(cString: $0) }
    }
}

private func siblingDeliveryExecutable() -> String? {
    guard let executable = loadedSupervisorExecutable(),
          executable.hasPrefix("/"), !executable.contains("\0")
    else {
        return nil
    }
    return URL(fileURLWithPath: executable)
        .deletingLastPathComponent()
        .appendingPathComponent("browser-use-field-delivery")
        .path
}

private func deliveryArguments(_ request: DeliveryRequest) -> [String] {
    var arguments = [
        "--ws-url", request.webSocketURL,
        "--target-url", request.targetURL,
        "--target-origin", request.targetOrigin,
        "--field-role", request.fieldRole,
        "--field-name", request.fieldName,
    ]
    if let activationRole = request.activationRole,
       let activationName = request.activationName
    {
        arguments.append(contentsOf: [
            "--activate-role", activationRole,
            "--activate-name", activationName,
        ])
    }
    return arguments
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
case let .bindingSelection(request):
    do {
        let tokenDescriptor = try openEnvironmentTokenDescriptor(
            configRoot: request.configRoot
        )
        defer { _ = Darwin.close(tokenDescriptor) }
        let result = EnvironmentOpSupervisor.executeAdmittedBindingSelection(
            executablePath: request.opPath,
            vaultID: request.vaultID,
            origin: request.origin,
            expectedDigest: request.expectedDigest,
            expectedCount: request.expectedCount,
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
        emitValidator(.rejected, socket: validatorDescriptor)
    }
case let .install(request):
    let result = installToken(request)
    let success = result.state == .installed || result.state == .replaced
    emit(custodyEnvelope(result), exitCode: success ? 0 : 20)
case let .remove(configRoot):
    let result = TokenCustody.remove(configRoot: configRoot)
    emit(
        custodyEnvelope(result),
        exitCode: result.state == .removed ? 0 : 20
    )
case let .status(request):
    let result = tokenStatusEnvelope(request)
    let decoded = try? JSONSerialization.jsonObject(with: result)
        as? [String: Any]
    emit(result, exitCode: decoded?["ok"] as? Bool == true ? 0 : 20)
case let .deliver(request):
    let deliveryPath = request.deliveryPath ?? siblingDeliveryExecutable()
    guard let deliveryPath else {
        emit(rejection("delivery-child-unavailable"), exitCode: 20)
    }
    let tokenDescriptor: Int32
    do {
        if let inheritedDescriptor = request.tokenDescriptor {
            tokenDescriptor = inheritedDescriptor
        } else if let tokenPath = request.tokenPath {
            let opened = Darwin.open(tokenPath, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
            guard opened >= 0, proveEnvironmentTokenDescriptor(opened) else {
                if opened >= 0 { _ = Darwin.close(opened) }
                emit(rejection("token-invalid"), exitCode: 20)
            }
            tokenDescriptor = opened
        } else if let configRoot = request.configRoot {
            tokenDescriptor = try openEnvironmentTokenDescriptor(
                configRoot: configRoot
            )
        } else {
            emit(rejection("token-custody-unavailable"), exitCode: 20)
        }
    } catch let cause as TokenCustodyCause {
        emit(rejection(cause.rawValue), exitCode: 20)
    } catch {
        emit(rejection("token-custody-unavailable"), exitCode: 20)
    }
    defer { _ = Darwin.close(tokenDescriptor) }

    let consume: (Int32, Int32) -> Data = { secretDescriptor, remaining in
        EnvironmentOpDeliveryRunner.run(
            executablePath: deliveryPath,
            arguments: deliveryArguments(request),
            secretReadDescriptor: secretDescriptor,
            timeoutMilliseconds: remaining
        )
    }
    let result: EnvironmentOpPrivatePipeResult
#if DEBUG
    if request.useUnadmittedOp {
        result = EnvironmentOpSupervisor.executeUnsnappedPrivateFieldForTesting(
            executablePath: request.opPath,
            vaultID: request.vaultID,
            itemID: request.itemID,
            field: request.field,
            tokenDescriptor: tokenDescriptor,
            timeoutMilliseconds: request.timeoutMilliseconds,
            consume: consume
        )
    } else {
        result = EnvironmentOpSupervisor.executeAdmittedPrivateField(
            executablePath: request.opPath,
            vaultID: request.vaultID,
            itemID: request.itemID,
            field: request.field,
            tokenDescriptor: tokenDescriptor,
            timeoutMilliseconds: request.timeoutMilliseconds,
            consume: consume
        )
    }
#else
    result = EnvironmentOpSupervisor.executeAdmittedPrivateField(
        executablePath: request.opPath,
        vaultID: request.vaultID,
        itemID: request.itemID,
        field: request.field,
        tokenDescriptor: tokenDescriptor,
        timeoutMilliseconds: request.timeoutMilliseconds,
        consume: consume
    )
#endif
    switch result {
    case let .blocked(cause):
        emit(rejection(cause.rawValue), exitCode: 20)
    case let .success(outcome):
        let decoded = try? JSONSerialization.jsonObject(with: outcome)
            as? [String: Any]
        emit(outcome, exitCode: decoded?["ok"] as? Bool == true ? 0 : 20)
    }
}
