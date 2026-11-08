// swift-tools-version: 6.2
// The platform-independent core of the iOS runner (frames, layout comparison, settle, hit test), unit
// tested on the Mac with `swift test`; the runner's UI test target compiles the same sources.
import PackageDescription

let package = Package(
    name: "RunnerCore",
    platforms: [.macOS(.v13), .iOS(.v17)],
    products: [.library(name: "RunnerCore", targets: ["RunnerCore"])],
    targets: [
        .target(name: "RunnerCore"),
        .testTarget(name: "RunnerCoreTests", dependencies: ["RunnerCore"])
    ]
)
