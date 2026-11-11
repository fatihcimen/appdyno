import UIKit
import XCTest

extension Device {
    /// What the home screen app draws over the app in front, and no read of that app has: a system alert or sheet (a
    /// call's prompt for a link the app opened may come as either; a simulator has no phone to show it), Control Center
    /// (its module grid) and the power-off screen (its slider), by the identifiers iOS 27 gives them.
    static let overTheApp = NSPredicate(format: "elementType IN %@ OR identifier IN %@",
                                        Device.aloneOverTheApp.map(\.rawValue),
                                        ["cc-root-folder-view", "actionSlider"])

    /// What of the home screen app over the app is read as itself, with the touches in its frame: all else it shows is
    /// read whole.
    static let aloneOverTheApp: [XCUIElement.ElementType] = [.alert, .sheet]

    struct Capture {
        var windows: [[String: Any]]
        var nodes: [Node]
        var truncated: Bool
        var busy: Bool
        var hash: String { layoutHash(nodes) }
    }

    /// How long a read waits for XCTest to take an app iOS has in front for running.
    static let startingWaitS = 1.0

    /// The snapshot of `app`, whose id is `id`. A process just started is in iOS's list of apps in front some 300 ms
    /// before XCTest takes it for running, and the list's object of it stays not running: XCTest's own object for the
    /// id is waited for then, up to `startingWaitS` and no longer than the job.
    private func snapshot(of app: XCUIApplication, id: String, job: Job?) throws -> XCUIElementSnapshot {
        do { return try KeyedSnapshot.of(app) ?? app.snapshot() } catch {
            let own = application(id)
            let end = Date().addingTimeInterval(Device.startingWaitS)
            // XCTest's wait runs the main run loop, where the news of the process comes; a sleep would hold it out
            while job?.over != true, Date() < end, !own.wait(for: .runningForeground, timeout: 0.1) {}
            guard own.state != .notRunning, let again = try? KeyedSnapshot.of(own) ?? own.snapshot() else {
                throw AgentError("APP_NOT_RUNNING", "the screen could not be read: \(error.localizedDescription)")
            }
            return again
        }
    }

    private func application(_ id: String) -> XCUIApplication {
        id == Device.springboardId ? springboard : XCUIApplication(bundleIdentifier: id)
    }

    /// The app in front, or `pkg`'s whichever is in front: that read alone, with no alert of the home screen app's.
    func capture(maxDepth: Int = 128, maxNodes: Int = 5000, job: Job? = nil, pkg: String? = nil) throws -> Capture {
        struct Pending {
            let snap: XCUIElementSnapshot
            let parent: Int
            let depth: Int
        }
        let (app, id) = pkg.map { (application($0), $0) } ?? front()
        var windows: [[String: Any]] = []
        var nodes: [Node] = []
        var truncated = false
        var busy = false
        var screen = CGRect.zero
        func add(_ root: XCUIElementSnapshot, window: Int) {
            var queue = [Pending(snap: root, parent: -1, depth: 0)]
            var head = 0
            while head < queue.count {
                let pending = queue[head], snap = pending.snap
                head += 1
                if nodes.count >= maxNodes || job?.over == true { truncated = true; break }
                let index = nodes.count
                let node = Device.node(snap, parent: pending.parent, window: window, screen: screen)
                if snap.elementType == .activityIndicator, node.flags & Flag.visible != 0 { busy = true }
                nodes.append(node)
                if pending.depth + 1 >= maxDepth { if !snap.children.isEmpty { truncated = true }; continue }
                for c in snap.children { queue.append(Pending(snap: c, parent: index, depth: pending.depth + 1)) }
            }
        }
        let snap = try snapshot(of: app, id: id, job: job)
        // the app's frame, not UIScreen's: a runner without a launch screen is told 320 x 480 on a bigger one
        screen = snap.frame
        windows.append(["type": 1, "pkg": id, "layer": 0, "b": box(snap.frame), "active": true, "focused": true])
        add(snap, window: 0)
        // `exists` answers at once; a snapshot of a missing element waits for it to appear
        let overQuery = springboard.descendants(matching: .any).matching(Device.overTheApp).firstMatch
        // a read for another's look leaves the alert a touch goes to and the app's shape as its last read had them
        if pkg == nil { (alertFrame, appFrame) = (nil, snap.frame) }
        if pkg == nil, app !== springboard, overQuery.exists, let over = try? overQuery.snapshot() {
            // a system alert (permission, notification prompt) or sheet alone; Control Center or the power-off screen
            // as all the home screen app shows, as their power and emergency controls lie outside what the query finds
            let alert = Device.aloneOverTheApp.contains(over.elementType)
            let shown = alert ? over : try? KeyedSnapshot.of(springboard) ?? springboard.snapshot()
            if let shown, alert || id != Device.springboardId {
                alertFrame = shown.frame
                windows.append(["type": 3, "pkg": Device.springboardId, "layer": 1, "b": box(shown.frame),
                                "active": false, "focused": false])
                add(shown, window: 1)
            }
        }
        // a scroll view's bars are no control: shown only while it scrolls, they would name the screen's
        // nameless controls differently than the app's own elements do
        for index in scrollIndicators(nodes) { nodes[index].flags &= ~Flag.visible }
        for index in containerBars(nodes, screenW: Int(screen.width), screenH: Int(screen.height)) {
            nodes[index].flags &= ~Flag.visible
        }
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
            for index in c.nodes.indices where known.copies.contains(c.nodes[index].copyKey) {
                c.nodes[index].flags &= ~Flag.visible
            }
            return
        }
        // a layout with no copy asks nothing, and keeps no place among those that did: the reads of a list
        // scrolling pushed out the screen with copies, which then asked again, 144 to 203 ms on a simulator
        let repeated = repeatedControls(c.nodes)
        if repeated.isEmpty { return }
        let app = front().0
        // the home screen's copies are a widget and its icon, or a keyboard on its way: asking of them went to a
        // widget's process, and on an iPhone took 7 s and then did not answer
        if app === springboard { return }
        var hidden: [String] = []
        defer {
            unreachable.removeAll { $0.hash == key }
            unreachable.append((key, hidden))
            if unreachable.count > 8 { unreachable.removeFirst() }
        }
        for idxs in repeated.prefix(4) {
            guard let id = c.nodes[idxs[0]].id else { continue }
            let query = app.descendants(matching: .any).matching(identifier: id)
            for index in 0 ..< min(query.count, 8) {
                let element = query.element(boundBy: index)
                // what it reads may have gone by now, as a keyboard's does as it closes: a snapshot throws where
                // a live element's frame ends the runner
                guard element.exists, !element.isHittable, let snap = try? element.snapshot() else { continue }
                let place = box(snap.frame)
                if let copy = idxs.first(where: { c.nodes[$0].box == place }) {
                    c.nodes[copy].flags &= ~Flag.visible
                    hidden.append(c.nodes[copy].copyKey)
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
                                                AutoreleasingUnsafeMutablePointer<NSError?>?) -> AnyObject?
    private static let selRequest = NSSelectorFromString("requestSnapshotForElement:attributes:parameters:error:")

    static func ask(_ object: AnyObject, _ name: String) -> AnyObject? {
        let sel = NSSelectorFromString(name)
        return object.responds(to: sel) ? object.perform(sel)?.takeUnretainedValue() : nil
    }

    private struct Parts {
        let client: AnyObject
        let request: Request
        let attributes: NSArray
        let parameters: NSDictionary
    }

    /// The accessibility client, its request, the attributes' own names and the parameters; nil where any is missing.
    private static let parts: Parts? = {
        guard let snapshotClass: AnyClass = NSClassFromString("XCElementSnapshot"),
              let client = ask(XCUIDevice.shared, "accessibilityInterface"),
              let map = class_getClassMethod(snapshotClass,
                                             NSSelectorFromString("axAttributesForElementSnapshotKeyPaths:isMacOS:")),
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
        return Parts(client: client, request: unsafeBitCast(method_getImplementation(request), to: Request.self),
                     attributes: attributes, parameters: parameters)
    }()

    static func of(_ app: XCUIApplication) -> XCUIElementSnapshot? {
        guard let p = parts, let process = ask(app, "currentProcess"),
              let element = ask(process, "accessibilityElement")
        else { return nil }
        // an error comes back autoreleased: a plain pointer to it made Swift release it a second time
        var error: NSError?
        guard let result = p.request(p.client, selRequest, element, p.attributes, p.parameters, &error) else {
            return nil
        }
        return ask(result, "rootElementSnapshot") as? XCUIElementSnapshot
    }
}
