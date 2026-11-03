import Foundation

extension Device {
    /// `wait`: reads as `tree.get` does until the screen differs from the digest the caller holds.
    func wait(_ p: [String: Any], job: Job) throws -> [String: Any] {
        var readMs = 0
        let r = try waitForChange(
            since: p["since"] as? String,
            timeoutMs: (p["timeoutMs"] as? NSNumber)?.intValue ?? 5000,
            minMs: (p["minMs"] as? NSNumber)?.intValue ?? 300,
            clock: { Int(Date().timeIntervalSince1970 * 1000) },
            sleep: { Thread.sleep(forTimeInterval: Double($0) / 1000) },
            stop: {
                if job.cancelled { return AgentError("CANCELLED", "wait was cancelled") }
                return job.over ? AgentError("TIMEOUT", "wait passed its deadline") : nil
            },
            read: { () throws -> Capture in
                let t0 = Date()
                var c = try capture(job: job)
                hideUnreachableCopies(&c)
                remember(c)
                readMs = Int(Date().timeIntervalSince(t0) * 1000)
                return c
            },
            sig: { c in
                screenSig(c.nodes, windows: c.windows.map { w in
                    ["type", "pkg", "layer", "b", "active", "focused"].map { "\(w[$0] ?? "")" }.joined(separator: "|")
                })
            })
        var out: [String: Any] = ["sig": r.sig, "changed": r.changed, "reads": r.reads, "elapsedMs": r.elapsedMs]
        if let c = r.last { out["tree"] = treeJSON(c, elapsedMs: readMs) }
        return out
    }
}
