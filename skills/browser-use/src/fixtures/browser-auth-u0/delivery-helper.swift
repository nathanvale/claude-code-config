import Darwin
import Foundation

@objc(BrowserAuthU0DeliveryService)
protocol DeliveryServiceProtocol {
	func probe(
		_ request: NSDictionary,
		secretPipe: FileHandle,
		browserChannel: FileHandle,
		writeAhead: FileHandle,
		withReply reply: @escaping (NSDictionary) -> Void
	)
}

private func readLine(_ handle: FileHandle) -> String? {
	var data = Data()
	while true {
		let byte = handle.readData(ofLength: 1)
		if byte.isEmpty {
			return data.isEmpty ? nil : String(data: data, encoding: .utf8)
		}
		if byte[byte.startIndex] == 0x0a {
			return String(data: data, encoding: .utf8)
		}
		data.append(byte)
	}
}

private func writeLine(_ value: String, to handle: FileHandle) {
	handle.write(Data("\(value)\n".utf8))
}

private func newNetworkIsDenied(port: Int32) -> Bool {
	let descriptor = socket(AF_INET, SOCK_STREAM, 0)
	guard descriptor >= 0 else {
		return true
	}
	defer { close(descriptor) }

	var address = sockaddr_in()
	address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
	address.sin_family = sa_family_t(AF_INET)
	address.sin_port = in_port_t(UInt16(port).bigEndian)
	address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
	let result = withUnsafePointer(to: &address) {
		$0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
			connect(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
		}
	}
	return result != 0 && (errno == EPERM || errno == EACCES)
}

private func unrelatedFileIsDenied(path: String) -> Bool {
	let descriptor = open(path, O_RDONLY)
	guard descriptor < 0 else {
		close(descriptor)
		return false
	}
	return errno == EPERM || errno == EACCES
}

final class DeliveryService: NSObject, DeliveryServiceProtocol {
	func probe(
		_ request: NSDictionary,
		secretPipe: FileHandle,
		browserChannel: FileHandle,
		writeAhead: FileHandle,
		withReply reply: @escaping (NSDictionary) -> Void
	) {
		let scenario = request["scenario"] as? String ?? "unknown"
		let expectedOrigin = request["expected_origin"] as? String ?? ""
		let unrelatedPath = request["unrelated_path"] as? String ?? ""
		let networkPort = (request["network_port"] as? NSNumber)?.int32Value ?? 0

		var result: [String: Any] = [
			"scenario": scenario,
			"xpc_connected": true,
			"descriptor_transport": "xpc",
			"sandbox_enforced": true,
			"secret_pipe_transferred": true,
			"browser_descriptor_transferred": true,
			"new_network_denied": newNetworkIsDenied(port: networkPort),
			"unrelated_file_denied": unrelatedFileIsDenied(path: unrelatedPath),
			"origin_reproved": false,
			"delivery_started": false,
			"submitted": false,
			"field_cleared": false,
			"replay_denied": false,
		]

		writeLine("ORIGIN", to: browserChannel)
		guard
			let originLine = readLine(browserChannel),
			originLine == "ORIGIN \(expectedOrigin)"
		else {
			try? secretPipe.close()
			try? browserChannel.close()
			try? writeAhead.close()
			reply(result as NSDictionary)
			return
		}
		result["origin_reproved"] = true

		let secret = secretPipe.readDataToEndOfFile()
		let replay = secretPipe.readDataToEndOfFile()
		result["replay_denied"] = replay.isEmpty
		try? secretPipe.close()
		guard !secret.isEmpty else {
			try? browserChannel.close()
			try? writeAhead.close()
			reply(result as NSDictionary)
			return
		}

		result["delivery_started"] = true
		writeLine("FILL \(secret.base64EncodedString())", to: browserChannel)
		guard readLine(browserChannel) == "FILLED" else {
			try? browserChannel.close()
			try? writeAhead.close()
			reply(result as NSDictionary)
			return
		}

		if scenario == "submit" || scenario == "failure-cleanup" {
			writeLine("submission_started", to: writeAhead)
			writeAhead.synchronizeFile()
			writeLine("SUBMIT", to: browserChannel)
			if readLine(browserChannel) == "SUBMITTED" {
				result["submitted"] = true
				writeLine("submission_dispatched", to: writeAhead)
				writeAhead.synchronizeFile()
			}
		}

		if scenario == "failure-cleanup" {
			writeLine("CLEAR", to: browserChannel)
			_ = readLine(browserChannel)
			writeLine("FIELD_LENGTH", to: browserChannel)
			result["field_cleared"] = readLine(browserChannel) == "FIELD_LENGTH 0"
		}

		try? browserChannel.close()
		try? writeAhead.close()
		reply(result as NSDictionary)
	}
}

final class ListenerDelegate: NSObject, NSXPCListenerDelegate {
	private let service = DeliveryService()

	func listener(
		_ listener: NSXPCListener,
		shouldAcceptNewConnection newConnection: NSXPCConnection
	) -> Bool {
		newConnection.exportedInterface = NSXPCInterface(
			with: DeliveryServiceProtocol.self
		)
		newConnection.exportedObject = service
		newConnection.resume()
		return true
	}
}

if CommandLine.arguments.count == 6,
	CommandLine.arguments[1] == "--inherited-probe"
{
	let scenario = CommandLine.arguments[2]
	let expectedOrigin = CommandLine.arguments[3]
	let unrelatedPath = CommandLine.arguments[4]
	let networkPort = Int32(CommandLine.arguments[5]) ?? 0
	let completion = DispatchSemaphore(value: 0)
	var response: [String: Any] = [:]
	DeliveryService().probe(
		[
			"scenario": scenario,
			"expected_origin": expectedOrigin,
			"unrelated_path": unrelatedPath,
			"network_port": networkPort,
		] as NSDictionary,
		secretPipe: FileHandle(fileDescriptor: 4, closeOnDealloc: true),
		browserChannel: FileHandle(fileDescriptor: 3, closeOnDealloc: true),
		writeAhead: FileHandle(fileDescriptor: 5, closeOnDealloc: true)
	) { value in
		response = value as? [String: Any] ?? [:]
		completion.signal()
	}
	_ = completion.wait(timeout: .now() + 10)
	response["xpc_connected"] = false
	response["descriptor_transport"] = "inherited-fd"
	// A plain posix_spawn'd child is NOT under an initialized App Sandbox
	// container, so its network/file denial fields are incidental process
	// behavior, not OS-enforced containment. Mark them unenforced so no
	// downstream evidence launders them into a containment pass.
	response["sandbox_enforced"] = false
	let output = try JSONSerialization.data(
		withJSONObject: response,
		options: [.sortedKeys]
	)
	FileHandle.standardOutput.write(output)
	FileHandle.standardOutput.write(Data([0x0a]))
} else {
	let listener = NSXPCListener.service()
	let delegate = ListenerDelegate()
	listener.delegate = delegate
	listener.resume()
	RunLoop.current.run()
}
