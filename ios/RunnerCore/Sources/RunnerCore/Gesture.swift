import CoreGraphics
import Foundation

/// The interface's turn that synthesized touches take (UIInterfaceOrientation: portrait 1, upside down 2, landscape
/// right 3, left 4), of a device turned so (UIDeviceOrientation's raw value). Nil lying flat, face up or down, or
/// unknown: the device then does not say how its screen stands, and an app in landscape is no portrait.
public func interfaceTurn(device: Int) -> Int? {
    switch device {
    case 1: return 1
    case 2: return 2
    case 3: return 4 // the device turned left shows the interface turned right
    case 4: return 3
    default: return nil
    }
}

/// The interface's turn a touch goes with: the device's own, else, lying flat, portrait where the app's last read
/// stood taller than wide (`app`: its width and height), as a portrait app on a phone on a desk does. Nil where
/// neither tells: a wide app on a phone lying flat may stand turned either way, and an iPad (`pad`) keeps any of four
/// turns lying flat, with a tall window beside another on a screen in landscape.
public func touchTurn(device: Int, app: (w: Double, h: Double)?, pad: Bool) -> Int? {
    if let turn = interfaceTurn(device: device) { return turn }
    guard !pad, let app, app.h > app.w else { return nil }
    return 1
}

/**
 * A frame of the home screen app's in the space of an app in landscape, where every other frame and touch is: the home
 * screen app keeps its windows upright (`window`, one's frame) and draws its alert turned in them. `device`,
 * UIDeviceOrientation's raw value, tells the way: turned left (3, its top at the left) or right (4); any other, or a
 * window that turned with the app, leaves the frame as it is.
 */
public func turnedFrame(_ frame: CGRect, window: CGRect, device: Int) -> CGRect {
    guard window.height > window.width else { return frame }
    switch device {
    case 3: return CGRect(x: frame.minY, y: window.width - frame.maxX, width: frame.height, height: frame.width)
    case 4: return CGRect(x: window.height - frame.maxY, y: frame.minX, width: frame.height, height: frame.width)
    default: return frame
    }
}

/**
 * Whether the home screen app's frames turn to the screen's (`turnedFrame`): its `window` stands upright on a device
 * turned to landscape (`device`) under an app in landscape. The read's `root` turned says so; upright it says nothing,
 * as XCTest had the home screen app upright under an iPad's app in landscape, and the app's shape in the `last` read
 * does: an iPhone's first prompt after its home screen came read turned. Neither known, the device's turn is taken.
 */
public func turnsHomeScreen(window: CGRect, device: Int, root: CGRect, last: CGRect?) -> Bool {
    guard device == 3 || device == 4, window.height > window.width else { return false }
    return root.width > root.height || (last.map { $0.width > $0.height } ?? true)
}

/// A point of a finger's path; `t` in the host's milliseconds, or in seconds from the down once on a timeline.
public struct GesturePoint {
    public let x: Double, y: Double, t: Double
}

/**
 * A gesture's fingers on one timeline, as the protocol has them: down together at their first sample and
 * up together after the last sample of any. Offsets only rise: two samples at one time go a millisecond
 * apart, as what the event synthesizer does with equal offsets was not tried.
 */
public func gestureTimeline(_ fingers: [[GesturePoint]]) throws -> (fingers: [[GesturePoint]], liftAt: Double) {
    guard fingers.allSatisfy({ !$0.isEmpty }), let start = fingers.compactMap({ $0.first?.t }).min() else {
        throw AgentError("INVALID_ARGUMENT", "a gesture needs a finger, each with a sample")
    }
    var last = 0.0
    let timed = try fingers.map { f -> [GesturePoint] in
        var out: [GesturePoint] = []
        for (index, sample) in f.enumerated() {
            if index > 0, sample.t < f[index - 1].t {
                throw AgentError("INVALID_ARGUMENT", "a finger's samples go back in time")
            }
            let t = index == 0 ? 0 : max((sample.t - start) / 1000, out[index - 1].t + 0.001)
            out.append(GesturePoint(x: sample.x, y: sample.y, t: t))
        }
        last = max(last, out[out.count - 1].t)
        return out
    }
    // as long as a tap's touch at least; the last sample keeps a moment of its own
    return (timed, max(0.05, last + 0.01))
}
