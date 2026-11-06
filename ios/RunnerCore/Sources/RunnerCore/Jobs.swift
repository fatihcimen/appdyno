import Foundation

/// One request's work: run on the main thread in arrival order, stopped by its deadline or a cancel.
public final class Job {
    public let id: Int
    public let method: String
    public let params: Wire
    public let deadline: Date
    private let lock = NSLock()
    private var _cancelled = false

    public init(id: Int, method: String, params: Wire) throws {
        self.id = id
        self.method = method
        self.params = params
        deadline = Date().addingTimeInterval(try requiredNumber(params, "_deadlineMs") / 1000)
    }

    public var cancelled: Bool {
        get { lock.lock(); defer { lock.unlock() }; return _cancelled }
        set { lock.lock(); _cancelled = newValue; lock.unlock() }
    }

    /// True once the caller no longer waits (cancelled, or past its deadline).
    public var over: Bool { cancelled || Date() >= deadline }
}

/// The requests one connection has in flight, kept on the server's one queue. A host's ids start at 1 on each connection,
/// so an id names a job only on its own: one table for the process let a host's cancel stop another's job, and the end of
/// either take both off it.
public final class JobTable {
    private var jobs: [Int: Job] = [:]

    public init() {}

    public func add(_ job: Job) { jobs[job.id] = job }

    public func cancel(_ id: Int) { jobs[id]?.cancelled = true }

    public func remove(_ job: Job) {
        if jobs[job.id] === job { jobs[job.id] = nil }
    }
}
