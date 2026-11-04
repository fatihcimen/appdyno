import SwiftUI

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
