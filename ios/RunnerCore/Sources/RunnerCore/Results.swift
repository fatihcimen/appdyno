import Foundation

// The runner's answers as JSON (the unit tests hold them against the protocol's fixtures).

/// What the runner answers a hello with: itself, the device, and its screen.
public struct Hello {
    public let agentVersion: String, osVersion: String, model: String
    public let w: Double, h: Double, density: Double, rotation: Int
    public let pid: Int, idleShimChecked: Bool

    public var wire: Wire {
        ["agentVersion": agentVersion, "protocol": ["major": protocolMajor], "platform": "ios", "osVersion": osVersion,
         "model": model, "screen": ["w": w, "h": h, "density": density, "rotation": rotation], "pid": pid,
         "idleShimChecked": idleShimChecked]
    }
}

public extension Node {
    var wire: Wire {
        var w: Wire = ["p": parent, "w": window, "c": type, "b": [left, top, right, bottom], "f": flags]
        if let id { w["id"] = id }
        if let text { w["t"] = text }
        if let label { w["d"] = label }
        if let hint { w["h"] = hint }
        return w
    }
}

public func treeWire(windows: [Wire], nodes: [Node], truncated: Bool, elapsedMs: Int, hash: String) -> Wire {
    ["windows": windows, "nodes": nodes.map(\.wire), "truncated": truncated, "elapsedMs": elapsedMs, "hash": hash]
}

/// `idleMs`: what was waited past `ms` for a system alert, a wait of the runner's own and no time of the app's.
public func settleWire(settled: Bool, ms: Int, reads: Int, quietMs: Int, idleMs: Int = 0) -> Wire {
    var w: Wire = ["settled": settled, "ms": ms, "reads": reads, "quietMs": quietMs]
    if idleMs > 0 { w["idleMs"] = idleMs }
    return w
}

/// `verified`: no verdict when the field cannot be read back.
public func textWire(focusMs: Int, verified: Bool?) -> Wire {
    var w: Wire = ["mode": "keys", "focusMs": focusMs]
    if let verified { w["verified"] = verified }
    return w
}

public func shotWire(w: Int, h: Int, png: Bool, bytes: Int) -> Wire {
    ["w": w, "h": h, "format": png ? "png" : "jpeg", "bytes": bytes]
}

public func waitWire(sig: String, changed: Bool, reads: Int, elapsedMs: Int, tree: Wire?) -> Wire {
    var w: Wire = ["sig": sig, "changed": changed, "reads": reads, "elapsedMs": elapsedMs]
    if let tree { w["tree"] = tree }
    return w
}

public func auditIssueWire(type: String, message: String, box: [Int]?, element: Wire?) -> Wire {
    var w: Wire = ["type": type, "rule": "XCUIAccessibilityAuditType.\(type)", "message": message]
    if let box { w["b"] = box }
    if let element { w["element"] = element }
    return w
}
