import Combine
import CoreLocation
import SwiftUI

/// Asks for the location: the system alert is the springboard's, over the app.
struct PermissionScreen: View {
    final class Asker: NSObject, ObservableObject, CLLocationManagerDelegate {
        let manager = CLLocationManager()
        @Published var status = "?"
        override init() {
            super.init()
            manager.delegate = self
        }

        func locationManagerDidChangeAuthorization(_ locationManager: CLLocationManager) {
            switch locationManager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: status = "Allowed"
            case .denied, .restricted: status = "Denied"
            default: status = "Not asked"
            }
        }
    }

    @StateObject private var asker = Asker()

    var body: some View {
        VStack(spacing: 12) {
            Button("Request location") { asker.manager.requestWhenInUseAuthorization() }
                .accessibilityIdentifier("ask_location")
            Text(asker.status).accessibilityIdentifier("permission_status")
            Spacer()
        }
        .padding()
    }
}
