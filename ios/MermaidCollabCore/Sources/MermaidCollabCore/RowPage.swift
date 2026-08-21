import Foundation

/// The shipped answer to "every row list is paged with a declared ceiling and reports what it
/// omitted": a caller renders `rows` and surfaces `omittedCount` instead of silently truncating.
public struct RowPage<Row: Sendable>: Sendable {
    public let rows: [Row]
    public let omittedCount: Int

    public init(rows: [Row], omittedCount: Int) {
        self.rows = rows
        self.omittedCount = omittedCount
    }

    public static func build(rows: [Row], pageSize: Int) -> RowPage<Row> {
        let pageRows = Array(rows.prefix(max(0, pageSize)))
        return RowPage(rows: pageRows, omittedCount: rows.count - pageRows.count)
    }
}

extension RowPage: Equatable where Row: Equatable {}
