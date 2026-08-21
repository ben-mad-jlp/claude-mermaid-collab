import XCTest
@testable import MermaidCollabCore

final class SessionCardMergeTests: XCTestCase {
    func test1_mergingTwoServersSummariesYieldsOneRowPerCardTaggedWithItsOriginServerId() {
        let summaryA = SessionSummary(project: "/p/one", session: "s1", progressState: .active, paneSeenAt: 1, updatedAt: 1)
        let summaryB1 = SessionSummary(project: "/p/two", session: "s2", progressState: .active, paneSeenAt: 2, updatedAt: 2)
        let summaryB2 = SessionSummary(project: "/p/two", session: "s3", progressState: .active, paneSeenAt: 3, updatedAt: 3)

        let registry = ServerRegistry(entries: [
            ServerEntry(id: "a", label: "A", host: "a.local", source: .manual, reachability: .reachable),
            ServerEntry(id: "b", label: "B", host: "b.local", source: .manual, reachability: .reachable),
        ])

        let result = SessionCardMerge.merged([
            (serverId: "a", summaries: [summaryA]),
            (serverId: "b", summaries: [summaryB1, summaryB2]),
        ], registry: registry)

        XCTAssertEqual(result.count, 3)
        XCTAssertEqual(result[0].session, "s1")
        XCTAssertEqual(result[0].serverId, "a")
        XCTAssertEqual(result[1].session, "s2")
        XCTAssertEqual(result[1].serverId, "b")
        XCTAssertEqual(result[2].session, "s3")
        XCTAssertEqual(result[2].serverId, "b")
    }

    func test2_aCardPresentOnBothServersYieldsOneRowOwnedByTheFirstServerInRegistryOrder() {
        let onA = SessionSummary(project: "/p/shared", session: "s1", progressState: .active, paneSeenAt: 1, updatedAt: 1)
        let onB = SessionSummary(project: "/p/shared", session: "s1", progressState: .stalled, paneSeenAt: 2, updatedAt: 2)

        let registry = ServerRegistry(entries: [
            ServerEntry(id: "a", label: "A", host: "a.local", source: .manual, reachability: .reachable),
            ServerEntry(id: "b", label: "B", host: "b.local", source: .manual, reachability: .reachable),
        ])

        let result = SessionCardMerge.merged([
            (serverId: "b", summaries: [onB]),
            (serverId: "a", summaries: [onA]),
        ], registry: registry)

        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].serverId, "a")
        XCTAssertEqual(result[0].key, "/p/shared::s1")
    }

    func test3_anUnreachableServerContributesZeroRowsWhileTheOtherServersRowsRemain() {
        let onA = SessionSummary(project: "/p/one", session: "s1", progressState: .active, paneSeenAt: 1, updatedAt: 1)
        let onB = SessionSummary(project: "/p/two", session: "s2", progressState: .active, paneSeenAt: 2, updatedAt: 2)

        let registry = ServerRegistry(entries: [
            ServerEntry(id: "a", label: "A", host: "a.local", source: .manual, reachability: .reachable),
            ServerEntry(id: "b", label: "B", host: "b.local", source: .manual, reachability: .unreachable),
        ])

        let result = SessionCardMerge.merged([
            (serverId: "a", summaries: [onA]),
            (serverId: "b", summaries: [onB]),
        ], registry: registry)

        XCTAssertTrue(result.allSatisfy { $0.serverId != "b" })
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result[0].serverId, "a")
        XCTAssertEqual(result[0].project, "/p/one")
        XCTAssertEqual(result[0].session, "s1")
    }
}
