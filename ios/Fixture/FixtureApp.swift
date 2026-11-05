import SwiftUI

/// The iOS fixture: the same screens as the Android one, where the platform has them.
/// `appdyno-fixture://open/<screen>` opens a screen directly.
@main
struct FixtureApp: App {
    @State private var path: [String] = []
    @State private var lastLink = ""

    /// A slow start of a known length: a launch reading must rise by it.
    init() {
        if let ms = ProcessInfo.processInfo.environment["APPDYNO_FIXTURE_STARTUP_MS"].flatMap(UInt32.init) { usleep(ms * 1000) }
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
        case "locale": LocaleScreen()
        default: Text("Bilinmeyen ekran: \(key)")
        }
    }
}
