import SwiftUI

/// A spinner for 1.5 s (and `APPDYNO_FIXTURE_DELAYED_MS` more), then the content: a settle waits for the spinner to go.
struct DelayedScreen: View {
    @State private var loaded = false

    var body: some View {
        VStack(spacing: 12) {
            if loaded { Text("Loaded").accessibilityIdentifier("loaded") } else { ProgressView() }
            Spacer()
        }
        .padding()
        .task {
            let more = ProcessInfo.processInfo.environment["APPDYNO_FIXTURE_DELAYED_MS"].flatMap(UInt64.init) ?? 0
            try? await Task.sleep(nanoseconds: 1_500_000_000 + more * 1_000_000)
            loaded = true
        }
    }
}
