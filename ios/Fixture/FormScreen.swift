import SwiftUI

struct FormScreen: View {
    @State private var name = ""
    @State private var phone = ""
    @State private var password = ""
    @State private var gsm = ""

    static func phone(_ text: String) -> String {
        let d = Array(text.filter(\.isNumber).prefix(10))
        var out = ""
        for (index, c) in d.enumerated() {
            if index == 0 { out += "(" }
            if index == 3 { out += ") " }
            if index == 6 { out += "-" }
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
                .onChange(of: gsm) { _, value in
                    let f = Self.phone(value)
                    if f != value { gsm = f }
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

/// A control drawn twice, one copy under another control, below a banner that turns on its own, as a home screen's
/// carousel does: the banner changes the layout at every read, and the copies do not move.
struct CopiesUnderBannerScreen: View {
    @State private var turn = 0
    let timer = Timer.publish(every: 0.3, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            Button("Kampanya \(turn % 4 + 1)") {}
                .accessibilityIdentifier("promo_banner")
                .frame(width: 200, height: 80)
                .background(Color.orange)
                .offset(x: CGFloat(turn % 40) * 3)
            HStack {
                ZStack {
                    Button("x-mark") {}.accessibilityIdentifier("dup_close")
                    Button("Üstteki") {}.frame(width: 120, height: 44).background(Color.purple)
                }
                Button("x-mark") {}.accessibilityIdentifier("dup_close")
            }
            Spacer()
        }
        .padding()
        .onReceive(timer) { _ in turn += 1 }
    }
}

/// A carousel whose slides carry one id and never stand still, two or three of them on a phone's screen at a time, as
/// a home screen's turning campaigns do: the copies themselves are elsewhere at every read.
struct CopiesCarouselScreen: View {
    @State private var turn = 0
    @State private var taps = 0
    @State private var lines = 0
    @StateObject private var asker = PermissionScreen.Asker()
    let timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()
    private let period = 200

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            ZStack(alignment: .leading) {
                ForEach(0 ..< 4, id: \.self) { index in
                    Button("Kampanya \(index + 1)") {}
                        .accessibilityIdentifier("promo_slide")
                        .frame(width: 180, height: 80)
                        .background(Color.orange)
                        .offset(x: CGFloat(index * period - turn * 7 % period - 190))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button("Dokun") { taps += 1 }.accessibilityIdentifier("carousel_tap")
            Text("Dokunuş: \(taps)").accessibilityIdentifier("carousel_taps")
            // the system's alert comes over slides that never stop, half a second after the tap: an app asks once
            // its own work is done, and a settle is over by then
            Button("Konum iste") {
                DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(500)) {
                    asker.manager.requestWhenInUseAuthorization()
                }
            }
            .accessibilityIdentifier("carousel_ask")
            // a tap that changes the layout under the slides
            Button("Satır ekle") { lines += 1 }.accessibilityIdentifier("carousel_more")
            ForEach(0 ..< lines, id: \.self) { Text("Satır \($0 + 1)") }
            Spacer()
        }
        .padding()
        .onReceive(timer) { _ in turn += 1 }
    }
}

/// A field that takes nothing the first time and lets go of the keyboard as it does, as a form that resets a field
/// once: text typed whole into it reads back as other, and the second typing finds the field without the focus.
struct FocusDropScreen: View {
    @State private var text = ""
    @State private var dropped = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            TextField("Drops once", text: $text)
                .focused($focused)
                .accessibilityIdentifier("drop_input")
                .onChange(of: text) { _, value in
                    guard !dropped, !value.isEmpty else { return }
                    dropped = true
                    text = ""
                    focused = false
                }
            Spacer()
        }
        .textFieldStyle(.roundedBorder)
        .padding()
    }
}
