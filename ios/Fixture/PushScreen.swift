import SwiftUI
import UIKit
import UserNotifications

/// What a push brought, as the app's own code saw it: the push screen shows the last, and the log has each.
final class PushDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate, ObservableObject {
    static let shared = PushDelegate()
    @Published var last = "none"

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions _: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = PushDelegate.shared
        let reply = UNNotificationAction(identifier: "reply", title: "Reply")
        center.setNotificationCategories([
            UNNotificationCategory(identifier: "order", actions: [reply], intentIdentifiers: [])
        ])
        application.registerForRemoteNotifications()
        return true
    }

    func application(_: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken token: Data) {
        NSLog("appdyno-fixture device token: %@", token.map { String(format: "%02x", $0) }.joined())
    }

    func application(_: UIApplication, didReceiveRemoteNotification info: [AnyHashable: Any],
                     fetchCompletionHandler done: @escaping (UIBackgroundFetchResult) -> Void) {
        PushDelegate.record("background", info)
        done(.newData)
    }

    // the center's calls are bound to no actor, as its protocol declares them
    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter, willPresent notification: UNNotification,
        withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        PushDelegate.record("alert \(notification.request.content.title)", notification.request.content.userInfo)
        done([.banner, .list, .sound, .badge])
    }

    nonisolated func userNotificationCenter(_: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler done: @escaping () -> Void) {
        PushDelegate.record("opened \(response.actionIdentifier)", response.notification.request.content.userInfo)
        done()
    }

    /// The kind, and the keys other than `aps`, sorted: in the log at once, on the screen from the main queue.
    nonisolated static func record(_ kind: String, _ info: [AnyHashable: Any]) {
        let keys = info.keys.map { "\($0)" }.filter { $0 != "aps" }.sorted()
        let text = "\(kind): \(keys.map { "\($0)=\(info[$0] ?? "")" }.joined(separator: ", "))"
        NSLog("appdyno-fixture push %@", text)
        DispatchQueue.main.async { PushDelegate.shared.last = text }
    }
}

/// The last push the app's code received, and a way to let alerts show.
struct PushScreen: View {
    @ObservedObject private var pushes = PushDelegate.shared

    var body: some View {
        VStack(spacing: 12) {
            Button("Allow notifications") {
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
            }
            .accessibilityIdentifier("ask_notifications")
            Text(pushes.last).accessibilityIdentifier("push_last")
            Spacer()
        }
        .padding()
    }
}
