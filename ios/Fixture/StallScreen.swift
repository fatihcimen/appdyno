import SwiftUI

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
            Button("Light") { taps += 1 }.accessibilityIdentifier("stall_light")
            Text("Taps: \(taps)").accessibilityIdentifier("stall_taps")
            Spacer()
        }
        .padding()
    }
}
