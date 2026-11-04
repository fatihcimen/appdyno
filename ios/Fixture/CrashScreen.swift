import SwiftUI

struct CrashScreen: View {
    var body: some View {
        Button("Crash") { fixtureCrash("fixture crash") }.accessibilityIdentifier("crash")
    }
}
