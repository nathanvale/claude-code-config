// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "browser-use-environment-auth",
    platforms: [.macOS(.v13)],
    products: [
        .executable(
            name: "browser-use-token-custody",
            targets: ["BrowserUseTokenCustody"]
        ),
        .executable(
            name: "browser-use-op-supervisor",
            targets: ["BrowserUseEnvironmentOpSupervisor"]
        ),
        .executable(
            name: "browser-use-confidential-delivery",
            targets: ["BrowserUseConfidentialFieldDelivery"]
        ),
    ],
    targets: [
        .target(
            name: "BrowserUseEnvironmentAuth",
            linkerSettings: [.linkedFramework("CryptoKit")]
        ),
        .executableTarget(
            name: "BrowserUseTokenCustody",
            dependencies: ["BrowserUseEnvironmentAuth"]
        ),
        .executableTarget(
            name: "BrowserUseEnvironmentOpSupervisor",
            dependencies: ["BrowserUseEnvironmentAuth"]
        ),
        .executableTarget(
            name: "BrowserUseConfidentialFieldDelivery",
            dependencies: ["BrowserUseEnvironmentAuth"]
        ),
        .executableTarget(
            name: "BrowserUseEnvironmentAuthTests",
            dependencies: ["BrowserUseEnvironmentAuth"],
            path: "Tests/BrowserUseEnvironmentAuthTests"
        ),
    ]
)
