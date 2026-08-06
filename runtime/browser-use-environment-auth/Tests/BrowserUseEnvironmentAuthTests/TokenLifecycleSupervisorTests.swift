import Foundation
import Testing

@Suite
struct TokenLifecycleSupervisorTests {
    private func supervisorPath() throws -> String {
        let path = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent(".build")
            .appendingPathComponent("debug")
            .appendingPathComponent("browser-use-op-supervisor")
            .path
        try #require(FileManager.default.isExecutableFile(atPath: path))
        return path
    }

    private func run(
        _ arguments: [String],
        environment: [String: String] = [
            "PATH": "/usr/bin:/bin",
            "LANG": "C.UTF-8",
        ],
        stdin: Data? = nil
    ) throws -> (status: Int32, stdout: String, stderr: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: try supervisorPath())
        process.arguments = arguments
        process.environment = environment
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        if let stdin {
            let input = Pipe()
            process.standardInput = input
            try input.fileHandleForWriting.write(contentsOf: stdin)
            try input.fileHandleForWriting.close()
            try process.run()
        } else {
            process.standardInput = FileHandle.nullDevice
            try process.run()
        }
        process.waitUntilExit()
        return (
            process.terminationStatus,
            String(
                decoding: output.fileHandleForReading.readDataToEndOfFile(),
                as: UTF8.self
            ),
            String(
                decoding: errors.fileHandleForReading.readDataToEndOfFile(),
                as: UTF8.self
            )
        )
    }

    @Test
    func helpDiscoversAllTokenLifecycleModes() throws {
        let result = try run(["--help"])
        #expect(result.status == 0)
        #expect(result.stdout.contains(" install "))
        #expect(result.stdout.contains(" remove "))
        #expect(result.stdout.contains(" status "))
    }

    @Test
    func ambientTokenIsRejectedBeforePipedInputIsReadOrEchoed() throws {
        let sentinel = "SUPERVISOR_INPUT_SENTINEL_73d1"
        let result = try run(
            [
                "install",
                "--config-root", "/private/tmp/browser-use-invalid",
                "--op-path", "/usr/local/bin/op",
                "--input", "stdin",
                "--replace", "false",
            ],
            environment: [
                "PATH": "/usr/bin:/bin",
                "LANG": "C.UTF-8",
                "OP_SERVICE_ACCOUNT_TOKEN": sentinel,
            ],
            stdin: Data(sentinel.utf8)
        )
        #expect(result.status == 20)
        #expect(result.stdout.contains("ambient-op-environment"))
        #expect(!result.stdout.contains(sentinel))
        #expect(!result.stderr.contains(sentinel))
    }

    @Test
    func statusInvalidArgumentsRemainTypedAndSecretFree() throws {
        let result = try run(["status"])
        #expect(result.status == 20)
        #expect(result.stdout.contains("invalid-arguments"))
        #expect(result.stderr.isEmpty)
    }
}
