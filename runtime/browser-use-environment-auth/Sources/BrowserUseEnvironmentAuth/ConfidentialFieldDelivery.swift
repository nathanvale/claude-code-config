import Darwin
import CryptoKit
import Foundation

public enum ConfidentialFieldInputKind: String, Codable, Sendable {
    case username
    case password
    case otpCurrent = "otp-current"
}

public struct ConfidentialSemanticFieldLocator: Codable, Equatable, Sendable {
    public let role: String
    public let accessibleName: String
    public let inputKind: ConfidentialFieldInputKind

    enum CodingKeys: String, CodingKey {
        case role
        case accessibleName = "accessible_name"
        case inputKind = "input_kind"
    }
}

public struct ConfidentialDeliveryTarget: Codable, Equatable, Sendable {
    public let targetID: String
    public let frameID: String
    public let topLevelOrigin: String
    public let frameOrigin: String

    enum CodingKeys: String, CodingKey {
        case targetID = "target_id"
        case frameID = "frame_id"
        case topLevelOrigin = "top_level_origin"
        case frameOrigin = "frame_origin"
    }
}

public struct ConfidentialDeliveryRequest: Codable, Equatable, Sendable {
    public let schemaVersion: Int
    public let target: ConfidentialDeliveryTarget
    public let locator: ConfidentialSemanticFieldLocator

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case target
        case locator
    }
}

private struct ConfidentialPrivateBinding: Codable, Equatable, Sendable {
    let vaultID: String
    let itemID: String

    enum CodingKeys: String, CodingKey {
        case vaultID = "vault_id"
        case itemID = "item_id"
    }
}

private struct ConfidentialPrivateDeliveryRequest: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let browserWebSocketEndpoint: String
    let browserPID: Int32
    let binding: ConfidentialPrivateBinding
    let target: ConfidentialDeliveryTarget
    let locator: ConfidentialSemanticFieldLocator

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case browserWebSocketEndpoint = "browser_ws_endpoint"
        case browserPID = "browser_pid"
        case binding
        case target
        case locator
    }
}

private struct ConfidentialTargetProofRequest: Codable, Equatable, Sendable {
    let schemaVersion: Int
    let browserWebSocketEndpoint: String
    let browserPID: Int32
    let targetID: String

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case browserWebSocketEndpoint = "browser_ws_endpoint"
        case browserPID = "browser_pid"
        case targetID = "target_id"
    }
}

private enum ConfidentialDeliveryCause: String {
    case invalidRequest = "invalid-request"
    case targetUnproven = "target-unproven"
    case fieldMissing = "field-missing"
    case fieldAmbiguous = "field-ambiguous"
    case fieldInvalid = "field-invalid"
    case credentialInvalid = "credential-invalid"
    case browserChannelUnavailable = "browser-channel-unavailable"
    case writeOutcomeUnknown = "write-outcome-unknown"
}

private enum ConfidentialTargetProofCause: String {
    case invalidRequest = "invalid-request"
    case browserChannelUnavailable = "browser-channel-unavailable"
    case targetUnproven = "target-unproven"
}

private func confidentialMonotonicMilliseconds() -> Int64 {
    var value = timespec()
    guard clock_gettime(CLOCK_MONOTONIC, &value) == 0 else { return 0 }
    return Int64(value.tv_sec) * 1_000 + Int64(value.tv_nsec) / 1_000_000
}

private func waitForConfidentialDescriptor(
    _ descriptor: Int32,
    events: Int16,
    deadline: Int64
) -> Bool {
    while true {
        let remaining = deadline - confidentialMonotonicMilliseconds()
        guard remaining > 0 else { return false }
        var polled = pollfd(fd: descriptor, events: events, revents: 0)
        let result = poll(
            &polled,
            1,
            Int32(min(remaining, Int64(Int32.max)))
        )
        if result < 0, errno == EINTR { continue }
        guard result > 0, polled.revents & events != 0 else { return false }
        return true
    }
}

private func readConfidentialBytes(
    _ descriptor: Int32,
    maximum: Int,
    deadline: Int64
) -> [UInt8]? {
    var output: [UInt8] = []
    var buffer = [UInt8](repeating: 0, count: 1_024)
    defer {
        _ = buffer.withUnsafeMutableBytes {
            $0.initializeMemory(as: UInt8.self, repeating: 0)
        }
    }
    while true {
        guard waitForConfidentialDescriptor(
            descriptor,
            events: Int16(POLLIN | POLLHUP),
            deadline: deadline
        ) else {
            return nil
        }
        let capacity = buffer.count
        let count = buffer.withUnsafeMutableBytes {
            Darwin.read(descriptor, $0.baseAddress, capacity)
        }
        if count == 0 { return output }
        if count < 0 {
            if errno == EINTR { continue }
            return nil
        }
        guard output.count + count <= maximum else { return nil }
        output.append(contentsOf: buffer.prefix(count))
    }
}

private func readConfidentialLine(
    _ descriptor: Int32,
    maximum: Int,
    deadline: Int64
) -> Data? {
    var output = Data()
    var byte: UInt8 = 0
    while output.count < maximum {
        guard waitForConfidentialDescriptor(
            descriptor,
            events: Int16(POLLIN | POLLHUP),
            deadline: deadline
        ) else {
            return nil
        }
        let count = Darwin.read(descriptor, &byte, 1)
        if count == 0 { return nil }
        if count < 0 {
            if errno == EINTR { continue }
            return nil
        }
        if byte == 0x0a { return output }
        output.append(byte)
    }
    return nil
}

private func writeConfidentialBytes(
    _ descriptor: Int32,
    bytes: Data,
    deadline: Int64
) -> Bool {
    var offset = 0
    while offset < bytes.count {
        guard waitForConfidentialDescriptor(
            descriptor,
            events: Int16(POLLOUT),
            deadline: deadline
        ) else {
            return false
        }
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

private func boundedCoordinate(_ value: String) -> Bool {
    guard !value.isEmpty, value.utf8.count <= 256 else { return false }
    return value.utf8.allSatisfy {
        ($0 >= 48 && $0 <= 57)
            || ($0 >= 65 && $0 <= 90)
            || ($0 >= 97 && $0 <= 122)
            || $0 == 45 || $0 == 46 || $0 == 58 || $0 == 95
    }
}

private func normalizedOrigin(_ value: String) -> String? {
    guard var components = URLComponents(string: value),
          let rawScheme = components.scheme,
          let rawHost = components.host,
          ["http", "https"].contains(rawScheme.lowercased()),
          components.user == nil,
          components.password == nil
    else {
        return nil
    }
    let scheme = rawScheme.lowercased()
    let host = rawHost.lowercased()
    let port = components.port.map { ":\($0)" } ?? ""
    components.path = ""
    components.query = nil
    components.fragment = nil
    return "\(scheme)://\(host)\(port)"
}

private func requestIsValid(_ request: ConfidentialDeliveryRequest) -> Bool {
    request.schemaVersion == 1
        && boundedCoordinate(request.target.targetID)
        && boundedCoordinate(request.target.frameID)
        && normalizedOrigin(request.target.topLevelOrigin)
            == request.target.topLevelOrigin
        && normalizedOrigin(request.target.frameOrigin)
            == request.target.frameOrigin
        && request.locator.role == "textbox"
        && !request.locator.accessibleName.isEmpty
        && request.locator.accessibleName.utf8.count <= 256
        && !request.locator.accessibleName.contains("\0")
        && !request.locator.accessibleName.contains("\n")
        && !request.locator.accessibleName.contains("\r")
}

private func exactKeys(
    _ value: [String: Any],
    _ expected: Set<String>
) -> Bool {
    Set(value.keys) == expected
}

private func validLoopbackBrowserWebSocket(_ value: String) -> URL? {
    guard let url = URL(string: value),
          let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
          components.scheme == "ws",
          let host = components.host?.lowercased(),
          ["127.0.0.1", "::1"].contains(host),
          components.port != nil,
          components.user == nil,
          components.password == nil,
          components.fragment == nil,
          !components.path.isEmpty,
          components.query == nil
    else {
        return nil
    }
    return url
}

private func decodePrivateDeliveryRequest(
    _ data: Data
) -> ConfidentialPrivateDeliveryRequest? {
    guard data.count <= 16_384,
          let raw = try? JSONSerialization.jsonObject(with: data)
            as? [String: Any],
          exactKeys(
            raw,
            [
                "schema_version",
                "browser_ws_endpoint",
                "browser_pid",
                "binding",
                "target",
                "locator",
            ]
          ),
          let binding = raw["binding"] as? [String: Any],
          exactKeys(binding, ["vault_id", "item_id"]),
          let target = raw["target"] as? [String: Any],
          exactKeys(
            target,
            [
                "lane_id",
                "run_id",
                "target_id",
                "page_id",
                "frame_id",
                "top_level_origin",
                "frame_origin",
                "target_proof_digest",
            ]
          ),
          let locator = raw["locator"] as? [String: Any],
          exactKeys(locator, ["role", "accessible_name", "input_kind"]),
          let request = try? JSONDecoder().decode(
            ConfidentialPrivateDeliveryRequest.self,
            from: data
          ),
          request.schemaVersion == 1,
          request.browserPID > 0,
          boundedCoordinate(request.binding.vaultID),
          boundedCoordinate(request.binding.itemID),
          validLoopbackBrowserWebSocket(
            request.browserWebSocketEndpoint
          ) != nil,
          requestIsValid(
            ConfidentialDeliveryRequest(
                schemaVersion: request.schemaVersion,
                target: request.target,
                locator: request.locator
            )
          )
    else {
        return nil
    }
    for key in ["lane_id", "run_id", "page_id"] {
        guard let coordinate = target[key] as? String,
              boundedCoordinate(coordinate)
        else {
            return nil
        }
    }
    guard let digest = target["target_proof_digest"] as? String,
          digest.utf8.count == 64,
          digest.utf8.allSatisfy({
              ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102)
          })
    else {
        return nil
    }
    return request
}

private func decodeTargetProofRequest(
    _ data: Data
) -> ConfidentialTargetProofRequest? {
    guard data.count <= 4_096,
          let raw = try? JSONSerialization.jsonObject(with: data)
            as? [String: Any],
          exactKeys(
            raw,
            [
                "schema_version",
                "browser_ws_endpoint",
                "browser_pid",
                "target_id",
            ]
          ),
          let request = try? JSONDecoder().decode(
            ConfidentialTargetProofRequest.self,
            from: data
          ),
          request.schemaVersion == 1,
          request.browserPID > 0,
          validLoopbackBrowserWebSocket(
            request.browserWebSocketEndpoint
          ) != nil,
          boundedCoordinate(request.targetID)
    else {
        return nil
    }
    return request
}

private func exactChromeExecutable(_ path: String) -> Bool {
    path == "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
}

private func browserProcessOwnsConfidentialListener(
    pid: Int32,
    endpoint: URL,
    requireChromeExecutable: Bool
) -> Bool {
    guard pid > 0,
          let host = endpoint.host,
          let port = endpoint.port,
          port >= 1,
          port <= 65_535
    else {
        return false
    }
    var bsd = proc_bsdinfo()
    let bsdSize = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(
        pid,
        PROC_PIDTBSDINFO,
        0,
        &bsd,
        bsdSize
    ) == bsdSize,
        bsd.pbi_uid == geteuid()
    else {
        return false
    }
    if requireChromeExecutable {
        var path = [CChar](repeating: 0, count: Int(MAXPATHLEN * 4))
        let pathCount = proc_pidpath(
            pid,
            &path,
            UInt32(path.count)
        )
        guard pathCount > 0,
              let terminator = path.firstIndex(of: 0),
              exactChromeExecutable(
                String(
                    decoding: path[..<terminator].map {
                        UInt8(bitPattern: $0)
                    },
                    as: UTF8.self
                )
              )
        else {
            return false
        }
    }

    let byteCount = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, nil, 0)
    guard byteCount > 0 else { return false }
    var descriptors = [proc_fdinfo](
        repeating: proc_fdinfo(),
        count: Int(byteCount) / MemoryLayout<proc_fdinfo>.stride
    )
    let actualBytes = descriptors.withUnsafeMutableBytes {
        proc_pidinfo(
            pid,
            PROC_PIDLISTFDS,
            0,
            $0.baseAddress,
            Int32($0.count)
        )
    }
    guard actualBytes > 0 else { return false }
    let count = min(
        descriptors.count,
        Int(actualBytes) / MemoryLayout<proc_fdinfo>.stride
    )
    let expectedPort = Int32(UInt16(port).bigEndian)
    for descriptor in descriptors.prefix(count)
    where descriptor.proc_fdtype == UInt32(PROX_FDTYPE_SOCKET) {
        var socketInfo = socket_fdinfo()
        let socketSize = Int32(MemoryLayout<socket_fdinfo>.size)
        guard proc_pidfdinfo(
            pid,
            descriptor.proc_fd,
            PROC_PIDFDSOCKETINFO,
            &socketInfo,
            socketSize
        ) == socketSize,
            socketInfo.psi.soi_kind == SOCKINFO_TCP,
            socketInfo.psi.soi_proto.pri_tcp.tcpsi_state == TSI_S_LISTEN,
            socketInfo.psi.soi_proto.pri_tcp.tcpsi_ini.insi_lport
                == expectedPort
        else {
            continue
        }
        let info = socketInfo.psi.soi_proto.pri_tcp.tcpsi_ini
        if host == "127.0.0.1",
           info.insi_vflag & UInt8(INI_IPV4) != 0,
           info.insi_laddr.ina_46.i46a_addr4.s_addr
            == inet_addr("127.0.0.1")
        {
            return true
        }
        if host == "::1",
           info.insi_vflag & UInt8(INI_IPV6) != 0
        {
            var expected = in6_addr()
            guard inet_pton(AF_INET6, "::1", &expected) == 1 else {
                return false
            }
            var observed = info.insi_laddr.ina_6
            if withUnsafeBytes(of: &observed, { observedBytes in
                withUnsafeBytes(of: &expected) { expectedBytes in
                    observedBytes.elementsEqual(expectedBytes)
                }
            }) {
                return true
            }
        }
    }
    return false
}

private func browserProcessOwnsConfidentialPeer(
    pid: Int32,
    descriptor: Int32,
    endpoint: URL
) -> Bool {
    guard let host = endpoint.host else { return false }
    let expectedLocalPort: Int32
    let expectedForeignPort: Int32
    let isIPv4: Bool
    if host == "127.0.0.1" {
        var local = sockaddr_in()
        var peer = sockaddr_in()
        var localLength = socklen_t(MemoryLayout<sockaddr_in>.size)
        var peerLength = socklen_t(MemoryLayout<sockaddr_in>.size)
        let localOK = withUnsafeMutablePointer(to: &local) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(descriptor, $0, &localLength)
            }
        }
        let peerOK = withUnsafeMutablePointer(to: &peer) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getpeername(descriptor, $0, &peerLength)
            }
        }
        guard localOK == 0,
              peerOK == 0,
              local.sin_family == sa_family_t(AF_INET),
              peer.sin_family == sa_family_t(AF_INET),
              local.sin_addr.s_addr == inet_addr("127.0.0.1"),
              peer.sin_addr.s_addr == inet_addr("127.0.0.1")
        else {
            return false
        }
        expectedLocalPort = Int32(peer.sin_port)
        expectedForeignPort = Int32(local.sin_port)
        isIPv4 = true
    } else if host == "::1" {
        var local = sockaddr_in6()
        var peer = sockaddr_in6()
        var localLength = socklen_t(MemoryLayout<sockaddr_in6>.size)
        var peerLength = socklen_t(MemoryLayout<sockaddr_in6>.size)
        let localOK = withUnsafeMutablePointer(to: &local) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getsockname(descriptor, $0, &localLength)
            }
        }
        let peerOK = withUnsafeMutablePointer(to: &peer) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                getpeername(descriptor, $0, &peerLength)
            }
        }
        var expected = in6_addr()
        guard localOK == 0,
              peerOK == 0,
              local.sin6_family == sa_family_t(AF_INET6),
              peer.sin6_family == sa_family_t(AF_INET6),
              inet_pton(AF_INET6, "::1", &expected) == 1
        else {
            return false
        }
        var localAddress = local.sin6_addr
        var peerAddress = peer.sin6_addr
        let localMatches = withUnsafeBytes(of: &localAddress) { bytes in
            withUnsafeBytes(of: &expected) { bytes.elementsEqual($0) }
        }
        let peerMatches = withUnsafeBytes(of: &peerAddress) { bytes in
            withUnsafeBytes(of: &expected) { bytes.elementsEqual($0) }
        }
        guard localMatches, peerMatches else { return false }
        expectedLocalPort = Int32(peer.sin6_port)
        expectedForeignPort = Int32(local.sin6_port)
        isIPv4 = false
    } else {
        return false
    }

    let byteCount = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, nil, 0)
    guard byteCount > 0 else { return false }
    var descriptors = [proc_fdinfo](
        repeating: proc_fdinfo(),
        count: Int(byteCount) / MemoryLayout<proc_fdinfo>.stride
    )
    let actualBytes = descriptors.withUnsafeMutableBytes {
        proc_pidinfo(
            pid,
            PROC_PIDLISTFDS,
            0,
            $0.baseAddress,
            Int32($0.count)
        )
    }
    guard actualBytes > 0 else { return false }
    let count = min(
        descriptors.count,
        Int(actualBytes) / MemoryLayout<proc_fdinfo>.stride
    )
    for candidate in descriptors.prefix(count)
    where candidate.proc_fdtype == UInt32(PROX_FDTYPE_SOCKET) {
        var socketInfo = socket_fdinfo()
        let socketSize = Int32(MemoryLayout<socket_fdinfo>.size)
        guard proc_pidfdinfo(
            pid,
            candidate.proc_fd,
            PROC_PIDFDSOCKETINFO,
            &socketInfo,
            socketSize
        ) == socketSize,
            socketInfo.psi.soi_kind == SOCKINFO_TCP,
            socketInfo.psi.soi_proto.pri_tcp.tcpsi_state == TSI_S_ESTABLISHED
        else {
            continue
        }
        let info = socketInfo.psi.soi_proto.pri_tcp.tcpsi_ini
        guard info.insi_lport == expectedLocalPort,
              info.insi_fport == expectedForeignPort
        else {
            continue
        }
        if isIPv4,
           info.insi_vflag & UInt8(INI_IPV4) != 0,
           info.insi_laddr.ina_46.i46a_addr4.s_addr
            == inet_addr("127.0.0.1"),
           info.insi_faddr.ina_46.i46a_addr4.s_addr
            == inet_addr("127.0.0.1")
        {
            return true
        }
        if !isIPv4,
           info.insi_vflag & UInt8(INI_IPV6) != 0
        {
            var expected = in6_addr()
            guard inet_pton(AF_INET6, "::1", &expected) == 1 else {
                return false
            }
            var localAddress = info.insi_laddr.ina_6
            var foreignAddress = info.insi_faddr.ina_6
            let localMatches = withUnsafeBytes(of: &localAddress) { bytes in
                withUnsafeBytes(of: &expected) {
                    bytes.elementsEqual($0)
                }
            }
            let foreignMatches = withUnsafeBytes(of: &foreignAddress) { bytes in
                withUnsafeBytes(of: &expected) {
                    bytes.elementsEqual($0)
                }
            }
            if localMatches, foreignMatches { return true }
        }
    }
    return false
}

private func dictionary(_ value: Any?) -> [String: Any]? {
    value as? [String: Any]
}

private func stringValue(_ value: Any?) -> String? {
    value as? String
}

private func connectConfidentialLoopback(
    _ endpoint: URL,
    deadline: Int64
) -> Int32? {
    guard let host = endpoint.host, let port = endpoint.port else { return nil }
    let descriptor: Int32
    let connected: Int32
    let originalFlags: Int32
    if host == "127.0.0.1" {
        descriptor = socket(AF_INET, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return nil }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = UInt16(port).bigEndian
        guard inet_pton(AF_INET, host, &address.sin_addr) == 1 else {
            _ = Darwin.close(descriptor)
            return nil
        }
        originalFlags = fcntl(descriptor, F_GETFL)
        guard originalFlags >= 0,
              fcntl(descriptor, F_SETFL, originalFlags | O_NONBLOCK) == 0
        else {
            _ = Darwin.close(descriptor)
            return nil
        }
        connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(
                    descriptor,
                    $0,
                    socklen_t(MemoryLayout<sockaddr_in>.size)
                )
            }
        }
    } else if host == "::1" {
        descriptor = socket(AF_INET6, SOCK_STREAM, 0)
        guard descriptor >= 0 else { return nil }
        var address = sockaddr_in6()
        address.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
        address.sin6_family = sa_family_t(AF_INET6)
        address.sin6_port = UInt16(port).bigEndian
        guard inet_pton(AF_INET6, host, &address.sin6_addr) == 1 else {
            _ = Darwin.close(descriptor)
            return nil
        }
        originalFlags = fcntl(descriptor, F_GETFL)
        guard originalFlags >= 0,
              fcntl(descriptor, F_SETFL, originalFlags | O_NONBLOCK) == 0
        else {
            _ = Darwin.close(descriptor)
            return nil
        }
        connected = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(
                    descriptor,
                    $0,
                    socklen_t(MemoryLayout<sockaddr_in6>.size)
                )
            }
        }
    } else {
        return nil
    }

    let pending = connected < 0 && (errno == EINPROGRESS || errno == EINTR)
    guard connected == 0 || pending,
          connected == 0 || waitForConfidentialDescriptor(
            descriptor,
            events: Int16(POLLOUT),
            deadline: deadline
          )
    else {
        _ = Darwin.close(descriptor)
        return nil
    }
    var socketError: Int32 = 0
    var socketErrorLength = socklen_t(MemoryLayout<Int32>.size)
    guard getsockopt(
        descriptor,
        SOL_SOCKET,
        SO_ERROR,
        &socketError,
        &socketErrorLength
    ) == 0,
        socketError == 0,
        confidentialMonotonicMilliseconds() < deadline
    else {
        _ = Darwin.close(descriptor)
        return nil
    }
    guard fcntl(descriptor, F_SETFL, originalFlags) == 0 else {
        _ = Darwin.close(descriptor)
        return nil
    }
    return descriptor
}

private func readConfidentialExact(
    _ descriptor: Int32,
    count: Int,
    deadline: Int64
) -> Data? {
    var output = Data(count: count)
    var offset = 0
    while offset < count {
        guard waitForConfidentialDescriptor(
            descriptor,
            events: Int16(POLLIN | POLLHUP),
            deadline: deadline
        ) else {
            return nil
        }
        let received = output.withUnsafeMutableBytes {
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
    return output
}

private func readConfidentialHTTPResponse(
    _ descriptor: Int32,
    deadline: Int64,
    maximumBodyBytes: Int
) -> (status: Int, headers: [String: String], body: Data)? {
    var header = Data()
    while header.count < 16_384 {
        guard let byte = readConfidentialExact(
            descriptor,
            count: 1,
            deadline: deadline
        ) else {
            return nil
        }
        header.append(byte)
        if header.suffix(4) == Data([13, 10, 13, 10]) { break }
    }
    guard header.suffix(4) == Data([13, 10, 13, 10]),
          let text = String(data: header, encoding: .utf8)
    else {
        return nil
    }
    let lines = text.components(separatedBy: "\r\n")
    guard let statusLine = lines.first,
          statusLine.hasPrefix("HTTP/1.1 "),
          let status = Int(statusLine.split(separator: " ").dropFirst().first ?? "")
    else {
        return nil
    }
    var headers: [String: String] = [:]
    for line in lines.dropFirst() where !line.isEmpty {
        let parts = line.split(separator: ":", maxSplits: 1)
        guard parts.count == 2 else { return nil }
        let name = parts[0].lowercased()
        guard headers[name] == nil else { return nil }
        headers[name] = parts[1].trimmingCharacters(in: .whitespaces)
    }
    let contentLength = Int(headers["content-length"] ?? "0") ?? -1
    guard contentLength >= 0, contentLength <= maximumBodyBytes,
          let body = readConfidentialExact(
            descriptor,
            count: contentLength,
            deadline: deadline
          )
    else {
        return nil
    }
    return (status, headers, body)
}

private func resolveConfidentialPageWebSocket(
    browserEndpoint: String,
    targetID: String,
    deadline: Int64
) -> URL? {
    guard let browserURL = validLoopbackBrowserWebSocket(browserEndpoint) else {
        return nil
    }
    guard let descriptor = connectConfidentialLoopback(
        browserURL,
        deadline: deadline
    ) else {
        return nil
    }
    defer { _ = Darwin.close(descriptor) }
    let host = browserURL.host == "::1" ? "[::1]" : "127.0.0.1"
    let request = [
        "GET /json/list HTTP/1.1",
        "Host: \(host):\(browserURL.port!)",
        "Connection: close",
        "",
        "",
    ].joined(separator: "\r\n")
    guard writeConfidentialBytes(
        descriptor,
        bytes: Data(request.utf8),
        deadline: deadline
    ),
        let response = readConfidentialHTTPResponse(
            descriptor,
            deadline: deadline,
            maximumBodyBytes: 262_144
        ),
        response.status == 200,
        let rows = try? JSONSerialization.jsonObject(
            with: response.body
        ) as? [Any]
    else {
        return nil
    }
    let matches = rows.compactMap { raw -> URL? in
        guard let row = raw as? [String: Any],
              row["id"] as? String == targetID,
              row["type"] as? String == "page",
              let rawEndpoint = row["webSocketDebuggerUrl"] as? String,
              let endpoint = validLoopbackBrowserWebSocket(rawEndpoint),
              endpoint.host?.lowercased() == browserURL.host?.lowercased(),
              endpoint.port == browserURL.port
        else {
            return nil
        }
        return endpoint
    }
    return matches.count == 1 ? matches[0] : nil
}

private protocol ConfidentialBrowserRequestChannel: AnyObject {
    var methods: [String] { get }
    func request(
        method: String,
        parameters: [String: Any]
    ) -> [String: Any]?
    func writeField(
        _ text: String,
        backendNodeID: Int,
        target: ConfidentialDeliveryTarget,
        inputKind: ConfidentialFieldInputKind
    ) -> Bool?
}

private let confidentialAtomicWriteFunction = """
    function(expectedFrameOrigin, expectedTopOrigin, allowedTypes, value) {
      const view = this.ownerDocument && this.ownerDocument.defaultView;
      if (!view || !this.isConnected || this.ownerDocument !== view.document) return {written:false};
      if (view.location.origin !== expectedFrameOrigin) return {written:false};
      try {
        if (view.top.location.origin !== expectedTopOrigin) return {written:false};
      } catch (_) {
        return {written:false};
      }
      if (this.tagName !== "INPUT" || !allowedTypes.includes((this.type || "text").toLowerCase())) return {written:false};
      const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, "value")?.set;
      if (typeof setter !== "function") return {written:false};
      this.focus();
      setter.call(this, value);
      this.dispatchEvent(new view.Event("input", {bubbles:true}));
      this.dispatchEvent(new view.Event("change", {bubbles:true}));
      return {written:true};
    }
    """

private func confidentialAllowedInputTypes(
    _ inputKind: ConfidentialFieldInputKind
) -> [String] {
    switch inputKind {
    case .password:
        return ["password"]
    case .username:
        return ["text", "email", "tel"]
    case .otpCurrent:
        return ["text", "tel", "number"]
    }
}

private func confidentialAtomicWriteParameters(
    objectID: String,
    text: String,
    target: ConfidentialDeliveryTarget,
    inputKind: ConfidentialFieldInputKind
) -> [String: Any] {
    [
        "objectId": objectID,
        "functionDeclaration": confidentialAtomicWriteFunction,
        "arguments": [
            ["value": target.frameOrigin],
            ["value": target.topLevelOrigin],
            ["value": confidentialAllowedInputTypes(inputKind)],
            ["value": text],
        ],
        "returnByValue": true,
        "userGesture": true,
    ]
}

private final class ConfidentialWebSocketBrowserChannel:
    ConfidentialBrowserRequestChannel
{
    private let descriptor: Int32
    private let deadline: Int64
    private(set) var methods: [String] = []
    private var nextID = 1

    init?(endpoint: URL, browserPID: Int32, deadline: Int64) {
        guard let descriptor = connectConfidentialLoopback(
            endpoint,
            deadline: deadline
        ) else {
            return nil
        }
        var nonce = [UInt8](repeating: 0, count: 16)
        nonce.withUnsafeMutableBytes {
            arc4random_buf($0.baseAddress, $0.count)
        }
        let key = Data(nonce).base64EncodedString()
        let host = endpoint.host == "::1" ? "[::1]" : "127.0.0.1"
        let path = endpoint.path
        let request = [
            "GET \(path) HTTP/1.1",
            "Host: \(host):\(endpoint.port!)",
            "Upgrade: websocket",
            "Connection: Upgrade",
            "Sec-WebSocket-Version: 13",
            "Sec-WebSocket-Key: \(key)",
            "",
            "",
        ].joined(separator: "\r\n")
        let expected = Data(
            Insecure.SHA1.hash(
                data: Data(
                    (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8
                )
            )
        ).base64EncodedString()
        guard writeConfidentialBytes(
            descriptor,
            bytes: Data(request.utf8),
            deadline: deadline
        ),
            let response = readConfidentialHTTPResponse(
                descriptor,
                deadline: deadline,
                maximumBodyBytes: 0
            ),
            response.status == 101,
            response.headers["upgrade"]?.lowercased() == "websocket",
            response.headers["sec-websocket-accept"] == expected,
            browserProcessOwnsConfidentialPeer(
                pid: browserPID,
                descriptor: descriptor,
                endpoint: endpoint
            )
        else {
            _ = Darwin.close(descriptor)
            return nil
        }
        self.descriptor = descriptor
        self.deadline = deadline
    }

    deinit {
        _ = Darwin.close(descriptor)
    }

    func request(
        method: String,
        parameters: [String: Any]
    ) -> [String: Any]? {
        let id = nextID
        nextID += 1
        methods.append(method)
        guard let data = try? JSONSerialization.data(
            withJSONObject: [
                "id": id,
                "method": method,
                "params": parameters,
            ],
            options: [.sortedKeys]
        ),
            data.count <= 65_536,
            sendFrame(opcode: 0x1, payload: data)
        else {
            return nil
        }
        var eventCount = 0
        var eventBytes = 0
        while eventCount <= 64, eventBytes <= 262_144 {
            guard let responseData = receiveText(),
                  let response = try? JSONSerialization.jsonObject(
                    with: responseData
                  ) as? [String: Any]
            else {
                return nil
            }
            eventBytes += responseData.count
            if response["id"] == nil {
                guard response["method"] is String else { return nil }
                eventCount += 1
                continue
            }
            guard (response["id"] as? NSNumber)?.intValue == id,
                  response["error"] == nil,
                  let result = response["result"] as? [String: Any]
            else {
                return nil
            }
            return result
        }
        return nil
    }

    func writeField(
        _ text: String,
        backendNodeID: Int,
        target: ConfidentialDeliveryTarget,
        inputKind: ConfidentialFieldInputKind
    ) -> Bool? {
        guard let resolved = request(
            method: "DOM.resolveNode",
            parameters: ["backendNodeId": backendNodeID]
        ),
            let object = dictionary(resolved["object"]),
            let objectID = stringValue(object["objectId"])
        else {
            return false
        }
        guard let result = request(
            method: "Runtime.callFunctionOn",
            parameters: confidentialAtomicWriteParameters(
                objectID: objectID,
                text: text,
                target: target,
                inputKind: inputKind
            )
        ),
            let remote = dictionary(result["result"]),
            let value = dictionary(remote["value"]),
            let written = value["written"] as? Bool
        else {
            return nil
        }
        return written
    }

    private func sendFrame(opcode: UInt8, payload value: Data) -> Bool {
        guard value.count <= 65_536, [0x1, 0x8, 0x9, 0xA].contains(opcode)
        else {
            return false
        }
        var frame: [UInt8] = [0x80 | opcode]
        if value.count < 126 {
            frame.append(0x80 | UInt8(value.count))
        } else {
            frame.append(0x80 | 126)
            frame.append(UInt8((value.count >> 8) & 0xff))
            frame.append(UInt8(value.count & 0xff))
        }
        var mask = [UInt8](repeating: 0, count: 4)
        mask.withUnsafeMutableBytes {
            arc4random_buf($0.baseAddress, $0.count)
        }
        frame.append(contentsOf: mask)
        for (index, byte) in value.enumerated() {
            frame.append(byte ^ mask[index % 4])
        }
        return writeConfidentialBytes(
            descriptor,
            bytes: Data(frame),
            deadline: deadline
        )
    }

    private func receiveText() -> Data? {
        while true {
            guard let header = readConfidentialExact(
                descriptor,
                count: 2,
                deadline: deadline
            ) else {
                return nil
            }
            let first = header[header.startIndex]
            let second = header[header.startIndex + 1]
            guard first & 0x80 != 0,
                  first & 0x70 == 0,
                  second & 0x80 == 0
            else {
                return nil
            }
            let opcode = first & 0x0f
            var length = Int(second & 0x7f)
            if opcode >= 0x8, length >= 126 { return nil }
            if length == 126 {
                guard let extended = readConfidentialExact(
                    descriptor,
                    count: 2,
                    deadline: deadline
                ) else {
                    return nil
                }
                length = Int(extended[extended.startIndex]) << 8
                    | Int(extended[extended.startIndex + 1])
            } else if length == 127 {
                guard let extended = readConfidentialExact(
                    descriptor,
                    count: 8,
                    deadline: deadline
                ),
                    extended.prefix(4).allSatisfy({ $0 == 0 })
                else {
                    return nil
                }
                length = extended.suffix(4).reduce(0) {
                    ($0 << 8) | Int($1)
                }
            }
            guard length <= 65_536,
                  let payload = readConfidentialExact(
                    descriptor,
                    count: length,
                    deadline: deadline
                  )
            else {
                return nil
            }
            if opcode == 0x8 { return nil }
            if opcode == 0x9 {
                guard sendFrame(opcode: 0xA, payload: payload) else {
                    return nil
                }
                continue
            }
            if opcode == 0xA { continue }
            return opcode == 0x1 ? payload : nil
        }
    }
}

private final class ConfidentialBrowserChannel: ConfidentialBrowserRequestChannel {
    private let descriptor: Int32
    private let deadline: Int64
    private(set) var methods: [String] = []
    private var nextID = 1

    init(descriptor: Int32, deadline: Int64) {
        self.descriptor = descriptor
        self.deadline = deadline
    }

    func request(
        method: String,
        parameters: [String: Any]
    ) -> [String: Any]? {
        let id = nextID
        nextID += 1
        methods.append(method)
        guard var request = try? JSONSerialization.data(
            withJSONObject: [
                "id": id,
                "method": method,
                "params": parameters,
            ],
            options: [.sortedKeys]
        ) else {
            return nil
        }
        request.append(0x0a)
        guard writeConfidentialBytes(
            descriptor,
            bytes: request,
            deadline: deadline
        ),
            let responseBytes = readConfidentialLine(
                descriptor,
                maximum: 65_536,
                deadline: deadline
            ),
            let response = try? JSONSerialization.jsonObject(with: responseBytes)
                as? [String: Any],
            (response["id"] as? NSNumber)?.intValue == id,
            response["error"] == nil,
            let result = response["result"] as? [String: Any]
        else {
            return nil
        }
        return result
    }

    func writeField(
        _ text: String,
        backendNodeID: Int,
        target: ConfidentialDeliveryTarget,
        inputKind: ConfidentialFieldInputKind
    ) -> Bool? {
        guard let resolved = request(
            method: "DOM.resolveNode",
            parameters: ["backendNodeId": backendNodeID]
        ),
            let object = dictionary(resolved["object"]),
            let objectID = stringValue(object["objectId"])
        else {
            return false
        }
        guard let result = request(
                method: "Runtime.callFunctionOn",
                parameters: confidentialAtomicWriteParameters(
                    objectID: objectID,
                    text: text,
                    target: target,
                    inputKind: inputKind
                )
            )
        else {
            return nil
        }
        guard
            let remote = dictionary(result["result"]),
            let value = dictionary(remote["value"]),
            let written = value["written"] as? Bool
        else {
            return false
        }
        return written
    }
}

private func envelope(
    ok: Bool,
    writeState: String,
    cause: ConfidentialDeliveryCause? = nil,
    field: ConfidentialFieldInputKind? = nil,
    byteLength: Int? = nil,
    methods: [String] = []
) -> Data {
    var object: [String: Any] = [
        "schema_version": 1,
        "ok": ok,
        "write_state": writeState,
        "protocol_trace": methods,
    ]
    if let cause {
        object["rejection"] = [
            "code": cause.rawValue,
            "message": "confidential field delivery blocked; inspect the typed code.",
        ]
    }
    if let field, let byteLength {
        object["shape"] = [
            "field": field.rawValue,
            "byte_length": byteLength,
        ]
    }
    return (try? JSONSerialization.data(
        withJSONObject: object,
        options: [.sortedKeys]
    )) ?? Data(
        "{\"ok\":false,\"schema_version\":1,\"write_state\":\"blocked-before-write\"}"
            .utf8
    )
}

private func targetProofEnvelope(
    targetID: String,
    frameID: String,
    topLevelOrigin: String,
    frameOrigin: String
) -> Data {
    // CDP represents a page as a Target of type `page`; there is no separate
    // page identifier on this boundary. `page_id` is therefore the proven page
    // Target ID, while `frame_id` is the root frame derived from
    // Page.getFrameTree.
    let pageID = targetID
    let canonical: [Any] = [
        1,
        "agent-browser",
        targetID,
        pageID,
        frameID,
        topLevelOrigin,
        frameOrigin,
    ]
    guard let canonicalData = try? JSONSerialization.data(
        withJSONObject: canonical
    ) else {
        return targetProofRejection(.targetUnproven)
    }
    let digest = SHA256.hash(data: canonicalData)
        .map { String(format: "%02x", $0) }
        .joined()
    let value: [String: Any] = [
        "schema_version": 1,
        "ok": true,
        "proof": [
            "lane_id": "agent-browser",
            "target_id": targetID,
            "page_id": pageID,
            "frame_id": frameID,
            "top_level_origin": topLevelOrigin,
            "frame_origin": frameOrigin,
            "target_proof_digest": digest,
        ],
    ]
    return (try? JSONSerialization.data(
        withJSONObject: value,
        options: [.sortedKeys]
    )) ?? targetProofRejection(.targetUnproven)
}

private func targetProofRejection(
    _ cause: ConfidentialTargetProofCause
) -> Data {
    let value: [String: Any] = [
        "schema_version": 1,
        "ok": false,
        "rejection": [
            "code": cause.rawValue,
            "message": "target proof blocked; inspect the typed code.",
        ],
    ]
    return (try? JSONSerialization.data(
        withJSONObject: value,
        options: [.sortedKeys]
    )) ?? Data(
        "{\"ok\":false,\"rejection\":{\"code\":\"invalid-request\",\"message\":\"target proof blocked; inspect the typed code.\"},\"schema_version\":1}"
            .utf8
    )
}

public enum ConfidentialFieldDeliveryProcess {
    @_spi(Testing)
    public static func acceptsChromeExecutablePathForTesting(
        _ path: String
    ) -> Bool {
        exactChromeExecutable(path)
    }

    public static func run(
        metadataDescriptor: Int32,
        credentialDescriptor: Int32,
        browserDescriptor: Int32,
        timeoutMilliseconds: Int32 = 10_000
    ) -> Data {
        let deadline = confidentialMonotonicMilliseconds()
            + Int64(timeoutMilliseconds)
        guard timeoutMilliseconds > 0,
              let metadata = readConfidentialBytes(
                metadataDescriptor,
                maximum: 8_192,
                deadline: deadline
              ),
              let request = try? JSONDecoder().decode(
                ConfidentialDeliveryRequest.self,
                from: Data(metadata)
              ),
              requestIsValid(request)
        else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .invalidRequest
            )
        }

        let channel = ConfidentialBrowserChannel(
            descriptor: browserDescriptor,
            deadline: deadline
        )
        return run(
            request: request,
            credentialDescriptor: credentialDescriptor,
            channel: channel,
            deadline: deadline
        )
    }

    public static func proveTarget(
        requestData: Data,
        timeoutMilliseconds: Int32 = 5_000
    ) -> Data {
        proveTarget(
            requestData: requestData,
            timeoutMilliseconds: timeoutMilliseconds,
            requireChromeExecutable: true
        )
    }

    @_spi(Testing)
    public static func proveTargetForTesting(
        requestData: Data,
        timeoutMilliseconds: Int32 = 5_000
    ) -> Data {
        proveTarget(
            requestData: requestData,
            timeoutMilliseconds: timeoutMilliseconds,
            requireChromeExecutable: false
        )
    }

    private static func proveTarget(
        requestData: Data,
        timeoutMilliseconds: Int32,
        requireChromeExecutable: Bool
    ) -> Data {
        let deadline = confidentialMonotonicMilliseconds()
            + Int64(timeoutMilliseconds)
        guard timeoutMilliseconds > 0,
              let request = decodeTargetProofRequest(requestData),
              let browserEndpoint = validLoopbackBrowserWebSocket(
                request.browserWebSocketEndpoint
              ),
              browserProcessOwnsConfidentialListener(
                pid: request.browserPID,
                endpoint: browserEndpoint,
                requireChromeExecutable: requireChromeExecutable
              ),
              let endpoint = resolveConfidentialPageWebSocket(
                browserEndpoint: request.browserWebSocketEndpoint,
                targetID: request.targetID,
                deadline: deadline
              )
        else {
            return targetProofRejection(.invalidRequest)
        }
        guard let channel = ConfidentialWebSocketBrowserChannel(
            endpoint: endpoint,
            browserPID: request.browserPID,
            deadline: deadline
        ) else {
            return targetProofRejection(.browserChannelUnavailable)
        }
        guard let targetResult = channel.request(
            method: "Target.getTargetInfo",
            parameters: ["targetId": request.targetID]
        ),
            let targetInfo = dictionary(targetResult["targetInfo"]),
            let targetID = stringValue(targetInfo["targetId"]),
            targetID == request.targetID,
            stringValue(targetInfo["type"]) == "page",
            let targetURL = stringValue(targetInfo["url"]),
            let topLevelOrigin = normalizedOrigin(targetURL),
            let frameResult = channel.request(
                method: "Page.getFrameTree",
                parameters: [:]
            ),
            let frameTree = dictionary(frameResult["frameTree"]),
            let frame = dictionary(frameTree["frame"]),
            let frameID = stringValue(frame["id"]),
            boundedCoordinate(frameID),
            let frameURL = stringValue(frame["url"]),
            let frameOrigin = normalizedOrigin(frameURL)
        else {
            return targetProofRejection(.targetUnproven)
        }
        return targetProofEnvelope(
            targetID: targetID,
            frameID: frameID,
            topLevelOrigin: topLevelOrigin,
            frameOrigin: frameOrigin
        )
    }

    private enum PreparedField {
        case ready(Int)
        case blocked(Data)
    }

    private static func prepareField(
        request: ConfidentialDeliveryRequest,
        channel: any ConfidentialBrowserRequestChannel
    ) -> PreparedField {
        guard let targetResult = channel.request(
            method: "Target.getTargetInfo",
            parameters: ["targetId": request.target.targetID]
        ),
            let targetInfo = dictionary(targetResult["targetInfo"]),
            stringValue(targetInfo["targetId"]) == request.target.targetID,
            stringValue(targetInfo["type"]) == "page",
            let targetURL = stringValue(targetInfo["url"]),
            normalizedOrigin(targetURL) == request.target.topLevelOrigin
        else {
            return .blocked(
                envelope(
                    ok: false,
                    writeState: "blocked-before-write",
                    cause: .targetUnproven,
                    methods: channel.methods
                )
            )
        }
        guard let frameResult = channel.request(
            method: "Page.getFrameTree",
            parameters: [:]
        ),
            let frameTree = dictionary(frameResult["frameTree"]),
            let frame = dictionary(frameTree["frame"]),
            stringValue(frame["id"]) == request.target.frameID,
            let frameURL = stringValue(frame["url"]),
            normalizedOrigin(frameURL) == request.target.frameOrigin
        else {
            return .blocked(
                envelope(
                    ok: false,
                    writeState: "blocked-before-write",
                    cause: .targetUnproven,
                    methods: channel.methods
                )
            )
        }
        guard let accessibility = channel.request(
            method: "Accessibility.getFullAXTree",
            parameters: [:]
        ),
            let nodes = accessibility["nodes"] as? [Any]
        else {
            return .blocked(
                envelope(
                    ok: false,
                    writeState: "blocked-before-write",
                    cause: .browserChannelUnavailable,
                    methods: channel.methods
                )
            )
        }
        let matches = nodes.compactMap { raw -> Int? in
            guard let node = dictionary(raw),
                  stringValue(dictionary(node["role"])?["value"])
                    == request.locator.role,
                  stringValue(dictionary(node["name"])?["value"])
                    == request.locator.accessibleName,
                  let backendNodeID = node["backendDOMNodeId"] as? NSNumber,
                  backendNodeID.intValue > 0
            else {
                return nil
            }
            return backendNodeID.intValue
        }
        guard matches.count == 1, let backendNodeID = matches.first else {
            return .blocked(
                envelope(
                    ok: false,
                    writeState: "blocked-before-write",
                    cause: matches.isEmpty ? .fieldMissing : .fieldAmbiguous,
                    methods: channel.methods
                )
            )
        }
        guard let described = channel.request(
            method: "DOM.describeNode",
            parameters: ["backendNodeId": backendNodeID]
        ),
            let node = dictionary(described["node"]),
            stringValue(node["nodeName"]) == "INPUT",
            stringValue(node["frameId"]) == request.target.frameID,
            let attributes = node["attributes"] as? [String],
            inputTypeIsValid(
                attributes: attributes,
                inputKind: request.locator.inputKind
            )
        else {
            return .blocked(
                envelope(
                    ok: false,
                    writeState: "blocked-before-write",
                    cause: .fieldInvalid,
                    methods: channel.methods
                )
            )
        }
        return .ready(backendNodeID)
    }

    private static func deliverPreparedField(
        request: ConfidentialDeliveryRequest,
        backendNodeID: Int,
        credentialDescriptor: Int32,
        channel: any ConfidentialBrowserRequestChannel,
        deadline: Int64
    ) -> Data {
        guard var credential = readConfidentialBytes(
            credentialDescriptor,
            maximum: 4_096,
            deadline: deadline
        ) else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .credentialInvalid,
                methods: channel.methods
            )
        }
        defer {
            _ = credential.withUnsafeMutableBytes {
                $0.initializeMemory(as: UInt8.self, repeating: 0)
            }
        }
        if credential.last == 0x0a { credential.removeLast() }
        if credential.last == 0x0d { credential.removeLast() }
        guard !credential.isEmpty,
              !credential.contains(0),
              !credential.contains(0x0a),
              !credential.contains(0x0d),
              let text = String(bytes: credential, encoding: .utf8)
        else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .credentialInvalid,
                methods: channel.methods
            )
        }
        let byteLength = credential.count
        guard let inserted = channel.writeField(
            text,
            backendNodeID: backendNodeID,
            target: request.target,
            inputKind: request.locator.inputKind
        ) else {
            return envelope(
                ok: false,
                writeState: "write-outcome-unknown",
                cause: .writeOutcomeUnknown,
                methods: channel.methods
            )
        }
        guard inserted else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .targetUnproven,
                methods: channel.methods
            )
        }
        return envelope(
            ok: true,
            writeState: "delivered",
            field: request.locator.inputKind,
            byteLength: byteLength,
            methods: channel.methods
        )
    }

    public static func runPrivate(
        requestData: Data,
        configRoot: String,
        opExecutablePath: String,
        timeoutMilliseconds: Int32 = 10_000
    ) -> Data {
        let deadline = confidentialMonotonicMilliseconds()
            + Int64(timeoutMilliseconds)
        guard timeoutMilliseconds > 0,
              let request = decodePrivateDeliveryRequest(requestData),
              let browserEndpoint = validLoopbackBrowserWebSocket(
                request.browserWebSocketEndpoint
              ),
              browserProcessOwnsConfidentialListener(
                pid: request.browserPID,
                endpoint: browserEndpoint,
                requireChromeExecutable: true
              ),
              let endpoint = resolveConfidentialPageWebSocket(
                browserEndpoint: request.browserWebSocketEndpoint,
                targetID: request.target.targetID,
                deadline: deadline
              )
        else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .invalidRequest
            )
        }
        guard let channel = ConfidentialWebSocketBrowserChannel(
            endpoint: endpoint,
            browserPID: request.browserPID,
            deadline: deadline
        ) else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .browserChannelUnavailable
            )
        }
        let deliveryRequest = ConfidentialDeliveryRequest(
            schemaVersion: request.schemaVersion,
            target: request.target,
            locator: request.locator
        )
        let backendNodeID: Int
        switch prepareField(request: deliveryRequest, channel: channel) {
        case let .ready(value):
            backendNodeID = value
        case let .blocked(result):
            return result
        }
        let tokenDescriptor: Int32
        do {
            tokenDescriptor = try openEnvironmentTokenDescriptor(
                configRoot: configRoot
            )
        } catch {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .credentialInvalid
            )
        }
        defer { _ = Darwin.close(tokenDescriptor) }
        guard let field = EnvironmentOpPrivateField(
            rawValue: request.locator.inputKind.rawValue
        ) else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .invalidRequest
            )
        }
        let remaining = Int32(
            max(1, deadline - confidentialMonotonicMilliseconds())
        )
        let result = EnvironmentOpSupervisor.executeAdmittedPrivateField(
            executablePath: opExecutablePath,
            vaultID: request.binding.vaultID,
            itemID: request.binding.itemID,
            field: field,
            tokenDescriptor: tokenDescriptor,
            timeoutMilliseconds: remaining
        ) { credentialDescriptor, deliveryTimeout in
            deliverPreparedField(
                request: deliveryRequest,
                backendNodeID: backendNodeID,
                credentialDescriptor: credentialDescriptor,
                channel: channel,
                deadline: min(
                    deadline,
                    confidentialMonotonicMilliseconds()
                        + Int64(deliveryTimeout)
                )
            )
        }
        switch result {
        case let .success(delivery):
            return delivery
        case .blocked:
            return envelope(
                ok: false,
                writeState: "write-outcome-unknown",
                cause: .writeOutcomeUnknown
            )
        }
    }

    @_spi(Testing)
    public static func runPrivateForTesting(
        requestData: Data,
        opExecutablePath: String,
        tokenDescriptor: Int32,
        timeoutMilliseconds: Int32 = 10_000
    ) -> Data {
        let deadline = confidentialMonotonicMilliseconds()
            + Int64(timeoutMilliseconds)
        guard timeoutMilliseconds > 0,
              let request = decodePrivateDeliveryRequest(requestData),
              let browserEndpoint = validLoopbackBrowserWebSocket(
                request.browserWebSocketEndpoint
              ),
              browserProcessOwnsConfidentialListener(
                pid: request.browserPID,
                endpoint: browserEndpoint,
                requireChromeExecutable: false
              ),
              let endpoint = resolveConfidentialPageWebSocket(
                browserEndpoint: request.browserWebSocketEndpoint,
                targetID: request.target.targetID,
                deadline: deadline
              ),
              let field = EnvironmentOpPrivateField(
                rawValue: request.locator.inputKind.rawValue
              )
        else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .invalidRequest
            )
        }
        guard let channel = ConfidentialWebSocketBrowserChannel(
            endpoint: endpoint,
            browserPID: request.browserPID,
            deadline: deadline
        ) else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .browserChannelUnavailable
            )
        }
        let deliveryRequest = ConfidentialDeliveryRequest(
            schemaVersion: request.schemaVersion,
            target: request.target,
            locator: request.locator
        )
        let backendNodeID: Int
        switch prepareField(request: deliveryRequest, channel: channel) {
        case let .ready(value):
            backendNodeID = value
        case let .blocked(result):
            return result
        }
        let result =
            EnvironmentOpSupervisor
                .executeIdentityBoundPrivateFieldForTesting(
                    executablePath: opExecutablePath,
                    vaultID: request.binding.vaultID,
                    itemID: request.binding.itemID,
                    field: field,
                    tokenDescriptor: tokenDescriptor,
                    timeoutMilliseconds: Int32(
                        max(1, deadline - confidentialMonotonicMilliseconds())
                    )
                ) { credentialDescriptor, deliveryTimeout in
                    return deliverPreparedField(
                        request: deliveryRequest,
                        backendNodeID: backendNodeID,
                        credentialDescriptor: credentialDescriptor,
                        channel: channel,
                        deadline: min(
                            deadline,
                            confidentialMonotonicMilliseconds()
                                + Int64(deliveryTimeout)
                        )
                    )
                }
        switch result {
        case let .success(delivery):
            return delivery
        case .blocked:
            return envelope(
                ok: false,
                writeState: "write-outcome-unknown",
                cause: .writeOutcomeUnknown
            )
        }
    }

    private static func run(
        request: ConfidentialDeliveryRequest,
        credentialDescriptor: Int32,
        channel: any ConfidentialBrowserRequestChannel,
        deadline: Int64
    ) -> Data {
        guard let targetResult = channel.request(
            method: "Target.getTargetInfo",
            parameters: ["targetId": request.target.targetID]
        ),
            let targetInfo = dictionary(targetResult["targetInfo"]),
            stringValue(targetInfo["targetId"]) == request.target.targetID,
            stringValue(targetInfo["type"]) == "page",
            let targetURL = stringValue(targetInfo["url"]),
            normalizedOrigin(targetURL) == request.target.topLevelOrigin
        else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .targetUnproven,
                methods: channel.methods
            )
        }

        guard let frameResult = channel.request(
            method: "Page.getFrameTree",
            parameters: [:]
        ),
            let frameTree = dictionary(frameResult["frameTree"]),
            let frame = dictionary(frameTree["frame"]),
            stringValue(frame["id"]) == request.target.frameID,
            let frameURL = stringValue(frame["url"]),
            normalizedOrigin(frameURL) == request.target.frameOrigin
        else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .targetUnproven,
                methods: channel.methods
            )
        }

        guard let accessibility = channel.request(
            method: "Accessibility.getFullAXTree",
            parameters: [:]
        ),
            let nodes = accessibility["nodes"] as? [Any]
        else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .browserChannelUnavailable,
                methods: channel.methods
            )
        }
        let matches = nodes.compactMap { raw -> Int? in
            guard let node = dictionary(raw),
                  stringValue(dictionary(node["role"])?["value"])
                    == request.locator.role,
                  stringValue(dictionary(node["name"])?["value"])
                    == request.locator.accessibleName,
                  let backendNodeID = node["backendDOMNodeId"] as? NSNumber,
                  backendNodeID.intValue > 0
            else {
                return nil
            }
            return backendNodeID.intValue
        }
        guard matches.count == 1, let backendNodeID = matches.first else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: matches.isEmpty ? .fieldMissing : .fieldAmbiguous,
                methods: channel.methods
            )
        }

        guard let described = channel.request(
            method: "DOM.describeNode",
            parameters: ["backendNodeId": backendNodeID]
        ),
            let node = dictionary(described["node"]),
            stringValue(node["nodeName"]) == "INPUT",
            stringValue(node["frameId"]) == request.target.frameID,
            let attributes = node["attributes"] as? [String],
            inputTypeIsValid(
                attributes: attributes,
                inputKind: request.locator.inputKind
            )
        else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .fieldInvalid,
                methods: channel.methods
            )
        }

        guard var credential = readConfidentialBytes(
            credentialDescriptor,
            maximum: 4_096,
            deadline: deadline
        ) else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .credentialInvalid,
                methods: channel.methods
            )
        }
        defer {
            _ = credential.withUnsafeMutableBytes {
                $0.initializeMemory(as: UInt8.self, repeating: 0)
            }
        }
        if credential.last == 0x0a { credential.removeLast() }
        if credential.last == 0x0d { credential.removeLast() }
        guard !credential.isEmpty,
              !credential.contains(0),
              !credential.contains(0x0a),
              !credential.contains(0x0d),
              let text = String(bytes: credential, encoding: .utf8)
        else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .credentialInvalid,
                methods: channel.methods
            )
        }
        let byteLength = credential.count
        guard let inserted = channel.writeField(
            text,
            backendNodeID: backendNodeID,
            target: request.target,
            inputKind: request.locator.inputKind
        ) else {
            return envelope(
                ok: false,
                writeState: "write-outcome-unknown",
                cause: .writeOutcomeUnknown,
                methods: channel.methods
            )
        }
        guard inserted else {
            return envelope(
                ok: false,
                writeState: "blocked-before-write",
                cause: .targetUnproven,
                methods: channel.methods
            )
        }
        return envelope(
            ok: true,
            writeState: "delivered",
            field: request.locator.inputKind,
            byteLength: byteLength,
            methods: channel.methods
        )
    }
}

private func inputTypeIsValid(
    attributes: [String],
    inputKind: ConfidentialFieldInputKind
) -> Bool {
    var projected: [String: String] = [:]
    var index = 0
    while index + 1 < attributes.count {
        projected[attributes[index].lowercased()] =
            attributes[index + 1].lowercased()
        index += 2
    }
    let type = projected["type"] ?? "text"
    switch inputKind {
    case .password:
        return type == "password"
    case .username:
        return ["text", "email", "tel"].contains(type)
    case .otpCurrent:
        return ["text", "tel", "number"].contains(type)
    }
}
