import SwiftUI

/// Reactions that come late with nothing in between: a tap adds a line after the button's delay.
/** Says what a finger did on the pad: double taps, how far the last path went, whether two pinched. */
struct GesturesScreen: View {
    @State private var doubles = 0
    @State private var travel = 0
    @State private var pinched = 0

    var body: some View {
        VStack(spacing: 8) {
            Text("double taps: \(doubles)").accessibilityIdentifier("double_taps")
            Text("travel: \(travel)").accessibilityIdentifier("travel")
            Text("pinches: \(pinched)").accessibilityIdentifier("pinches")
            Color.gray.opacity(0.2)
                .contentShape(Rectangle())
                .onTapGesture(count: 2) { doubles += 1 }
                .gesture(DragGesture(minimumDistance: 10).onEnded { travel = Int($0.translation.height) })
                .simultaneousGesture(MagnifyGesture().onEnded { _ in pinched += 1 })
                .accessibilityLabel("Gesture pad")
        }
    }
}
