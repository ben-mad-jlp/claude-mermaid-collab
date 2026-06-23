// swift-tools-version: 6.0
import PackageDescription

// MermaidCollabCore — the platform-independent core of the iOS companion app
// (mobile-app-ios-swift-design). Holds the domain models + PURE selectors
// re-derived from the web UI's TS selectors (freshnessSelectors / triageSelectors),
// so the verdict/triage/freshness logic is unit-tested headlessly with `swift test`
// — no Xcode, no simulator, no Apple account. The SwiftUI app + HTTP/WS client +
// widget/Live-Activity targets are added later in Xcode and depend on this package.
let package = Package(
    name: "MermaidCollabCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "MermaidCollabCore", targets: ["MermaidCollabCore"]),
    ],
    targets: [
        .target(name: "MermaidCollabCore"),
        .testTarget(
            name: "MermaidCollabCoreTests",
            dependencies: ["MermaidCollabCore"]
        ),
    ]
)
