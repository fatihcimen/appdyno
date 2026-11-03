import Foundation

public struct SettleOutcome<S> {
    public let settled: Bool
    public let reads: Int
    public let last: S
    public let elapsedMs: Int
}

/// After an action: read every `pollMs` and call the screen settled once its layout has been still for
/// `quietMs` (no change between reads, nothing busy), at most `maxMs` after the action. The first read
/// is compared with the layout the caller saw before. iOS gives no event stream: the reads decide alone.
public final class Settler {
    let clock: () -> Int
    let sleep: (Int) -> Void
    public var pollMs = 80

    public init(clock: @escaping () -> Int, sleep: @escaping (Int) -> Void) {
        self.clock = clock
        self.sleep = sleep
    }

    public func run<S>(actionAt: Int, quietMs: Int, maxMs: Int, before: S?, read: () -> S,
                       same: (S, S) -> Bool, busy: (S) -> Bool, cancelled: () -> Bool) -> SettleOutcome<S> {
        let deadline = actionAt + maxMs
        var reads = 0
        var last = before
        var changedAt = actionAt
        while true {
            let readStart = clock()
            let next = read()
            reads += 1
            let now = clock()
            // a read shows the layout as it was when it began: stillness is proven up to its start only
            if let prev = last, same(next, prev), !busy(next) {
                // still
            } else {
                changedAt = readStart
            }
            let settled = last != nil && !busy(next) && readStart - changedAt >= quietMs
            last = next
            if settled { return SettleOutcome(settled: true, reads: reads, last: next, elapsedMs: now - actionAt) }
            if cancelled() || now >= deadline {
                return SettleOutcome(settled: false, reads: reads, last: next, elapsedMs: now - actionAt)
            }
            sleep(max(1, min(pollMs, deadline - now)))
        }
    }
}

public struct WaitOutcome<S> {
    public let sig: String
    public let changed: Bool
    public let reads: Int
    public let elapsedMs: Int
    /// The read to answer with; nil when the screen stayed the one `since` named.
    public let last: S?
}

/// Reads every `pollMs` until the screen differs from `since` and `minMs` has passed, at most `timeoutMs`;
/// without `since`, the first read is the answer. `stop` says why the caller no longer waits.
public func waitForChange<S>(since: String?, timeoutMs: Int, minMs: Int, pollMs: Int = 80, clock: () -> Int,
                             sleep: (Int) -> Void, stop: () -> AgentError?, read: () throws -> S,
                             sig: (S) -> String) throws -> WaitOutcome<S> {
    let start = clock()
    var reads = 0
    while true {
        if let e = stop() { throw e }
        let next = try read()
        reads += 1
        let s = sig(next)
        let elapsed = clock() - start
        // a timeout shorter than minMs still tells of the change it saw
        guard let since, s == since || elapsed < min(minMs, timeoutMs) else {
            return WaitOutcome(sig: s, changed: true, reads: reads, elapsedMs: elapsed, last: next)
        }
        if elapsed >= timeoutMs { return WaitOutcome(sig: since, changed: false, reads: reads, elapsedMs: elapsed, last: nil) }
        sleep(max(1, min(pollMs, timeoutMs - elapsed)))
    }
}
