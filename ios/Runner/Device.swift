import UIKit
import XCTest

/// The device side of every method, on top of public XCUI API. Coordinates are points.
@MainActor final class Device {
    static let springboardId = "com.apple.springboard"
    let springboard = XCUIApplication(bundleIdentifier: Device.springboardId)
    private(set) var target: XCUIApplication?
    private var targetId: String?
    /// Recent captures by layout digest: what `before` names (compare and hit test).
    var recent: [(hash: String, nodes: [Node])] = []
    /// The copies found out of reach on a recent layout, by its hash (each hittability check costs a query).
    var unreachable: [(hash: String, copies: [String])] = []
    /// The frame of the system alert in the last read, if one was over the app.
    var alertFrame: CGRect?
    let settler = Settler(clock: { Int(Date().timeIntervalSince1970 * 1000) },
                          sleep: { Thread.sleep(forTimeInterval: Double($0) / 1000) })
    /// The longest a touch waits for the app's animations (UIKit's sheet comes up in about 0.5 s; an
    /// animation that never ends costs this once per touch).
    static let animationWaitS = 1.0
    /// How long typed text has to show in its field before it counts as not gone in.
    static let echoWaitS = 1.5

    /// The protected resources by the names `app grant` and `revoke` take: a reset is all iOS offers.
    static let resources: [String: XCUIProtectedResource] = [
        "contacts": .contacts, "calendar": .calendar, "reminders": .reminders, "photos": .photos,
        "microphone": .microphone, "camera": .camera, "media-library": .mediaLibrary, "homekit": .homeKit,
        "focus": .focus, "local-network": .localNetwork, "bluetooth": .bluetooth,
        "keyboard-network": .keyboardNetwork, "location": .location, "health": .health, "tracking": .userTracking,
    ]

    /// The app asks again, as if it never had; one that runs may be ended by it.
    func resetPermission(_ pkg: String, _ service: String) throws {
        guard let resource = Device.resources[service] else {
            throw AgentError("INVALID_ARGUMENT", "a permission iOS resets: \(Device.resources.keys.sorted().joined(separator: ", ")), not \(service)")
        }
        XCUIApplication(bundleIdentifier: pkg).resetAuthorizationStatus(for: resource)
    }

    func setTarget(_ id: String) {
        targetId = id
        target = XCUIApplication(bundleIdentifier: id)
    }

    /// The app on screen: the target when it is in front, else the home screen.
    func front() -> (XCUIApplication, String) {
        if let target, let targetId, target.state == .runningForeground { return (target, targetId) }
        return (springboard, Device.springboardId)
    }
}
