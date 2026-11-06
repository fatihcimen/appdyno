import SwiftUI

/// A known cost by name, from `APPDYNO_FIXTURE_<NAME>_MS`, or kept by `appdyno-fixture://cost/<name>/<ms>` (0 clears it):
/// a phone's flow launches the app with no environment, so a cost has to outlive a stop.
func fixtureCost(_ name: String) -> Double? {
    let env = ProcessInfo.processInfo.environment["APPDYNO_FIXTURE_\(name.uppercased())_MS"]
    if let ms = env.flatMap(Double.init) { return ms }
    let kept = UserDefaults.standard.double(forKey: "cost_\(name)")
    return kept > 0 ? kept : nil
}

/// The iOS fixture: the same screens as the Android one, where the platform has them.
/// `appdyno-fixture://open/<screen>` opens a screen directly.
@main
struct FixtureApp: App {
    @State private var path: [String] = []
    @State private var lastLink = ""

    /// A slow start of a known length: a launch reading must rise by it.
    init() {
        if let ms = fixtureCost("startup") { usleep(UInt32(ms) * 1000) }
        if let ms = fixtureCost("cpu") { DispatchQueue.global(qos: .userInitiated).async { knownCpuCost(ms) } }
    }

    var body: some Scene {
        WindowGroup {
            NavigationStack(path: $path) {
                Home(path: $path, lastLink: lastLink)
                    .navigationDestination(for: String.self) { screen($0) }
            }
            .onOpenURL { url in
                lastLink = url.absoluteString
                if url.host == "open", let key = url.pathComponents.last { path = [key] }
                if url.host == "cost", url.pathComponents.count == 3, let ms = Double(url.lastPathComponent) {
                    UserDefaults.standard.set(ms, forKey: "cost_\(url.pathComponents[1])")
                    UserDefaults.standard.synchronize()
                }
            }
        }
    }

    @ViewBuilder func screen(_ key: String) -> some View {
        switch key {
        case "form": FormScreen()
        case "list": ListScreen()
        case "list_heavy": CostListScreen(drawMs: 40)
        case "list_stall": CostListScreen(stallMs: 1000)
        case "dialog": DialogScreen()
        case "keychain": KeychainScreen()
        case "crash": CrashScreen()
        case "biometric": BiometricScreen()
        case "ticker": TickerScreen()
        case "delayed": DelayedScreen()
        case "permission": PermissionScreen()
        case "late": LateScreen()
        case "gestures": GesturesScreen()
        case "memory": MemoryScreen()
        case "cpu": CpuScreen()
        case "stall": StallScreen()
        case "frames": FramesScreen()
        case "noise": NoiseScreen()
        case "leak": LeakScreen()
        case "network": NetworkScreen()
        case "code": CodeScreen()
        case "slide": SlideScreen()
        case "a11y": A11yScreen()
        case "web": WebScreen()
        case "canvas": CanvasScreen()
        case "marquee", "marquee_jumps", "marquee_back", "marquee_cut": MarqueeScreen(mode: key)
        case "locale": LocaleScreen()
        default: Text("Unknown screen: \(key)")
        }
    }
}
