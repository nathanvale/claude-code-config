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
    ],
    targets: [
        .target(name: "BrowserUseEnvironmentAuth"),
        .executableTarget(
            name: "BrowserUseTokenCustody",
            dependencies: ["BrowserUseEnvironmentAuth"]
        ),
        .executableTarget(
            name: "BrowserUseEnvironmentAuthTests",
            dependencies: ["BrowserUseEnvironmentAuth"],
            path: "Tests/BrowserUseEnvironmentAuthTests"
        ),
    ]
)
