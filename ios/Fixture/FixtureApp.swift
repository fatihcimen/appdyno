import SwiftUI

/// A known cost by name, from `APPDYNO_FIXTURE_<NAME>_MS`, or kept by `appdyno-fixture://cost/<name>/<ms>` (0 clears
/// it): a phone's flow launches the app with no environment, so a cost has to outlive a stop.
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
    @UIApplicationDelegateAdaptor(PushDelegate.self) private var pushes
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
        if let make = Self.screens[key] {
            make(key)
        } else {
            Text("Unknown screen: \(key)")
        }
    }

    /// A marquee's key is its mode as well.
    private static let marquee: (String) -> AnyView = { AnyView(MarqueeScreen(mode: $0)) }

    private static let screens: [String: (String) -> AnyView] = [
        "form": { _ in AnyView(FormScreen()) },
        "list": { _ in AnyView(ListScreen()) },
        "list_heavy": { _ in AnyView(CostListScreen(drawMs: 40)) },
        "list_stall": { _ in AnyView(CostListScreen(stallMs: 1000)) },
        "dialog": { _ in AnyView(DialogScreen()) },
        "keychain": { _ in AnyView(KeychainScreen()) },
        "crash": { _ in AnyView(CrashScreen()) },
        "biometric": { _ in AnyView(BiometricScreen()) },
        "ticker": { _ in AnyView(TickerScreen()) },
        "copies_banner": { _ in AnyView(CopiesUnderBannerScreen()) },
        "delayed": { _ in AnyView(DelayedScreen()) },
        "permission": { _ in AnyView(PermissionScreen()) },
        "late": { _ in AnyView(LateScreen()) },
        "gestures": { _ in AnyView(GesturesScreen()) },
        "memory": { _ in AnyView(MemoryScreen()) },
        "cpu": { _ in AnyView(CpuScreen()) },
        "stall": { _ in AnyView(StallScreen()) },
        "frames": { _ in AnyView(FramesScreen()) },
        "noise": { _ in AnyView(NoiseScreen()) },
        "leak": { _ in AnyView(LeakScreen()) },
        "network": { _ in AnyView(NetworkScreen()) },
        "code": { _ in AnyView(CodeScreen()) },
        "slide": { _ in AnyView(SlideScreen()) },
        "a11y": { _ in AnyView(A11yScreen()) },
        "web": { _ in AnyView(WebScreen()) },
        "canvas": { _ in AnyView(CanvasScreen()) },
        "marquee": marquee, "marquee_jumps": marquee, "marquee_back": marquee, "marquee_cut": marquee,
        "locale": { _ in AnyView(LocaleScreen()) },
        "push": { _ in AnyView(PushScreen()) }
    ]
}
