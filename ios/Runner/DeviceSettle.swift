import UIKit
import XCTest

extension Device {
    /// After an action: settle (when asked) and read what the caller wants.
    func after(_ request: AfterRequest, job: Job, actionAt: Int,
               tapAt: (x: Double, y: Double)?) throws -> [String: Any] {
        var out: [String: Any] = [:]
        var last: Capture?
        if let settle = request.settle {
            let before = request.before.flatMap { h in recent.last { $0.hash == h }?.nodes }
            let (wire, read) = settled(settle, before: before, job: job, actionAt: actionAt, tapAt: tapAt)
            out["settle"] = wire
            last = read
        }
        switch request.read {
        case "hash", "tree":
            let start = Date()
            var c = try last.flatMap { $0.windows.isEmpty ? nil : $0 } ?? capture(job: job)
            hideUnreachableCopies(&c)
            remember(c)
            out["hash"] = c.hash
            if request.read == "tree" {
                out["tree"] = treeJSON(c, elapsedMs: Int(Date().timeIntervalSince(start) * 1000))
            }
        default: break
        }
        return out
    }

    /// The settle an action asked for: what it answers, and its last read.
    private func settled(_ settle: SettleRequest, before: [Node]?, job: Job, actionAt: Int,
                         tapAt: (x: Double, y: Double)?) -> (Wire, Capture?) {
        var quiet = settle.quietMs
        var inert = false
        if let tapAt, let before, !actionable(before, x: Int(tapAt.x), y: Int(tapAt.y)) {
            quiet = min(quiet, SettleTimes.inertQuietMs)
            inert = true
        }
        // an alert or sheet that came up during the settle is still animating in: a tap on it then is
        // lost, so the screen counts as busy for its appear animation
        var alertSince: Date? = before.flatMap { hasAlert($0) ? Date.distantPast : nil }
        let read = { () -> Capture in
            var c = (try? self.capture(job: job)) ?? Capture(windows: [], nodes: [], truncated: true, busy: true)
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
        let probe = SettleProbe(read: read, same: { sameLayout($0.nodes, $1.nodes) }, busy: { $0.busy },
                                cancelled: { job.over })
        let outcome = settler.run(actionAt: actionAt, quietMs: quiet, maxMs: settle.maxMs, before: seen, probe: probe)
        var last: Capture? = outcome.last
        var settled = outcome.settled
        var ms = outcome.elapsedMs
        var reads = outcome.reads
        var idleMs = 0
        // an actionable tap that changed nothing in the app may have asked the system for something (a
        // permission): its alert comes from the home screen app a moment later, while the app is idle
        if tapAt != nil, !inert, let before {
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
        guard sameLayout(before, now.nodes), !hasAlert(now.nodes) else { return (0, false) }
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
        return (Int(Date().timeIntervalSince(idleAt) * 1000), !sameLayout(before, now.nodes) || hasAlert(now.nodes))
    }
}
