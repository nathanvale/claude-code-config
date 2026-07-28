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

/// Explicit XPC peer authentication for the delivery listener.
///
/// The `_AllowedClients` array in `Info.plist` is defense in depth, not access
/// control: an `xpc_connection_create_mach_service` listener otherwise accepts
/// every incoming connection, and the plist allow-list alone does not reject a
/// non-launcher peer before its descriptors are read. This type is the actual
/// gate. It pins each accepted peer connection to a code-signing designated
/// requirement — via `xpc_connection_set_peer_code_signing_requirement`, which
/// derives identity from the peer's audit token (never a PID, which is reusable
/// and spoofable) — that names the Token Retrieval Launcher's bundle id anchored
/// to this product's own signing team. Any peer that fails the requirement has
/// its messages dropped by XPC before the event handler runs, so no descriptor
/// is ever accepted from an unauthorized caller.
///
/// Denial invariant (documented; exercised by the signed build):
/// a connection whose audit-token code-signing identity does NOT satisfy
/// `launcherDesignatedRequirement` never reaches `ConfidentialFieldDelivery`
/// — XPC drops its requests on this listener (TN3127 semantics) — so there is
/// no reply, no descriptor read, and no field write, log-free. This is the
/// peer-denial live probe recorded for the signed-build operator gate: it
/// cannot run against unsigned source (peer code-signing enforcement needs a
/// signed binary and a signed peer), so it ships as a source-level invariant
/// here and is exercised as a live denial probe once the operator signs the
/// product.
enum PeerAuthorization {
    /// Bundle id of the sole authorized caller (ADR 0027 xpc-peer-pinned custody).
    /// Mirrors `Info.plist` `_AllowedClients` and `TokenRetrievalLauncher`'s
    /// `CFBundleIdentifier` exactly.
    static let launcherBundleID =
        "com.side-quest.browser-use-security.token-retrieval-launcher"

    /// Designated requirement the peer's code signature must satisfy.
    ///
    /// Requires an Apple-anchored signature for the launcher's bundle id whose
    /// leaf certificate carries this product's signing team in `subject.OU`. The
    /// `$(TeamIdentifierPrefix)` placeholder is resolved to the concrete 10-char
    /// Team ID at signing time (the operator gate signs this source); it is kept
    /// as an explicit token so the anchored-to-same-team constraint cannot be
    /// silently dropped when the requirement is minted. Pinning the team blocks a
    /// signature that merely reuses the bundle id under a different (attacker)
    /// team — the same defense `admission.ts` encodes for the manifest.
    static let launcherDesignatedRequirement =
        "anchor apple generic and identifier \"\(launcherBundleID)\" "
        + "and certificate leaf[subject.OU] = \"$(TeamIdentifierPrefix)\""

    /// Pin one inbound peer connection to `launcherDesignatedRequirement`.
    ///
    /// `xpc_connection_set_peer_code_signing_requirement` validates the peer via
    /// its audit token: on a listener connection every request that does not
    /// satisfy the requirement is dropped before delivery, so an unauthorized
    /// peer's message never reaches the delivery handler. Returns `true` only
    /// when the requirement was installed (return value `0`); a non-zero result
    /// (invalid requirement string, or `ENOTSUP` on an unsupported platform)
    /// fails closed and the caller cancels the connection.
    static func pinPeerRequirement(_ connection: xpc_connection_t) -> Bool {
        launcherDesignatedRequirement.withCString { requirement in
            xpc_connection_set_peer_code_signing_requirement(
                connection,
                requirement
            ) == 0
        }
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
    // Explicit peer authentication: pin this peer to the launcher's code-signing
    // designated requirement before resuming it, so XPC drops any request from a
    // non-launcher peer before a descriptor is read. If the requirement cannot be
    // installed, fail closed and cancel — never fall back to accepting the peer.
    // The plist `_AllowedClients` list stays as defense in depth, not relied on.
    guard PeerAuthorization.pinPeerRequirement(connection) else {
        xpc_connection_cancel(connection)
        return
    }
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
