import SwiftUI

/// Words that are only a picture, as a game has them: nothing of them is in the tree. A touch changes them.
struct CanvasScreen: View {
    @State private var said = "Start Game"

    var body: some View {
        Canvas { context, size in
            context.draw(Text(said).font(.largeTitle), at: CGPoint(x: size.width / 2, y: size.height / 2))
        }
        .id(said)
        .accessibilityHidden(true)
        .contentShape(Rectangle())
        .onTapGesture { said = "Game Over" }
        .toolbar(.hidden, for: .navigationBar)
    }
}
