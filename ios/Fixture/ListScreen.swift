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

/// A list a search field filters, the field in the bottom bar as Settings' is since iOS 26: once it has the focus it
/// rises with the keyboard and makes room for its close button, away from where the tap found it. It has no identifier,
/// as Settings' has none.
struct SearchScreen: View {
    @State private var query = ""
    private let rows = ["Bluetooth", "Kapı zili", "Wi-Fi"]

    var body: some View {
        let list = List(rows.filter { query.isEmpty || $0.localizedCaseInsensitiveContains(query) }, id: \.self) {
            Text($0)
        }
        .searchable(text: $query, prompt: "Search rows")
        if #available(iOS 26, *) {
            list.toolbar { DefaultToolbarItem(kind: .search, placement: .bottomBar) }
        } else {
            list
        }
    }
}

/// A crash in a function of its own that the optimizer keeps: what a symbolicated report must name.
@inline(never) func fixtureCrash(_ why: String) -> Never { fatalError(why) }
