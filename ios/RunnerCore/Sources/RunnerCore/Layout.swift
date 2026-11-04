import CoreGraphics
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

public extension Node {
    var box: [Int] { [left, top, right, bottom] }

    /// One copy of a control: its type, id and place.
    var copyKey: String { "\(type)#\(id ?? "")@\(box)" }
}

/// A frame as a tree gives it: [left, top, right, bottom], whole numbers; nothing finite to say is no box.
public func box(_ r: CGRect) -> [Int] {
    guard r.width.isFinite, r.height.isFinite else { return [0, 0, 0, 0] }
    return [Int(r.minX.rounded()), Int(r.minY.rounded()), Int(r.maxX.rounded()), Int(r.maxY.rounded())]
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

/// All a caller sees of a screen, texts too, unlike the layout digest; `windows` a string each. FNV-1a 64, hex.
public func screenSig(_ nodes: [Node], windows: [String]) -> String {
    var h: UInt64 = 0xcbf2_9ce4_8422_2325
    func mix(_ s: String?) {
        for u in (s ?? "\0").utf16 {
            h ^= UInt64(u)
            h = h &* 0x100_0000_01b3
        }
        // a field's end: "ab","c" is not "a","bc"
        h ^= 1
        h = h &* 0x100_0000_01b3
    }
    mix("\(windows.count)")
    for w in windows { mix(w) }
    for n in nodes {
        mix(n.type); mix(n.id); mix(n.text); mix(n.label)
        mix("\(n.left),\(n.top),\(n.right),\(n.bottom),\(n.flags)")
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

/// An alert or a sheet is on the screen.
public func hasAlert(_ nodes: [Node]) -> Bool {
    nodes.contains { ($0.type == "Alert" || $0.type == "Sheet") && $0.flags & Flag.visible != 0 }
}

/// Can a tap at (x, y) start a reaction the screen does not show yet? Yes when any shown node there, or an
/// ancestor of one, is actionable or draws its own content (a web view, a map): a touch passes through
/// a non-interactive overlay. No on plain text and space; without a screen, always yes.
public func actionable(_ nodes: [Node]?, x: Int, y: Int) -> Bool {
    guard let nodes else { return true }
    let ownDrawing = ["WebView", "Map"]
    var hit = false
    for n in nodes where shown(n) && x >= n.left && x < n.right && y >= n.top && y < n.bottom {
        hit = true
        var a: Node? = n
        while let c = a {
            if c.flags & (Flag.clickable | Flag.longClickable | Flag.editable | Flag.checkable) != 0 { return true }
            if ownDrawing.contains(where: { c.type.contains($0) }) { return true }
            a = c.parent >= 0 ? nodes[c.parent] : nil
        }
    }
    return !hit
}

/// The controls found more than once in the app's window, by index: a control drawn twice (an overlay's spare
/// copy) comes in 2 or 3; an id repeated more is a list's rows.
public func repeatedControls(_ nodes: [Node]) -> [[Int]] {
    var groups: [String: [Int]] = [:]
    for (i, n) in nodes.enumerated() where n.window == 0 && n.flags & Flag.visible != 0 {
        if let id = n.id { groups["\(n.type)#\(id)", default: []].append(i) }
    }
    return groups.values.filter { (2 ... 3).contains($0.count) }
}

/// A toolbar as large as the screen is the system's container, no bar (iOS 27 on a phone: XCUI calls it
/// hittable during a transition and not at rest, so it came and went in the answers).
public func containerBars(_ nodes: [Node], screenW: Int, screenH: Int) -> [Int] {
    nodes.indices.filter { i in
        let n = nodes[i]
        return n.type == "Toolbar" && n.right - n.left >= screenW && n.bottom - n.top >= screenH
    }
}

/// Containers that draw scroll indicators.
private let scrollers: Set<String> = ["ScrollView", "Table", "CollectionView", "WebView", "TextView"]

/**
 * The scroll indicators XCUI reports as elements (a scroll view's bars, labelled "Vertical scroll bar, 2
 * pages" in the system's language): `Other` nodes with no identifier and nothing named inside, a thin
 * strip along a scroll container's right or bottom edge spanning most of it. Told by their shape, never their words; they are
 * no control of the app and only show while it scrolls.
 */
public func scrollIndicators(_ nodes: [Node]) -> [Int] {
    // a node with a named or labelled descendant is the app's (a table's section index), never a bar
    var named = [Bool](repeating: false, count: nodes.count)
    for i in nodes.indices.reversed() where nodes[i].id != nil || nodes[i].label != nil || named[i] {
        let p = nodes[i].parent
        if p >= 0 && p < nodes.count && p < i { named[p] = true }
    }
    let edge = 40, thin = 40
    return nodes.indices.filter { i in
        let n = nodes[i]
        guard n.type == "Other", n.id == nil, !named[i], n.parent >= 0, n.parent < nodes.count else { return false }
        let p = nodes[n.parent]
        guard scrollers.contains(p.type) else { return false }
        let w = n.right - n.left, h = n.bottom - n.top
        let vertical = w > 0 && w <= thin && h * 2 >= p.bottom - p.top && abs(p.right - n.right) <= edge
        let horizontal = h > 0 && h <= thin && w * 2 >= p.right - p.left && abs(p.bottom - n.bottom) <= edge
        return vertical || horizontal
    }
}
