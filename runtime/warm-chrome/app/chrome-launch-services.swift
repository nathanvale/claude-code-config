import AppKit
import Foundation

private let expectedChromeApp = "/Applications/Google Chrome.app"
private let expectedChromeBinary = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

private struct Invocation {
    let chromeBinary: String
    let port: String
    let profileDir: String
    let profileDirectory: String
    let startupURL: String
}

private enum LaunchFailure: Error {
    case invalidUsage
    case invalidChrome
    case invalidPort
    case invalidProfile
    case invalidStartupURL
    case launchFailed
    case launchTimedOut

    var code: String {
        switch self {
        case .invalidUsage: "invalid_usage"
        case .invalidChrome: "invalid_chrome"
        case .invalidPort: "invalid_port"
        case .invalidProfile: "invalid_profile"
        case .invalidStartupURL: "invalid_startup_url"
        case .launchFailed: "launch_failed"
        case .launchTimedOut: "launch_timed_out"
        }
    }
}

private func help() -> String {
    """
    Usage: chrome-launch-services --chrome <binary> --port <port> --profile <path> --profile-directory <name> --startup-url <url>

    Launch Google Chrome through macOS Launch Services and emit its pid as JSON.
    """
}

private func parse(_ arguments: [String]) throws -> Invocation? {
    if arguments.isEmpty || arguments.contains("--help") || arguments.contains("-h") {
        return nil
    }
    var values: [String: String] = [:]
    var index = 0
    let valueFlags = Set([
        "--chrome",
        "--port",
        "--profile",
        "--profile-directory",
        "--startup-url",
    ])
    while index < arguments.count {
        let argument = arguments[index]
        guard valueFlags.contains(argument), index + 1 < arguments.count else {
            throw LaunchFailure.invalidUsage
        }
        values[argument] = arguments[index + 1]
        index += 2
    }
    guard
        let chromeBinary = values["--chrome"],
        let port = values["--port"],
        let profileDir = values["--profile"],
        let profileDirectory = values["--profile-directory"],
        let startupURL = values["--startup-url"]
    else {
        throw LaunchFailure.invalidUsage
    }
    guard chromeBinary == expectedChromeBinary else {
        throw LaunchFailure.invalidChrome
    }
    guard port.range(of: #"^[1-9][0-9]{0,4}$"#, options: .regularExpression) != nil,
          let numericPort = Int(port),
          numericPort <= 65_535
    else {
        throw LaunchFailure.invalidPort
    }
    let expectedProfilePrefix = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent("Library/Application Support/Agent Chrome/")
        .standardizedFileURL.path
    let standardizedProfile = URL(fileURLWithPath: profileDir).standardizedFileURL.path
    guard
        profileDir == standardizedProfile,
        standardizedProfile.hasPrefix(expectedProfilePrefix),
        profileDirectory == "Default"
    else {
        throw LaunchFailure.invalidProfile
    }
    guard
        !startupURL.hasPrefix("-"),
        let parsedStartupURL = URL(string: startupURL),
        let scheme = parsedStartupURL.scheme?.lowercased(),
        ["http", "https", "chrome"].contains(scheme),
        parsedStartupURL.host?.isEmpty == false
    else {
        throw LaunchFailure.invalidStartupURL
    }
    return Invocation(
        chromeBinary: chromeBinary,
        port: port,
        profileDir: profileDir,
        profileDirectory: profileDirectory,
        startupURL: startupURL
    )
}

private final class LaunchCompletion {
    private let lock = NSLock()
    private var application: NSRunningApplication?
    private var error: Error?
    private var completed = false

    func finish(application: NSRunningApplication?, error: Error?) {
        lock.lock()
        self.application = application
        self.error = error
        completed = true
        lock.unlock()
    }

    func snapshot() -> (application: NSRunningApplication?, error: Error?, completed: Bool) {
        lock.lock()
        let result = (application, error, completed)
        lock.unlock()
        return result
    }
}

private func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload) else {
        return
    }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0a]))
}

private func launch(_ invocation: Invocation) throws -> pid_t {
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = false
    configuration.addsToRecentItems = false
    configuration.allowsRunningApplicationSubstitution = false
    configuration.createsNewApplicationInstance = true
    configuration.promptsUserIfNeeded = false
    configuration.arguments = [
        "--remote-debugging-port=\(invocation.port)",
        "--user-data-dir=\(invocation.profileDir)",
        "--profile-directory=\(invocation.profileDirectory)",
        "--no-first-run",
        "--no-default-browser-check",
        invocation.startupURL,
    ]

    let completion = LaunchCompletion()
    NSWorkspace.shared.openApplication(
        at: URL(fileURLWithPath: expectedChromeApp),
        configuration: configuration
    ) { application, error in
        completion.finish(application: application, error: error)
    }

    let deadline = Date().addingTimeInterval(15)
    var result = completion.snapshot()
    while !result.completed && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.05))
        result = completion.snapshot()
    }
    guard result.completed else {
        throw LaunchFailure.launchTimedOut
    }
    guard result.error == nil, let application = result.application else {
        throw LaunchFailure.launchFailed
    }
    return application.processIdentifier
}

@main
private enum ChromeLaunchServices {
    static func main() {
        do {
            guard let invocation = try parse(Array(CommandLine.arguments.dropFirst())) else {
                print(help())
                exit(0)
            }
            let pid = try launch(invocation)
            emit([
                "status": "launched",
                "browser_pid": pid,
                "launch_mode": "launch_services",
            ])
            exit(0)
        } catch let failure as LaunchFailure {
            emit([
                "status": "blocked",
                "code": failure.code,
                "changed_state": "none",
            ])
            exit(failure == .invalidUsage ? 2 : 20)
        } catch {
            emit([
                "status": "blocked",
                "code": "launch_failed",
                "changed_state": "unknown",
            ])
            exit(20)
        }
    }
}
