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

import Darwin
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
    case opStagingFailed
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

    /// Filename the public op is cloned to inside the private staging directory.
    /// The staged copy is what gets verified and exec'd, so verify-target and
    /// exec-target are the same inode by construction.
    static let stagedOpName = "op"

    /// Verify the binary at `path` satisfies the pinned op designated
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

    /// A verified private copy of op plus the 0700 directory holding it. The
    /// caller execs `binaryPath` and removes `directory` after the child exits.
    struct StagedOp {
        let directory: String
        let binaryPath: String
    }

    /// Stage op into a private 0700 directory, then verify the *staged copy*, and
    /// return it for exec.
    ///
    /// This closes the TOCTOU window between signature verification and exec.
    /// Verifying `opPath` and then exec'ing `opPath` are two path lookups: an
    /// attacker who swaps `/usr/local/bin/op` between them makes the verified
    /// inode and the exec'd inode differ, so a binary that passed the pinned
    /// designated requirement is not necessarily the one that receives the token.
    ///
    /// Instead: (1) create a per-launch staging directory with 0700 perms owned
    /// by this process, and verify its perms and ownership after creation; (2)
    /// clone the public op into it (clonefile, copyfile fallback); (3) run the
    /// pinned designated-requirement check against the PRIVATE COPY; (4) hand that
    /// verified copy back for exec. Because the staging directory is 0700 and
    /// owned by us, an attacker who can swap the public path cannot touch the
    /// private copy — so verify-target and exec-target are the same inode by
    /// construction, and there is no window in which they can diverge.
    ///
    /// Fails closed (`opStagingFailed`) on any staging error; the pinned
    /// signature check still throws `opSignatureUntrusted`. Never falls back to
    /// the public path unverified.
    static func stageAndVerifyOp() throws -> StagedOp {
        guard FileManager.default.isExecutableFile(atPath: opPath) else {
            throw LauncherError.opBinaryNotFound
        }

        // Per-launch staging directory under the per-user Darwin temp dir (or the
        // Foundation temporary directory if confstr yields nothing). mkdtemp
        // creates it atomically with 0700 before returning, owned by this euid.
        let base = darwinUserTempDir() ?? FileManager.default.temporaryDirectory.path
        let template = (base as NSString)
            .appendingPathComponent("op-staging-XXXXXXXX")
        var templateBytes = Array(template.utf8CString)
        guard mkdtemp(&templateBytes) != nil else {
            throw LauncherError.opStagingFailed
        }
        let stagingDir = String(cString: templateBytes)

        // Verify the directory really is 0700 and owned by us before trusting it
        // as a private staging root — fail closed and clean up otherwise.
        do {
            try assertPrivateDirectory(stagingDir)
        } catch {
            try? FileManager.default.removeItem(atPath: stagingDir)
            throw error
        }

        let stagedPath = (stagingDir as NSString)
            .appendingPathComponent(stagedOpName)

        // Clone the public op into the private directory. clonefile is atomic and
        // copy-on-write; fall back to copyfile when the temp dir is on a
        // different filesystem or the clone is unsupported.
        let cloned = clonefile(opPath, stagedPath, 0) == 0
        if !cloned {
            guard copyfile(opPath, stagedPath, nil, copyfile_flags_t(COPYFILE_ALL)) == 0
            else {
                try? FileManager.default.removeItem(atPath: stagingDir)
                throw LauncherError.opStagingFailed
            }
        }

        // Verify the PRIVATE COPY, not the public path. This is the inode that
        // will be exec'd, so passing this check binds verify-target to
        // exec-target. Propagate opSignatureUntrusted on failure; clean up first.
        do {
            try verifyOpSignature(atPath: stagedPath)
        } catch {
            try? FileManager.default.removeItem(atPath: stagingDir)
            throw error
        }

        return StagedOp(directory: stagingDir, binaryPath: stagedPath)
    }

    /// The per-user Darwin temp dir (`_CS_DARWIN_USER_TEMP_DIR`), a 0700
    /// per-uid path, or nil if confstr yields nothing usable.
    private static func darwinUserTempDir() -> String? {
        let size = confstr(_CS_DARWIN_USER_TEMP_DIR, nil, 0)
        guard size > 0 else { return nil }
        var buffer = [CChar](repeating: 0, count: size)
        guard confstr(_CS_DARWIN_USER_TEMP_DIR, &buffer, size) == size else {
            return nil
        }
        let path = String(cString: buffer)
        return path.isEmpty ? nil : path
    }

    /// Fail closed unless `path` is a directory with 0700 permissions owned by
    /// this effective uid — the invariant that keeps the staged copy private.
    private static func assertPrivateDirectory(_ path: String) throws {
        var info = stat()
        guard stat(path, &info) == 0 else { throw LauncherError.opStagingFailed }
        let isDirectory = (info.st_mode & S_IFMT) == S_IFDIR
        let permBits = info.st_mode & (S_IRWXU | S_IRWXG | S_IRWXO)
        guard isDirectory,
              permBits == S_IRWXU,
              info.st_uid == geteuid()
        else {
            throw LauncherError.opStagingFailed
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
    /// The binary is authenticated before any token is assembled. op is staged
    /// into a private 0700 directory and the pinned designated requirement is
    /// verified against that private copy, which is then the inode exec'd — so no
    /// TOCTOU window exists between the verify and the exec. The token env is
    /// assembled only after staging + verification pass; never for an unverified
    /// binary and never against the public install path.
    static func execDisposableOp(arguments: [String], token: Data) throws -> Never {
        // Stage + verify the private copy before touching the token: fail closed
        // if op cannot be staged or the staged copy is not the pinned,
        // 1Password-signed op.
        let staged = try stageAndVerifyOp()
        // Best-effort cleanup of the private staging directory on every exit path
        // out of this scope, including the throwing ones below.
        defer { try? FileManager.default.removeItem(atPath: staged.directory) }

        guard let tokenString = String(data: token, encoding: .utf8) else {
            throw LauncherError.tokenItemMissing
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: staged.binaryPath)
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
        // Remove the private staging directory before exiting; the deferred
        // cleanup does not run past exit(), so do it explicitly here.
        try? FileManager.default.removeItem(atPath: staged.directory)
        // The launcher exits with the op child's status and holds no token
        // afterward. On-demand lifetime; no daemon (ADR 0027).
        exit(process.terminationStatus)
    }
}
