import SwiftUI

/// Each tap makes a retain cycle nothing else reaches: a leaks count must rise.
final class LeakNode {
    var other: LeakNode?
}

struct LeakScreen: View {
    @State private var made = 0

    var body: some View {
        VStack(spacing: 12) {
            Button("Make a leak") {
                let first = LeakNode()
                let second = LeakNode()
                first.other = second
                second.other = first
                made += 1
            }
            .accessibilityIdentifier("leak_make")
            Text("Made: \(made)").accessibilityIdentifier("leak_made")
            Spacer()
        }
        .padding()
    }
}
