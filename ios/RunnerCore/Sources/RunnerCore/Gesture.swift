import Foundation

/// A point of a finger's path; `t` in the host's milliseconds, or in seconds from the down once on a timeline.
public typealias GesturePoint = (x: Double, y: Double, t: Double)

/**
 * A gesture's fingers on one timeline, as the protocol has them: down together at their first sample and
 * up together after the last sample of any. Offsets only rise: two samples at one time go a millisecond
 * apart, as what the event synthesizer does with equal offsets was not tried.
 */
public func gestureTimeline(_ fingers: [[GesturePoint]]) throws -> (fingers: [[GesturePoint]], liftAt: Double) {
    guard fingers.allSatisfy({ !$0.isEmpty }), let t0 = fingers.compactMap({ $0.first?.t }).min() else {
        throw AgentError("INVALID_ARGUMENT", "a gesture needs a finger, each with a sample")
    }
    var last = 0.0
    let timed = try fingers.map { f -> [GesturePoint] in
        var out: [GesturePoint] = []
        for (i, s) in f.enumerated() {
            if i > 0, s.t < f[i - 1].t { throw AgentError("INVALID_ARGUMENT", "a finger's samples go back in time") }
            out.append((s.x, s.y, i == 0 ? 0 : max((s.t - t0) / 1000, out[i - 1].t + 0.001)))
        }
        last = max(last, out[out.count - 1].t)
        return out
    }
    // as long as a tap's touch at least; the last sample keeps a moment of its own
    return (timed, max(0.05, last + 0.01))
}
