import AppKit
import Foundation

private let expectedChromeURL = URL(fileURLWithPath: "/Applications/Google Chrome.app")
    .standardizedFileURL

private enum EverydayChromeFailure: Error {
    case chromeMissing
    case launchFailed
    case wrongApplication
    case activationRejected

    var code: String {
        switch self {
        case .chromeMissing: "chrome_missing"
        case .launchFailed: "launch_failed"
        case .wrongApplication: "wrong_application"
        case .activationRejected: "activation_rejected"
        }
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        guard FileManager.default.fileExists(atPath: expectedChromeURL.path) else {
            showFailure(.chromeMissing)
        }

        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.addsToRecentItems = false
        configuration.allowsRunningApplicationSubstitution = false
        configuration.createsNewApplicationInstance = true
        configuration.promptsUserIfNeeded = false

        NSWorkspace.shared.openApplication(
            at: expectedChromeURL,
            configuration: configuration
        ) { application, error in
            guard error == nil, let application else {
                showFailure(.launchFailed)
            }
            guard application.bundleURL?.standardizedFileURL == expectedChromeURL else {
                showFailure(.wrongApplication)
            }
            guard application.activate(options: []) else {
                showFailure(.activationRejected)
            }
            NSApp.terminate(nil)
        }
    }
}

private func showFailure(_ failure: EverydayChromeFailure) -> Never {
    NSApp.setActivationPolicy(.regular)
    NSApp.activate(ignoringOtherApps: true)
    let alert = NSAlert()
    alert.alertStyle = .critical
    alert.messageText = "Everyday Chrome could not open"
    alert.informativeText = "Failure: \(failure.code). Open /Applications/Google Chrome.app directly. Agent Chrome was not used."
    alert.runModal()
    exit(20)
}

private func runVerifier() -> Never {
    let chromePresent = FileManager.default.fileExists(atPath: expectedChromeURL.path)
    let payload: [String: Any] = [
        "status": chromePresent ? "verified" : "blocked",
        "launcher": "human_only",
        "chrome_launch": "launch_services",
        "chrome_app": expectedChromeURL.path,
        "automation": "none",
        "arguments": "none",
    ]
    if let data = try? JSONSerialization.data(withJSONObject: payload) {
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([0x0a]))
    }
    exit(chromePresent ? 0 : 20)
}

@main
private enum EverydayChromeLauncher {
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
