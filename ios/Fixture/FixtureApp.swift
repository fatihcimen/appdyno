import Combine
import CoreLocation
import SwiftUI
import UIKit

/// The iOS fixture: the same screens as the Android one, where the platform has them.
/// `appdyno-fixture://open/<screen>` opens a screen directly.
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
        case "slide": SlideScreen()
        case "a11y": A11yScreen()
        default: Text("Bilinmeyen ekran: \(key)")
        }
    }
}

let screens: [(key: String, title: String)] = [
    ("form", "Form"), ("list", "List"), ("dialog", "Dialog"), ("ticker", "Ticker"), ("delayed", "Delayed"),
    ("permission", "Permission"),
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
            if !lastLink.isEmpty { Text("Link: \(lastLink)").accessibilityIdentifier("last_link") }
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
            Text("Enter your details")
            TextField("Your name", text: $name).accessibilityIdentifier("name_input")
            TextField("Phone", text: $phone).keyboardType(.phonePad).accessibilityIdentifier("phone_input")
            SecureField("Password", text: $password).accessibilityIdentifier("password_input")
            // formats the digits as they come, as phone fields do: "(599) 999-9900"
            TextField("Mobile phone", text: $gsm)
                .keyboardType(.phonePad)
                .accessibilityIdentifier("gsm_input")
                .onChange(of: gsm) { _, v in
                    let f = Self.phone(v)
                    if f != v { gsm = f }
                }
            Button("Send") { result = "Sent: \(name)" }.accessibilityIdentifier("submit")
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
                Text("Product \(i + 1)").accessibilityIdentifier("row_name")
                Spacer()
                Text("In basket: \(counts[i])").accessibilityIdentifier("row_count")
                Button("Add") { counts[i] += 1 }.buttonStyle(.bordered).accessibilityIdentifier("add_button")
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
            Button("Open dialog") { shown = true }.accessibilityIdentifier("open_dialog")
            Text(result).accessibilityIdentifier("result")
            Spacer()
        }
        .padding()
        .alert("Emin misiniz?", isPresented: $shown) {
            Button("OK") { result = "Confirmed" }
            Button("Cancel", role: .cancel) { result = "Cancelled" }
        } message: {
            Text("The basket will be emptied.")
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
            Text("Ticker: \(n)").monospacedDigit().accessibilityIdentifier("ticker")
            Button(running ? "STOP" : "START") { running.toggle() }.accessibilityIdentifier("ticker_toggle")
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
            if loaded { Text("Loaded").accessibilityIdentifier("loaded") } else { ProgressView() }
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
            case .authorizedWhenInUse, .authorizedAlways: status = "Allowed"
            case .denied, .restricted: status = "Denied"
            default: status = "Not asked"
            }
        }
    }

    @StateObject private var asker = Asker()

    var body: some View {
        VStack(spacing: 12) {
            Button("Request location") { asker.manager.requestWhenInUseAuthorization() }.accessibilityIdentifier("ask_location")
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
            Button("Clear") { lines.removeAll() }.accessibilityIdentifier("late_clear")
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
            Button("Hold 50 MB") { held = [UInt8](repeating: 7, count: 50 * 1024 * 1024) }.accessibilityIdentifier("memory_alloc")
            Button("Release") { held = [] }.accessibilityIdentifier("memory_free")
            Text(held.isEmpty ? "Empty" : "Holding 50 MB").accessibilityIdentifier("memory_state")
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
            Button("Load 3 s") {
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
            Text(busy ? "Busy" : "Idle").accessibilityIdentifier("cpu_state")
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
            Text("Verification code").font(.headline)
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
            Text("Code: \(code)").accessibilityIdentifier("code_value")
            Spacer()
        }
        .padding()
    }
}

/// A button that slides and fades in over 300 ms after "Show", as a sheet comes up: UIKit's animation
/// (default options) takes no touches while it runs, though the tree shows the button where it ends at once.
struct SlideScreen: View {
    @State private var taps = 0

    var body: some View {
        VStack(spacing: 12) {
            Text("Onay: \(taps)").accessibilityIdentifier("slide_count")
            SlidePanel { taps += 1 }.frame(height: 160)
            Spacer()
        }
        .padding()
    }
}

struct SlidePanel: UIViewRepresentable {
    var onConfirm: () -> Void

    final class Panel: UIView {
        let show = UIButton(type: .system)
        let confirm = UIButton(type: .system)
        var onConfirm: () -> Void = {}

        override init(frame: CGRect) {
            super.init(frame: frame)
            show.setTitle("Show", for: .normal)
            show.accessibilityIdentifier = "slide_show"
            show.addAction(UIAction { [weak self] _ in self?.slideIn() }, for: .touchUpInside)
            confirm.setTitle("Onayla", for: .normal)
            confirm.accessibilityIdentifier = "slide_confirm"
            confirm.backgroundColor = .systemBlue
            confirm.setTitleColor(.white, for: .normal)
            confirm.isHidden = true
            confirm.addAction(UIAction { [weak self] _ in self?.onConfirm() }, for: .touchUpInside)
            addSubview(show)
            addSubview(confirm)
        }

        required init?(coder: NSCoder) { nil }

        override func layoutSubviews() {
            super.layoutSubviews()
            show.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 44)
        }

        func slideIn() {
            let end = CGRect(x: 0, y: 100, width: bounds.width, height: 50)
            confirm.frame = end.offsetBy(dx: 0, dy: 300)
            confirm.alpha = 0
            confirm.isHidden = false
            UIView.animate(withDuration: 0.3) {
                self.confirm.frame = end
                self.confirm.alpha = 1
            }
        }
    }

    func makeUIView(context: Context) -> Panel {
        let p = Panel()
        p.onConfirm = onConfirm
        return p
    }

    func updateUIView(_ p: Panel, context: Context) { p.onConfirm = onConfirm }
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

/// Known accessibility problems for the platform audit's device tests: faint text, a small target, a
/// control without a name, a fixed font size, text cut by its frame, and a price read before the name above
/// it. "Continue" has none of them.
struct A11yScreen: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Accessibility").font(.title2).accessibilityIdentifier("title")
            Text("Faint text").foregroundColor(Color(white: 0.85)).accessibilityIdentifier("a11y_faint")
            Button(action: {}) { Color.blue.frame(width: 18, height: 18) }
                .accessibilityLabel("Small").accessibilityIdentifier("a11y_small")
            Button(action: {}) { Color.blue.frame(width: 44, height: 44) }.accessibilityIdentifier("a11y_unnamed")
            Text("Fixed text size").font(.system(size: 15)).accessibilityIdentifier("a11y_fixed")
            Text("This text is too long for its frame and is cut")
                .lineLimit(1).frame(width: 120, alignment: .leading).accessibilityIdentifier("a11y_cut")
            // the price comes first in the view tree, though it sits below the name
            ZStack(alignment: .topLeading) {
                Text("24,90 TL").padding(.top, 32).accessibilityIdentifier("a11y_price")
                Text("Ayran 1 L").accessibilityIdentifier("a11y_name")
            }
            .frame(width: 200, height: 64, alignment: .topLeading)
            // a dark tint: the system blue on white is under 4.5:1 for text. The hit area is the label's own
            // frame (a frame around the button does not widen it): 44 pt tall, whatever the text size (a
            // bare text label is 19 pt at the "medium" size, a hit area the audit reports)
            Button(action: {}) {
                Text("Continue").padding(.horizontal, 16).frame(minHeight: 44).contentShape(Rectangle())
            }
            .tint(Color(red: 0, green: 0.25, blue: 0.6)).accessibilityIdentifier("a11y_ok")
            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
    }
}
