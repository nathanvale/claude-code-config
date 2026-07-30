// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "browser-use-environment-auth",
    platforms: [.macOS(.v13)],
    products: [
        .executable(
            name: "browser-use-op-supervisor",
            targets: ["BrowserUseEnvironmentOpSupervisor"]
        ),
    ],
    targets: [
        .target(
            name: "BrowserUseEnvironmentAuth",
            sources: ["EnvironmentOp.swift", "TokenCustody.swift"],
            linkerSettings: [.linkedFramework("CryptoKit")]
        ),
        .executableTarget(
            name: "BrowserUseEnvironmentOpSupervisor",
            dependencies: ["BrowserUseEnvironmentAuth"]
        ),
    ]
)
