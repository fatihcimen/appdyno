import Foundation
import os

/// The wire's version: `PROTOCOL.major`.
public let protocolMajor = 2

/// The protocol's error codes, in wire order: the JSON-RPC code is -32000 minus the index.
public let errorCodes = [
    "TIMEOUT", "CANCELLED", "DEVICE_GONE", "AGENT_UNAVAILABLE", "AGENT_CONFLICT", "AGENT_VERSION_MISMATCH",
    "UNSUPPORTED", "PERMISSION_REQUIRED", "NOT_FOUND", "NO_FOCUS", "APP_NOT_RUNNING", "POLICY_DENIED",
    "INVALID_ARGUMENT", "STALE", "SCREEN_OFF", "INTERNAL"
]

public struct AgentError: Error {
    public let code: String
    public let message: String
    public let hint: String?

    public init(_ code: String, _ message: String, hint: String? = nil) {
        self.code = errorCodes.contains(code) ? code : "INTERNAL"
        self.message = message
        self.hint = hint
    }

    public var rpcCode: Int { -32000 - (errorCodes.firstIndex(of: code) ?? errorCodes.count - 1) }

    public var json: [String: Any] {
        var data: [String: Any] = ["code": code]
        if let hint { data["hint"] = hint }
        return ["code": rpcCode, "message": message, "data": data]
    }
}

public func unknownMethod(_ method: String) -> AgentError { AgentError("UNSUPPORTED", "unknown method \(method)") }

/// Whether XCTest's event synthesizer did `what`: false where it refused, for XCUI to do instead. With no answer it may
/// have gone through late, and XCUI's would do it twice: TIMEOUT, for the host to read the screen first.
public func synthesized(_ answer: Bool?, _ what: String) throws -> Bool {
    guard let answer else {
        throw AgentError("TIMEOUT", "XCTest's event synthesizer did not answer \(what), which may have gone through",
                         hint: "read the screen to see whether it did before doing it again")
    }
    return answer
}

/// A failure XCTest recorded during a request: the request's error, if the runner lives through it. It may not: on an
/// iPhone a live element's frame read after the element went ended this test, whatever `continueAfterFailure` says, so
/// a request reads by snapshots, which throw.
public enum IssueTrap {
    private static let last = OSAllocatedUnfairLock<String?>(initialState: nil)
    /// Set while a question is asked whose failure is its answer; true once it failed.
    private static let asking = OSAllocatedUnfairLock<Bool?>(initialState: nil)
    public static func take() -> String? { last.withLock { issue in defer { issue = nil }; return issue } }

    /// `question`'s answer, nil where XCTest failed it. That failure goes no further: XCUI marks a hittability it
    /// cannot tell as one that ends the test (an overlay's point on the edge of an iPad in landscape, 8 of 9 reads).
    public static func answer<T>(_ question: () -> T) -> T? {
        asking.withLock { $0 = false }
        let answer = question()
        let failed = asking.withLock { failed in defer { failed = nil }; return failed == true }
        return failed ? nil : answer
    }

    /// Takes an issue XCTest recorded: true where it goes on to XCTest as the request's error, false where it failed a
    /// question, whose answer it is.
    public static func keep(_ issue: String) -> Bool {
        let ofQuestion = asking.withLock { failed in
            if failed != nil { failed = true }
            return failed != nil
        }
        if !ofQuestion { last.withLock { $0 = issue } }
        return !ofQuestion
    }
}

/// Constant-time comparison of the launch token.
public func sameToken(_ given: String, _ expected: String) -> Bool {
    let x = Array(given.utf8), y = Array(expected.utf8)
    var diff = x.count ^ y.count
    for index in 0 ..< max(x.count, y.count) {
        diff |= Int((index < x.count ? x[index] : 0) ^ (index < y.count ? y[index] : 0))
    }
    return diff == 0
}
