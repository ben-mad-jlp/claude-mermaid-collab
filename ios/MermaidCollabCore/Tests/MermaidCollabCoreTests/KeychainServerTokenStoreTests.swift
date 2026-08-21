import XCTest
@testable import MermaidCollabCore

final class KeychainServerTokenStoreTests: XCTestCase {
    func test1_tokenWrittenForOneServerIdIsReadableForThatId() {
        let store = KeychainServerTokenStore(backend: InMemoryKeychainTokenBackend())
        store.setToken("abc123", forServerId: "server-a")

        XCTAssertEqual(store.token(forServerId: "server-a"), "abc123")
    }

    func test2_tokenWrittenForOneServerIdReadsNilForDifferentId() {
        let store = KeychainServerTokenStore(backend: InMemoryKeychainTokenBackend())
        store.setToken("abc123", forServerId: "server-a")

        XCTAssertNil(store.token(forServerId: "server-b"))
    }
}
