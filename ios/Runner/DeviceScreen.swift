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

    /// UIInterfaceOrientation of the device now (`interfaceTurn`); nil while it lies flat.
    static func interfaceOrientation() -> Int? {
        interfaceTurn(device: XCUIDevice.shared.orientation.rawValue)
    }

    /// The turn synthesized keys go with: a key has no place on the screen, so a device lying flat may say none.
    static func keysOrientation() -> Int { interfaceOrientation() ?? 1 }

    /// The turn a touch goes with (`touchTurn`): lying flat, by the app's shape in the last read; nil where none tells.
    func touchOrientation() -> Int? {
        touchTurn(device: XCUIDevice.shared.orientation.rawValue,
                  app: appFrame.map { (w: Double($0.width), h: Double($0.height)) })
    }

    func orientation(_ rotation: Int) {
        XCUIDevice.shared.orientation = [.portrait, .landscapeLeft, .portraitUpsideDown, .landscapeRight][rotation & 3]
    }
}
