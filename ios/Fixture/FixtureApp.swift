import Combine
import CoreLocation
import SwiftUI
import UIKit

/// The iOS fixture: the same screens as the Android one, where the platform has them.
/// `gdfixture://open/<screen>` opens a screen directly.
@main
struct FixtureApp: App {
    @State private var path: [String] = []
    @State private var lastLink = ""

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
        case "dialog": DialogScreen()
        case "ticker": TickerScreen()
        case "delayed": DelayedScreen()
        case "permission": PermissionScreen()
        case "late": LateScreen()
        case "memory": MemoryScreen()
        case "cpu": CpuScreen()
        case "code": CodeScreen()
        default: Text("Bilinmeyen ekran: \(key)")
        }
    }
}

let screens: [(key: String, title: String)] = [
    ("form", "Form"), ("list", "Liste"), ("dialog", "Diyalog"), ("ticker", "Sayaç"), ("delayed", "Gecikmeli"),
    ("permission", "İzin"),
]

struct Home: View {
    @Binding var path: [String]
    var lastLink = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("appdyno fixture").font(.title2).accessibilityIdentifier("title")
            ForEach(screens, id: \.key) { s in
                Button(s.title) { path.append(s.key) }.accessibilityIdentifier("open_\(s.key)")
            }
            if !lastLink.isEmpty { Text("Bağlantı: \(lastLink)").accessibilityIdentifier("last_link") }
            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct FormScreen: View {
    @State private var name = ""
    @State private var phone = ""
    @State private var password = ""
    @State private var result = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Bilgilerinizi girin")
            TextField("Adınız", text: $name).accessibilityIdentifier("name_input")
            TextField("Telefon", text: $phone).keyboardType(.phonePad).accessibilityIdentifier("phone_input")
            SecureField("Şifre", text: $password).accessibilityIdentifier("password_input")
            Button("Gönder") { result = "Gönderildi: \(name)" }.accessibilityIdentifier("submit")
            Text(result).accessibilityIdentifier("result")
            Spacer()
        }
        .textFieldStyle(.roundedBorder)
        .padding()
    }
}

struct ListScreen: View {
    @State private var counts = Array(repeating: 0, count: 60)

    var body: some View {
        List(0 ..< 60, id: \.self) { i in
            HStack {
                Text("Ürün \(i + 1)").accessibilityIdentifier("row_name")
                Spacer()
                Text("Sepette: \(counts[i])").accessibilityIdentifier("row_count")
                Button("Ekle") { counts[i] += 1 }.buttonStyle(.bordered).accessibilityIdentifier("add_button")
            }
        }
        .accessibilityIdentifier("list")
    }
}

struct DialogScreen: View {
    @State private var shown = false
    @State private var result = ""

    var body: some View {
        VStack(spacing: 12) {
            Button("Diyaloğu aç") { shown = true }.accessibilityIdentifier("open_dialog")
            Text(result).accessibilityIdentifier("result")
            Spacer()
        }
        .padding()
        .alert("Emin misiniz?", isPresented: $shown) {
            Button("Tamam") { result = "Onaylandı" }
            Button("İptal", role: .cancel) { result = "Vazgeçildi" }
        } message: {
            Text("Sepet boşaltılacak.")
        }
    }
}

/// Text that changes every 100 ms without moving anything: the screen still counts as settled.
struct TickerScreen: View {
    @State private var n = 0
    @State private var running = true
    let timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 12) {
            Text("Sayaç: \(n)").monospacedDigit().accessibilityIdentifier("ticker")
            Button(running ? "DUR" : "BAŞLAT") { running.toggle() }.accessibilityIdentifier("ticker_toggle")
            Spacer()
        }
        .padding()
        .onReceive(timer) { _ in if running { n += 1 } }
    }
}

/// A spinner for 1.5 s, then the content: a settle waits for the spinner to go.
struct DelayedScreen: View {
    @State private var loaded = false

    var body: some View {
        VStack(spacing: 12) {
            if loaded { Text("Yüklendi").accessibilityIdentifier("loaded") } else { ProgressView() }
            Spacer()
        }
        .padding()
        .task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            loaded = true
        }
    }
}

/// Asks for the location: the system alert is the springboard's, over the app.
struct PermissionScreen: View {
    final class Asker: NSObject, ObservableObject, CLLocationManagerDelegate {
        let manager = CLLocationManager()
        @Published var status = "?"
        override init() {
            super.init()
            manager.delegate = self
        }

        func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
            switch m.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: status = "İzin verildi"
            case .denied, .restricted: status = "İzin reddedildi"
            default: status = "Sorulmadı"
            }
        }
    }

    @StateObject private var asker = Asker()

    var body: some View {
        VStack(spacing: 12) {
            Button("Konum izni iste") { asker.manager.requestWhenInUseAuthorization() }.accessibilityIdentifier("ask_location")
            Text(asker.status).accessibilityIdentifier("permission_status")
            Spacer()
        }
        .padding()
    }
}

/// Reactions that come late with nothing in between: a tap adds a line after the button's delay.
struct LateScreen: View {
    @State private var lines: [String] = []
    let delays = [0, 50, 100, 150, 200, 250, 300, 350, 450, 700, 1000]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(delays, id: \.self) { d in
                Button("\(d) ms") {
                    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(d)) { lines.append("Tepki \(d)") }
                }
                .accessibilityIdentifier("late_\(d)")
            }
            Button("Temizle") { lines.removeAll() }.accessibilityIdentifier("late_clear")
            ForEach(Array(lines.enumerated()), id: \.offset) { _, l in Text(l) }
            Spacer()
        }
        .padding()
    }
}

/// Holds 50 MB (written, so it is resident) until freed: a memory reading must show it.
struct MemoryScreen: View {
    @State private var held: [UInt8] = []

    var body: some View {
        VStack(spacing: 12) {
            Button("50 MB ayır") { held = [UInt8](repeating: 7, count: 50 * 1024 * 1024) }.accessibilityIdentifier("memory_alloc")
            Button("Bırak") { held = [] }.accessibilityIdentifier("memory_free")
            Text(held.isEmpty ? "Boş" : "50 MB tutuluyor").accessibilityIdentifier("memory_state")
            Spacer()
        }
        .padding()
    }
}

/// Keeps one core busy for 3 s off the main thread: a CPU reading and a profile must show it.
struct CpuScreen: View {
    @State private var busy = false

    var body: some View {
        VStack(spacing: 12) {
            Button("3 sn yük") {
                busy = true
                DispatchQueue.global(qos: .userInitiated).async {
                    let end = Date().addingTimeInterval(3)
                    var x: UInt64 = 1
                    // the clock is read rarely: the time goes to this loop, not to the clock
                    while Date() < end { for _ in 0 ..< 100_000 { x = x &+ (x ^ 7) } }
                    if x == 42 { print(x) }
                    DispatchQueue.main.async { busy = false }
                }
            }
            .accessibilityIdentifier("cpu_load")
            Text(busy ? "Yükte" : "Boşta").accessibilityIdentifier("cpu_state")
            Spacer()
        }
        .padding()
    }
}

/// A code entry as login screens build it: six boxes drawn over a hidden text field that takes the focus
/// when the screen appears (XCUI does not report the hidden field as focused).
struct CodeScreen: View {
    @State private var code = ""

    var body: some View {
        VStack(spacing: 16) {
            Text("Doğrulama kodu").font(.headline)
            ZStack {
                HiddenField(text: $code).frame(width: 1, height: 1).opacity(0.01)
                HStack(spacing: 8) {
                    ForEach(0 ..< 6, id: \.self) { i in
                        let chars = Array(code)
                        Text(i < chars.count ? String(chars[i]) : "–")
                            .frame(width: 36, height: 44)
                            .overlay(RoundedRectangle(cornerRadius: 6).stroke(.gray))
                    }
                }
            }
            Text("Kod: \(code)").accessibilityIdentifier("code_value")
            Spacer()
        }
        .padding()
    }
}

struct HiddenField: UIViewRepresentable {
    @Binding var text: String

    func makeUIView(context: Context) -> UITextField {
        let f = UITextField()
        f.keyboardType = .numberPad
        f.textContentType = .oneTimeCode
        f.isAccessibilityElement = false
        f.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { f.becomeFirstResponder() }
        return f
    }

    func updateUIView(_ f: UITextField, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

    final class Coordinator: NSObject {
        var text: Binding<String>
        init(text: Binding<String>) { self.text = text }
        @objc func changed(_ f: UITextField) { text.wrappedValue = String((f.text ?? "").prefix(6)) }
    }
}
