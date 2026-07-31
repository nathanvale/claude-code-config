import Darwin
import Foundation
@_spi(Executor) import BrowserUseEnvironmentAuth

private struct FieldDescriptor {
    let role: String
    let name: String
}

private struct ActivationDescriptor {
    let role: String
    let name: String
}

private struct DeliveryArguments {
    let webSocketURL: URL
    let targetURL: String
    let targetOrigin: String
    let field: FieldDescriptor
    let activation: ActivationDescriptor?
}

private enum DeliveryFailure: Error {
    case invalidArguments
    case browserConnection
    case targetNotFound
    case targetAmbiguous
    case targetChanged
    case fieldNotFound
    case fieldAmbiguous
    case activationNotFound
    case activationAmbiguous
    case pipeRead
    case write
    case activation

    var reason: String {
        switch self {
        case .invalidArguments:
            return "invalid-arguments"
        case .browserConnection:
            return "browser-connection-failed"
        case .targetNotFound:
            return "target-not-found"
        case .targetAmbiguous:
            return "target-ambiguous"
        case .targetChanged:
            return "target-reproof-failed"
        case .fieldNotFound:
            return "field-not-found"
        case .fieldAmbiguous:
            return "field-ambiguous"
        case .activationNotFound:
            return "activation-not-found"
        case .activationAmbiguous:
            return "activation-ambiguous"
        case .pipeRead:
            return "pipe-read-failed"
        case .write:
            return "write-failed"
        case .activation:
            return "activation-failed"
        }
    }
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

private func boundedDescriptorPart(
    _ value: String?,
    allowEmpty: Bool
) -> String? {
    guard let value,
          (allowEmpty || !value.isEmpty),
          value.utf8.count <= 512,
          !value.contains("\0"),
          !value.contains("\n"),
          !value.contains("\r")
    else {
        return nil
    }
    return value
}

private func normalizedOrigin(_ raw: String) -> String? {
    guard raw.utf8.count <= 2_048,
          var components = URLComponents(string: raw),
          let scheme = components.scheme?.lowercased(),
          ["http", "https"].contains(scheme),
          let host = components.host?.lowercased(),
          components.user == nil,
          components.password == nil,
          components.path.isEmpty || components.path == "/",
          components.query == nil,
          components.fragment == nil
    else {
        return nil
    }
    let defaultPort = scheme == "https" ? 443 : 80
    let port = components.port == defaultPort ? nil : components.port
    components = URLComponents()
    components.scheme = scheme
    components.host = host
    components.port = port
    return components.string
}

private func origin(of raw: String) -> String? {
    guard let url = URL(string: raw),
          let scheme = url.scheme,
          let host = url.host
    else {
        return nil
    }
    var components = URLComponents()
    components.scheme = scheme
    components.host = host
    components.port = url.port
    return normalizedOrigin(components.string ?? "")
}

private func parseArguments(_ values: [String]) -> DeliveryArguments? {
    guard let options = exactOptions(values[...]),
          let rawWebSocketURL = options["--ws-url"],
          rawWebSocketURL.utf8.count <= 2_048,
          let webSocketURL = URL(string: rawWebSocketURL),
          ["ws", "wss"].contains(webSocketURL.scheme?.lowercased() ?? ""),
          webSocketURL.host != nil,
          webSocketURL.user == nil,
          webSocketURL.password == nil,
          webSocketURL.query == nil,
          webSocketURL.fragment == nil,
          let targetURL = options["--target-url"],
          targetURL.utf8.count <= 2_048,
          let parsedTargetURL = URL(string: targetURL),
          ["http", "https"].contains(parsedTargetURL.scheme?.lowercased() ?? ""),
          parsedTargetURL.host != nil,
          parsedTargetURL.user == nil,
          parsedTargetURL.password == nil,
          parsedTargetURL.fragment == nil,
          let targetOrigin = normalizedOrigin(options["--target-origin"] ?? ""),
          origin(of: targetURL) == targetOrigin,
          let fieldRole = boundedDescriptorPart(
              options["--field-role"],
              allowEmpty: false
          ),
          let fieldName = boundedDescriptorPart(
              options["--field-name"],
              allowEmpty: true
          )
    else {
        return nil
    }

    let baseKeys: Set<String> = [
        "--ws-url",
        "--target-url",
        "--target-origin",
        "--field-role",
        "--field-name",
    ]
    let activation: ActivationDescriptor?
    if let rawActivationRole = options["--activate-role"],
       let rawActivationName = options["--activate-name"],
       let role = boundedDescriptorPart(rawActivationRole, allowEmpty: false),
       let name = boundedDescriptorPart(rawActivationName, allowEmpty: true),
       Set(options.keys) == baseKeys.union([
           "--activate-role",
           "--activate-name",
       ])
    {
        activation = ActivationDescriptor(role: role, name: name)
    } else {
        guard options["--activate-role"] == nil,
              options["--activate-name"] == nil,
              Set(options.keys) == baseKeys
        else {
            return nil
        }
        activation = nil
    }
    return DeliveryArguments(
        webSocketURL: webSocketURL,
        targetURL: targetURL,
        targetOrigin: targetOrigin,
        field: FieldDescriptor(role: fieldRole, name: fieldName),
        activation: activation
    )
}

private func encodedOutcome(_ object: [String: Any]) -> Data {
    (try? JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys]
    )) ?? Data(
        "{\"field_cleared\":false,\"ok\":false,\"reason\":\"outcome-encoding-failed\"}".utf8
    )
}

private func emit(
    _ object: [String: Any],
    exitCode: Int32
) -> Never {
    FileHandle.standardOutput.write(encodedOutcome(object))
    FileHandle.standardOutput.write(Data([0x0a]))
    Foundation.exit(exitCode)
}

private final class CDPClient: @unchecked Sendable {
    private let session: URLSession
    private let task: URLSessionWebSocketTask
    private var nextID = 0

    init(url: URL) {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        session = URLSession(configuration: configuration)
        task = session.webSocketTask(with: url)
        task.resume()
    }

    deinit {
        task.cancel(with: .goingAway, reason: nil)
        session.invalidateAndCancel()
    }

    func close() {
        task.cancel(with: .normalClosure, reason: nil)
        session.finishTasksAndInvalidate()
    }

    func send(
        _ method: String,
        parameters: [String: Any] = [:],
        sessionID: String? = nil
    ) async throws -> [String: Any] {
        nextID += 1
        let requestID = nextID
        var request: [String: Any] = [
            "id": requestID,
            "method": method,
            "params": parameters,
        ]
        if let sessionID {
            request["sessionId"] = sessionID
        }
        let data = try JSONSerialization.data(withJSONObject: request)
        try await task.send(.data(data))
        while true {
            let message = try await task.receive()
            let responseData: Data
            switch message {
            case let .data(value):
                responseData = value
            case let .string(value):
                responseData = Data(value.utf8)
            @unknown default:
                throw DeliveryFailure.browserConnection
            }
            guard let response = try? JSONSerialization.jsonObject(
                with: responseData
            ) as? [String: Any] else {
                throw DeliveryFailure.browserConnection
            }
            guard (response["id"] as? NSNumber)?.intValue == requestID else {
                continue
            }
            guard response["error"] == nil,
                  let result = response["result"] as? [String: Any]
            else {
                throw DeliveryFailure.browserConnection
            }
            return result
        }
    }
}

private struct ProvenTarget: Equatable {
    let identifier: String
    let url: String
}

private func proveTarget(
    client: CDPClient,
    targetURL: String,
    targetOrigin: String
) async throws -> ProvenTarget {
    let result = try await client.send("Target.getTargets")
    guard let targetInfos = result["targetInfos"] as? [[String: Any]] else {
        throw DeliveryFailure.browserConnection
    }
    let matches = targetInfos.compactMap { info -> ProvenTarget? in
        guard info["type"] as? String == "page",
              let identifier = info["targetId"] as? String,
              let observedURL = info["url"] as? String,
              observedURL == targetURL,
              origin(of: observedURL) == targetOrigin
        else {
            return nil
        }
        return ProvenTarget(identifier: identifier, url: observedURL)
    }
    guard !matches.isEmpty else {
        throw DeliveryFailure.targetNotFound
    }
    guard matches.count == 1, let target = matches.first else {
        throw DeliveryFailure.targetAmbiguous
    }
    return target
}

private func backendNodeID(
    in nodes: [[String: Any]],
    descriptor: FieldDescriptor
) throws -> Int {
    let matches = nodes.compactMap { node -> Int? in
        let role = (node["role"] as? [String: Any])?["value"] as? String
        let name = (node["name"] as? [String: Any])?["value"] as? String
        guard role == descriptor.role,
              name == descriptor.name,
              let identifier = node["backendDOMNodeId"] as? NSNumber
        else {
            return nil
        }
        return identifier.intValue
    }
    guard !matches.isEmpty else {
        throw DeliveryFailure.fieldNotFound
    }
    guard matches.count == 1, let identifier = matches.first else {
        throw DeliveryFailure.fieldAmbiguous
    }
    return identifier
}

private func activationBackendNodeID(
    in nodes: [[String: Any]],
    descriptor: ActivationDescriptor
) throws -> Int {
    let matches = nodes.compactMap { node -> Int? in
        let role = (node["role"] as? [String: Any])?["value"] as? String
        let name = (node["name"] as? [String: Any])?["value"] as? String
        guard role == descriptor.role,
              name == descriptor.name,
              let identifier = node["backendDOMNodeId"] as? NSNumber
        else {
            return nil
        }
        return identifier.intValue
    }
    guard !matches.isEmpty else {
        throw DeliveryFailure.activationNotFound
    }
    guard matches.count == 1, let identifier = matches.first else {
        throw DeliveryFailure.activationAmbiguous
    }
    return identifier
}

private func readPrivateValue() throws -> Data {
    var value = Data()
    var buffer = [UInt8](repeating: 0, count: 4_096)
    defer {
        _ = buffer.withUnsafeMutableBytes {
            $0.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }
    while true {
        let count = buffer.withUnsafeMutableBytes {
            Darwin.read(3, $0.baseAddress, $0.count)
        }
        if count == 0 { break }
        if count < 0 {
            if errno == EINTR { continue }
            throw DeliveryFailure.pipeRead
        }
        guard value.count + count <= 65_536 else {
            throw DeliveryFailure.pipeRead
        }
        value.append(contentsOf: buffer.prefix(count))
    }
    if value.last == 0x0a {
        value.removeLast()
        if value.last == 0x0d {
            value.removeLast()
        }
    }
    guard !value.isEmpty,
          !value.contains(0),
          String(data: value, encoding: .utf8) != nil
    else {
        value.resetBytes(in: 0..<value.count)
        throw DeliveryFailure.pipeRead
    }
    return value
}

private func activate(
    client: CDPClient,
    sessionID: String,
    backendNodeID: Int
) async throws {
    let box = try await client.send(
        "DOM.getBoxModel",
        parameters: ["backendNodeId": backendNodeID],
        sessionID: sessionID
    )
    guard let model = box["model"] as? [String: Any],
          let content = model["content"] as? [NSNumber],
          content.count == 8
    else {
        throw DeliveryFailure.activation
    }
    let x = stride(from: 0, to: 8, by: 2)
        .map { content[$0].doubleValue }
        .reduce(0, +) / 4
    let y = stride(from: 1, to: 8, by: 2)
        .map { content[$0].doubleValue }
        .reduce(0, +) / 4
    _ = try await client.send(
        "Input.dispatchMouseEvent",
        parameters: ["type": "mouseMoved", "x": x, "y": y],
        sessionID: sessionID
    )
    _ = try await client.send(
        "Input.dispatchMouseEvent",
        parameters: [
            "type": "mousePressed",
            "x": x,
            "y": y,
            "button": "left",
            "clickCount": 1,
        ],
        sessionID: sessionID
    )
    _ = try await client.send(
        "Input.dispatchMouseEvent",
        parameters: [
            "type": "mouseReleased",
            "x": x,
            "y": y,
            "button": "left",
            "clickCount": 1,
        ],
        sessionID: sessionID
    )
}

@main
private enum BrowserUseFieldDelivery {
    static func main() async {
        guard let arguments = parseArguments(
            Array(CommandLine.arguments.dropFirst())
        ) else {
            emit(
                [
                    "ok": false,
                    "reason": DeliveryFailure.invalidArguments.reason,
                    "field_cleared": false,
                ],
                exitCode: 20
            )
        }
        do {
            try TokenCustodyProcessSafety.disableCoreDumps()
        } catch {
            emit(
                [
                    "ok": false,
                    "reason": "core-dump-disable-failed",
                    "field_cleared": false,
                ],
                exitCode: 20
            )
        }

        let client = CDPClient(url: arguments.webSocketURL)
        let fieldCleared = false
        var privateValue = Data()
        defer {
            if !privateValue.isEmpty {
                privateValue.resetBytes(in: 0..<privateValue.count)
            }
            client.close()
        }
        do {
            let initialTarget = try await proveTarget(
                client: client,
                targetURL: arguments.targetURL,
                targetOrigin: arguments.targetOrigin
            )
            let attachment = try await client.send(
                "Target.attachToTarget",
                parameters: [
                    "targetId": initialTarget.identifier,
                    "flatten": true,
                ]
            )
            guard let sessionID = attachment["sessionId"] as? String else {
                throw DeliveryFailure.browserConnection
            }
            _ = try await client.send("DOM.enable", sessionID: sessionID)
            _ = try await client.send(
                "Accessibility.enable",
                sessionID: sessionID
            )
            let tree = try await client.send(
                "Accessibility.getFullAXTree",
                sessionID: sessionID
            )
            guard let nodes = tree["nodes"] as? [[String: Any]] else {
                throw DeliveryFailure.browserConnection
            }
            let fieldBackendNodeID = try backendNodeID(
                in: nodes,
                descriptor: arguments.field
            )
            let activationNodeID: Int?
            if let activation = arguments.activation {
                activationNodeID = try activationBackendNodeID(
                    in: nodes,
                    descriptor: activation
                )
            } else {
                activationNodeID = nil
            }
            let resolvedField = try await client.send(
                "DOM.resolveNode",
                parameters: ["backendNodeId": fieldBackendNodeID],
                sessionID: sessionID
            )
            guard let resolvedObject = resolvedField["object"] as? [String: Any],
                  let fieldObjectID = resolvedObject["objectId"] as? String
            else {
                throw DeliveryFailure.fieldNotFound
            }

            let freshTarget = try await proveTarget(
                client: client,
                targetURL: arguments.targetURL,
                targetOrigin: arguments.targetOrigin
            )
            guard freshTarget == initialTarget else {
                throw DeliveryFailure.targetChanged
            }
            privateValue = try readPrivateValue()
            guard let value = String(data: privateValue, encoding: .utf8) else {
                throw DeliveryFailure.pipeRead
            }
            _ = try await client.send(
                "DOM.focus",
                parameters: ["backendNodeId": fieldBackendNodeID],
                sessionID: sessionID
            )
            _ = try await client.send(
                "Runtime.callFunctionOn",
                parameters: [
                    "objectId": fieldObjectID,
                    "functionDeclaration":
                        "function(){if(typeof this.select!=='function'){throw new Error('not-selectable')}this.select();}",
                    "returnByValue": true,
                ],
                sessionID: sessionID
            )
            _ = try await client.send(
                "Input.insertText",
                parameters: ["text": value],
                sessionID: sessionID
            )
            if let activationNodeID {
                do {
                    try await activate(
                        client: client,
                        sessionID: sessionID,
                        backendNodeID: activationNodeID
                    )
                } catch {
                    throw DeliveryFailure.activation
                }
            }
            emit(
                [
                    "ok": true,
                    "shape": [
                        "kind": "utf8",
                        "byte_length": privateValue.count,
                    ],
                ],
                exitCode: 0
            )
        } catch let failure as DeliveryFailure {
            emit(
                [
                    "ok": false,
                    "reason": failure.reason,
                    "field_cleared": fieldCleared,
                ],
                exitCode: 20
            )
        } catch {
            emit(
                [
                    "ok": false,
                    "reason": DeliveryFailure.write.reason,
                    "field_cleared": fieldCleared,
                ],
                exitCode: 20
            )
        }
    }
}
