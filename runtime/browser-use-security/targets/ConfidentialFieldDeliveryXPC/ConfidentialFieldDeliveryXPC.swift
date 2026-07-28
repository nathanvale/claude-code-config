// Confidential Field Delivery XPC service (ADR 0027 target 3; ADR 0022; plan
// R16, R17, R18).
//
// A signed, sandboxed, disposable macOS XPC service. It receives a private
// secret-pipe file descriptor and a pre-opened verified browser-channel file
// descriptor through the supported XPC file-descriptor APIs
// (`xpc_fd_create` / `xpc_dictionary_set_fd` / `xpc_dictionary_dup_fd`),
// performs ONE bounded field write against that browser channel, clears its
// in-process secret buffer, and exits.
//
// It runs under App Sandbox with `network.client=false` and no broad file
// entitlement, so it cannot open new network connections or unrelated files —
// only the two inherited, connected descriptors (R17). It receives NO OP token.
//
// Authored unsigned. The XPC connection, sandbox probe, and descriptor passing
// require a signed service; this does not build or run without full Xcode.

import Foundation
import XPC

/// The two file descriptors the delivery service consumes for one action.
///
/// Both arrive pre-opened over XPC. The service opens neither itself: the
/// sandbox forbids new connections and unrelated files, so these inherited,
/// already-connected descriptors are its entire I/O surface.
private enum DeliveryFDKey {
    /// Private inherited pipe carrying the one requested field value.
    static let secretPipe = "secret_pipe_fd"
    /// Pre-opened verified browser-channel descriptor for the one write.
    static let browserChannel = "browser_channel_fd"
    /// The DOM field selector for the single bounded write.
    static let fieldSelector = "field_selector"
}

/// Typed outcomes of one delivery action (R18, R21) — never a silent failure.
enum DeliveryResult: Int32 {
    case delivered = 0
    case missingDescriptor = 10
    case fieldWriteFailed = 11
    case cleanupFailed = 12
}

/// One bounded confidential-field delivery.
struct ConfidentialFieldDelivery {
    /// Handle exactly one inbound XPC message: read the secret from the pipe,
    /// write it once to the browser channel, zeroize, and reply. Any missing
    /// descriptor fails closed.
    static func handle(_ message: xpc_object_t) -> Int32 {
        // Duplicate the inherited descriptors out of the XPC message. If either
        // is absent the request is malformed; fail closed without touching a
        // browser channel.
        let secretFD = xpc_dictionary_dup_fd(message, DeliveryFDKey.secretPipe)
        let channelFD = xpc_dictionary_dup_fd(message, DeliveryFDKey.browserChannel)
        guard secretFD >= 0, channelFD >= 0 else {
            if secretFD >= 0 { close(secretFD) }
            if channelFD >= 0 { close(channelFD) }
            return DeliveryResult.missingDescriptor.rawValue
        }
        defer {
            close(secretFD)
            close(channelFD)
        }

        guard
            let selector = xpc_dictionary_get_string(message, DeliveryFDKey.fieldSelector)
        else {
            return DeliveryResult.missingDescriptor.rawValue
        }

        // Read the one field value from the private inherited pipe into a
        // mutable buffer so it can be zeroized after the single write.
        var secret = readAll(fd: secretFD)
        defer { zeroize(&secret) }

        // Perform exactly one bounded field write against the pre-opened,
        // verified browser channel. The service never opens its own connection
        // (sandbox: network.client=false), so this is the only egress path.
        let selectorString = String(cString: selector)
        let wrote = performBoundedFieldWrite(
            channelFD: channelFD,
            fieldSelector: selectorString,
            value: secret
        )
        guard wrote else { return DeliveryResult.fieldWriteFailed.rawValue }

        return DeliveryResult.delivered.rawValue
    }

    /// Read the full secret payload from the inherited pipe fd.
    private static func readAll(fd: Int32) -> [UInt8] {
        var buffer = [UInt8]()
        var chunk = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = read(fd, &chunk, chunk.count)
            if n <= 0 { break }
            buffer.append(contentsOf: chunk[0..<n])
        }
        return buffer
    }

    /// Overwrite the in-process secret buffer before exit (R18 zeroize).
    private static func zeroize(_ bytes: inout [UInt8]) {
        for i in bytes.indices { bytes[i] = 0 }
        bytes.removeAll(keepingCapacity: false)
    }

    /// Write the one field value to the verified browser-channel descriptor.
    ///
    /// The browser channel is pre-opened and verified by the caller before the
    /// descriptor is handed in; the service re-uses it and performs no origin
    /// discovery of its own. Exactly one bounded write, then done.
    private static func performBoundedFieldWrite(
        channelFD: Int32,
        fieldSelector: String,
        value: [UInt8]
    ) -> Bool {
        // Frame: the verified channel's protocol expects the field selector
        // followed by the value bytes for a single fill. The unsigned scaffold
        // writes the framed payload to the inherited descriptor; the signed
        // build binds this to the concrete browser-channel wire format.
        var frame = Array("\(fieldSelector)\n".utf8)
        frame.append(contentsOf: value)
        let written = frame.withUnsafeBytes { raw -> Int in
            guard let base = raw.baseAddress else { return -1 }
            return write(channelFD, base, raw.count)
        }
        return written == frame.count
    }
}

// XPC event handler: one bounded action per service instance, then exit. The
// service is spawned on demand and is not kept alive (ADR 0027 no daemon).
let listener = xpc_connection_create_mach_service(
    "com.side-quest.browser-use-security.confidential-field-delivery",
    nil,
    UInt64(XPC_CONNECTION_MACH_SERVICE_LISTENER)
)
xpc_connection_set_event_handler(listener) { peer in
    guard xpc_get_type(peer) == XPC_TYPE_CONNECTION else { return }
    let connection = peer
    xpc_connection_set_event_handler(connection) { message in
        guard xpc_get_type(message) == XPC_TYPE_DICTIONARY else { return }
        let status = ConfidentialFieldDelivery.handle(message)
        let reply = xpc_dictionary_create_reply(message)
        if let reply {
            xpc_dictionary_set_int64(reply, "status", Int64(status))
            xpc_connection_send_message(connection, reply)
        }
        // One bounded field action, then the service exits (R16).
        exit(status)
    }
    xpc_connection_resume(connection)
}
xpc_connection_resume(listener)
dispatchMain()
