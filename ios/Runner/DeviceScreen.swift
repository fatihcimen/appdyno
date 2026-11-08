import UIKit
import XCTest

extension Device {
    func screenshot(_ request: ShotRequest) throws -> Reply {
        let shot = XCUIScreen.main.screenshot()
        var image = shot.image
        if let maxPx = request.maxPx {
            let pixels = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
            let factor = maxPx / max(pixels.width, pixels.height)
            if factor < 1 {
                let size = CGSize(width: (pixels.width * factor).rounded(), height: (pixels.height * factor).rounded())
                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                    image.draw(in: CGRect(origin: .zero, size: size))
                }
            }
        }
        let quality = Double(request.quality) / 100
        guard let data = request.png ? image.pngData() : image.jpegData(compressionQuality: quality) else {
            throw AgentError("INTERNAL", "the screenshot could not be encoded")
        }
        let w = Int(image.size.width * image.scale), h = Int(image.size.height * image.scale)
        return Reply(result: shotWire(w: w, h: h, png: request.png, bytes: data.count), binary: data)
    }

    func foreground() -> [String: Any] {
        let (_, id) = front()
        return ["pkg": id]
    }

    /// UIInterfaceOrientation of the device now (portrait 1, upside down 2, landscape right 3, left 4).
    static func interfaceOrientation() -> Int {
        switch XCUIDevice.shared.orientation {
        case .portraitUpsideDown: return 2
        case .landscapeLeft: return 4 // the device turned left shows the interface turned right
        case .landscapeRight: return 3
        default: return 1
        }
    }

    func orientation(_ rotation: Int) {
        XCUIDevice.shared.orientation = [.portrait, .landscapeLeft, .portraitUpsideDown, .landscapeRight][rotation & 3]
    }
}
