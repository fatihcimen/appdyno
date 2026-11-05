import UIKit
import XCTest

extension Device {
    /// The app a touch at a point goes to: on the system alert the home screen app's, else the one in front.
    private func app(at x: Double, _ y: Double) -> XCUIApplication {
        alertFrame?.contains(CGPoint(x: x, y: y)) == true ? springboard : front().0
    }

    /// A point on screen, in the app a touch there goes to.
    func point(_ x: Double, _ y: Double) -> XCUICoordinate {
        app(at: x, y).coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: x, dy: y))
    }

    /// UIKit takes no touches while a view animates (a sheet sliding in, a button fading in), and the tree
    /// shows the view where it ends from the start, so the settle cannot see it: a touch first waits for
    /// the app under it to report its animations over. Milliseconds waited (nil: the app cannot say).
    func animationsOver(_ x: Double, _ y: Double) -> Int? {
        IdleShim.waitForAnimations(of: app(at: x, y), within: Device.animationWaitS)
    }

    /// Does the action; for a touch, the milliseconds it first waited for the app's animations.
    func perform(_ a: Action) throws -> Int? {
        switch a {
        case let .tap(x, y):
            let waited = animationsOver(x, y)
            if !EventShim.tap(CGPoint(x: x, y: y), orientation: Device.interfaceOrientation()) { point(x, y).tap() }
            return waited
        case let .doubleTap(x, y):
            let waited = animationsOver(x, y)
            point(x, y).doubleTap()
            return waited
        case let .longPress(x, y, ms):
            let waited = animationsOver(x, y)
            point(x, y).press(forDuration: ms / 1000)
            return waited
        case let .swipe(x0, y0, x1, y1, ms):
            let waited = animationsOver(x0, y0)
            try drag(x0, y0, x1, y1, ms: ms)
            return waited
        case let .gesture(pointers):
            guard let path = pointers.first, let first = path.first, let last = path.last else {
                throw AgentError("INVALID_ARGUMENT", "pointers need a finger with samples")
            }
            let (x0, y0, x1, y1) = (first.x, first.y, last.x, last.y)
            if pointers.count == 1, path.count <= 2 {
                let ms = max(20, last.t - first.t)
                let waited = animationsOver(x0, y0)
                if x0 == x1, y0 == y1 { point(x0, y0).press(forDuration: ms / 1000) } else { try drag(x0, y0, x1, y1, ms: ms) }
                return waited
            }
            let plan = try gestureTimeline(pointers)
            guard EventShim.gestureAvailable else {
                throw AgentError("UNSUPPORTED", "this XCTest has no event synthesizer for a gesture of \(pointers.count) fingers and \(path.count) samples")
            }
            let waited = animationsOver(x0, y0)
            guard EventShim.gesture(plan.fingers, liftAt: plan.liftAt, orientation: Device.interfaceOrientation()) else {
                throw AgentError("UNSUPPORTED", "XCTest's event synthesizer refused a gesture of \(pointers.count) fingers and \(path.count) samples")
            }
            return waited
        case let .key(k, modifiers):
            try key(k, modifiers)
            return nil
        }
    }

    private func drag(_ x0: Double, _ y0: Double, _ x1: Double, _ y1: Double, ms: Double) throws {
        let distance = hypot(x1 - x0, y1 - y0)
        let velocity = XCUIGestureVelocity(max(1, distance / max(0.02, ms / 1000)))
        point(x0, y0).press(forDuration: 0.05, thenDragTo: point(x1, y1), withVelocity: velocity, thenHoldForDuration: 0)
    }

    /// A key of a hardware keyboard, by XCTest's words for it.
    private static let keyboard: [String: XCUIKeyboardKey] = [
        "escape": .escape, "space": .space, "enter": .enter, "delete": .delete, "tab": .tab,
        "arrowUp": .upArrow, "arrowDown": .downArrow, "arrowLeft": .leftArrow, "arrowRight": .rightArrow,
    ]

    private static let held: [String: XCUIElement.KeyModifierFlags] = [
        "command": .command, "control": .control, "option": .option, "shift": .shift,
    ]

    private func key(_ k: String, _ modifiers: [String]) throws {
        let flags = modifiers.reduce(into: XCUIElement.KeyModifierFlags()) { $0.formUnion(Device.held[$1] ?? []) }
        if !flags.isEmpty || k.count == 1 || ["escape", "space", "arrowUp", "arrowDown", "arrowLeft", "arrowRight"].contains(k) {
            front().0.typeKey(Device.keyboard[k]?.rawValue ?? k, modifierFlags: flags)
            return
        }
        switch k {
        case "home": XCUIDevice.shared.press(.home)
        case "enter":
            // synthesized: XCUI's typing refuses when no element reports the focus
            if !EventShim.type("\n", orientation: Device.interfaceOrientation()) { front().0.typeText("\n") }
        case "delete": front().0.typeText(XCUIKeyboardKey.delete.rawValue)
        case "tab": front().0.typeText("\t")
        case "volumeUp", "volumeDown":
            #if targetEnvironment(simulator)
            throw AgentError("UNSUPPORTED", "a simulator has no \(k) button: XCTest offers it on a phone only")
            #else
            XCUIDevice.shared.press(k == "volumeUp" ? .volumeUp : .volumeDown)
            #endif
        case "mute":
            guard XCUIDevice.shared.hasHardwareButton(.action) else {
                throw AgentError("UNSUPPORTED", "this iPhone has a mute switch, not an Action button: only a hand moves it")
            }
            XCUIDevice.shared.press(.action)
        case "siri":
            throw AgentError("UNSUPPORTED", "Siri is the side button held, which XCTest cannot press on a phone", hint: "appdyno mirror presses it")
        case "lock", "power":
            let press = NSSelectorFromString("pressLockButton")
            guard XCUIDevice.shared.responds(to: press) else {
                throw AgentError("UNSUPPORTED", "this XCTest cannot press the lock button (it has no pressLockButton)")
            }
            _ = XCUIDevice.shared.perform(press)
        default: throw AgentError("UNSUPPORTED", "no \(k) key on iOS", hint: "tap the screen's own back control")
        }
    }
}
