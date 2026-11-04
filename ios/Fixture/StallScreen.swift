import SwiftUI

/// What a test put on the light button: the main thread at work for `APPDYNO_FIXTURE_STALL_MS` in this function, or
/// asleep for `APPDYNO_FIXTURE_SLEEP_MS`.
@inline(never) func knownCost() {
    let env = ProcessInfo.processInfo.environment
    if let ms = env["APPDYNO_FIXTURE_SLEEP_MS"].flatMap(UInt32.init) { usleep(ms * 1000) }
    guard let ms = env["APPDYNO_FIXTURE_STALL_MS"].flatMap(Double.init) else { return }
    let end = Date().addingTimeInterval(ms / 1000)
    var x = 0
    while Date() < end { x &+= 1 }
    if x == 42 { print(x) }
}

struct StallScreen: View {
    @State private var taps = 0

    var body: some View {
        VStack(spacing: 12) {
            Button("Stall 500 ms") {
                usleep(500_000)
                taps += 1
            }
            .accessibilityIdentifier("stall_500")
            Button("Busy 500 ms") {
                busyMainThread()
                taps += 1
            }
            .accessibilityIdentifier("stall_busy")
            Button("Light") {
                knownCost()
                taps += 1
            }
            .accessibilityIdentifier("stall_light")
            Text("Taps: \(taps)").accessibilityIdentifier("stall_taps")
            Spacer()
        }
        .padding()
    }
}
