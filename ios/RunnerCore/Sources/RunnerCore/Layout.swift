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
public func box(_ rect: CGRect) -> [Int] {
    guard rect.width.isFinite, rect.height.isFinite else { return [0, 0, 0, 0] }
    return [Int(rect.minX.rounded()), Int(rect.minY.rounded()), Int(rect.maxX.rounded()), Int(rect.maxY.rounded())]
}

/// Node flags, as the protocol numbers them.
public enum Flag {
    public static let visible = 1, clickable = 2, focusable = 4, focused = 8, enabled = 16, checked = 32,
        selected = 64, editable = 128, scrollable = 256, password = 512, checkable = 1024, longClickable = 2048
}

private func shown(_ node: Node) -> Bool {
    node.flags & Flag.visible != 0 && node.right > node.left && node.bottom > node.top
}
private func interactive(_ node: Node) -> Bool {
    node.flags & (Flag.clickable | Flag.editable | Flag.checkable | Flag.scrollable) != 0
}

/// The layout digest: type, id and box of every shown node, texts left out; a plain text node keeps only
/// its vertical place (its width follows its text). FNV-1a 64, hex.
public func layoutHash(_ nodes: [Node]) -> String {
    var h: UInt64 = 0xcbf2_9ce4_8422_2325
    func mix(_ text: String) {
        for unit in text.utf16 {
            h ^= UInt64(unit)
            h = h &* 0x100_0000_01b3
        }
    }
    for node in nodes where shown(node) {
        mix(node.type); mix("#"); mix(node.id ?? "")
        let plainText = !interactive(node) && !(node.text ?? node.label ?? "").isEmpty
        mix(plainText ? "@\(node.top),\(node.bottom)" : "@\(node.left),\(node.top),\(node.right),\(node.bottom)")
        mix(";")
    }
    return String(h, radix: 16)
}

/// All a caller sees of a screen, texts too, unlike the layout digest; `windows` a string each. FNV-1a 64, hex.
public func screenSig(_ nodes: [Node], windows: [String]) -> String {
    var h: UInt64 = 0xcbf2_9ce4_8422_2325
    func mix(_ text: String?) {
        for unit in (text ?? "\0").utf16 {
            h ^= UInt64(unit)
            h = h &* 0x100_0000_01b3
        }
        // a field's end: "ab","c" is not "a","bc"
        h ^= 1
        h = h &* 0x100_0000_01b3
    }
    mix("\(windows.count)")
    for w in windows { mix(w) }
    for node in nodes {
        mix(node.type); mix(node.id); mix(node.text); mix(node.label)
        mix("\(node.left),\(node.top),\(node.right),\(node.bottom),\(node.flags)")
    }
    return String(h, radix: 16)
}

/// Moves up to this many points are no layout change.
public let layoutTolerance = 4

/// The same layout: the same shown nodes (type, id) in order, each within the tolerance of its place.
public func sameLayout(_ one: [Node], _ other: [Node]) -> Bool {
    let ones = one.filter(shown), others = other.filter(shown)
    if ones.count != others.count { return false }
    for (node, match) in zip(ones, others) {
        if node.type != match.type || node.id != match.id { return false }
        func near(_ value: Int, _ target: Int) -> Bool { abs(value - target) <= layoutTolerance }
        if !near(node.top, match.top) || !near(node.bottom, match.bottom) { return false }
        let plainText = !interactive(node) && !(node.text ?? node.label ?? "").isEmpty
        if !plainText && (!near(node.left, match.left) || !near(node.right, match.right)) { return false }
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
    for node in nodes where shown(node) && x >= node.left && x < node.right && y >= node.top && y < node.bottom {
        hit = true
        var ancestor: Node? = node
        while let c = ancestor {
            if c.flags & (Flag.clickable | Flag.longClickable | Flag.editable | Flag.checkable) != 0 { return true }
            if ownDrawing.contains(where: { c.type.contains($0) }) { return true }
            ancestor = c.parent >= 0 ? nodes[c.parent] : nil
        }
    }
    return !hit
}

/// The controls found more than once in the app's window, by index: a control drawn twice (an overlay's spare
/// copy) comes in 2 or 3; an id repeated more is a list's rows.
public func repeatedControls(_ nodes: [Node]) -> [[Int]] {
    var groups: [String: [Int]] = [:]
    for (index, node) in nodes.enumerated() where node.window == 0 && node.flags & Flag.visible != 0 {
        if let id = node.id { groups["\(node.type)#\(id)", default: []].append(index) }
    }
    return groups.values.filter { (2 ... 3).contains($0.count) }
}

/// A toolbar as large as the screen is the system's container, no bar (iOS 27 on a phone: XCUI calls it
/// hittable during a transition and not at rest, so it came and went in the answers).
public func containerBars(_ nodes: [Node], screenW: Int, screenH: Int) -> [Int] {
    nodes.indices.filter { index in
        let node = nodes[index]
        return node.type == "Toolbar" && node.right - node.left >= screenW && node.bottom - node.top >= screenH
    }
}

/// Containers that draw scroll indicators.
private let scrollers: Set<String> = ["ScrollView", "Table", "CollectionView", "WebView", "TextView"]

/**
 * The scroll indicators XCUI reports as elements (a scroll view's bars, labelled "Vertical scroll bar, 2
 * pages" in the system's language): `Other` nodes with no identifier and nothing named inside, a thin
 * strip along a scroll container's right or bottom edge spanning most of it. Told by their shape, never their
 * words; they are no control of the app and only show while it scrolls.
 */
public func scrollIndicators(_ nodes: [Node]) -> [Int] {
    // a node with a named or labelled descendant is the app's (a table's section index), never a bar
    var named = [Bool](repeating: false, count: nodes.count)
    for index in nodes.indices.reversed() where nodes[index].id != nil || nodes[index].label != nil || named[index] {
        let p = nodes[index].parent
        if p >= 0 && p < nodes.count && p < index { named[p] = true }
    }
    let edge = 40, thin = 40
    return nodes.indices.filter { index in
        let node = nodes[index]
        guard node.type == "Other", node.id == nil, !named[index], node.parent >= 0, node.parent < nodes.count else {
            return false
        }
        let p = nodes[node.parent]
        guard scrollers.contains(p.type) else { return false }
        let w = node.right - node.left, h = node.bottom - node.top
        let vertical = w > 0 && w <= thin && h * 2 >= p.bottom - p.top && abs(p.right - node.right) <= edge
        let horizontal = h > 0 && h <= thin && w * 2 >= p.right - p.left && abs(p.bottom - node.bottom) <= edge
        return vertical || horizontal
    }
}
