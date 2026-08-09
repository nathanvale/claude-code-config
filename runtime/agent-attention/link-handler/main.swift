import AppKit
import Foundation
import OSLog

private let logger = Logger(
	subsystem: "local.nathanvale.AgentAttentionLink",
	category: "navigation"
)

final class AppDelegate: NSObject, NSApplicationDelegate {
	private var pendingTermination: DispatchWorkItem?

	func applicationDidFinishLaunching(_ notification: Notification) {
		NSApp.setActivationPolicy(.prohibited)

		for argument in CommandLine.arguments.dropFirst() {
			guard let url = URL(string: argument), url.scheme == "agent-attention" else {
				continue
			}
			open(urls: [url])
		}
	}

	func application(_ application: NSApplication, open urls: [URL]) {
		open(urls: urls)
	}

	private func open(urls: [URL]) {
		guard let sourceURL = urls.last,
			  sourceURL.scheme == "agent-attention",
			  sourceURL.host == "threads"
		else {
			logger.error("Rejected malformed Agent Attention URL")
			scheduleTermination()
			return
		}

		let pathParts = sourceURL.pathComponents.filter { $0 != "/" }
		guard pathParts.count == 1,
			  let threadID = UUID(uuidString: pathParts[0])
		else {
			logger.error("Rejected Agent Attention URL without one UUID thread ID")
			scheduleTermination()
			return
		}

		guard let codexURL = URL(string: "codex://threads/\(threadID.uuidString.lowercased())") else {
			logger.error("Could not construct Codex thread URL")
			scheduleTermination()
			return
		}

		openCodex(codexURL)
		DispatchQueue.main.asyncAfter(deadline: .now() + 1.25) {
			self.openCodex(codexURL)
		}
		scheduleTermination(after: 2.5)
	}

	private func openCodex(_ url: URL) {
		let configuration = NSWorkspace.OpenConfiguration()
		configuration.activates = true
		NSWorkspace.shared.open(url, configuration: configuration) { _, error in
			if let error {
				logger.error("Codex route open failed: \(error.localizedDescription, privacy: .public)")
			}
		}
	}

	private func scheduleTermination(after delay: TimeInterval = 0.25) {
		pendingTermination?.cancel()
		let workItem = DispatchWorkItem {
			NSApp.terminate(nil)
		}
		pendingTermination = workItem
		DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: workItem)
	}
}
@main
enum AgentAttentionLink {
	static func main() {
		let application = NSApplication.shared
		let delegate = AppDelegate()
		application.delegate = delegate
		application.run()
	}
}
