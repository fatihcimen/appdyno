import SwiftUI

/// Holds 50 MB (written, so it is resident) until freed: a memory reading must show it.
struct MemoryScreen: View {
    @State private var held: [UInt8] = []

    var body: some View {
        VStack(spacing: 12) {
            Button("Hold 50 MB") { held = [UInt8](repeating: 7, count: 50 * 1024 * 1024) }.accessibilityIdentifier("memory_alloc")
            Button("Release") { held = [] }.accessibilityIdentifier("memory_free")
            Text(held.isEmpty ? "Empty" : "Holding 50 MB").accessibilityIdentifier("memory_state")
            Spacer()
        }
        .padding()
    }
}
