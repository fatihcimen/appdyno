import UIKit
import XCTest

extension Device {
    struct Capture {
        var windows: [[String: Any]]
        var nodes: [Node]
        var truncated: Bool
        var busy: Bool
        var hash: String { layoutHash(nodes) }
    }

    func capture(maxDepth: Int = 128, maxNodes: Int = 5000, job: Job? = nil) throws -> Capture {
        let (app, id) = front()
        var windows: [[String: Any]] = []
        var nodes: [Node] = []
        var truncated = false
        var busy = false
        var screen = CGRect.zero
        func add(_ root: XCUIElementSnapshot, window: Int) {
            var queue: [(XCUIElementSnapshot, Int, Int)] = [(root, -1, 0)]
            var head = 0
            while head < queue.count {
                let (s, parent, depth) = queue[head]
                head += 1
                if nodes.count >= maxNodes || job?.over == true { truncated = true; break }
                let index = nodes.count
                let n = Device.node(s, parent: parent, window: window, screen: screen)
                if s.elementType == .activityIndicator, n.flags & Flag.visible != 0 { busy = true }
                nodes.append(n)
                if depth + 1 >= maxDepth { if !s.children.isEmpty { truncated = true }; continue }
                for c in s.children { queue.append((c, index, depth + 1)) }
            }
        }
        let snap: XCUIElementSnapshot
        do { snap = try KeyedSnapshot.of(app) ?? app.snapshot() } catch {
            throw AgentError("APP_NOT_RUNNING", "the screen could not be read: \(error.localizedDescription)")
        }
        // the app's frame, not UIScreen's: a runner without a launch screen is told 320 x 480 on a bigger one
        screen = snap.frame
        windows.append(["type": 1, "pkg": id, "layer": 0, "b": box(snap.frame), "active": true, "focused": true])
        add(snap, window: 0)
        // `exists` answers at once; a snapshot of a missing element waits for it to appear
        let alertQuery = springboard.alerts.firstMatch
        alertFrame = nil
        if app !== springboard, alertQuery.exists, let alert = try? alertQuery.snapshot() {
            alertFrame = alert.frame
            // a system alert (permission, notification prompt) over the app
            windows.append(["type": 3, "pkg": Device.springboardId, "layer": 1, "b": box(alert.frame),
                            "active": false, "focused": false])
            add(alert, window: 1)
        }
        // a scroll view's bars are no control: shown only while it scrolls, they would name the screen's
        // nameless controls differently than the app's own elements do
        for i in scrollIndicators(nodes) { nodes[i].flags &= ~Flag.visible }
        for i in containerBars(nodes, screenW: Int(screen.width), screenH: Int(screen.height)) { nodes[i].flags &= ~Flag.visible }
        return Capture(windows: windows, nodes: nodes, truncated: truncated, busy: busy)
    }

    /**
     * The same control (type and identifier) found more than once: the copies a tap would not reach (drawn
     * under another view, never shown) are marked not visible, so a tool picks the one on screen. Live: a real
     * app's home walkthrough keeps a second bubble with its close button under the header; other drivers report
     * one. XCUI's hittable check decides, only for such duplicates (a few queries).
     */
    func hideUnreachableCopies(_ c: inout Capture) {
        let key = c.hash
        if let known = unreachable.first(where: { $0.hash == key }) {
            for i in c.nodes.indices where known.copies.contains(c.nodes[i].copyKey) {
                c.nodes[i].flags &= ~Flag.visible
            }
            return
        }
        let app = front().0
        // the home screen's copies are a widget and its icon, or a keyboard on its way: asking of them went to a widget's
        // process, and on an iPhone took 7 s and then did not answer
        if app === springboard { return }
        var hidden: [String] = []
        defer {
            unreachable.removeAll { $0.hash == key }
            unreachable.append((key, hidden))
            if unreachable.count > 8 { unreachable.removeFirst() }
        }
        for idxs in repeatedControls(c.nodes).prefix(4) {
            guard let id = c.nodes[idxs[0]].id else { continue }
            let query = app.descendants(matching: .any).matching(identifier: id)
            for k in 0 ..< min(query.count, 8) {
                let e = query.element(boundBy: k)
                // what it reads may have gone by now, as a keyboard's does as it closes: a snapshot throws where
                // a live element's frame ends the runner
                guard e.exists, !e.isHittable, let s = try? e.snapshot() else { continue }
                let r = box(s.frame)
                if let ni = idxs.first(where: { c.nodes[$0].box == r }) {
                    c.nodes[ni].flags &= ~Flag.visible
                    hidden.append(c.nodes[ni].copyKey)
                }
            }
        }
    }

    func remember(_ c: Capture) {
        let h = c.hash
        recent.removeAll { $0.hash == h }
        recent.append((h, c.nodes))
        if recent.count > 8 { recent.removeFirst() }
    }

    func treeJSON(_ c: Capture, elapsedMs: Int) -> [String: Any] {
        treeWire(windows: c.windows, nodes: c.nodes, truncated: c.truncated, elapsedMs: elapsedMs, hash: c.hash)
    }
}

/**
 * An app's snapshot asking XCTest only for what `Device.node` reads, by private XCTest API: Settings' 167 elements took
 * the runner 45-47 ms against 59-60 with all of XCTest's attributes, the same tree, on a simulator. Each part is looked
 * up once and checked; where this XCTest lacks one, or a request fails, the public snapshot is taken.
 */
@MainActor enum KeyedSnapshot {
    /// What `Device.node` reads of a snapshot: a key it reads and this list lacks comes back empty.
    private static let keys = ["identifier", "frame", "value", "label", "elementType", "enabled", "selected",
                               "placeholderValue", "hasFocus", "hasKeyboardFocus"]
    private typealias AttributesOf = @convention(c) (AnyClass, Selector, NSArray, Bool) -> AnyObject?
    private typealias Request = @convention(c) (AnyObject, Selector, AnyObject, NSArray, NSDictionary,
                                                UnsafeMutablePointer<NSError?>?) -> AnyObject?
    private static let selRequest = NSSelectorFromString("requestSnapshotForElement:attributes:parameters:error:")

    private static func ask(_ o: AnyObject, _ name: String) -> AnyObject? {
        let sel = NSSelectorFromString(name)
        return o.responds(to: sel) ? o.perform(sel)?.takeUnretainedValue() : nil
    }

    /// The accessibility client, its request, the attributes' own names and the parameters; nil where any is missing.
    private static let parts: (client: AnyObject, request: Request, attributes: NSArray, parameters: NSDictionary)? = {
        guard let snapshotClass: AnyClass = NSClassFromString("XCElementSnapshot"),
              let client = ask(XCUIDevice.shared, "accessibilityInterface"),
              let map = class_getClassMethod(snapshotClass, NSSelectorFromString("axAttributesForElementSnapshotKeyPaths:isMacOS:")),
              let request = class_getInstanceMethod(object_getClass(client), selRequest),
              let parameters = ask(client, "defaultParameters") as? NSDictionary
        else {
            NSLog("appdyno runner: snapshots ask XCTest for all it reads")
            return nil
        }
        let mapped = unsafeBitCast(method_getImplementation(map), to: AttributesOf.self)(
            snapshotClass, method_getName(map), keys as NSArray, false)
        // an NSSet in Xcode 27.1, which the request refuses
        guard let attributes = (mapped as? NSArray) ?? ((mapped as? NSSet)?.allObjects as NSArray?) else { return nil }
        NSLog("appdyno runner: snapshots ask XCTest for %d attributes", attributes.count)
        return (client, unsafeBitCast(method_getImplementation(request), to: Request.self), attributes, parameters)
    }()

    static func of(_ app: XCUIApplication) -> XCUIElementSnapshot? {
        guard let p = parts, let process = ask(app, "currentProcess"), let element = ask(process, "accessibilityElement")
        else { return nil }
        var error: NSError?
        guard let result = p.request(p.client, selRequest, element, p.attributes, p.parameters, &error) else { return nil }
        return ask(result, "rootElementSnapshot") as? XCUIElementSnapshot
    }
}
