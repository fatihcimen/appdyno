import Foundation

/// Where two reads of a screen differ.
public enum Region {
    /// No one part under half the screen holds what differs.
    public static let whole = ""

    private static func kind(_ node: Node) -> String { "\(node.type)#\(node.id ?? "")" }

    /// A node as the layout digest has it.
    private static func key(_ node: Node) -> String {
        let plainText = !interactive(node) && !(node.text ?? node.label ?? "").isEmpty
        return kind(node) + (plainText ? "@\(node.top),\(node.bottom)"
            : "@\(node.left),\(node.top),\(node.right),\(node.bottom)")
    }

    /// The nodes that are not under the one at `holder`: a view comes before what it holds.
    private static func outside(_ nodes: [Node], _ holder: Int) -> [Node] {
        var under = [Bool](repeating: false, count: nodes.count)
        return nodes.indices.filter { index in
            let parent = nodes[index].parent
            under[index] = parent >= 0 && parent < index && (parent == holder || under[parent])
            return !under[index]
        }.map { nodes[$0] }
    }

    /// The shown nodes of `nodes`, by index, that `other` has none of with the same key.
    private static func differ(_ nodes: [Node], _ keys: [String], from other: [Node], _ others: [String]) -> [Int] {
        let there = Set(other.indices.filter { shown(other[$0]) }.map { others[$0] })
        return nodes.indices.filter { shown(nodes[$0]) && !there.contains(keys[$0]) }
    }

    /// The one part of the screen that holds every node which moved, came or went between two reads; `whole` where
    /// there is none, nil where the layouts are the same. It is the lowest view that holds them, itself in place in
    /// both and under half the screen, by its type, id and place. Where that view is the screen, as SwiftUI gives a
    /// row no view of its own, it is the strip across the screen they lie in, under half its height, by their types
    /// and ids and its top and bottom: what else lies in it is not of it.
    public static func between(_ one: [Node], _ other: [Node]) -> String? {
        if sameLayout(one, other) { return nil }
        guard let screen = one.first else { return whole }
        // each node's key once: a real app's screen has a thousand nodes under thirty views
        let keys = one.map(key), others = other.map(key)
        let gone = differ(one, keys, from: other, others), come = differ(other, others, from: one, keys)
        guard let (nodes, names, first) = gone.first.map({ (one, keys, $0) })
            ?? come.first.map({ (other, others, $0) }) else { return whole }
        var holder = nodes[first].parent
        while holder >= 0 {
            if let here = keys.firstIndex(of: names[holder]), let there = others.firstIndex(of: names[holder]),
               sameLayout(outside(one, here), outside(other, there)) {
                let view = one[here]
                if (view.right - view.left) * (view.bottom - view.top) * 2
                    <= (screen.right - screen.left) * (screen.bottom - screen.top) { return names[holder] }
                break
            }
            holder = nodes[holder].parent
        }
        let moved = gone.map { one[$0] } + come.map { other[$0] }
        guard let top = moved.map(\.top).min(), let bottom = moved.map(\.bottom).max(),
              (bottom - top) * 2 <= screen.bottom - screen.top else { return whole }
        let kinds = Set(moved.map(kind))
        func rest(_ nodes: [Node]) -> [Node] {
            nodes.filter { !(kinds.contains(kind($0)) && $0.top >= top && $0.bottom <= bottom) }
        }
        return sameLayout(rest(one), rest(other))
            ? kinds.sorted().joined(separator: ",") + "|\(top),\(bottom)" : whole
    }
}

/// A part of the screen that keeps changing by itself, as a banner that turns: told from a transition by where it is
/// and how long it goes on. Reads that differ under one part only, never `gapMs` between one's end and the next's
/// start, for `cycleMs`, longer than a transition lasts, make it known to cycle, and from then a change under it
/// alone is none: the screen is as still as the rest of it. A change anywhere else is one as before. Not seen moving
/// for `keptMs`, the part is known no longer. The host's settle of a simulator has the same, held by
/// `runner-rules.json`. Time is given, so the logic runs in a unit test.
public struct Cycling {
    /// A slide of a page or a sheet is over well within this.
    public static let cycleMs = 1_000
    /// A banner that steps this far apart leaves the settle its quiet window between two steps.
    public static let gapMs = 300
    public static let keptMs = 30_000
    /// What an action of ours set moving, a row a swipe threw, is over within this: a settle's own cap.
    public static let ownMs = 3_000

    /// Where the reads have kept differing, since when, and when the last of them ended.
    private var moving: String?
    private var since = 0
    private var movedAt = 0
    /// The part known to cycle, and when it was last seen to.
    private var known: String?
    private var knownAt = 0

    public init() {}

    /// Whether a read is the one before it to a settle: `region` is `Region.between` of the two, the read began at
    /// `readAt` and it is `now`. `byItself`: no action of ours set moving what moves now, as none went out lately and
    /// this one throws nothing: only then can reads make a part known.
    public mutating func same(_ region: String?, byItself: Bool, readAt: Int, now: Int) -> Bool {
        guard let region else { return true }
        if region == Region.whole {
            moving = nil
            return false
        }
        if region == known, now - knownAt <= Cycling.keptMs {
            knownAt = now
            return true
        }
        if !byItself { return false }
        if region != moving || readAt - movedAt > Cycling.gapMs {
            moving = region
            since = readAt
        }
        movedAt = now
        if now - since < Cycling.cycleMs { return false }
        known = region
        knownAt = now
        return true
    }
}
