import Foundation
import Security

/// Seam over a single opaque account key so `KeychainServerTokenStore` is testable without a
/// real keychain (a CI / `swift test` process has no keychain entitlement).
public protocol KeychainTokenBackend {
    func read(account: String) -> String?
    func write(_ value: String, account: String)
    func delete(account: String)
}

/// Real Security-framework backend, mirroring the app target's `Keychain.saveServerToken` /
/// `loadServerToken` / `deleteServerToken` (same service string, delete-then-add replace
/// semantics, `kSecAttrAccessibleAfterFirstUnlock` on the add).
public struct SecurityKeychainTokenBackend: KeychainTokenBackend {
    private let service = "com.mermaidcollab.app"

    public init() {}

    public func read(account: String) -> String? {
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
              let value = String(data: data, encoding: .utf8) else { return nil }
        return value
    }

    public func write(_ value: String, account: String) {
        guard let data = value.data(using: .utf8) else { return }
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

    public func delete(account: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

/// Exported headless fake backend, keyed by account string. Public (not `@testable`-only) so
/// Core's own test target can drive `KeychainServerTokenStore` without touching the real
/// keychain.
public final class InMemoryKeychainTokenBackend: KeychainTokenBackend {
    private var storage: [String: String] = [:]

    public init() {}

    public func read(account: String) -> String? {
        storage[account]
    }

    public func write(_ value: String, account: String) {
        storage[account] = value
    }

    public func delete(account: String) {
        storage.removeValue(forKey: account)
    }
}

/// `ServerTokenStore` conformer backed by the Keychain (or an injected `KeychainTokenBackend`
/// for tests), keyed per server id. Non-`mutating` members so this can be held as a
/// `ServerTokenStore` existential.
public struct KeychainServerTokenStore: ServerTokenStore {
    private static let accountPrefix = "server-token."

    private let backend: KeychainTokenBackend

    public init(backend: KeychainTokenBackend = SecurityKeychainTokenBackend()) {
        self.backend = backend
    }

    private func account(forServerId serverId: String) -> String {
        Self.accountPrefix + serverId
    }

    public func token(forServerId serverId: String) -> String? {
        backend.read(account: account(forServerId: serverId))
    }

    public func setToken(_ token: String, forServerId serverId: String) {
        backend.write(token, account: account(forServerId: serverId))
    }

    public func removeToken(forServerId serverId: String) {
        backend.delete(account: account(forServerId: serverId))
    }
}
