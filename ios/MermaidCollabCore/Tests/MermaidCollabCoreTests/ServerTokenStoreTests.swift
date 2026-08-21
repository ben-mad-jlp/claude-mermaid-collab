import XCTest
@testable import MermaidCollabCore

final class ServerTokenStoreTests: XCTestCase {
    func testTokenWrittenForOneServerIdIsReadableForThatId() {
        let store = InMemoryServerTokenStore()
        store.setToken("tok-a", forServerId: "server-a")
        XCTAssertEqual(store.token(forServerId: "server-a"), "tok-a")
    }

    func testTokenWrittenForOneServerIdIsAbsentForAnotherId() {
        let store = InMemoryServerTokenStore()
        store.setToken("tok-a", forServerId: "server-a")
        XCTAssertNil(store.token(forServerId: "server-b"))
    }

    func testTokensForDistinctServerIdsDoNotOverwriteEachOther() {
        let store = InMemoryServerTokenStore()
        store.setToken("tok-a", forServerId: "server-a")
        store.setToken("tok-b", forServerId: "server-b")
        XCTAssertEqual(store.token(forServerId: "server-a"), "tok-a")
        XCTAssertEqual(store.token(forServerId: "server-b"), "tok-b")
    }

    func testRemoveTokenClearsOnlyTheTargetedServerId() {
        let store = InMemoryServerTokenStore()
        store.setToken("tok-a", forServerId: "server-a")
        store.setToken("tok-b", forServerId: "server-b")
        store.removeToken(forServerId: "server-a")
        XCTAssertNil(store.token(forServerId: "server-a"))
        XCTAssertEqual(store.token(forServerId: "server-b"), "tok-b")
    }
}
