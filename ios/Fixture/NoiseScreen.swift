import Combine
import SwiftUI

/// New colours over the whole screen each frame: what a video encoder can compress least.
struct NoiseScreen: View {
    final class Source: NSObject, ObservableObject {
        @Published var image: CGImage?
        private var link: CADisplayLink?

        func start() {
            link = CADisplayLink(target: self, selector: #selector(tick))
            link?.add(to: .main, forMode: .common)
        }

        func stop() {
            link?.invalidate()
            link = nil
        }

        @objc private func tick() {
            let width = 215, height = 466
            var bytes = Data(count: width * height * 4)
            bytes.withUnsafeMutableBytes { arc4random_buf($0.baseAddress, $0.count) }
            image = CGDataProvider(data: bytes as CFData).flatMap {
                CGImage(
                    width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                    provider: $0, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
            }
        }
    }

    @StateObject private var source = Source()

    var body: some View {
        Group {
            if let image = source.image {
                Image(decorative: image, scale: 1).interpolation(.none).resizable()
            } else {
                Color.black
            }
        }
        .ignoresSafeArea()
        .onAppear { source.start() }
        .onDisappear { source.stop() }
    }
}
