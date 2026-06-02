/**
 * PCS Phase 5 — shared plan-item shape.
 *
 * The minimal structural subset the plan/graph rendering needs, satisfied by
 * BOTH the legacy `RoadmapItem` (roadmap-store) and the unified `SessionTodo`
 * (todo-store work-graph). Lets `roadmapToMermaid` / wave computation render
 * either source so the Plan can be re-pointed off `roadmap_item` onto the
 * unified project todos without forking the renderer.
 *
 * Note `RoadmapItem` uses `ord` and `SessionTodo` uses `order` for sequencing —
 * intentionally NOT part of PlanItem, since graph/wave layout derives order from
 * `dependsOn`, not the sibling sort field.
 */
export interface PlanItem {
  id: string;
  title: string;
  status: string;
  parentId?: string | null;
  dependsOn?: string[];
}
