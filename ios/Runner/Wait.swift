import Foundation

extension Device {
    /// `wait`: reads as `tree.get` does until the screen differs from the digest the caller holds.
    func wait(_ w: WaitRequest, job: Job) throws -> [String: Any] {
        var readMs = 0
        let outcome = try settler.waitForChange(
            w,
            stop: {
                if job.cancelled { return AgentError("CANCELLED", "wait was cancelled") }
                return job.over ? AgentError("TIMEOUT", "wait passed its deadline") : nil
            },
            read: { () throws -> Capture in
                let start = Date()
                var c = try capture(job: job)
                hideUnreachableCopies(&c)
                remember(c)
                readMs = Int(Date().timeIntervalSince(start) * 1000)
                return c
            },
            sig: { c in
                screenSig(c.nodes, windows: c.windows.map { w in
                    ["type", "pkg", "layer", "b", "active", "focused"].map { "\(w[$0] ?? "")" }.joined(separator: "|")
                })
            })
        return waitWire(sig: outcome.sig, changed: outcome.changed, reads: outcome.reads, elapsedMs: outcome.elapsedMs,
                        tree: outcome.last.map { treeJSON($0, elapsedMs: readMs) })
    }
}
