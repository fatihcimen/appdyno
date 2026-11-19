import UIKit
import XCTest

extension Device {
    /// The app a touch at a point goes to: on the system alert the home screen app's, else the one in front.
    private func app(at x: Double, _ y: Double) -> XCUIApplication {
        alertFrame?.contains(CGPoint(x: x, y: y)) == true ? springboard : front().0
    }

    /// A point on screen, in the app a touch there goes to.
    func point(_ x: Double, _ y: Double) -> XCUICoordinate {
        app(at: x, y).coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: x, dy: y))
    }

    /// UIKit takes no touches while a view animates (a sheet sliding in, a button fading in), and the tree
    /// shows the view where it ends from the start, so the settle cannot see it: a touch first waits for
    /// the app under it to report its animations over. Milliseconds waited (nil: the app cannot say).
    func animationsOver(_ x: Double, _ y: Double) -> Int? {
        IdleShim.waitForAnimations(of: app(at: x, y), within: Device.animationWaitS)
    }

    /// Does the action; what its answer adds: for a touch the milliseconds it first waited for the app's animations,
    /// after which a caller told TIMEOUT or CANCELLED gets no touch, and for a key whether its field shows it and
    /// whether no field had the keyboard focus (`key`).
    func perform(_ action: Action, job: Job) throws -> [String: Any] {
        if case let .key(name, modifiers) = action {
            let (seen, unfocused) = try key(name, modifiers, job: job)
            return (seen.map { ["verified": $0] } ?? [:]).merging(unfocused ? ["noFocus": true] : [:]) { $1 }
        }
        return try touch(action, job: job).map { ["animationWaitMs": $0] } ?? [:]
    }

    private func touch(_ action: Action, job: Job) throws -> Int? {
        let touch = "the touch"
        switch action {
        case let .tap(x, y):
            let waited = animationsOver(x, y)
            try job.stillWaited(before: touch)
            // the synthesizer's tap missed on a turned screen, where XCUI's own coordinate knows the way, as it does
            // on a device lying flat whose turn nothing tells: a phone with a wide app, an iPad
            let upright = touchOrientation() == 1
            if try !upright || !EventShim.tap(CGPoint(x: x, y: y), orientation: 1) { point(x, y).tap() }
            return waited
        case let .doubleTap(x, y):
            let waited = animationsOver(x, y)
            try job.stillWaited(before: touch)
            point(x, y).doubleTap()
            return waited
        case let .longPress(x, y, ms):
            let waited = animationsOver(x, y)
            try job.stillWaited(before: touch)
            point(x, y).press(forDuration: ms / 1000)
            return waited
        case let .swipe(fromX, fromY, toX, toY, ms):
            let waited = animationsOver(fromX, fromY)
            try job.stillWaited(before: touch)
            try drag(fromX, fromY, toX, toY, ms: ms)
            return waited
        case let .gesture(pointers):
            return try perform(gesture: pointers, job: job)
        case .key:
            return nil
        }
    }

    private func perform(gesture pointers: [[Action.Sample]], job: Job) throws -> Int? {
        guard let path = pointers.first, let first = path.first, let last = path.last else {
            throw AgentError("INVALID_ARGUMENT", "pointers need a finger with samples")
        }
        let (fromX, fromY, toX, toY) = (first.x, first.y, last.x, last.y)
        if pointers.count == 1, path.count <= 2 {
            let ms = max(20, last.t - first.t)
            let waited = animationsOver(fromX, fromY)
            try job.stillWaited(before: "the touch")
            if fromX == toX, fromY == toY {
                point(fromX, fromY).press(forDuration: ms / 1000)
            } else {
                try drag(fromX, fromY, toX, toY, ms: ms)
            }
            return waited
        }
        let plan = try gestureTimeline(pointers)
        guard EventShim.gestureAvailable else { throw Self.noSynthesizer(pointers, path) }
        // XCUI has no gesture of many fingers to fall back on: a wide app on a phone lying flat stands either way, and
        // any app on an iPad lying flat
        guard let turn = touchOrientation() else {
            throw AgentError(
                "UNSUPPORTED",
                "this device lies flat, so which way its screen stands is not known: stand it up"
            )
        }
        let waited = animationsOver(fromX, fromY)
        try job.stillWaited(before: "the gesture")
        guard try EventShim.gesture(plan.fingers, liftAt: plan.liftAt, orientation: turn) else {
            throw AgentError(
                "UNSUPPORTED",
                "XCTest's event synthesizer refused a gesture of \(pointers.count) fingers and \(path.count) samples"
            )
        }
        return waited
    }

    private static func noSynthesizer(_ pointers: [[Action.Sample]], _ path: [Action.Sample]) -> AgentError {
        AgentError(
            "UNSUPPORTED",
            "this XCTest has no event synthesizer for a gesture of \(pointers.count) fingers and \(path.count) samples"
        )
    }

    private func drag(_ fromX: Double, _ fromY: Double, _ toX: Double, _ toY: Double, ms: Double) throws {
        let distance = hypot(toX - fromX, toY - fromY)
        let velocity = XCUIGestureVelocity(max(1, distance / max(0.02, ms / 1000)))
        point(fromX, fromY).press(forDuration: 0.05, thenDragTo: point(toX, toY), withVelocity: velocity,
                                  thenHoldForDuration: 0)
    }

    /// A key of a hardware keyboard, by XCTest's words for it.
    private static let keyboard: [String: XCUIKeyboardKey] = [
        "escape": .escape, "space": .space, "enter": .enter, "delete": .delete, "tab": .tab,
        "arrowUp": .upArrow, "arrowDown": .downArrow, "arrowLeft": .leftArrow, "arrowRight": .rightArrow
    ]

    private static let held: [String: XCUIElement.KeyModifierFlags] = [
        "command": .command, "control": .control, "option": .option, "shift": .shift
    ]

    /// A key by XCTest's keyboard. Its first key to an app that just started comes without its modifiers, and its next
    /// ones keep them (live: command+a selected nothing, shift+arrow moved the cursor alone): a key no app takes goes
    /// first, once for each process. On a hosted Mac the key after it still came so, which `pressSeen` reads back.
    func typeKey(_ key: String, _ flags: XCUIElement.KeyModifierFlags, in app: XCUIApplication) {
        let pid = app.responds(to: NSSelectorFromString("processID")) ? app.value(forKey: "processID") as? Int : nil
        if !flags.isEmpty, pid == nil || pid != keyedPid {
            NSLog("appdyno runner: a first key to pid %d before one with a modifier", pid ?? -1)
            app.typeKey(XCUIKeyboardKey.F19.rawValue, modifierFlags: [])
        }
        app.typeKey(key, modifierFlags: flags)
        keyedPid = pid
    }

    /**
     * A key of the keyboard, read back on a simulator (`readsKeys`) from the field with the focus where what it does
     * can be (`pressSeen`): true once the field shows it, false where it shows nothing of it or shows it otherwise, nil
     * where that cannot be read. A plain letter or digit into a field goes as typed text, which the keyboard does not
     * capitalize: its shift stays on for a while after text typed into an empty field, and a hardware key then came as
     * a capital ("acX" of x). With it, whether no field had the keyboard focus as it went. A button of the device's own
     * is pressed as it is.
     */
    private func key(_ name: String, _ modifiers: [String], job: Job) throws -> (seen: Bool?, unfocused: Bool) {
        // XCTest's delete does nothing with a modifier held, and typed as text it deletes one character whatever is
        // held (live: option+delete left the word, or took a letter of it)
        if name == "delete", !modifiers.isEmpty {
            throw AgentError(
                "UNSUPPORTED",
                "XCTest sends no delete with \(modifiers.joined(separator: "+")) held",
                hint: "select what to delete first (shift+option+arrow_left takes a word, shift+command+arrow_left "
                    + "the line), then press delete"
            )
        }
        guard Device.keyboard[name] != nil || name.count == 1 else {
            try press(name)
            return (nil, false)
        }
        let app = front().0
        guard Device.readsKeys else {
            try send(name, Set(modifiers), in: app)
            return (nil, false)
        }
        // the first read is the one before the key
        var focused: Bool?
        let pressed = try pressSeen(name, Set(modifiers), waitS: Device.echoWaitS, PressProbe(
            send: { key, held in try self.send(key, held, in: app) },
            read: {
                let (field, state) = self.keyState(app)
                focused = focused ?? field
                return state
            },
            clock: { Date().timeIntervalSince1970 }, pause: { Thread.sleep(forTimeInterval: $0) },
            over: { job.over }))
        if pressed.seen == false || pressed.sent > 1 {
            NSLog("appdyno runner: %@ went %d times, and its field %@", (modifiers + [name]).joined(separator: "+"),
                  pressed.sent, pressed.seen == true ? "shows it" : "does not show it")
        }
        return (pressed.seen, focused == false)
    }

    /// Whether keys are read back (`key`): on a simulator. shortcut: a phone's go as before, unread, as no run on a
    /// phone has proven the read-back there; read them back once one has.
    #if targetEnvironment(simulator)
    static let readsKeys = true
    #else
    static let readsKeys = false
    #endif

    /// One key: a plain letter or digit as typed text where keys are read back and a field has the focus, Enter, delete
    /// and tab by XCTest's synthesizer, any other by its keyboard.
    private func send(_ name: String, _ modifiers: Set<String>, in app: XCUIApplication) throws {
        let flags = modifiers.reduce(into: XCUIElement.KeyModifierFlags()) { $0.formUnion(Device.held[$1] ?? []) }
        let typed = Device.readsKeys && flags.isEmpty && name.count == 1 && focusedField(app) != nil
        if typed, try EventShim.type(name, orientation: Device.keysOrientation()) { return }
        if !flags.isEmpty || name.count == 1
            || ["escape", "space", "arrowUp", "arrowDown", "arrowLeft", "arrowRight"].contains(name) {
            typeKey(Device.keyboard[name]?.rawValue ?? name, flags, in: app)
            return
        }
        if name == "enter" {
            // synthesized: XCUI's typing refuses when no element reports the focus
            if try !EventShim.type("\n", orientation: Device.keysOrientation()) { try typeFocused("\n", app) }
            return
        }
        // nothing takes delete or tab with no field focused and no keyboard up (a hidden code field has the keyboard)
        guard focusedField(app) != nil || app.keyboards.firstMatch.exists else { throw Device.noFocus }
        let text = name == "tab" ? "\t" : XCUIKeyboardKey.delete.rawValue
        if try !EventShim.type(text, orientation: Device.keysOrientation()) { try typeFocused(text, app) }
    }

    private static let noFocus = AgentError("NO_FOCUS", "no field has the focus and no keyboard is up",
                                            hint: "tap the field first")

    /// XCUI's typing, where the synthesizer takes no text: with no element focused it fails the runner's own test,
    /// which ends it (live: `delete` on a screen with no field).
    private func typeFocused(_ text: String, _ app: XCUIApplication) throws {
        guard focusedField(app) != nil else { throw Device.noFocus }
        app.typeText(text)
    }

    /// A key that is a button of the device's own.
    private func press(_ name: String) throws {
        switch name {
        case "home": XCUIDevice.shared.press(.home)
        case "volumeUp", "volumeDown":
            #if targetEnvironment(simulator)
            throw AgentError("UNSUPPORTED", "a simulator has no \(name) button: XCTest offers it on a phone only")
            #else
            XCUIDevice.shared.press(name == "volumeUp" ? .volumeUp : .volumeDown)
            #endif
        case "mute":
            guard XCUIDevice.shared.hasHardwareButton(.action) else {
                throw AgentError("UNSUPPORTED",
                                 "this iPhone has a mute switch, not an Action button: only a hand moves it")
            }
            XCUIDevice.shared.press(.action)
        case "siri":
            throw AgentError("UNSUPPORTED", "Siri is the side button held, which XCTest cannot press on a phone",
                             hint: "appdyno mirror presses it")
        case "lock", "power":
            let press = NSSelectorFromString("pressLockButton")
            guard XCUIDevice.shared.responds(to: press) else {
                throw AgentError("UNSUPPORTED", "this XCTest cannot press the lock button (it has no pressLockButton)")
            }
            _ = XCUIDevice.shared.perform(press)
        default: throw AgentError("UNSUPPORTED", "no \(name) key on iOS", hint: "tap the screen's own back control")
        }
    }
}
