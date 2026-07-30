import BrowserUseEnvironmentAuth
import Darwin
import Foundation

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

private func closeUnrelatedDescriptors(preserving: Set<Int32>) {
    let observed = sysconf(_SC_OPEN_MAX)
    let maximum = observed > 0 ? min(observed, Int(Int32.max)) : 1_024
    for descriptor in Int32(3)..<Int32(maximum) {
        if !preserving.contains(descriptor) {
            _ = Darwin.close(descriptor)
        }
    }
}

private func rejection() -> Data {
    Data(
        "{\"ok\":false,\"rejection\":{\"code\":\"invalid-arguments\",\"message\":\"confidential field delivery blocked; inspect the typed code.\"},\"schema_version\":1,\"write_state\":\"blocked-before-write\"}"
            .utf8
    )
}

private func readBoundedStandardInput(maximumBytes: Int) -> Data? {
    var output = Data()
    do {
        while output.count <= maximumBytes {
            let capacity = min(8_192, maximumBytes + 1 - output.count)
            guard let chunk = try FileHandle.standardInput.read(
                upToCount: capacity
            ),
                !chunk.isEmpty
            else {
                return output
            }
            output.append(chunk)
        }
    } catch {
        return nil
    }
    return nil
}

private func emit(_ data: Data, exitCode: Int32) -> Never {
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
    Foundation.exit(exitCode)
}

_ = signal(SIGPIPE, SIG_IGN)
do {
    try TokenCustodyProcessSafety.disableCoreDumps()
} catch {
    emit(rejection(), exitCode: 20)
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
    emit(rejection(), exitCode: 20)
}

let rawArguments = CommandLine.arguments.dropFirst()
if rawArguments.first == "prove-target" {
    guard Array(rawArguments) == ["prove-target"],
          let request = try? FileHandle.standardInput.readToEnd(),
          request.count <= 4_096
    else {
        emit(
            ConfidentialFieldDeliveryProcess.proveTarget(
                requestData: Data()
            ),
            exitCode: 20
        )
    }
    let result = ConfidentialFieldDeliveryProcess.proveTarget(
        requestData: request
    )
    let decoded = try? JSONSerialization.jsonObject(with: result)
        as? [String: Any]
    emit(result, exitCode: decoded?["ok"] as? Bool == true ? 0 : 20)
}
if rawArguments.first == "read-reviewed" {
    guard Array(rawArguments) == ["read-reviewed"],
          let request = readBoundedStandardInput(maximumBytes: 131_072)
    else {
        emit(
            ConfidentialFieldDeliveryProcess.readReviewed(
                requestData: Data()
            ),
            exitCode: 20
        )
    }
    let result = ConfidentialFieldDeliveryProcess.readReviewed(
        requestData: request
    )
    let decoded = try? JSONSerialization.jsonObject(with: result)
        as? [String: Any]
    emit(result, exitCode: decoded?["ok"] as? Bool == true ? 0 : 20)
}
if rawArguments.first == "private" {
    guard let options = exactOptions(rawArguments.dropFirst()),
          options.count == 2,
          let configRoot = options["--config-root"],
          let opPath = options["--op-path"],
          let request = try? FileHandle.standardInput.readToEnd(),
          request.count <= 16_384
    else {
        emit(rejection(), exitCode: 20)
    }
    let result = ConfidentialFieldDeliveryProcess.runPrivate(
        requestData: request,
        configRoot: configRoot,
        opExecutablePath: opPath
    )
    let decoded = try? JSONSerialization.jsonObject(with: result)
        as? [String: Any]
    emit(result, exitCode: decoded?["ok"] as? Bool == true ? 0 : 20)
}

guard let options = exactOptions(rawArguments),
      options.count == 3,
      let credentialRaw = options["--credential-fd"],
      let metadataRaw = options["--metadata-fd"],
      let browserRaw = options["--browser-fd"],
      let credentialDescriptor = Int32(credentialRaw),
      let metadataDescriptor = Int32(metadataRaw),
      let browserDescriptor = Int32(browserRaw),
      credentialDescriptor >= 3,
      metadataDescriptor >= 3,
      browserDescriptor >= 3,
      Set([
        credentialDescriptor,
        metadataDescriptor,
        browserDescriptor,
      ]).count == 3
else {
    emit(rejection(), exitCode: 20)
}

closeUnrelatedDescriptors(
    preserving: [
        credentialDescriptor,
        metadataDescriptor,
        browserDescriptor,
    ]
)
let result = ConfidentialFieldDeliveryProcess.run(
    metadataDescriptor: metadataDescriptor,
    credentialDescriptor: credentialDescriptor,
    browserDescriptor: browserDescriptor
)
let decoded = try? JSONSerialization.jsonObject(with: result)
    as? [String: Any]
emit(result, exitCode: decoded?["ok"] as? Bool == true ? 0 : 20)
