import PhotosUI
import SwiftUI

/// The system's photo picker, which asks no permission: how many photos and videos were picked from the library.
struct PhotosScreen: View {
    @State private var picking = false
    @State private var picked = "Picked: none"

    var body: some View {
        VStack(spacing: 12) {
            Button("Pick photos") { picking = true }.accessibilityIdentifier("pick_photos")
            Text(picked).accessibilityIdentifier("picked")
            Spacer()
        }
        .padding()
        .sheet(isPresented: $picking) {
            PhotoPicker { results in
                picked = "Picked: \(results.count)"
                picking = false
            }
        }
    }
}

/// PHPickerViewController with no limit to how many it picks, saying what was picked when it closes.
private struct PhotoPicker: UIViewControllerRepresentable {
    let done: ([PHPickerResult]) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var configuration = PHPickerConfiguration()
        configuration.selectionLimit = 0
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_: PHPickerViewController, context _: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(done: done) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let done: ([PHPickerResult]) -> Void
        init(done: @escaping ([PHPickerResult]) -> Void) { self.done = done }

        func picker(_: PHPickerViewController, didFinishPicking results: [PHPickerResult]) { done(results) }
    }
}
