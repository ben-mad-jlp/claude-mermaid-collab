import XCTest
import MermaidCollabCore

final class WatchListTests: XCTestCase {
    func test1_entryForProjectAndSessionCarriesOwnerServerId() {
        let entry = WatchEntry(serverId: "srv-owner", project: "/Users/x/Code/alpha", session: "design")
        let list = WatchList().adding(entry)

        XCTAssertEqual(list.entries.count, 1)
        XCTAssertEqual(list.entries[0].serverId, "srv-owner")
        XCTAssertEqual(list.entries[0].session, "design")
    }

    func test2_removingEntryLeavesOtherServersEntriesIntact() {
        let owner = WatchEntry(serverId: "srv-owner", project: "/Users/x/Code/alpha", session: "design")
        let other = WatchEntry(serverId: "srv-other", project: "/Users/x/Code/alpha", session: "design")
        let list = WatchList(entries: [owner, other])

        let result = list.removing(serverId: "srv-owner", project: "/Users/x/Code/alpha", session: "design")

        XCTAssertEqual(result.entries, [other])
    }

    func test3_listFromTwoServersHasOneEntryPerServerProjectSessionTriple() {
        let ownerEntry = WatchEntry(serverId: "srv-owner", project: "/Users/x/Code/alpha", session: nil)
        let otherEntry = WatchEntry(serverId: "srv-other", project: "/Users/x/Code/alpha", session: nil)

        let list = WatchList.list(from: [
            (serverId: "srv-owner", entries: [ownerEntry, ownerEntry]),
            (serverId: "srv-other", entries: [otherEntry]),
        ])

        XCTAssertEqual(list.entries.count, 2)
        XCTAssertTrue(list.entries.contains { $0.serverId == "srv-owner" })
        XCTAssertTrue(list.entries.contains { $0.serverId == "srv-other" })
    }
}
