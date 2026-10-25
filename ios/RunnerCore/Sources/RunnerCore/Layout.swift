import Foundation

/// One captured element, the runner's own copy (wire names: c, id, t, d, h, b, f).
public struct Node: Equatable {
    public var parent: Int
    public var window: Int
    public var type: String
    public var id: String?
    public var text: String?
    public var label: String?
    public var hint: String?
    public var left: Int, top: Int, right: Int, bottom: Int
    public var flags: Int

    public init(parent: Int, window: Int, type: String, id: String? = nil, text: String? = nil, label: String? = nil,
                hint: String? = nil, left: Int, top: Int, right: Int, bottom: Int, flags: Int) {
        self.parent = parent; self.window = window; self.type = type; self.id = id; self.text = text
        self.label = label; self.hint = hint; self.left = left; self.top = top; self.right = right
        self.bottom = bottom; self.flags = flags
    }
}

/// Node flags, as the protocol numbers them.
public enum Flag {
    public static let visible = 1, clickable = 2, focusable = 4, focused = 8, enabled = 16, checked = 32,
        selected = 64, editable = 128, scrollable = 256, password = 512, checkable = 1024, longClickable = 2048
}

private func shown(_ n: Node) -> Bool { n.flags & Flag.visible != 0 && n.right > n.left && n.bottom > n.top }
private func interactive(_ n: Node) -> Bool {
    n.flags & (Flag.clickable | Flag.editable | Flag.checkable | Flag.scrollable) != 0
}

/// The layout digest: type, id and box of every shown node, texts left out; a plain text node keeps only
/// its vertical place (its width follows its text). FNV-1a 64, hex.
public func layoutHash(_ nodes: [Node]) -> String {
    var h: UInt64 = 0xcbf2_9ce4_8422_2325
    func mix(_ s: String) {
        for u in s.utf16 {
            h ^= UInt64(u)
            h = h &* 0x100_0000_01b3
        }
    }
    for n in nodes where shown(n) {
        mix(n.type); mix("#"); mix(n.id ?? "")
        let plainText = !interactive(n) && !(n.text ?? n.label ?? "").isEmpty
        mix(plainText ? "@\(n.top),\(n.bottom)" : "@\(n.left),\(n.top),\(n.right),\(n.bottom)")
        mix(";")
    }
    return String(h, radix: 16)
}

/// Moves up to this many points are no layout change.
public let layoutTolerance = 4

/// The same layout: the same shown nodes (type, id) in order, each within the tolerance of its place.
public func sameLayout(_ a: [Node], _ b: [Node]) -> Bool {
    let x = a.filter(shown), y = b.filter(shown)
    if x.count != y.count { return false }
    for (p, q) in zip(x, y) {
        if p.type != q.type || p.id != q.id { return false }
        func near(_ u: Int, _ v: Int) -> Bool { abs(u - v) <= layoutTolerance }
        if !near(p.top, q.top) || !near(p.bottom, q.bottom) { return false }
        let plainText = !interactive(p) && !(p.text ?? p.label ?? "").isEmpty
        if !plainText && (!near(p.left, q.left) || !near(p.right, q.right)) { return false }
    }
    return true
}

/// Can a tap at (x, y) start a reaction the screen does not show yet? Yes on an actionable node (or one
/// inside it) and on anything drawing its own content (a web view, a map); no on plain text and space.
public func actionable(_ nodes: [Node]?, x: Int, y: Int) -> Bool {
    guard let nodes else { return true }
    var deepest = -1
    for (i, n) in nodes.enumerated() where shown(n) && x >= n.left && x < n.right && y >= n.top && y < n.bottom {
        deepest = i
    }
    if deepest < 0 { return true }
    var i = deepest
    let ownDrawing = ["WebView", "Map"]
    while i >= 0 {
        let n = nodes[i]
        if n.flags & (Flag.clickable | Flag.longClickable | Flag.editable | Flag.checkable) != 0 { return true }
        if ownDrawing.contains(where: { n.type.contains($0) }) { return true }
        i = n.parent
    }
    return false
}
