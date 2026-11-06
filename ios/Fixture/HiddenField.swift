import SwiftUI
import UIKit

struct HiddenField: UIViewRepresentable {
    @Binding var text: String

    /// Takes keys without being a text field (no element reports the focus), as code entries do.
    final class KeyInput: UIView, UIKeyInput {
        var onChange: (String) -> Void = { _ in }
        private var value = ""
        override var canBecomeFirstResponder: Bool { true }
        var keyboardType: UIKeyboardType = .numberPad
        var hasText: Bool { !value.isEmpty }
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
