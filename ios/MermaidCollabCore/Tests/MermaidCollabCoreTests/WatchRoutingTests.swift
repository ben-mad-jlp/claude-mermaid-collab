import XCTest
import MermaidCollabCore

final class WatchRoutingTests: XCTestCase {
    private func makeRegistry() -> ServerRegistry {
        ServerRegistry(entries: [
            ServerEntry(id: "srv-owner", label: "Owner", host: "owner.local:9002", source: .manual),
            ServerEntry(id: "srv-other", label: "Other", host: "other.local:9002", source: .manual),
        ])
    }

    func test1_watchRouteForProjectTargetsOwnerServerWhileAnotherServerIsSelected() {
        let route = ServerRequestRouter.route(
            forProject: "/Users/x/Code/alpha",
            path: "/api/supervisor/projects",
            registry: makeRegistry(),
            projectsByServerId: ["srv-owner": ["/Users/x/Code/alpha"]],
            selectedServerId: "srv-other",
            localServerId: nil
        )

        XCTAssertEqual(route.serverId, "srv-owner")
        XCTAssertEqual(route.host, "owner.local:9002")
        XCTAssertEqual(route.url, URL(string: "http://owner.local:9002/api/supervisor/projects"))
    }
}
