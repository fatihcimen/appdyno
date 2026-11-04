import SwiftUI

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
