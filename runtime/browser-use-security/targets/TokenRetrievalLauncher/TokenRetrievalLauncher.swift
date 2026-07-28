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
    case tokenAccessibilityMismatch
    case entitlementMissing
    case opBinaryNotFound
    case opSignatureUntrusted
    case execFailed(Int32)
}

/// Where the single token item lives: the private data-protection keychain
/// access group scoped to this launcher, with the fixed service label.
enum TokenItemLocator {
    static let accessGroup = "com.side-quest.browser-use-security.token"
    static let service = "com.side-quest.browser-use-security.op-service-account-token"
    /// The one environment variable the disposable op child receives.
    static let tokenEnvVar = "OP_SERVICE_ACCOUNT_TOKEN"
    /// The only accessibility class this token may carry: readable after first
    /// unlock, never migrated off this device. A same-service item stored with
    /// any weaker class (e.g. `AfterFirstUnlock`, `WhenUnlocked`, or a
    /// synchronizing/backup-eligible class) is rejected rather than accepted.
    static let expectedAccessible = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
}

struct TokenRetrievalLauncher {
    /// Read EXACTLY one token item from the private data-protection group.
    ///
    /// Zero matches -> `tokenItemMissing`; more than one -> `tokenItemAmbiguous`.
    /// The item is `AfterFirstUnlockThisDeviceOnly` and non-synchronizing; a
    /// missing first unlock surfaces as `firstUnlockUnavailable`. The token
    /// bytes returned here are handed straight to the op child's environment and
    /// never retained, logged, or written anywhere else.
    ///
    /// `kSecAttrAccessible` is not a query constraint the keychain honors for
    /// matching, so it is fetched back with `kSecReturnAttributes` and compared:
    /// a same-service item stored under any other accessibility class (a weaker
    /// protection, or a synchronizing/backup-eligible one) is rejected as
    /// `tokenAccessibilityMismatch` rather than accepted.
    static func readSingleTokenItem() throws -> Data {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: TokenItemLocator.service,
            kSecAttrAccessGroup as String: TokenItemLocator.accessGroup,
            kSecAttrSynchronizable as String: false,
            kSecMatchLimit as String: kSecMatchLimitAll,
            kSecReturnData as String: true,
            kSecReturnAttributes as String: true,
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
        // With attributes returned, each match is a dictionary carrying both the
        // token bytes (kSecValueData) and its accessibility class (kSecAttrAccessible).
        guard let items = result as? [[String: Any]] else { throw LauncherError.tokenItemMissing }
        guard items.count == 1, let item = items.first else {
            throw items.isEmpty ? LauncherError.tokenItemMissing : LauncherError.tokenItemAmbiguous
        }
        // Require the expected accessibility class before accepting the token: a
        // same-service item with a different class must not be returned.
        let accessible = item[kSecAttrAccessible as String] as CFTypeRef?
        guard let accessible,
              CFEqual(accessible, TokenItemLocator.expectedAccessible)
        else {
            throw LauncherError.tokenAccessibilityMismatch
        }
        guard let token = item[kSecValueData as String] as? Data else {
            throw LauncherError.tokenItemMissing
        }
        return token
    }

    /// The immutable install path of the official op helper. A binary at any
    /// other path is never handed the token.
    static let opPath = "/usr/local/bin/op"

    /// Designated requirement pinning 1Password's official `op` CLI identity.
    ///
    /// `op` ships signed by AgileBits Inc. under Apple Developer ID team
    /// `2BUA8C4S2C` with code-signing identifier `com.1password.op` (verified
    /// against the shipped binary's `codesign -d -r-` output). `anchor apple
    /// generic` roots it in the Apple-issued Developer ID chain; the identifier
    /// pin rejects a same-team binary with a different identity; the leaf OU pin
    /// rejects a re-sign under any other team. A swapped or ad-hoc binary at the
    /// install path fails this requirement and never receives the token.
    static let opDesignatedRequirement =
        "anchor apple generic and identifier \"com.1password.op\" "
        + "and certificate leaf[subject.OU] = \"2BUA8C4S2C\""

    /// Verify the binary at `opPath` satisfies the pinned op designated
    /// requirement. Fails closed (`opSignatureUntrusted`) on any error: an
    /// unreadable static code object, a malformed requirement, or a validity
    /// check that does not pass. Only a binary that provably matches 1Password's
    /// signing identity is admitted before the token env is assembled.
    static func verifyOpSignature(atPath path: String) throws {
        let url = URL(fileURLWithPath: path) as CFURL
        var staticCode: SecStaticCode?
        guard SecStaticCodeCreateWithPath(url, [], &staticCode) == errSecSuccess,
              let code = staticCode
        else {
            throw LauncherError.opSignatureUntrusted
        }
        var requirement: SecRequirement?
        guard SecRequirementCreateWithString(
            opDesignatedRequirement as CFString, [], &requirement
        ) == errSecSuccess,
            let requirement
        else {
            throw LauncherError.opSignatureUntrusted
        }
        guard SecStaticCodeCheckValidity(code, [], requirement) == errSecSuccess else {
            throw LauncherError.opSignatureUntrusted
        }
    }

    /// Exec the disposable official op helper with an exact environment.
    ///
    /// The child receives ONLY the one token variable plus a minimal fixed
    /// environment (PATH). `inherit:false`: the launcher's own environment,
    /// descriptors, and any browser channel are not passed down. The op binary
    /// is a short-lived trusted networked process; it gets the token but no
    /// browser endpoint (R16, R17).
    ///
    /// The binary is authenticated before any token is assembled:
    /// `isExecutableFile` only proves the path can execute, so a swapped binary
    /// there would still receive the token. The pinned designated requirement is
    /// verified from the immutable install path first, and the token env is
    /// assembled only after that passes — never for an unverified binary.
    static func execDisposableOp(arguments: [String], token: Data) throws -> Never {
        guard FileManager.default.isExecutableFile(atPath: opPath) else {
            throw LauncherError.opBinaryNotFound
        }
        // Authenticate before touching the token: fail closed if the binary at
        // the install path is not the pinned, 1Password-signed op.
        try verifyOpSignature(atPath: opPath)
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
