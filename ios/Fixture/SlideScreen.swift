import SwiftUI
import UIKit

/// A button that slides and fades in over 300 ms after "Show", as a sheet comes up: UIKit's animation
/// (default options) takes no touches while it runs, though the tree shows the button where it ends at once.
struct SlideScreen: View {
    @State private var taps = 0

    var body: some View {
        VStack(spacing: 12) {
            Text("Onay: \(taps)").accessibilityIdentifier("slide_count")
            SlidePanel { taps += 1 }.frame(height: 160)
            Spacer()
        }
        .padding()
    }
}

struct SlidePanel: UIViewRepresentable {
    var onConfirm: () -> Void

    final class Panel: UIView {
        let show = UIButton(type: .system)
        let confirm = UIButton(type: .system)
        var onConfirm: () -> Void = {}

        override init(frame: CGRect) {
            super.init(frame: frame)
            show.setTitle("Show", for: .normal)
            show.accessibilityIdentifier = "slide_show"
            show.addAction(UIAction { [weak self] _ in self?.slideIn() }, for: .touchUpInside)
            confirm.setTitle("Onayla", for: .normal)
            confirm.accessibilityIdentifier = "slide_confirm"
            confirm.backgroundColor = .systemBlue
            confirm.setTitleColor(.white, for: .normal)
            confirm.isHidden = true
            confirm.addAction(UIAction { [weak self] _ in self?.onConfirm() }, for: .touchUpInside)
            addSubview(show)
            addSubview(confirm)
        }

        required init?(coder: NSCoder) { nil }

        override func layoutSubviews() {
            super.layoutSubviews()
            show.frame = CGRect(x: 0, y: 0, width: bounds.width, height: 44)
        }

        func slideIn() {
            let end = CGRect(x: 0, y: 100, width: bounds.width, height: 50)
            confirm.frame = end.offsetBy(dx: 0, dy: 300)
            confirm.alpha = 0
            confirm.isHidden = false
            UIView.animate(withDuration: 0.3) {
                self.confirm.frame = end
                self.confirm.alpha = 1
            }
        }
    }

    func makeUIView(context: Context) -> Panel {
        let p = Panel()
        p.onConfirm = onConfirm
        return p
    }

    func updateUIView(_ p: Panel, context: Context) { p.onConfirm = onConfirm }
}
