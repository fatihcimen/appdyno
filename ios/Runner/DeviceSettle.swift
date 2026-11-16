import UIKit
import XCTest

extension Device {
    /// After an action: settle (when asked) and read what the caller wants. `inFront`: the app under test was in front
    /// as the action began, so another app in front after it is one the action brought up.
    func after(_ request: AfterRequest, job: Job, actionAt: Int,
               tapAt: (x: Double, y: Double)?, inFront: Bool = false) throws -> [String: Any] {
        var out: [String: Any] = [:]
        var last: Capture?
        // the next settle is an action's own to call so again
        defer { byItself = false }
        cycled = false
        if let (wire, read) = settled(request, job: job, actionAt: actionAt, tapAt: tapAt, inFront: inFront) {
            out["settle"] = wire
            last = read
        }
        switch request.read {
        case "hash", "tree":
            let start = Date()
            let read = last.flatMap { $0.windows.isEmpty ? nil : $0 }
            var c = try read ?? capture(job: job)
            // a settle that ended settled saw the screen, its copies too, stand still, but for a part known to cycle
            let settled = (out["settle"] as? Wire)?["settled"] as? Bool == true
            hideUnreachableCopies(&c, still: read != nil && settled && !cycled)
            remember(c)
            out["hash"] = c.hash
            if request.read == "tree" {
                out["tree"] = treeJSON(c, elapsedMs: Int(Date().timeIntervalSince(start) * 1000))
            }
        default: break
        }
        return out
    }

    /// Before an action: what moves after it and is not known to cycle, no action of ours set moving where none went
    /// out in `Cycling.ownMs` and this one throws nothing. A row our own swipe threw runs as long as a banner does.
    func begins(_ action: Action) {
        let now = Int(Date().timeIntervalSince1970 * 1000)
        byItself = action.throwsNothing && now - actedAt > Cycling.ownMs
        actedAt = now
    }

    /// Whether a settle's read, begun at `readAt`, is the one before it: a part of the screen known to keep moving by
    /// itself does not hold the settle.
    private func sameToSettle(_ next: Capture, _ prev: Capture, readAt: Int) -> Bool {
        guard let region = Region.between(prev.nodes, next.nodes) else { return true }
        let known = cycling.same(region, byItself: byItself, readAt: readAt,
                                 now: Int(Date().timeIntervalSince1970 * 1000))
        if known { cycled = true }
        return known
    }

    /// The settle an action asked for, if it asked: what it answers, and its last read.
    private func settled(_ request: AfterRequest, job: Job, actionAt: Int,
                         tapAt: (x: Double, y: Double)?, inFront: Bool) -> (Wire, Capture?)? {
        guard let settle = request.settle else { return nil }
        let before = request.before.flatMap { h in recent.last { $0.hash == h }?.nodes }
        var quiet = settle.quietMs
        var inert = false
        // the action sent the app under test away, as a link it opened in Safari: the app come up is read once, as it
        // loads it is read slowly, and the host gave up on the action at its deadline and restarted the runner
        var left = false
        if let tapAt, let before, !actionable(before, x: Int(tapAt.x), y: Int(tapAt.y)) {
            quiet = min(quiet, SettleTimes.inertQuietMs)
            inert = true
        }
        // an alert or sheet that came up during the settle is still animating in: a tap on it then is
        // lost, so the screen counts as busy for its appear animation
        var alertSince: Date? = before.flatMap { hasAlert($0) ? Date.distantPast : nil }
        var readAt = actionAt
        let read = { () -> Capture in
            readAt = Int(Date().timeIntervalSince1970 * 1000)
            var c = (try? self.capture(job: job)) ?? Capture(windows: [], nodes: [], truncated: true, busy: true)
            if inFront, let id = c.windows.first?["pkg"] as? String, id != self.targetId, id != Device.springboardId {
                left = true
            }
            if hasAlert(c.nodes) {
                let since = alertSince ?? Date()
                alertSince = since
                if Date().timeIntervalSince(since) < Double(SettleTimes.alertAppearMs) / 1000 { c.busy = true }
            } else {
                alertSince = nil
            }
            return c
        }
        let seen = before.map { Capture(windows: [], nodes: $0, truncated: false, busy: false) }
        let probe = SettleProbe(read: read, same: { self.sameToSettle($0, $1, readAt: readAt) }, busy: { $0.busy },
                                cancelled: { job.over || left })
        let outcome = settler.run(actionAt: actionAt, quietMs: quiet, maxMs: settle.maxMs, before: seen, probe: probe)
        var last: Capture? = outcome.last
        var settled = outcome.settled
        var ms = outcome.elapsedMs
        var reads = outcome.reads
        var idleMs = 0
        // an actionable tap that changed nothing in the app may have asked the system for something (a
        // permission): its alert comes from the home screen app a moment later, while the app is idle
        if tapAt != nil, !inert, !left, let before {
            let watch = watchForAlert(before: before, last: &last, job: job, read: read)
            idleMs = watch.ms
            // a reaction that began after the settle, the alert or the app's own, is at its first frame: it is
            // settled in turn from that read, within what is left of the action's time
            if watch.changed, let from = last {
                let at = Int(Date().timeIntervalSince1970 * 1000)
                let again = settler.run(actionAt: at, quietMs: quiet, maxMs: max(0, actionAt + settle.maxMs - at),
                                        before: from, probe: probe)
                last = again.last
                settled = again.settled
                ms += again.elapsedMs
                reads += again.reads
            }
        }
        return (settleWire(settled: settled, ms: ms, reads: reads, quietMs: quiet, idleMs: idleMs), last)
    }

    /// While the screen is still the one before the tap, waits for a system alert and reads again, by the settle's
    /// `read`: the milliseconds that took, 0 when the screen had changed, and whether the read is another screen.
    private func watchForAlert(before: [Node], last: inout Capture?, job: Job,
                               read: () -> Capture) -> (ms: Int, changed: Bool) {
        guard var now = last else { return (0, false) }
        let idleAt = Date()
        // `before` was sent with its copies hidden, and a read has them still, so that a screen with a copy would
        // never compare as the same
        hideUnreachableCopies(&now)
        // what a part known to cycle holds says nothing of the tap: over slides that never stop the alert is watched
        // for as on a still screen
        func unmoved(_ nodes: [Node]) -> Bool {
            let at = Int(Date().timeIntervalSince1970 * 1000)
            return sameLayout(cycling.rest(before, now: at), cycling.rest(nodes, now: at))
        }
        guard unmoved(now.nodes), !hasAlert(now.nodes) else { return (0, false) }
        let end = Date().addingTimeInterval(Double(SettleTimes.alertWatchMs) / 1000)
        while Date() < end, !job.over, !springboard.alerts.firstMatch.exists {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        // read again either way: an in-app change that came during the watch belongs in the answer, and an alert's
        // appearance counts from here
        let next = read()
        last = next
        now = next
        hideUnreachableCopies(&now)
        return (Int(Date().timeIntervalSince(idleAt) * 1000), !unmoved(now.nodes) || hasAlert(now.nodes))
    }
}
