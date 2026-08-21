import XCTest
@testable import MermaidCollabCore

final class EscalationMergeTests: XCTestCase {
    func test1_mergingTwoServersListsYieldsOneEntryPerCardTaggedWithItsOriginServerId() {
        let cardA = Escalation(id: "e1", project: "/p/one", session: "s1", status: "open", createdAt: 1)
        let cardB1 = Escalation(id: "e2", project: "/p/two", session: "s2", status: "open", createdAt: 2)
        let cardB2 = Escalation(id: "e3", project: "/p/two", session: "s3", status: "open", createdAt: 3)

        let result = EscalationMerge.merged([
            (serverId: "a", escalations: [cardA]),
            (serverId: "b", escalations: [cardB1, cardB2]),
        ])

        XCTAssertEqual(result.count, 3)
        XCTAssertEqual(result[0].id, "e1")
        XCTAssertEqual(result[0].serverId, "a")
        XCTAssertEqual(result[1].id, "e2")
        XCTAssertEqual(result[1].serverId, "b")
        XCTAssertEqual(result[2].id, "e3")
        XCTAssertEqual(result[2].serverId, "b")
    }

    func test2_decideRouteReturnsTheCardsOwnServerIdWhileADifferentServerIsSelected() {
        let registry = ServerRegistry(entries: [
            ServerEntry(id: "a", label: "A", host: "a.local:9002", source: .manual),
            ServerEntry(id: "b", label: "B", host: "b.local:9002", source: .manual),
        ])
        let card = Escalation(id: "e1", project: "/p/one", session: "s1", status: "open", createdAt: 1, serverId: "b")

        let route = EscalationMerge.decideRoute(for: card, registry: registry, selectedServerId: "a")

        XCTAssertEqual(route.serverId, "b")
        XCTAssertEqual(route.host, "b.local:9002")
        XCTAssertTrue(route.path.hasSuffix("/api/supervisor/escalation/e1/decide"))
    }
}
