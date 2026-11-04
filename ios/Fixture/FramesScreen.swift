import Combine
import SwiftUI

/// An animation of 2 s whose frames each cost a known time on the main thread: a frame reading must tell
/// about 1 ms from 40 ms.
struct FramesScreen: View {
    final class Animator: NSObject, ObservableObject {
        @Published var x: CGFloat = 0
        private var link: CADisplayLink?
        private var workMs = 0.0
        private var end: CFTimeInterval = 0

        func run(workMs: Double, seconds: Double = 2) {
            self.workMs = workMs
            end = CACurrentMediaTime() + seconds
            link?.invalidate()
            link = CADisplayLink(target: self, selector: #selector(tick))
            link?.add(to: .main, forMode: .common)
        }

        @objc private func tick(_ l: CADisplayLink) {
            // spins, as real work does: a sleep would leave the CPU free
            let stop = CACurrentMediaTime() + workMs / 1000
            while CACurrentMediaTime() < stop {}
            x = CGFloat(l.timestamp.truncatingRemainder(dividingBy: 1)) * 200
            if l.timestamp > end {
                l.invalidate()
                link = nil
            }
        }
    }

    @StateObject private var animator = Animator()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button("Light frames") { animator.run(workMs: 1) }.accessibilityIdentifier("frames_light")
            Button("Heavy frames") { animator.run(workMs: 40) }.accessibilityIdentifier("frames_heavy")
            Circle().frame(width: 30, height: 30).offset(x: animator.x)
            Spacer()
        }
        .padding()
    }
}
