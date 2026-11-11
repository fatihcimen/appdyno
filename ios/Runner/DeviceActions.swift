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

    /// Does the action; for a touch, the milliseconds it first waited for the app's animations.
    func perform(_ action: Action) throws -> Int? {
        switch action {
        case let .tap(x, y):
            let waited = animationsOver(x, y)
            // the synthesizer's tap missed on a turned screen, where XCUI's own coordinate knows the way, as it does
            // on a phone lying flat with a wide app, which does not say how its screen stands
            let upright = touchOrientation() == 1
            if try !upright || !EventShim.tap(CGPoint(x: x, y: y), orientation: 1) { point(x, y).tap() }
            return waited
        case let .doubleTap(x, y):
            let waited = animationsOver(x, y)
            point(x, y).doubleTap()
            return waited
        case let .longPress(x, y, ms):
            let waited = animationsOver(x, y)
            point(x, y).press(forDuration: ms / 1000)
            return waited
        case let .swipe(fromX, fromY, toX, toY, ms):
            let waited = animationsOver(fromX, fromY)
            try drag(fromX, fromY, toX, toY, ms: ms)
            return waited
        case let .gesture(pointers):
            return try perform(gesture: pointers)
        case let .key(name, modifiers):
            try key(name, modifiers)
            return nil
        }
    }

    private func perform(gesture pointers: [[Action.Sample]]) throws -> Int? {
        guard let path = pointers.first, let first = path.first, let last = path.last else {
            throw AgentError("INVALID_ARGUMENT", "pointers need a finger with samples")
        }
        let (fromX, fromY, toX, toY) = (first.x, first.y, last.x, last.y)
        if pointers.count == 1, path.count <= 2 {
            let ms = max(20, last.t - first.t)
            let waited = animationsOver(fromX, fromY)
            if fromX == toX, fromY == toY {
                point(fromX, fromY).press(forDuration: ms / 1000)
            } else {
                try drag(fromX, fromY, toX, toY, ms: ms)
            }
            return waited
        }
        let plan = try gestureTimeline(pointers)
        guard EventShim.gestureAvailable else { throw Self.noSynthesizer(pointers, path) }
        // XCUI has no gesture of many fingers to fall back on: a wide app on a phone lying flat stands either way
        guard let turn = touchOrientation() else {
            throw AgentError(
                "UNSUPPORTED",
                "this phone lies flat and its app is wide, so which way its screen stands is not known: stand it up"
            )
        }
        let waited = animationsOver(fromX, fromY)
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

    private func key(_ name: String, _ modifiers: [String]) throws {
        let flags = modifiers.reduce(into: XCUIElement.KeyModifierFlags()) { $0.formUnion(Device.held[$1] ?? []) }
        if !flags.isEmpty || name.count == 1
            || ["escape", "space", "arrowUp", "arrowDown", "arrowLeft", "arrowRight"].contains(name) {
            front().0.typeKey(Device.keyboard[name]?.rawValue ?? name, modifierFlags: flags)
            return
        }
        switch name {
        case "enter":
            // synthesized: XCUI's typing refuses when no element reports the focus
            if try !EventShim.type("\n", orientation: Device.keysOrientation()) { front().0.typeText("\n") }
        case "delete": front().0.typeText(XCUIKeyboardKey.delete.rawValue)
        case "tab": front().0.typeText("\t")
        default: try press(name)
        }
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
