@_spi(Executor) @_spi(Testing) import BrowserUseEnvironmentAuth
import Darwin
import Foundation
import Testing

// Serialized: these tests fork real children and share process-global
// signal-handler and process-group state (activeEnvironmentOpProcessGroup),
// so parallel execution lets one test's group termination signal a sibling's
// child (observed as spurious .processSignalled). Production never runs two
// private pipes in one process — the supervisor is single-shot — so the
// constraint is test-only.
@Suite(.serialized)
struct EnvironmentOpDeliveryTests {
    private func temporaryExecutable(
        _ body: String
    ) throws -> (path: String, root: URL) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
        let path = root.appendingPathComponent("fixture").path
        try Data(body.utf8).write(to: URL(fileURLWithPath: path))
        guard chmod(path, 0o700) == 0 else {
            throw POSIXError(.EACCES)
        }
        return (path, root)
    }

    private func tokenDescriptor() throws -> Int32 {
        let path = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString).path
        guard FileManager.default.createFile(
            atPath: path,
            contents: Data("fixture-token".utf8),
            attributes: [.posixPermissions: 0o600]
        ) else {
            throw POSIXError(.EIO)
        }
        let descriptor = Darwin.open(path, O_RDONLY | O_CLOEXEC)
        guard descriptor >= 0, unlink(path) == 0 else {
            throw POSIXError(.EIO)
        }
        return descriptor
    }

    @Test
    func privatePipeDoesNotStartConsumerWhenOpFailsBeforeOutput() throws {
        let executable = try temporaryExecutable(
            """
            #!/bin/sh
            exit 7
            """
        )
        defer { try? FileManager.default.removeItem(at: executable.root) }
        let token = try tokenDescriptor()
        defer { _ = Darwin.close(token) }
        var consumerStarted = false

        let result = EnvironmentOpProcessRunner.runPrivatePipe(
            executablePath: executable.path,
            arguments: [],
            tokenDescriptor: token,
            consume: { _, _ in
                consumerStarted = true
                return Data()
            }
        )

        #expect(!consumerStarted)
        guard case .blocked(.processFailed) = result else {
            Issue.record("expected process-failed, got \(result)")
            return
        }
    }

    @Test
    func deliveryRunnerPassesPipeOnlyOnDescriptorThree() throws {
        let executable = try temporaryExecutable(
            """
            #!/bin/sh
            value=
            IFS= read -r value <&3 || true
            printf '{"ok":true,"shape":{"kind":"utf8","byte_length":%s}}\\n' "${#value}"
            """
        )
        defer { try? FileManager.default.removeItem(at: executable.root) }
        var secretPipe: [Int32] = [-1, -1]
        #expect(pipe(&secretPipe) == 0)
        let sentinel = Data("DELIVERY_SENTINEL_9173".utf8)
        sentinel.withUnsafeBytes {
            _ = Darwin.write(secretPipe[1], $0.baseAddress, $0.count)
        }
        _ = Darwin.close(secretPipe[1])

        let output = EnvironmentOpDeliveryRunner.run(
            executablePath: executable.path,
            arguments: ["--non-secret", "field"],
            secretReadDescriptor: secretPipe[0],
            timeoutMilliseconds: 2_000
        )
        _ = Darwin.close(secretPipe[0])

        let text = String(decoding: output, as: UTF8.self)
        #expect(text.contains(#""byte_length":22"#))
        #expect(!text.contains("DELIVERY_SENTINEL_9173"))
    }

    @Test
    func identityBoundPrivateFieldComposesOpAndConsumer() throws {
        let executable = try temporaryExecutable(
            """
            #!/bin/sh
            if [ "$1" = "--version" ]; then
              printf '2.35.0\\n'
              exit 0
            fi
            printf 'PRIVATE_FIELD_VALUE'
            """
        )
        defer { try? FileManager.default.removeItem(at: executable.root) }
        let tokenURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
        try Data("fixture-token".utf8).write(
            to: tokenURL,
            options: .withoutOverwriting
        )
        guard chmod(tokenURL.path, 0o600) == 0 else {
            throw POSIXError(.EACCES)
        }
        defer { try? FileManager.default.removeItem(at: tokenURL) }
        let token = Darwin.open(tokenURL.path, O_RDONLY | O_CLOEXEC)
        guard token >= 0 else { throw POSIXError(.EIO) }
        defer { _ = Darwin.close(token) }
        var consumerStarted = false

        let result = EnvironmentOpSupervisor.executeIdentityBoundPrivateFieldForTesting(
            executablePath: executable.path,
            vaultID: "vault-1",
            itemID: "item-1",
            field: .password,
            tokenDescriptor: token,
            consume: { descriptor, _ in
                consumerStarted = true
                var bytes = [UInt8](repeating: 0, count: 64)
                let count = Darwin.read(descriptor, &bytes, bytes.count)
                return Data(bytes.prefix(max(0, count)))
            }
        )

        #expect(consumerStarted)
        guard case let .success(output) = result else {
            Issue.record("expected private-field success")
            return
        }
        let decodedOutput = try #require(String(bytes: output, encoding: .utf8))
        #expect(decodedOutput == "PRIVATE_FIELD_VALUE")
    }
}
