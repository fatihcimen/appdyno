import SwiftUI

/// A list whose frames each cost a known time, or that stalls once as its rows come in: what a scroll must read.
struct CostListScreen: View {
    var drawMs = 0.0
    var stallMs: UInt32 = 0
    @StateObject private var animator = FramesScreen.Animator()
    @State private var stalled = false

    var body: some View {
        List(0 ..< 60, id: \.self) { i in
            Text("Row \(i + 1)").onAppear {
                guard i == 20, stallMs > 0, !stalled else { return }
                stalled = true
                usleep(stallMs * 1000)
            }
        }
        .accessibilityIdentifier("list")
        .onAppear { if drawMs > 0 { animator.run(workMs: drawMs, seconds: 3600) } }
    }
}
