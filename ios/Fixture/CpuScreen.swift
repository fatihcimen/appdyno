import SwiftUI

/// What a test put on the app: a core at work off the main thread for the cost `cpu` of each second, in this function.
@inline(never) func knownCpuCost(_ ms: Double) {
    var x: UInt64 = 1
    while true {
        let end = Date().addingTimeInterval(ms / 1000)
        while Date() < end { for _ in 0 ..< 100_000 { x = x &+ (x ^ 7) } }
        if x == 42 { print(x) }
        usleep(UInt32(1000 - ms) * 1000)
    }
}

/// Keeps one core busy for 3 s off the main thread: a CPU reading and a profile must show it.
struct CpuScreen: View {
    @State private var busy = false

    var body: some View {
        VStack(spacing: 12) {
            Button("Load 3 s") {
                busy = true
                DispatchQueue.global(qos: .userInitiated).async {
                    let end = Date().addingTimeInterval(3)
                    var x: UInt64 = 1
                    // the clock is read rarely: the time goes to this loop, not to the clock
                    while Date() < end { for _ in 0 ..< 100_000 { x = x &+ (x ^ 7) } }
                    if x == 42 { print(x) }
                    DispatchQueue.main.async { busy = false }
                }
            }
            .accessibilityIdentifier("cpu_load")
            Text(busy ? "Busy" : "Idle").accessibilityIdentifier("cpu_state")
            Spacer()
        }
        .padding()
    }
}

/// Blocks the main thread for a known time: a stall reading must show it. "Light" does next to nothing.
/// A loop with a name of its own: what a hang that is busy must name.
@inline(never) func busyMainThread() {
    let end = Date().addingTimeInterval(0.5)
    var x = 0
    while Date() < end { x &+= 1 }
    if x == 42 { print(x) }
}
