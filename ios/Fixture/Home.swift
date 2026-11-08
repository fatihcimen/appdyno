import SwiftUI

let screens: [(key: String, title: String)] = [
    ("form", "Form"), ("list", "List"), ("dialog", "Dialog"), ("ticker", "Ticker"), ("delayed", "Delayed"),
    ("permission", "Permission")
]

struct Home: View {
    @Binding var path: [String]
    var lastLink = ""

    /// It scrolls, though all of it fits: what records a scroll has frames to read here too.
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("appdyno fixture").font(.title2).accessibilityIdentifier("title")
                ForEach(screens, id: \.key) { screen in
                    Button(screen.title) { path.append(screen.key) }.accessibilityIdentifier("open_\(screen.key)")
                }
                if !lastLink.isEmpty { Text("Link: \(lastLink)").accessibilityIdentifier("last_link") }
            }
            .padding()
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
