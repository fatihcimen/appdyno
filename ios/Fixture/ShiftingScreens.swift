import SwiftUI

/// A page under a sheet that opens with it, as an app asks for a choice as it starts.
struct SheetScreen: View {
    @State private var choosing = true
    @State private var result = ""

    var body: some View {
        VStack(spacing: 12) {
            Text("Plans")
            Button("Next") { result = "Next tapped" }.accessibilityIdentifier("next_button")
            Text(result).accessibilityIdentifier("result")
            Spacer()
        }
        .padding()
        .sheet(isPresented: $choosing) {
            VStack(spacing: 12) {
                Text("Choose a plan")
                ForEach(["Basic plan", "Full plan"], id: \.self) { plan in
                    Button(plan) {
                        result = "Chosen: \(plan)"
                        choosing = false
                    }
                }
                Button("Compare plans") {}
            }
            .presentationDetents([.medium])
        }
    }
}

/// A page that moves on by itself 300 ms after it appears (`moves_on` as a cost in place of that), each time: a back
/// from the page it opens lands here, and this opens it again.
struct MovesOnScreen: View {
    @State private var onward = false

    var body: some View {
        VStack(spacing: 12) {
            Text("Start")
            Button("Begin") {}.accessibilityIdentifier("begin_button")
            Spacer()
        }
        .padding()
        .navigationDestination(isPresented: $onward) {
            VStack(spacing: 12) {
                Text("Details")
                Button("Done") { onward = false }
                Spacer()
            }
            .padding()
        }
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + (fixtureCost("moves_on") ?? 300) / 1000) {
                onward = true
            }
        }
    }
}
