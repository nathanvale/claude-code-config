import Darwin
import Foundation
import SQLite3
import Testing

@Suite(.serialized)
struct ProfilePolicyLoginDataTests {
    private enum FixtureError: Error {
        case commandFailed(String)
        case sqlite(String)
    }

    private func profilePolicyHarness(in root: URL) throws -> URL {
        let sourceURL = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            .appendingPathComponent("Sources")
            .appendingPathComponent("BrowserUseEnvironmentOpSupervisor")
            .appendingPathComponent("main.swift")
        let source = try String(contentsOf: sourceURL, encoding: .utf8)
        let start = try #require(source.range(of: "private func profilePolicyCheck"))
        let end = try #require(source.range(of: "private func tokenStatusEnvelope"))
        let functionSource = source[start.lowerBound..<end.lowerBound]
        let harnessSource = """
        import Darwin
        import Foundation
        import SQLite3

        \(functionSource)

        let result = profilePolicyCheck(CommandLine.arguments[1])
        let output = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        FileHandle.standardOutput.write(output)
        """
        let harnessURL = root.appendingPathComponent("main.swift")
        try Data(harnessSource.utf8).write(to: harnessURL)
        let executableURL = root.appendingPathComponent("profile-policy-harness")
        let result = try run(
            executable: URL(fileURLWithPath: "/usr/bin/swiftc"),
            arguments: [harnessURL.path, "-o", executableURL.path]
        )
        guard result.status == 0 else {
            throw FixtureError.commandFailed(result.stderr)
        }
        return executableURL
    }

    private func makeProfile() throws -> (profile: URL, root: URL) {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        let profile = root.appendingPathComponent("profile", isDirectory: true)
        let defaultDirectory = profile.appendingPathComponent("Default", isDirectory: true)
        try FileManager.default.createDirectory(
            at: defaultDirectory,
            withIntermediateDirectories: true
        )
        guard chmod(profile.path, 0o700) == 0 else {
            throw POSIXError(.EACCES)
        }
        let preferences: [String: Any] = [
            "credentials_enable_service": false,
            "profile": ["password_manager_enabled": false],
            "autofill": [
                "profile_enabled": false,
                "credit_card_enabled": false,
            ],
            "sync": ["requested": false],
        ]
        let preferencesData = try JSONSerialization.data(withJSONObject: preferences)
        try preferencesData.write(to: defaultDirectory.appendingPathComponent("Preferences"))
        return (profile, root)
    }

    private func createLoginData(at url: URL, withSavedLogin: Bool) throws {
        var database: OpaquePointer?
        guard sqlite3_open_v2(
            url.path,
            &database,
            SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
            nil
        ) == SQLITE_OK, let database else {
            throw FixtureError.sqlite("open failed")
        }
        defer { sqlite3_close(database) }
        let schema = """
        CREATE TABLE logins (
            origin_url TEXT NOT NULL,
            username_value TEXT NOT NULL,
            password_value BLOB NOT NULL
        );
        """
        guard sqlite3_exec(database, schema, nil, nil, nil) == SQLITE_OK else {
            throw FixtureError.sqlite("schema failed")
        }
        if withSavedLogin {
            let insert = """
            INSERT INTO logins (origin_url, username_value, password_value)
            VALUES ('https://example.test', 'fixture-user', X'01');
            """
            guard sqlite3_exec(database, insert, nil, nil, nil) == SQLITE_OK else {
                throw FixtureError.sqlite("insert failed")
            }
        }
    }

    private func checkProfile(_ profile: URL, root: URL) throws -> [String: String] {
        let harness = try profilePolicyHarness(in: root)
        let result = try run(executable: harness, arguments: [profile.path])
        guard result.status == 0 else {
            throw FixtureError.commandFailed(result.stderr)
        }
        let data = Data(result.stdout.utf8)
        return try #require(
            JSONSerialization.jsonObject(with: data) as? [String: String]
        )
    }

    private func run(
        executable: URL,
        arguments: [String]
    ) throws -> (status: Int32, stdout: String, stderr: String) {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        process.environment = ProcessInfo.processInfo.environment
        let output = Pipe()
        let errors = Pipe()
        process.standardOutput = output
        process.standardError = errors
        try process.run()
        process.waitUntilExit()
        return (
            process.terminationStatus,
            String(decoding: output.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self),
            String(decoding: errors.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
        )
    }

    @Test
    func emptyLoginTableIsReady() throws {
        let fixture = try makeProfile()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        try createLoginData(
            at: fixture.profile.appendingPathComponent("Default/Login Data"),
            withSavedLogin: false
        )

        let result = try checkProfile(fixture.profile, root: fixture.root)

        #expect(result["status"] == "ready")
        #expect(result["cause"] == nil)
    }

    @Test
    func savedLoginIsBlockedAsUnsafe() throws {
        let fixture = try makeProfile()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        try createLoginData(
            at: fixture.profile.appendingPathComponent("Default/Login Data"),
            withSavedLogin: true
        )

        let result = try checkProfile(fixture.profile, root: fixture.root)

        #expect(result["status"] == "blocked")
        #expect(result["cause"] == "profile-policy-unsafe")
    }

    @Test
    func missingLoginDataIsReady() throws {
        let fixture = try makeProfile()
        defer { try? FileManager.default.removeItem(at: fixture.root) }

        let result = try checkProfile(fixture.profile, root: fixture.root)

        #expect(result["status"] == "ready")
        #expect(result["cause"] == nil)
    }

    @Test
    func corruptLoginDataIsBlockedAsUnsafe() throws {
        let fixture = try makeProfile()
        defer { try? FileManager.default.removeItem(at: fixture.root) }
        try Data("not a SQLite database".utf8).write(
            to: fixture.profile.appendingPathComponent("Default/Login Data")
        )

        let result = try checkProfile(fixture.profile, root: fixture.root)

        #expect(result["status"] == "blocked")
        #expect(result["cause"] == "profile-policy-unsafe")
    }
}
