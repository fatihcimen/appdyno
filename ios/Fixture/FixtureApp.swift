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
    @State private var gsm = ""

    static func phone(_ v: String) -> String {
        let d = Array(v.filter(\.isNumber).prefix(10))
        var out = ""
        for (i, c) in d.enumerated() {
            if i == 0 { out += "(" }
            if i == 3 { out += ") " }
            if i == 6 { out += "-" }
            out.append(c)
        }
        return out
    }
    @State private var result = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Bilgilerinizi girin")
            TextField("Adınız", text: $name).accessibilityIdentifier("name_input")
            TextField("Telefon", text: $phone).keyboardType(.phonePad).accessibilityIdentifier("phone_input")
            SecureField("Şifre", text: $password).accessibilityIdentifier("password_input")
            // formats the digits as they come, as phone fields do: "(599) 999-9900"
            TextField("Cep telefonu", text: $gsm)
                .keyboardType(.phonePad)
                .accessibilityIdentifier("gsm_input")
                .onChange(of: gsm) { _, v in
                    let f = Self.phone(v)
                    if f != v { gsm = f }
                }
            Button("Gönder") { result = "Gönderildi: \(name)" }.accessibilityIdentifier("submit")
            // the same control twice, one copy drawn under another control (as an overlay's spare bubble
            // under a header): only the one in the open can be tapped
            HStack {
                ZStack {
                    Button("x-mark") {}.accessibilityIdentifier("dup_close")
                    Button("Üstteki") {}.frame(width: 120, height: 44).background(Color.purple)
                }
                Button("x-mark") {}.accessibilityIdentifier("dup_close")
            }
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
/// when the screen appears; the field is hidden from accessibility, so no element reports the focus.
struct CodeScreen: View {
    @State private var code = ""

    var body: some View {
        VStack(spacing: 16) {
            Text("Doğrulama kodu").font(.headline)
            ZStack {
                // hidden from accessibility: XCUI sees no element with the focus while the keyboard is up
                HiddenField(text: $code).frame(width: 1, height: 1).opacity(0.01).accessibilityHidden(true)
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

    /// Takes keys without being a text field (no element reports the focus), as code entries do.
    final class KeyInput: UIView, UIKeyInput {
        var onChange: (String) -> Void = { _ in }
        private var value = ""
        override var canBecomeFirstResponder: Bool { true }
        var keyboardType: UIKeyboardType = .numberPad
        var hasText: Bool { !value.isEmpty }
        /// Like an entry that moves to its next box after each digit: a key that comes before that move is lost.
        private var moving = false
        func insertText(_ text: String) {
            guard text != "\n" else { return }
            value = String((value + text).prefix(6))
            onChange(value)
            // full: it submits itself and gives up the focus, as login code entries do
            if value.count == 6 { resignFirstResponder() }
        }
        func deleteBackward() {
            value = String(value.dropLast())
            onChange(value)
        }
    }

    func makeUIView(context: Context) -> KeyInput {
        let v = KeyInput()
        v.isAccessibilityElement = false
        v.accessibilityElementsHidden = true
        v.onChange = { text = $0 }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { v.becomeFirstResponder() }
        return v
    }

    func updateUIView(_ v: KeyInput, context: Context) {}
}
