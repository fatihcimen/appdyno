import UIKit
import XCTest

extension Device {
    /// After an action: settle (when asked) and read what the caller wants.
    func after(_ request: AfterRequest, job: Job, actionAt: Int,
               tapAt: (x: Double, y: Double)?) throws -> [String: Any] {
        var out: [String: Any] = [:]
        var last: Capture?
        if let settle = request.settle {
            var quiet = settle.quietMs
            let before = request.before.flatMap { h in recent.last { $0.hash == h }?.nodes }
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
            let outcome = settler.run(actionAt: actionAt, quietMs: quiet, maxMs: settle.maxMs, before: seen,
                                      probe: SettleProbe(read: read, same: { sameLayout($0.nodes, $1.nodes) },
                                                         busy: { $0.busy }, cancelled: { job.over }))
            last = outcome.last
            var idleMs = 0
            // an actionable tap that changed nothing in the app may have asked the system for something (a
            // permission): its alert comes from the home screen app a moment later, while the app is idle
            if tapAt != nil, !inert, let before { idleMs = watchForAlert(before: before, last: &last, job: job) }
            out["settle"] = settleWire(settled: outcome.settled, ms: outcome.elapsedMs, reads: outcome.reads,
                                       quietMs: quiet, idleMs: idleMs)
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

    /// While the screen is still the one before the tap, waits for a system alert and reads again: the milliseconds
    /// that took, 0 when the screen had changed.
    private func watchForAlert(before: [Node], last: inout Capture?, job: Job) -> Int {
        guard var now = last else { return 0 }
        let idleAt = Date()
        // `before` was sent with its copies hidden, and this read has them still, so that a screen with a copy
        // would never compare as the same
        hideUnreachableCopies(&now)
        guard sameLayout(before, now.nodes), !hasAlert(now.nodes) else { return 0 }
        let end = Date().addingTimeInterval(Double(SettleTimes.alertWatchMs) / 1000)
        while Date() < end, !job.over, !springboard.alerts.firstMatch.exists {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        // read again either way: an in-app change that came during the watch belongs in the answer
        last = (try? capture(job: job)) ?? last
        return Int(Date().timeIntervalSince(idleAt) * 1000)
    }
}
