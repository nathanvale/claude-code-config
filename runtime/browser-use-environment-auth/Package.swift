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
        .executable(
            name: "browser-use-field-delivery",
            targets: ["BrowserUseFieldDelivery"]
        ),
    ],
    targets: [
        .target(
            name: "BrowserUseEnvironmentAuth",
            sources: [
                "DeliveryOriginSafety.swift",
                "EnvironmentOp.swift",
                "TokenCustody.swift",
            ],
            linkerSettings: [.linkedFramework("CryptoKit")]
        ),
        .executableTarget(
            name: "BrowserUseEnvironmentOpSupervisor",
            dependencies: ["BrowserUseEnvironmentAuth"]
        ),
        .executableTarget(
            name: "BrowserUseFieldDelivery",
            dependencies: ["BrowserUseEnvironmentAuth"]
        ),
        .testTarget(
            name: "BrowserUseEnvironmentAuthTests",
            dependencies: ["BrowserUseEnvironmentAuth"]
        ),
    ]
)
