// Token Retrieval Launcher (ADR 0027 target 2; ADR 0028 daemon-in-app's-clothing;
// ADR 0023; plan R7, R16).
//
// An app-like bundle embedding a provisioning profile so it can hold the
// restricted private data-protection keychain access group. It reads EXACTLY
// one keychain item (the Browser Automation service-account token, stored
// AfterFirstUnlockThisDeviceOnly and non-synchronizing) and immediately execs
// the disposable official `op` helper with an exact environment carrying that
// one token variable, inherit:false. It receives NO browser channel.
//
// The token never enters Browser Use's parent environment, with-env, .env,
// tmux, a persistent PTY, shell history, an adapter, a plugin, a daemon, or the
// delivery helper's environment (R7). It exists only inside the disposable op
// child's environment for the lifetime of that one exec.
//
// Authored unsigned. The restricted keychain-access-group requires the embedded
// provisioning profile from a paid Apple Developer Program enrollment (ADR
// 0028), so this does not build or run without full Xcode plus enrollment.

import Foundation
import Security

/// Typed launcher failures (R7, R21) — always a state, never a crash.
enum LauncherError: Error {
    case firstUnlockUnavailable
    case tokenItemMissing
    case tokenItemAmbiguous
    case entitlementMissing
    case opBinaryNotFound
    case execFailed(Int32)
}

/// Where the single token item lives: the private data-protection keychain
/// access group scoped to this launcher, with the fixed service label.
enum TokenItemLocator {
    static let accessGroup = "com.side-quest.browser-use-security.token"
    static let service = "com.side-quest.browser-use-security.op-service-account-token"
    /// The one environment variable the disposable op child receives.
    static let tokenEnvVar = "OP_SERVICE_ACCOUNT_TOKEN"
}

struct TokenRetrievalLauncher {
    /// Read EXACTLY one token item from the private data-protection group.
    ///
    /// Zero matches -> `tokenItemMissing`; more than one -> `tokenItemAmbiguous`.
    /// The item is `AfterFirstUnlockThisDeviceOnly` and non-synchronizing; a
    /// missing first unlock surfaces as `firstUnlockUnavailable`. The token
    /// bytes returned here are handed straight to the op child's environment and
    /// never retained, logged, or written anywhere else.
    static func readSingleTokenItem() throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: TokenItemLocator.service,
            kSecAttrAccessGroup as String: TokenItemLocator.accessGroup,
            kSecAttrSynchronizable as String: false,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnData as String: true,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            break
        case errSecItemNotFound:
            throw LauncherError.tokenItemMissing
        case errSecInteractionNotAllowed:
            // The device has not reached first unlock, so the protected item is
            // unreadable. A typed repair state, not a crash.
            throw LauncherError.firstUnlockUnavailable
        case errSecMissingEntitlement:
            throw LauncherError.entitlementMissing
        default:
            throw LauncherError.tokenItemMissing
        }
        guard let items = result as? [Data] else { throw LauncherError.tokenItemMissing }
        guard items.count == 1, let token = items.first else {
            throw items.isEmpty ? LauncherError.tokenItemMissing : LauncherError.tokenItemAmbiguous
        }
        return token
    }

    /// Exec the disposable official op helper with an exact environment.
    ///
    /// The child receives ONLY the one token variable plus a minimal fixed
    /// environment (PATH). `inherit:false`: the launcher's own environment,
    /// descriptors, and any browser channel are not passed down. The op binary
    /// is a short-lived trusted networked process; it gets the token but no
    /// browser endpoint (R16, R17).
    static func execDisposableOp(arguments: [String], token: Data) throws -> Never {
        let opPath = "/usr/local/bin/op"
        guard FileManager.default.isExecutableFile(atPath: opPath) else {
            throw LauncherError.opBinaryNotFound
        }
        guard let tokenString = String(data: token, encoding: .utf8) else {
            throw LauncherError.tokenItemMissing
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: opPath)
        process.arguments = arguments
        // Exact environment: exactly the token var and a minimal PATH. Nothing
        // is inherited from the launcher, so the token never leaks upward and no
        // browser-channel or unrelated variable reaches op.
        process.environment = [
            TokenItemLocator.tokenEnvVar: tokenString,
            "PATH": "/usr/local/bin:/usr/bin:/bin",
        ]
        // inherit:false — do not pass the launcher's stdio/descriptors down.
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        do {
            try process.run()
        } catch {
            throw LauncherError.execFailed(-1)
        }
        process.waitUntilExit()
        // The launcher exits with the op child's status and holds no token
        // afterward. On-demand lifetime; no daemon (ADR 0027).
        exit(process.terminationStatus)
    }
}
