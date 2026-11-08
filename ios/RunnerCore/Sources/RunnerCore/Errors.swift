import Foundation

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

/// Constant-time comparison of the launch token.
public func sameToken(_ given: String, _ expected: String) -> Bool {
    let x = Array(given.utf8), y = Array(expected.utf8)
    var diff = x.count ^ y.count
    for index in 0 ..< max(x.count, y.count) {
        diff |= Int((index < x.count ? x[index] : 0) ^ (index < y.count ? y[index] : 0))
    }
    return diff == 0
}
