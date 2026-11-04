import SwiftUI

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
