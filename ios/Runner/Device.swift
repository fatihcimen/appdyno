import UIKit
import XCTest

/// The device side of every method, on top of public XCUI API. Coordinates are points.
final class Device {
    static let springboardId = "com.apple.springboard"
    let springboard = XCUIApplication(bundleIdentifier: Device.springboardId)
    private(set) var target: XCUIApplication?
    private var targetId: String?
    /// Recent captures by layout digest: what `before` names (compare and hit test).
    private var recent: [(hash: String, nodes: [Node])] = []
    private let settler = Settler(clock: { Int(Date().timeIntervalSince1970 * 1000) },
                                  sleep: { Thread.sleep(forTimeInterval: Double($0) / 1000) })
    static let inertQuietMs = 80
    /// How long an alert or sheet takes to come up (UIKit's presentation is about 0.3–0.4 s).
    static let alertAppearS = 0.45

    static func hasAlert(_ nodes: [Node]) -> Bool {
        nodes.contains { ($0.type == "Alert" || $0.type == "Sheet") && $0.flags & Flag.visible != 0 }
    }

    func setTarget(_ id: String) {
        targetId = id
        target = XCUIApplication(bundleIdentifier: id)
    }

    /// The app on screen: the target when it is in front, else the home screen.
    private func front() -> (XCUIApplication, String) {
        if let target, let targetId, target.state == .runningForeground { return (target, targetId) }
        return (springboard, Device.springboardId)
    }

    // MARK: tree

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
        let screen = UIScreen.main.bounds
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
        do { snap = try app.snapshot() } catch {
            throw AgentError("APP_NOT_RUNNING", "the screen could not be read: \(error.localizedDescription)")
        }
        windows.append(["type": 1, "pkg": id, "layer": 0, "b": Device.rect(snap.frame), "active": true, "focused": true])
        add(snap, window: 0)
        // `exists` answers at once; a snapshot of a missing element waits for it to appear
        let alertQuery = springboard.alerts.firstMatch
        alertFrame = nil
        if app !== springboard, alertQuery.exists, let alert = try? alertQuery.snapshot() {
            alertFrame = alert.frame
            // a system alert (permission, notification prompt) over the app
            windows.append(["type": 3, "pkg": Device.springboardId, "layer": 1, "b": Device.rect(alert.frame),
                            "active": false, "focused": false])
            add(alert, window: 1)
        }
        return Capture(windows: windows, nodes: nodes, truncated: truncated, busy: busy)
    }

    func remember(_ c: Capture) {
        let h = c.hash
        recent.removeAll { $0.hash == h }
        recent.append((h, c.nodes))
        if recent.count > 8 { recent.removeFirst() }
    }

    func treeJSON(_ c: Capture, elapsedMs: Int) -> [String: Any] {
        ["windows": c.windows, "nodes": c.nodes.map(Device.wire), "truncated": c.truncated,
         "elapsedMs": elapsedMs, "hash": c.hash]
    }

    // MARK: actions

    /// The frame of the system alert in the last read, if one was over the app.
    private var alertFrame: CGRect?

    /// A point on screen; on the system alert it is the home screen app's (events on the alert are its).
    private func point(_ x: Double, _ y: Double) -> XCUICoordinate {
        let onAlert = alertFrame?.contains(CGPoint(x: x, y: y)) == true
        let app = onAlert ? springboard : front().0
        return app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: x, dy: y))
    }

    func perform(_ a: [String: Any]) throws {
        func num(_ k: String, _ d: [String: Any] = a) throws -> Double {
            guard let v = (d[k] as? NSNumber)?.doubleValue else { throw AgentError("INVALID_ARGUMENT", "\(k) is required") }
            return v
        }
        switch a["kind"] as? String {
        case "tap":
            let x = try num("x"), y = try num("y")
            if !EventShim.tap(CGPoint(x: x, y: y), orientation: Device.interfaceOrientation()) { point(x, y).tap() }
        case "longPress":
            point(try num("x"), try num("y")).press(forDuration: try num("durationMs") / 1000)
        case "swipe":
            guard let f = a["from"] as? [String: Any], let t = a["to"] as? [String: Any] else {
                throw AgentError("INVALID_ARGUMENT", "from and to are required")
            }
            try drag(try num("x", f), try num("y", f), try num("x", t), try num("y", t), ms: try num("durationMs"))
        case "gesture":
            guard let pointers = a["pointers"] as? [[[String: Any]]], pointers.count == 1, let path = pointers.first,
                  let first = path.first, let last = path.last
            else { throw AgentError("UNSUPPORTED", "only one-finger gestures on iOS for now") }
            let (x0, y0, x1, y1) = (try num("x", first), try num("y", first), try num("x", last), try num("y", last))
            let ms = max(20, try num("t", last) - num("t", first))
            if x0 == x1, y0 == y1 { point(x0, y0).press(forDuration: ms / 1000) } else { try drag(x0, y0, x1, y1, ms: ms) }
        case "key":
            try key(a["key"] as? String ?? "")
        default:
            throw AgentError("INVALID_ARGUMENT", "unknown action \(a["kind"] ?? "nil")")
        }
    }

    private func drag(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double, ms: Double) throws {
        let distance = hypot(x1 - x0, y1 - y0)
        let velocity = XCUIGestureVelocity(max(1, distance / max(0.02, ms / 1000)))
        point(x0, y0).press(forDuration: 0.05, thenDragTo: point(x1, y1), withVelocity: velocity, thenHoldForDuration: 0)
    }

    private func key(_ k: String) throws {
        switch k {
        case "home": XCUIDevice.shared.press(.home)
        case "enter":
            // synthesized: XCUI's typing refuses when no element reports the focus
            if !EventShim.type("\n", orientation: Device.interfaceOrientation()) { front().0.typeText("\n") }
        case "delete": front().0.typeText(XCUIKeyboardKey.delete.rawValue)
        case "tab": front().0.typeText("\t")
        default: throw AgentError("UNSUPPORTED", "no \(k) key on iOS", hint: "tap the screen's own back control")
        }
    }

    // MARK: settle

    /// After an action: settle (when asked) and read what the caller wants.
    func after(_ p: [String: Any], job: Job, actionAt: Int, tapAt: (Double, Double)?) throws -> [String: Any] {
        var out: [String: Any] = [:]
        var last: Capture?
        if let s = p["settle"] as? [String: Any] {
            var quiet = (s["quietMs"] as? NSNumber)?.intValue ?? 200
            let maxMs = (s["maxMs"] as? NSNumber)?.intValue ?? 3000
            let before = (p["before"] as? String).flatMap { h in recent.last { $0.hash == h }?.nodes }
            if let tapAt, let before, !actionable(before, x: Int(tapAt.0), y: Int(tapAt.1)) {
                quiet = min(quiet, Device.inertQuietMs)
            }
            // an alert or sheet that came up during the settle is still animating in: a tap on it then is
            // lost, so the screen counts as busy for its appear animation
            var alertSince: Date? = before.flatMap { Device.hasAlert($0) ? Date.distantPast : nil }
            let r = settler.run(actionAt: actionAt, quietMs: quiet, maxMs: maxMs,
                                before: before.map { Capture(windows: [], nodes: $0, truncated: false, busy: false) },
                                read: { () -> Capture in
                                    var c = (try? self.capture(job: job)) ?? Capture(windows: [], nodes: [], truncated: true, busy: true)
                                    if Device.hasAlert(c.nodes) {
                                        let since = alertSince ?? Date()
                                        alertSince = since
                                        if Date().timeIntervalSince(since) < Device.alertAppearS { c.busy = true }
                                    } else {
                                        alertSince = nil
                                    }
                                    return c
                                },
                                same: { sameLayout($0.nodes, $1.nodes) }, busy: { $0.busy }, cancelled: { job.over })
            last = r.last
            out["settle"] = ["settled": r.settled, "ms": r.elapsedMs, "reads": r.reads, "quietMs": quiet]
        }
        switch p["read"] as? String ?? "none" {
        case "hash", "tree":
            let t0 = Date()
            let c = try last.flatMap { $0.windows.isEmpty ? nil : $0 } ?? capture(job: job)
            remember(c)
            out["hash"] = c.hash
            if p["read"] as? String == "tree" { out["tree"] = treeJSON(c, elapsedMs: Int(Date().timeIntervalSince(t0) * 1000)) }
        default: break
        }
        return out
    }

    // MARK: text

    /**
     * The field with the keyboard focus, held by a query that still finds it after the focus moves on (a
     * code entry submits itself when it is full): its identifier when it has one, else the focus query.
     */
    func focusedField(_ app: XCUIApplication) -> XCUIElement? {
        let f = app.descendants(matching: .any).matching(NSPredicate(format: "hasKeyboardFocus == true")).firstMatch
        guard let snap = try? f.snapshot() else { return nil }
        if !snap.identifier.isEmpty {
            return app.descendants(matching: snap.elementType).matching(identifier: snap.identifier).firstMatch
        }
        return f
    }

    /// The field's text; a field showing its placeholder is empty.
    /// The field's text from a snapshot (nil when it is gone); a field showing its placeholder is empty.
    private func currentText(_ f: XCUIElement) -> String? {
        guard let s = try? f.snapshot() else { return nil }
        let v = (s.value as? String) ?? ""
        return v == s.placeholderValue ? "" : v
    }

    func setText(_ p: [String: Any], job: Job) throws -> [String: Any] {
        guard let text = p["text"] as? String else { throw AgentError("INVALID_ARGUMENT", "text is required") }
        let t0 = Date()
        let app = front().0
        if let at = p["at"] as? [String: Any], let x = (at["x"] as? NSNumber)?.doubleValue, let y = (at["y"] as? NSNumber)?.doubleValue {
            // a field that already has the focus there is not tapped again (each event costs about 350 ms)
            let focused = focusedField(app)
            if focused == nil || !(focused!.frame.contains(CGPoint(x: x, y: y))) { point(x, y).tap() }
        }
        let timeout = Double((p["focusTimeoutMs"] as? NSNumber)?.intValue ?? 2000) / 1000
        var field = focusedField(app)
        while field == nil, Date().timeIntervalSince(t0) < timeout, !job.over {
            Thread.sleep(forTimeInterval: 0.08)
            field = focusedField(app)
        }
        let focusMs = Int(Date().timeIntervalSince(t0) * 1000)
        guard let field else {
            // no element reports the focus (a code entry's hidden field): the keys go to whatever has the
            // keyboard, as a person's would (XCUI's own typing refuses without a focused element); the text
            // cannot be read back
            let o = Device.interfaceOrientation()
            if !EventShim.type(text, orientation: o) {
                guard app.keyboards.firstMatch.exists else {
                    throw AgentError("NO_FOCUS", "no text field took the focus", hint: "tap the field first")
                }
                app.typeText(text)
            }
            if p["submit"] as? Bool == true, !EventShim.type("\n", orientation: o) { app.typeText("\n") }
            var out = try after(p, job: job, actionAt: Int(Date().timeIntervalSince1970 * 1000), tapAt: nil)
            out["mode"] = "keys"
            out["verified"] = false
            out["focusMs"] = focusMs
            return out
        }
        let replace = p["replace"] as? Bool == true
        let before = currentText(field) ?? ""
        // nil: the field is gone (a code entry that submitted itself took the text)
        func check() -> Bool? {
            guard let now = currentText(field) else { return nil }
            return replace ? now == text : now == before + text || now.contains(text)
        }
        // paste first (one event for the whole text), keys when the field did not take it
        var mode = "paste"
        let saved = UIPasteboard.general.string
        UIPasteboard.general.string = text
        // on a phone the runner (not the app in front) cannot reach the clipboard: keys then, at once
        let pasteable = UIPasteboard.general.string == text
        // a field that just took the focus may not take key commands before its keyboard is up
        let keyboard = app.keyboards.firstMatch
        let kbEnd = Date().addingTimeInterval(pasteable ? 1 : 0)
        while !keyboard.exists, Date() < kbEnd, !job.over { Thread.sleep(forTimeInterval: 0.05) }
        var verified: Bool? = false
        for _ in 0 ..< (pasteable ? 2 : 0) where verified == false {
            guard field.exists else { verified = nil; break }
            if replace { field.typeKey("a", modifierFlags: .command) }
            field.typeKey("v", modifierFlags: .command)
            verified = check()
            // a paste that changed nothing is tried once more; one that changed the text is not repeated
            if verified == false, currentText(field) != before { break }
        }
        if let saved { UIPasteboard.general.string = saved } else { UIPasteboard.general.items = [] }
        if verified == false, field.exists {
            mode = "keys"
            let now = currentText(field) ?? ""
            let extra = replace ? now.count : max(0, now.count - before.count)
            if extra > 0 { field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: extra)) }
            if replace, let left = currentText(field), !left.isEmpty {
                field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: left.count))
            }
            if field.exists { field.typeText(text) }
            verified = check()
        }
        // a field that is gone has taken the text and submitted it already
        if p["submit"] as? Bool == true, field.exists { field.typeText("\n") }
        var out = try after(p, job: job, actionAt: Int(Date().timeIntervalSince1970 * 1000), tapAt: nil)
        out["mode"] = mode
        out["verified"] = verified ?? false
        out["focusMs"] = focusMs
        return out
    }

    // MARK: screen

    func screenshot(_ p: [String: Any]) throws -> Reply {
        let shot = XCUIScreen.main.screenshot()
        var image = shot.image
        if let maxPx = (p["maxPx"] as? NSNumber)?.doubleValue {
            let px = CGSize(width: image.size.width * image.scale, height: image.size.height * image.scale)
            let k = maxPx / max(px.width, px.height)
            if k < 1 {
                let size = CGSize(width: (px.width * k).rounded(), height: (px.height * k).rounded())
                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                image = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
            }
        }
        let png = p["format"] as? String == "png"
        let q = Double((p["quality"] as? NSNumber)?.intValue ?? 80) / 100
        guard let data = png ? image.pngData() : image.jpegData(compressionQuality: q) else {
            throw AgentError("INTERNAL", "the screenshot could not be encoded")
        }
        let w = Int(image.size.width * image.scale), h = Int(image.size.height * image.scale)
        return Reply(result: ["w": w, "h": h, "format": png ? "png" : "jpeg", "bytes": data.count], binary: data)
    }

    func foreground() -> [String: Any] {
        let (_, id) = front()
        return ["pkg": id]
    }

    /// UIInterfaceOrientation of the device now (portrait 1, upside down 2, landscape right 3, left 4).
    static func interfaceOrientation() -> Int {
        switch XCUIDevice.shared.orientation {
        case .portraitUpsideDown: return 2
        case .landscapeLeft: return 4 // the device turned left shows the interface turned right
        case .landscapeRight: return 3
        default: return 1
        }
    }

    func orientation(_ r: Int) {
        XCUIDevice.shared.orientation = [.portrait, .landscapeLeft, .portraitUpsideDown, .landscapeRight][r & 3]
    }

    // MARK: mapping

    static func rect(_ r: CGRect) -> [Int] {
        guard r.width.isFinite, r.height.isFinite else { return [0, 0, 0, 0] }
        return [Int(r.minX.rounded()), Int(r.minY.rounded()), Int(r.maxX.rounded()), Int(r.maxY.rounded())]
    }

    private static let clickableTypes: Set<XCUIElement.ElementType> = [
        .button, .cell, .link, .tab, .menuItem, .segmentedControl, .switch, .toggle, .slider, .stepper, .picker,
        .pickerWheel, .key, .icon, .incrementArrow, .decrementArrow, .radioButton, .checkBox, .popUpButton,
        .menuButton, .disclosureTriangle, .pageIndicator,
    ]
    private static let editableTypes: Set<XCUIElement.ElementType> = [.textField, .secureTextField, .searchField, .textView]
    private static let scrollableTypes: Set<XCUIElement.ElementType> = [.scrollView, .table, .collectionView, .webView]
    private static let checkableTypes: Set<XCUIElement.ElementType> = [.switch, .toggle, .checkBox]

    static func node(_ s: XCUIElementSnapshot, parent: Int, window: Int, screen: CGRect) -> Node {
        let b = rect(s.frame)
        let t = s.elementType
        var f = 0
        if s.frame.width > 0, s.frame.height > 0, s.frame.intersects(screen) { f |= Flag.visible }
        if clickableTypes.contains(t) { f |= Flag.clickable }
        if editableTypes.contains(t) { f |= Flag.editable | Flag.focusable }
        if s.hasFocus { f |= Flag.focused }
        if s.isEnabled { f |= Flag.enabled }
        if s.isSelected { f |= Flag.selected }
        if scrollableTypes.contains(t) { f |= Flag.scrollable }
        if t == .secureTextField { f |= Flag.password }
        if checkableTypes.contains(t) {
            f |= Flag.checkable
            if (s.value as? String) == "1" || (s.value as? NSNumber)?.intValue == 1 { f |= Flag.checked }
        }
        let value: String? = {
            if let v = s.value as? String { return v }
            if let v = s.value as? NSNumber { return v.stringValue }
            return nil
        }()
        func nonEmpty(_ x: String?) -> String? { x.flatMap { $0.isEmpty ? nil : $0 } }
        let placeholder = nonEmpty(s.placeholderValue)
        return Node(parent: parent, window: window, type: typeName(t), id: nonEmpty(s.identifier),
                    text: value == placeholder ? nil : nonEmpty(value), label: nonEmpty(s.label), hint: placeholder,
                    left: b[0], top: b[1], right: b[2], bottom: b[3], flags: f)
    }

    static func wire(_ n: Node) -> [String: Any] {
        var w: [String: Any] = ["p": n.parent, "w": n.window, "c": n.type, "b": [n.left, n.top, n.right, n.bottom], "f": n.flags]
        if let v = n.id { w["id"] = v }
        if let v = n.text { w["t"] = v }
        if let v = n.label { w["d"] = v }
        if let v = n.hint { w["h"] = v }
        return w
    }

    private static let names: [XCUIElement.ElementType: String] = [
        .any: "Any", .other: "Other", .application: "Application", .group: "Group", .window: "Window",
        .sheet: "Sheet", .drawer: "Drawer", .alert: "Alert", .dialog: "Dialog", .button: "Button",
        .radioButton: "RadioButton", .radioGroup: "RadioGroup", .checkBox: "CheckBox",
        .disclosureTriangle: "DisclosureTriangle", .popUpButton: "PopUpButton", .comboBox: "ComboBox",
        .menuButton: "MenuButton", .toolbarButton: "ToolbarButton", .popover: "Popover", .keyboard: "Keyboard",
        .key: "Key", .navigationBar: "NavigationBar", .tabBar: "TabBar", .tabGroup: "TabGroup", .toolbar: "Toolbar",
        .statusBar: "StatusBar", .table: "Table", .tableRow: "TableRow", .tableColumn: "TableColumn",
        .outline: "Outline", .outlineRow: "OutlineRow", .browser: "Browser", .collectionView: "CollectionView",
        .slider: "Slider", .pageIndicator: "PageIndicator", .progressIndicator: "ProgressIndicator",
        .activityIndicator: "ActivityIndicator", .segmentedControl: "SegmentedControl", .picker: "Picker",
        .pickerWheel: "PickerWheel", .switch: "Switch", .toggle: "Toggle", .link: "Link", .image: "Image",
        .icon: "Icon", .searchField: "SearchField", .scrollView: "ScrollView", .scrollBar: "ScrollBar",
        .staticText: "StaticText", .textField: "TextField", .secureTextField: "SecureTextField",
        .datePicker: "DatePicker", .textView: "TextView", .menu: "Menu", .menuItem: "MenuItem", .menuBar: "MenuBar",
        .menuBarItem: "MenuBarItem", .map: "Map", .webView: "WebView", .incrementArrow: "IncrementArrow",
        .decrementArrow: "DecrementArrow", .timeline: "Timeline", .ratingIndicator: "RatingIndicator",
        .valueIndicator: "ValueIndicator", .splitGroup: "SplitGroup", .splitter: "Splitter",
        .relevanceIndicator: "RelevanceIndicator", .colorWell: "ColorWell", .helpTag: "HelpTag", .matte: "Matte",
        .dockItem: "DockItem", .ruler: "Ruler", .rulerMarker: "RulerMarker", .grid: "Grid",
        .levelIndicator: "LevelIndicator", .cell: "Cell", .layoutArea: "LayoutArea", .layoutItem: "LayoutItem",
        .handle: "Handle", .stepper: "Stepper", .tab: "Tab", .touchBar: "TouchBar",
    ]

    static func typeName(_ t: XCUIElement.ElementType) -> String { names[t] ?? "Type\(t.rawValue)" }
}
