import SwiftUI

struct DialogScreen: View {
    @State private var shown = false
    @State private var result = ""

    var body: some View {
        VStack(spacing: 12) {
            Button("Open dialog") { shown = true }.accessibilityIdentifier("open_dialog")
            Text(result).accessibilityIdentifier("result")
            Spacer()
        }
        .padding()
        .alert("Emin misiniz?", isPresented: $shown) {
            Button("OK") { result = "Confirmed" }
            Button("Cancel", role: .cancel) { result = "Cancelled" }
        } message: {
            Text("The basket will be emptied.")
        }
    }
}
