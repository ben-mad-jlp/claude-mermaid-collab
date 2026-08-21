import Foundation
import Security
import MermaidCollabCore

/// Tiny Keychain wrapper for the pairing credentials (host + bearer token).
/// The token is the root secret for tailnet access, so it lives in the Keychain
/// (not UserDefaults). One generic-password item, JSON-encoded.
enum Keychain {
    private static let service = "com.mermaidcollab.app"
    private static let account = "pairing-credentials"
    private static let serverTokenAccountPrefix = "server-token."

    private static func serverTokenAccount(_ serverId: String) -> String {
        serverTokenAccountPrefix + serverId
    }

    static func saveCredentials(_ c: Credentials) {
        guard let data = try? JSONEncoder().encode(c) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        // Replace any existing item.
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func loadCredentials() -> Credentials? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let c = try? JSONDecoder().decode(Credentials.self, from: data) else { return nil }
        return c
    }

    static func deleteCredentials() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    static func saveServerToken(_ token: String, serverId: String) {
        guard let data = token.data(using: .utf8) else { return }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: serverTokenAccount(serverId),
        ]
        // Replace any existing item.
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func loadServerToken(serverId: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: serverTokenAccount(serverId),
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let token = String(data: data, encoding: .utf8) else { return nil }
        return token
    }

    static func deleteServerToken(serverId: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: serverTokenAccount(serverId),
        ]
        SecItemDelete(query as CFDictionary)
    }
}

/// `ServerTokenStore` conformer backed by the Keychain, keyed per server id.
struct KeychainServerTokenStore: ServerTokenStore {
    init() {}

    func token(forServerId serverId: String) -> String? {
        Keychain.loadServerToken(serverId: serverId)
    }

    func setToken(_ token: String, forServerId serverId: String) {
        Keychain.saveServerToken(token, serverId: serverId)
    }

    func removeToken(forServerId serverId: String) {
        Keychain.deleteServerToken(serverId: serverId)
    }
}
