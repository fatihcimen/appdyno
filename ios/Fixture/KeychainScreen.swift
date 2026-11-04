import Security
import SwiftUI

/** One item in the keychain, saved and read: what `device_setting keychain` empties. */
struct KeychainScreen: View {
    @State private var result = "Not read"
    private let item: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "dev.appdyno.fixture",
        kSecAttrAccount as String: "fixture",
    ]

    var body: some View {
        VStack(spacing: 12) {
            Button("Save") {
                SecItemDelete(item as CFDictionary)
                var add = item
                add[kSecValueData as String] = Data("kept".utf8)
                let status = SecItemAdd(add as CFDictionary, nil)
                result = status == errSecSuccess ? "Saved" : "Error \(status)"
            }.accessibilityIdentifier("save")
            Button("Read") {
                var read = item
                read[kSecReturnData as String] = true
                var found: AnyObject?
                let status = SecItemCopyMatching(read as CFDictionary, &found)
                result = status == errSecSuccess
                    ? "Found" : status == errSecItemNotFound ? "Not found" : "Error \(status)"
            }.accessibilityIdentifier("read")
            Text(result).accessibilityIdentifier("result")
            Spacer()
        }.padding()
    }
}
