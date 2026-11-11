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
