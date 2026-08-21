import XCTest
@testable import MermaidCollabCore

final class HomeFeedTests: XCTestCase {
    func test1_pageOf120CardsWithPageSize40CarriesFortyRowsAndOmittedCount80() {
        let registry = ServerRegistry(entries: [
            ServerEntry(id: "a", label: "A", host: "a.local", source: .manual, reachability: .reachable),
        ])

        let summaries = (0..<120).map { i in
            SessionSummary(project: "/p/one", session: "s\(i)", progressState: .active, paneSeenAt: 1, updatedAt: 1)
        }

        let page = HomeFeed.page(
            previous: [],
            results: [(serverId: "a", fetch: .answered(summaries))],
            registry: registry,
            pageSize: 40
        )

        XCTAssertEqual(page.rows.count, 40)
        XCTAssertEqual(page.omittedCount, 80)
    }

    func test2_aFailedServerCarriesThroughItsPreviousCardCountForThatServerId() {
        let registry = ServerRegistry(entries: [
            ServerEntry(id: "a", label: "A", host: "a.local", source: .manual, reachability: .reachable),
            ServerEntry(id: "b", label: "B", host: "b.local", source: .manual, reachability: .reachable),
        ])

        let onA = SessionSummary(project: "/p/one", session: "s1", progressState: .active, paneSeenAt: 1, updatedAt: 1)
        let onB1 = SessionSummary(project: "/p/two", session: "s2", progressState: .active, paneSeenAt: 2, updatedAt: 2)
        let onB2 = SessionSummary(project: "/p/two", session: "s3", progressState: .active, paneSeenAt: 3, updatedAt: 3)

        let previous = SessionCardMerge.merged([
            (serverId: "a", summaries: [onA]),
            (serverId: "b", summaries: [onB1, onB2]),
        ], registry: registry)

        let previousBCount = previous.filter { $0.serverId == "b" }.count

        let onAFresh = SessionSummary(project: "/p/one", session: "s1-fresh", progressState: .active, paneSeenAt: 4, updatedAt: 4)

        let page = HomeFeed.page(
            previous: previous,
            results: [
                (serverId: "a", fetch: .answered([onAFresh])),
                (serverId: "b", fetch: .failed),
            ],
            registry: registry,
            pageSize: 100
        )

        let pagedBCount = page.rows.filter { $0.serverId == "b" }.count
        XCTAssertEqual(pagedBCount, previousBCount)
    }

    func test3_aServerAnsweringWithAnEmptyListCarriesZeroCardsForThatServerId() {
        let registry = ServerRegistry(entries: [
            ServerEntry(id: "a", label: "A", host: "a.local", source: .manual, reachability: .reachable),
            ServerEntry(id: "b", label: "B", host: "b.local", source: .manual, reachability: .reachable),
        ])

        let onA = SessionSummary(project: "/p/one", session: "s1", progressState: .active, paneSeenAt: 1, updatedAt: 1)
        let onB1 = SessionSummary(project: "/p/two", session: "s2", progressState: .active, paneSeenAt: 2, updatedAt: 2)
        let onB2 = SessionSummary(project: "/p/two", session: "s3", progressState: .active, paneSeenAt: 3, updatedAt: 3)

        let previous = SessionCardMerge.merged([
            (serverId: "a", summaries: [onA]),
            (serverId: "b", summaries: [onB1, onB2]),
        ], registry: registry)

        let page = HomeFeed.page(
            previous: previous,
            results: [
                (serverId: "a", fetch: .answered([onA])),
                (serverId: "b", fetch: .answered([])),
            ],
            registry: registry,
            pageSize: 100
        )

        XCTAssertEqual(page.rows.filter { $0.serverId == "b" }.count, 0)
        XCTAssertEqual(page.rows.filter { $0.serverId == "a" }.count, 1)
    }
}
