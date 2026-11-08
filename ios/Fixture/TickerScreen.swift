import Combine
import SwiftUI

/// Text that changes every 100 ms without moving anything: the screen still counts as settled.
struct TickerScreen: View {
    @State private var count = 0
    @State private var running = true
    let timer = Timer.publish(every: 0.1, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(spacing: 12) {
            Text("Ticker: \(count)").monospacedDigit().accessibilityIdentifier("ticker")
            Button(running ? "STOP" : "START") { running.toggle() }.accessibilityIdentifier("ticker_toggle")
            Spacer()
        }
        .padding()
        .onReceive(timer) { _ in if running { count += 1 } }
    }
}
