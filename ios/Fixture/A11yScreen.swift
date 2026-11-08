import SwiftUI

/// Known accessibility problems for the platform audit's device tests: faint text, a small target, a
/// control without a name, a fixed font size, text cut by its frame, and a price read before the name above
/// it. "Continue" has none of them.
struct A11yScreen: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Accessibility").font(.title2).accessibilityIdentifier("title")
            Text("Faint text").foregroundColor(Color(white: 0.85)).accessibilityIdentifier("a11y_faint")
            Button(action: {}, label: { Color.blue.frame(width: 18, height: 18) })
                .accessibilityLabel("Small").accessibilityIdentifier("a11y_small")
            Button(action: {}, label: { Color.blue.frame(width: 44, height: 44) })
                .accessibilityIdentifier("a11y_unnamed")
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
            Button(action: {}, label: {
                Text("Continue").padding(.horizontal, 16).frame(minHeight: 44).contentShape(Rectangle())
            })
            .tint(Color(red: 0, green: 0.25, blue: 0.6)).accessibilityIdentifier("a11y_ok")
            Spacer()
        }
        .padding()
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white)
    }
}
