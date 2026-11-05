import SwiftUI

/// A line of text that runs left: smooth, or with a fault a single picture would not show.
struct MarqueeScreen: View {
    let mode: String
    private let start = Date()
    private let text = "Kargo yolda, siparişin bugün geliyor, teşekkürler"
    private let speed = 80.0, jump = 40.0, every = 1.2, backFor = 0.4, width = 620.0

    /// How far it has run, in points; each fault breaks it every so often.
    private func run(_ t: Double) -> Double {
        let turns = (t / every).rounded(.down)
        switch mode {
        case "marquee_jumps": return t * speed + turns * jump
        case "marquee_back":
            let into = t - turns * every
            let stepped = turns * (every - 2 * backFor) * speed
            return stepped + (into < every - backFor ? into : 2 * (every - backFor) - into) * speed
        default: return t * speed
        }
    }

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                if mode == "marquee_cut" {
                    context.clip(to: Path(CGRect(x: 0, y: 0, width: size.width * 0.6, height: size.height)))
                }
                let label = context.resolve(Text(text).font(.title2))
                let shift = run(timeline.date.timeIntervalSince(start)).truncatingRemainder(dividingBy: width)
                var x = -shift
                while x < size.width {
                    context.draw(label, at: CGPoint(x: x, y: size.height * 0.3), anchor: .leading)
                    x += width
                }
            }
        }
        .background(Color.white)
    }
}
