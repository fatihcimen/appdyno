import SwiftUI
import UIKit

extension Notification.Name {
    static let fixtureShake = Notification.Name("fixtureShake")
}

/// A shake reaches the window from whatever holds the focus, the screen's text field too.
extension UIWindow {
    override open func motionEnded(_ motion: UIEvent.EventSubtype, with event: UIEvent?) {
        if motion == .motionShake { NotificationCenter.default.post(name: .fixtureShake, object: nil) }
        super.motionEnded(motion, with: event)
    }
}

/// When this process started, by the kernel's record of it: a process the system ended and a launch began shows anew.
private let processStart: String = {
    var info = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.stride
    var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
    guard sysctl(&mib, u_int(mib.count), &info, &size, nil, 0) == 0 else { return "unknown" }
    let start = info.kp_proc.p_un.__p_starttime
    let seconds = Double(start.tv_sec) + Double(start.tv_usec) / 1_000_000
    return Date(timeIntervalSince1970: seconds).formatted(.iso8601)
}()

/// What the system tells the app: memory warnings and shakes, counted while the screen shows, a typed value kept by
/// scene storage across an end the system makes, and when this process started.
struct LifecycleScreen: View {
    @SceneStorage("lifecycle_kept") private var kept = ""
    @State private var warnings = 0
    @State private var shakes = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Memory warnings: \(warnings)").accessibilityIdentifier("memory_warnings")
            Text("Shakes: \(shakes)").accessibilityIdentifier("shakes")
            TextField("Kept value", text: $kept)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("kept_value")
            Text("Process \(getpid()) started \(processStart)").accessibilityIdentifier("process_start")
            Spacer()
        }
        .padding()
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.didReceiveMemoryWarningNotification)) { _ in
            warnings += 1
        }
        .onReceive(NotificationCenter.default.publisher(for: .fixtureShake)) { _ in shakes += 1 }
    }
}
