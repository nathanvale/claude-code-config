import AppKit
import Foundation

private let expectedProfilePath = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/Agent Chrome/Chrome User Data")
    .standardizedFileURL.path

private enum LauncherFailure: Error {
    case helperMissing
    case avatarHelperMissing
    case helperFailed(String)
    case avatarHelperFailed(String)
    case invalidEnvelope
    case wrongProfile
    case targetUnverified
    case browserUnavailable
    case activationRejected
    case activationUnverified

    var code: String {
        switch self {
        case .helperMissing: "helper_missing"
        case .avatarHelperMissing: "avatar_helper_missing"
        case .helperFailed(let helperCode): "helper_\(helperCode)"
        case .avatarHelperFailed(let helperCode): "avatar_helper_\(helperCode)"
        case .invalidEnvelope: "invalid_envelope"
        case .wrongProfile: "wrong_profile"
        case .targetUnverified: "target_unverified"
        case .browserUnavailable: "browser_unavailable"
        case .activationRejected: "activation_rejected"
        case .activationUnverified: "activation_unverified"
        }
    }
}

private struct LaunchProof {
    let browserPID: pid_t
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        DispatchQueue.main.async {
            do {
                try applyProfileAvatar()
                let proof = try runWarmChrome()
                try activateVerifiedBrowser(pid: proof.browserPID)
                NSApp.terminate(nil)
            } catch let failure as LauncherFailure {
                showFailure(failure)
            } catch {
                showFailure(.invalidEnvelope)
            }
        }
    }
}

private func helperURL() -> URL {
    Bundle.main.bundleURL
        .appendingPathComponent("Contents", isDirectory: true)
        .appendingPathComponent("Helpers", isDirectory: true)
        .appendingPathComponent("warm-chrome", isDirectory: false)
}

private func avatarHelperURL() -> URL {
    Bundle.main.bundleURL
        .appendingPathComponent("Contents", isDirectory: true)
        .appendingPathComponent("Helpers", isDirectory: true)
        .appendingPathComponent("agent-chrome-profile-avatar", isDirectory: false)
}

private func avatarResourceURL() -> URL {
    Bundle.main.bundleURL
        .appendingPathComponent("Contents", isDirectory: true)
        .appendingPathComponent("Resources", isDirectory: true)
        .appendingPathComponent("agent-chrome-avatar.png", isDirectory: false)
}

private func launchServicesHelperURL() -> URL {
    Bundle.main.bundleURL
        .appendingPathComponent("Contents", isDirectory: true)
        .appendingPathComponent("Helpers", isDirectory: true)
        .appendingPathComponent("chrome-launch-services", isDirectory: false)
}

private func applyProfileAvatar() throws {
    let helper = avatarHelperURL()
    guard FileManager.default.isExecutableFile(atPath: helper.path) else {
        throw LauncherFailure.avatarHelperMissing
    }
    let process = Process()
    process.executableURL = helper
    process.arguments = [
        "--apply",
        "--profile",
        expectedProfilePath,
        "--avatar",
        avatarResourceURL().path,
        "--json",
    ]
    let stdout = Pipe()
    process.standardOutput = stdout
    process.standardError = Pipe()
    process.standardInput = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()
    let output = stdout.fileHandleForReading.readDataToEndOfFile()
    let envelope = try? JSONSerialization.jsonObject(with: output) as? [String: Any]
    guard process.terminationStatus == 0 else {
        let rawCode = envelope?["code"] as? String
        let safeCode = rawCode?.range(
            of: #"^[a-z0-9_]{1,64}$"#,
            options: .regularExpression
        ) == nil ? "runtime_failure" : rawCode!
        throw LauncherFailure.avatarHelperFailed(safeCode)
    }
    guard
        let envelope,
        ["branded", "verified"].contains(envelope["status"] as? String),
        envelope["profile_avatar"] as? String == "agent_chrome"
    else {
        throw LauncherFailure.avatarHelperFailed("invalid_envelope")
    }
}

private func runWarmChrome() throws -> LaunchProof {
    let helper = helperURL()
    guard FileManager.default.isExecutableFile(atPath: helper.path) else {
        throw LauncherFailure.helperMissing
    }

    let process = Process()
    process.executableURL = helper
    process.arguments = [
        "launch",
        "--open",
        "--profile",
        expectedProfilePath,
        "--json",
        "--run-id",
        "agent-chrome-launcher",
    ]
    let stdout = Pipe()
    process.standardOutput = stdout
    process.standardError = Pipe()
    process.standardInput = FileHandle.nullDevice
    try process.run()
    process.waitUntilExit()
    let output = stdout.fileHandleForReading.readDataToEndOfFile()
    let envelope = try? JSONSerialization.jsonObject(with: output) as? [String: Any]
    guard process.terminationStatus == 0 else {
        let rawCode = (envelope?["error"] as? [String: Any])?["code"] as? String
        let safeCode = rawCode?.range(
            of: #"^[a-z0-9_]{1,64}$"#,
            options: .regularExpression
        ) == nil ? "runtime_failure" : rawCode!
        throw LauncherFailure.helperFailed(safeCode)
    }
    guard
        let envelope,
        envelope["status"] as? String == "ok",
        let data = envelope["data"] as? [String: Any],
        let pid = data["browser_pid"] as? NSNumber,
        let profile = data["profile_dir"] as? String
    else {
        throw LauncherFailure.invalidEnvelope
    }
    guard URL(fileURLWithPath: profile).standardizedFileURL.path == expectedProfilePath else {
        throw LauncherFailure.wrongProfile
    }
    guard
        data["open_target_verified"] as? Bool == true,
        data["open_target_id"] is String
    else {
        throw LauncherFailure.targetUnverified
    }
    return LaunchProof(browserPID: pid_t(pid.int32Value))
}

private func activateVerifiedBrowser(pid: pid_t) throws {
    guard let browser = NSRunningApplication(processIdentifier: pid) else {
        throw LauncherFailure.browserUnavailable
    }
    guard browser.activate(options: []) else {
        throw LauncherFailure.activationRejected
    }

    let deadline = Date().addingTimeInterval(3)
    while Date() < deadline {
        if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid {
            return
        }
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
    }
    throw LauncherFailure.activationUnverified
}

private func showFailure(_ failure: LauncherFailure) -> Never {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = "Agent Chrome could not open"
    alert.informativeText = "Failure: \(failure.code). \(continuation(for: failure)) Everyday Chrome was not used."
    alert.runModal()
    exit(20)
}

private func continuation(for failure: LauncherFailure) -> String {
    switch failure {
    case .helperMissing:
        return "Re-run the Agent Chrome installer preview and apply."
    case .avatarHelperMissing:
        return "Re-run the Agent Chrome installer preview and apply."
    case .avatarHelperFailed(let helperCode):
        if helperCode == "profile_running" {
            return "Quit Agent Chrome once, then open it again to install the Agent Chrome avatar."
        }
        if helperCode == "browser_account_signed_in" {
            return "Agent Chrome preserved the Google account avatar. Sign out of Chrome profile sync before applying product branding."
        }
        return "Run the embedded Agent Chrome avatar helper in Terminal to inspect the bounded failure."
    case .helperFailed:
        return "Run \"\(helperURL().path)\" launch --open --profile \"\(expectedProfilePath)\" --json in Terminal to inspect the bounded Warm Chrome failure."
    case .invalidEnvelope, .wrongProfile, .targetUnverified:
        return "Re-run the Agent Chrome installer, then retry the native launcher."
    case .browserUnavailable, .activationRejected, .activationUnverified:
        return "Warm Chrome proved the Browser but macOS activation failed. Retry the native launcher and inspect the verified Browser pid if it repeats."
    }
}

private func runVerifier() -> Never {
    let helper = helperURL()
    let avatarHelper = avatarHelperURL()
    let verified = FileManager.default.isExecutableFile(atPath: helper.path)
        && FileManager.default.isExecutableFile(atPath: avatarHelper.path)
        && FileManager.default.isExecutableFile(atPath: launchServicesHelperURL().path)
        && FileManager.default.isReadableFile(atPath: avatarResourceURL().path)
    let payload: [String: Any] = [
        "status": verified ? "verified" : "blocked",
        "launcher": "native",
        "helper": verified ? "embedded" : "missing",
        "profile_avatar": verified ? "embedded" : "missing",
        "chrome_launch": verified ? "launch_services" : "missing",
        "profile_dir": expectedProfilePath,
    ]
    if let data = try? JSONSerialization.data(withJSONObject: payload) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0a]))
    }
    exit(verified ? 0 : 20)
}

@main
private enum AgentChromeLauncher {
    static func main() {
        if CommandLine.arguments.dropFirst().first == "verifier" {
            runVerifier()
        }
        let application = NSApplication.shared
        application.setActivationPolicy(.accessory)
        let delegate = AppDelegate()
        application.delegate = delegate
        application.run()
    }
}
