import Foundation

// A request as the host sends it. `RpcClient.call` parses its params by the protocol's schema, so a value with a
// default is always here and the runner has none of its own; one that is missing is the caller's INVALID_ARGUMENT.
// The unit tests read the protocol's fixtures through these.

public typealias Wire = [String: Any]

func required<T>(_ p: Wire, _ key: String) throws -> T {
    guard let v = p[key] as? T else { throw AgentError("INVALID_ARGUMENT", "\(key) is required") }
    return v
}

public func requiredNumber(_ p: Wire, _ key: String) throws -> Double { (try required(p, key) as NSNumber).doubleValue }

public func requiredInt(_ p: Wire, _ key: String) throws -> Int { (try required(p, key) as NSNumber).intValue }

public func requiredString(_ p: Wire, _ key: String) throws -> String { try required(p, key) }

/// The requests that carry one value.
public enum OneValue {
    public static func text(_ p: Wire) throws -> String { try requiredString(p, "text") }

    public static func pkg(_ p: Wire) throws -> String { try requiredString(p, "pkg") }

    public static func rotation(_ p: Wire) throws -> Int { try requiredInt(p, "rotation") }

    public static func id(_ p: Wire) throws -> Int { try requiredInt(p, "id") }

    public static func point(_ p: Wire) throws -> (x: Double, y: Double) { (try requiredNumber(p, "x"), try requiredNumber(p, "y")) }
}

public struct TreeRequest {
    public let maxDepth: Int, maxNodes: Int

    public init(_ p: Wire) throws {
        maxDepth = try requiredInt(p, "maxDepth")
        maxNodes = try requiredInt(p, "maxNodes")
    }
}

public struct SettleRequest {
    public let quietMs: Int, maxMs: Int
}

/// What an action asks for once it is done.
public struct AfterRequest {
    public let settle: SettleRequest?
    public let read: String
    public let before: String?

    public init(_ p: Wire) throws {
        settle = try (p["settle"] as? Wire).map { SettleRequest(quietMs: try requiredInt($0, "quietMs"), maxMs: try requiredInt($0, "maxMs")) }
        read = try requiredString(p, "read")
        before = p["before"] as? String
    }
}

public enum Action {
    public typealias Sample = (x: Double, y: Double, t: Double)

    case tap(x: Double, y: Double)
    case doubleTap(x: Double, y: Double)
    case longPress(x: Double, y: Double, durationMs: Double)
    case swipe(x0: Double, y0: Double, x1: Double, y1: Double, durationMs: Double)
    case gesture(pointers: [[Sample]])
    case key(String, modifiers: [String])

    public init(_ a: Wire) throws {
        func x(_ d: Wire = a) throws -> Double { try requiredNumber(d, "x") }
        func y(_ d: Wire = a) throws -> Double { try requiredNumber(d, "y") }
        switch a["kind"] as? String {
        case "tap": self = .tap(x: try x(), y: try y())
        case "doubleTap": self = .doubleTap(x: try x(), y: try y())
        case "longPress": self = .longPress(x: try x(), y: try y(), durationMs: try requiredNumber(a, "durationMs"))
        case "swipe":
            let from: Wire = try required(a, "from"), to: Wire = try required(a, "to")
            self = .swipe(x0: try x(from), y0: try y(from), x1: try x(to), y1: try y(to), durationMs: try requiredNumber(a, "durationMs"))
        case "gesture":
            let pointers: [[Wire]] = try required(a, "pointers")
            self = .gesture(pointers: try pointers.map { f in
                try f.map { s in (x: try x(s), y: try y(s), t: try requiredNumber(s, "t")) }
            })
        case "key": self = .key(try requiredString(a, "key"), modifiers: a["modifiers"] as? [String] ?? [])
        default: throw AgentError("INVALID_ARGUMENT", "unknown action \(a["kind"] ?? "nil")")
        }
    }

    /// Where a tap landed: only a tap may be inert.
    public var tapPoint: (x: Double, y: Double)? {
        if case let .tap(x, y) = self { return (x, y) }
        return nil
    }
}

public struct TextRequest {
    public let text: String
    public let replace: Bool, submit: Bool
    public let at: (x: Double, y: Double)?
    public let focusTimeoutMs: Int
    public let after: AfterRequest

    public init(_ p: Wire) throws {
        text = try requiredString(p, "text")
        replace = try required(p, "replace")
        submit = try required(p, "submit")
        at = try (p["at"] as? Wire).map { (x: try requiredNumber($0, "x"), y: try requiredNumber($0, "y")) }
        focusTimeoutMs = try requiredInt(p, "focusTimeoutMs")
        after = try AfterRequest(p)
    }
}

public struct KeysRequest {
    public let text: String
    public let into: (x: Double, y: Double)?
    public let focusTimeoutMs: Int

    public init(_ p: Wire) throws {
        text = try requiredString(p, "text")
        into = try (p["into"] as? Wire).map { (x: try requiredNumber($0, "x"), y: try requiredNumber($0, "y")) }
        focusTimeoutMs = try requiredInt(p, "focusTimeoutMs")
    }
}

public struct ShotRequest {
    public let png: Bool
    public let quality: Int
    public let maxPx: Double?

    public init(_ p: Wire) throws {
        png = try requiredString(p, "format") == "png"
        quality = try requiredInt(p, "quality")
        maxPx = (p["maxPx"] as? NSNumber)?.doubleValue
    }
}

public struct AuditRequest {
    public let types: [String]?
    public let maxIssues: Int

    public init(_ p: Wire) throws {
        types = p["types"] as? [String]
        maxIssues = try requiredInt(p, "maxIssues")
    }
}

public struct WaitRequest {
    public let since: String?
    public let timeoutMs: Int, minMs: Int

    public init(_ p: Wire) throws {
        since = p["since"] as? String
        timeoutMs = try requiredInt(p, "timeoutMs")
        minMs = try requiredInt(p, "minMs")
    }
}
