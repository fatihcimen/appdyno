import LocalAuthentication
import SwiftUI

/** Asks for Face ID or Touch ID and says what came back: what `device_setting biometric` answers. */
struct BiometricScreen: View {
    @State private var result = "Not asked"

    var body: some View {
        VStack(spacing: 12) {
            Button("Authenticate") {
                let context = LAContext()
                context.evaluatePolicy(
                    .deviceOwnerAuthenticationWithBiometrics, localizedReason: "Fixture sign-in"
                ) { success, error in
                    DispatchQueue.main.async {
                        let code = (error as? LAError)?.code
                        result = success
                            ? "Authenticated" : code == .authenticationFailed
                            ? "Not recognized" : "Error: \(error?.localizedDescription ?? "")"
                    }
                }
            }.accessibilityIdentifier("authenticate")
            Text(result).accessibilityIdentifier("result")
            Spacer()
        }.padding()
    }
}
