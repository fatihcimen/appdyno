import SwiftUI
import UIKit

/// The hinge as UIKit tells it (UIHingeInteraction, iOS 27.1), found by name: an SDK before it has no such class, and
/// this builds with one. A view outside a device that folds hears nothing.
private struct HingeWatch: UIViewRepresentable {
    let heard: (String) -> Void

    func makeUIView(context _: Context) -> UIView {
        let view = UIView()
        guard let hinge = NSClassFromString("UIHingeInteraction") as? NSObject.Type else {
            heard("unknown, this system tells no hinge")
            return view
        }
        let handler: @convention(block) (NSObject, NSObject) -> Void = { _, update in
            guard let hinge = update.value(forKey: "hinge") as? NSObject else {
                return heard("no hinge in this window")
            }
            let status = (hinge.value(forKey: "status") as? Int) ?? 0
            let degrees = ((hinge.value(forKey: "angle") as? Double) ?? 0) * 180 / .pi
            let words = ["unknown", "closed", "partially open", "fully open"]
            let word = status < words.count ? words[status] : "status \(status)"
            heard("\(word), hinge at \(Int(degrees.rounded())) degrees")
        }
        let made = hinge.perform(NSSelectorFromString("alloc")).takeUnretainedValue()
            .perform(NSSelectorFromString("initWithUpdateHandler:"), with: unsafeBitCast(handler, to: AnyObject.self))
        if let interaction = made?.takeRetainedValue() as? UIInteraction { view.addInteraction(interaction) }
        return view
    }

    func updateUIView(_: UIView, context _: Context) {}
}

/// What a fold changes for an app, as the app itself reads it: its window's size and size class, the hinge's posture
/// and angle, and its process, which stays the same as the scene moves from one display to the other.
struct FoldScreen: View {
    @Environment(\.horizontalSizeClass) private var wide
    @Environment(\.verticalSizeClass) private var high
    @State private var posture = "unknown"

    private func word(_ size: UserInterfaceSizeClass?) -> String {
        size == .regular ? "regular" : size == .compact ? "compact" : "unspecified"
    }

    var body: some View {
        GeometryReader { window in
            VStack(alignment: .leading, spacing: 12) {
                Text("Process \(getpid())").accessibilityIdentifier("fold_created")
                Text("Window \(Int(window.size.width))x\(Int(window.size.height)) points")
                    .accessibilityIdentifier("fold_window")
                Text("Size class: \(word(wide)) wide, \(word(high)) high").accessibilityIdentifier("fold_size_class")
                Text("Posture: \(posture)").accessibilityIdentifier("fold_posture")
                HingeWatch { posture = $0 }.frame(width: 1, height: 1)
                Spacer()
            }
            .padding()
        }
        .ignoresSafeArea()
    }
}
