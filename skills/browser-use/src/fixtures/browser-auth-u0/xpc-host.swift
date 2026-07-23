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

final class BrowserState: @unchecked Sendable {
	private let lock = NSLock()
	private var field = Data()
	private var didSubmit = false

	func setField(_ value: Data) {
		lock.lock()
		field = value
		lock.unlock()
	}

	func clearField() {
		setField(Data())
	}

	func fieldLength() -> Int {
		lock.lock()
		defer { lock.unlock() }
		return field.count
	}

	func markSubmitted() {
		lock.lock()
		didSubmit = true
		lock.unlock()
	}

	func submitted() -> Bool {
		lock.lock()
		defer { lock.unlock() }
		return didSubmit
	}
}

private func readLine(descriptor: Int32) -> String? {
	var bytes: [UInt8] = []
	var byte: UInt8 = 0
	while true {
		let count = Darwin.read(descriptor, &byte, 1)
		if count == 0 {
			return bytes.isEmpty ? nil : String(bytes: bytes, encoding: .utf8)
		}
		if count < 0 {
			return nil
		}
		if byte == 0x0a {
			return String(bytes: bytes, encoding: .utf8)
		}
		bytes.append(byte)
	}
}

private func writeLine(_ value: String, descriptor: Int32) {
	let data = Data("\(value)\n".utf8)
	data.withUnsafeBytes { buffer in
		_ = Darwin.write(descriptor, buffer.baseAddress, buffer.count)
	}
}

private func makeNetworkListener() throws -> (descriptor: Int32, port: Int32) {
	let descriptor = socket(AF_INET, SOCK_STREAM, 0)
	guard descriptor >= 0 else {
		throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
	}
	var address = sockaddr_in()
	address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
	address.sin_family = sa_family_t(AF_INET)
	address.sin_port = 0
	address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
	let bindResult = withUnsafePointer(to: &address) {
		$0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
			bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
		}
	}
	guard bindResult == 0, listen(descriptor, 1) == 0 else {
		close(descriptor)
		throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
	}
	var boundAddress = sockaddr_in()
	var length = socklen_t(MemoryLayout<sockaddr_in>.size)
	let nameResult = withUnsafeMutablePointer(to: &boundAddress) {
		$0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
			getsockname(descriptor, $0, &length)
		}
	}
	guard nameResult == 0 else {
		close(descriptor)
		throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
	}
	return (descriptor, Int32(UInt16(bigEndian: boundAddress.sin_port)))
}

private func runBrowserPeer(
	descriptor: Int32,
	origin: String,
	state: BrowserState
) {
	defer { close(descriptor) }
	while let line = readLine(descriptor: descriptor) {
		if line == "ORIGIN" {
			writeLine("ORIGIN \(origin)", descriptor: descriptor)
		} else if line.hasPrefix("FILL ") {
			let encoded = String(line.dropFirst(5))
			state.setField(Data(base64Encoded: encoded) ?? Data())
			writeLine("FILLED", descriptor: descriptor)
		} else if line == "SUBMIT" {
			state.markSubmitted()
			writeLine("SUBMITTED", descriptor: descriptor)
		} else if line == "CLEAR" {
			state.clearField()
			writeLine("CLEARED", descriptor: descriptor)
		} else if line == "FIELD_LENGTH" {
			writeLine(
				"FIELD_LENGTH \(state.fieldLength())",
				descriptor: descriptor
			)
		}
	}
}

guard CommandLine.arguments.count == 5 else {
	fputs(
		"usage: xpc-host <retrieval> <scenario> <unrelated-path> <receipt-path>\n",
		stderr
	)
	exit(64)
}

let retrievalPath = CommandLine.arguments[1]
let scenario = CommandLine.arguments[2]
let unrelatedPath = CommandLine.arguments[3]
let receiptPath = CommandLine.arguments[4]
let expectedOrigin = "https://fixture.invalid"
let observedOrigin =
	scenario == "origin-drift" ? "https://drift.invalid" : expectedOrigin

let connection = NSXPCConnection(
	serviceName: "dev.browser-use.research.auth-u0.delivery"
)
connection.remoteObjectInterface = NSXPCInterface(with: DeliveryServiceProtocol.self)
connection.resume()

let secretPipe = Pipe()
let retrieval = Process()
retrieval.executableURL = URL(fileURLWithPath: retrievalPath)
retrieval.standardOutput = secretPipe
retrieval.standardError = FileHandle.standardError
retrieval.environment = [:]
try retrieval.run()
secretPipe.fileHandleForWriting.closeFile()

var browserPair: [Int32] = [0, 0]
guard socketpair(AF_UNIX, SOCK_STREAM, 0, &browserPair) == 0 else {
	fputs("socketpair failed\n", stderr)
	exit(70)
}
let browserState = BrowserState()
DispatchQueue.global().async {
	runBrowserPeer(
		descriptor: browserPair[0],
		origin: observedOrigin,
		state: browserState
	)
}

let networkListener = try makeNetworkListener()
defer { close(networkListener.descriptor) }
let writeAhead = Pipe()
let completion = DispatchSemaphore(value: 0)
var response: [String: Any] = [:]
var xpcError: String?

let proxy = connection.remoteObjectProxyWithErrorHandler { error in
	xpcError = String(describing: error)
	completion.signal()
} as? DeliveryServiceProtocol

proxy?.probe(
	[
		"scenario": scenario,
		"expected_origin": expectedOrigin,
		"unrelated_path": unrelatedPath,
		"network_port": networkListener.port,
	] as NSDictionary,
	secretPipe: secretPipe.fileHandleForReading,
	browserChannel: FileHandle(
		fileDescriptor: browserPair[1],
		closeOnDealloc: true
	),
	writeAhead: writeAhead.fileHandleForWriting
) { value in
	response = value as? [String: Any] ?? [:]
	completion.signal()
}

guard completion.wait(timeout: .now() + 15) == .success else {
	fputs("xpc timeout\n", stderr)
	exit(70)
}

secretPipe.fileHandleForReading.closeFile()
writeAhead.fileHandleForWriting.closeFile()
let writeAheadText = String(
	data: writeAhead.fileHandleForReading.readDataToEndOfFile(),
	encoding: .utf8
) ?? ""
let writeAheadEvents = writeAheadText
	.split(separator: "\n")
	.map(String.init)

response["write_ahead_events"] = writeAheadEvents
response["submitted"] = browserState.submitted()
if xpcError != nil {
	response["xpc_connected"] = false
	response["xpc_error"] = xpcError
}

var output = try JSONSerialization.data(
	withJSONObject: response,
	options: [.sortedKeys]
)
output.append(0x0a)
try output.write(to: URL(fileURLWithPath: receiptPath), options: .atomic)

connection.invalidate()
retrieval.waitUntilExit()
