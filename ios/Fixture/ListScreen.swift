import SwiftUI

struct ListScreen: View {
    @State private var counts = Array(repeating: 0, count: 60)

    var body: some View {
        List(0 ..< 60, id: \.self) { index in
            HStack {
                Text("Product \(index + 1)").accessibilityIdentifier("row_name")
                Spacer()
                Text("In basket: \(counts[index])").accessibilityIdentifier("row_count")
                Button("Add") { counts[index] += 1 }.buttonStyle(.bordered).accessibilityIdentifier("add_button")
            }
        }
        .accessibilityIdentifier("list")
    }
}

/// A crash in a function of its own that the optimizer keeps: what a symbolicated report must name.
@inline(never) func fixtureCrash(_ why: String) -> Never { fatalError(why) }
