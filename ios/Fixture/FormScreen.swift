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
