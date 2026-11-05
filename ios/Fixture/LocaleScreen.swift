import SwiftUI

/// The language this launch runs in, as an app is told it.
struct LocaleScreen: View {
    var body: some View {
        Text("language: \(Locale.preferredLanguages.first ?? "")").accessibilityIdentifier("result")
    }
}
