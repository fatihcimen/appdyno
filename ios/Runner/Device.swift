import UIKit
import XCTest

/// The device side of every method, on top of public XCUI API. Coordinates are points.
@MainActor final class Device {
    static let springboardId = "com.apple.springboard"
    let springboard = XCUIApplication(bundleIdentifier: Device.springboardId)
    private(set) var target: XCUIApplication?
    private(set) var targetId: String?
    /// Recent captures by layout digest: what `before` names (compare and hit test).
    var recent: [(hash: String, nodes: [Node])] = []
    /// What XCUI said of the copies of each control lately asked of, by `copiesId` (each hittability check costs a
    /// query).
    var unreachable: [(id: String, verdict: CopiesVerdict)] = []
    /// What is known of the screen to keep moving by itself, and when the last action began.
    var cycling = Cycling()
    var actedAt = 0
    /// What moves after the action being settled, no action of ours set moving; and a read of its settle was the one
    /// before it only as what moved is known to cycle.
    var byItself = false
    var cycled = false
    /// The process XCTest's keyboard last sent a key to (`key`).
    var keyedPid: Int?
    /// The frame of the system alert in the last read, if one was over the app.
    var alertFrame: CGRect?
    /// The app's frame in the last read: wider than tall where its interface stands turned.
    var appFrame: CGRect?
    let settler = Settler(clock: { Int(Date().timeIntervalSince1970 * 1000) },
                          sleep: { Thread.sleep(forTimeInterval: Double($0) / 1000) })
    /// The longest a touch waits for the app's animations (UIKit's sheet comes up in about 0.5 s; an
    /// animation that never ends costs this once per touch).
    static let animationWaitS = 1.0
    /// How long typed text has to show in its field before it counts as not gone in.
    static let echoWaitS = 1.5
    /// After this much of a read, no other group of a control's copies is asked of XCUI: each query walks the app's
    /// whole tree, 0.1 to 0.4 s on a real app's home grid.
    static let copiesAskS = 0.5
    /// The most one group's queries take before they are left unasked: a read's own deadline is 15 s.
    static let copiesGroupS = 3.0

    /// The protected resources by the names `app grant` and `revoke` take: a reset is all iOS offers.
    static let resources: [String: XCUIProtectedResource] = [
        "contacts": .contacts, "calendar": .calendar, "reminders": .reminders, "photos": .photos,
        "microphone": .microphone, "camera": .camera, "media-library": .mediaLibrary, "homekit": .homeKit,
        "focus": .focus, "local-network": .localNetwork, "bluetooth": .bluetooth,
        "keyboard-network": .keyboardNetwork, "location": .location, "health": .health, "tracking": .userTracking
    ]

    /// The app asks again, as if it never had; one that runs may be ended by it.
    func resetPermission(_ pkg: String, _ service: String) throws {
        guard let resource = Device.resources[service] else {
            throw AgentError(
                "INVALID_ARGUMENT",
                "a permission iOS resets: \(Device.resources.keys.sorted().joined(separator: ", ")), not \(service)"
            )
        }
        XCUIApplication(bundleIdentifier: pkg).resetAuthorizationStatus(for: resource)
    }

    func setTarget(_ id: String) {
        targetId = id
        target = XCUIApplication(bundleIdentifier: id)
    }

    /// Whether the app under test is the one in front.
    var targetInFront: Bool { target?.state == .runningForeground }

    /// The app on screen: the target when it is in front, else the app iOS has there, else the home screen. Read in
    /// place of another app in front, the home screen app is only that app's card in the switcher.
    func front() -> (XCUIApplication, String) {
        if let target, let targetId, target.state == .runningForeground { return (target, targetId) }
        return inFront() ?? (springboard, Device.springboardId)
    }

    /// The app in front by XCTest's private list, as public XCUI tells only of an app it is named; with an alert the
    /// home screen app may come along, and the app under it is what is read.
    private func inFront() -> (XCUIApplication, String)? {
        guard let client = KeyedSnapshot.ask(XCUIDevice.shared, "accessibilityInterface"),
              let apps = KeyedSnapshot.ask(client, "activeForegroundApplications") as? [XCUIApplication]
        else { return nil }
        for app in apps {
            if let id = KeyedSnapshot.ask(app, "bundleID") as? String, id != Device.springboardId { return (app, id) }
        }
        return nil
    }
}
