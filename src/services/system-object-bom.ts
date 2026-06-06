import { getStoreDb } from './system-object-store';

/**
 * Derived Bill-of-Materials + where-used over the system-object composition tree
 * (design-system-object-primitive §5, Phase 2 #3). BOTH are pure recursive-CTE
 * queries — NEVER stored. `bom` walks DOWN (qty multiplies through each level);
 * `whereUsed` walks UP (the assemblies an object is part of).
 */

/** One rolled-up BOM line: total quantity of a type beneath the root. */
export interface BomLine {
  typeId: string;
  totalQty: number;
}

/** An ancestor an object is used within (where-used walk). */
export interface WhereUsedNode {
  id: string;
  typeId: string;
  name: string;
}

/**
 * Rolled-up BOM beneath `rootId`: every descendant's qty multiplied down the
 * tree and summed per typeId. The root assembly itself is excluded (a BOM lists
 * the parts that make up the assembly, not the assembly). Returns [] for an
 * unknown/childless root.
 *
 * §5 Robot example → Motor:6, Encoder:6, Gearbox:6, Sensor:2 (and Axis:6).
 */
export function bom(project: string, rootId: string): BomLine[] {
  const db = getStoreDb(project);
  const rows = db
    .query(
      `WITH RECURSIVE bom(id, typeId, qty) AS (
         SELECT id, typeId, qty FROM instances WHERE id = ?
         UNION ALL
         SELECT c.id, c.typeId, c.qty * p.qty
         FROM instances c JOIN bom p ON c.parentObjectId = p.id
       )
       SELECT typeId, SUM(qty) AS totalQty
       FROM bom
       WHERE id != ?
       GROUP BY typeId
       ORDER BY typeId ASC`,
    )
    .all(rootId, rootId) as Array<{ typeId: string; totalQty: number }>;
  return rows.map((r) => ({ typeId: r.typeId, totalQty: r.totalQty }));
}

/**
 * Where-used: the chain of ancestor objects `objId` is composed within, nearest
 * parent first up to the root. Excludes the object itself. Returns [] for a root
 * or unknown object.
 */
export function whereUsed(project: string, objId: string): WhereUsedNode[] {
  const db = getStoreDb(project);
  const rows = db
    .query(
      `WITH RECURSIVE up(id, typeId, name, parentObjectId, depth) AS (
         SELECT id, typeId, name, parentObjectId, 0 FROM instances WHERE id = ?
         UNION ALL
         SELECT p.id, p.typeId, p.name, p.parentObjectId, u.depth + 1
         FROM instances p JOIN up u ON p.id = u.parentObjectId
       )
       SELECT id, typeId, name FROM up WHERE id != ? ORDER BY depth ASC`,
    )
    .all(objId, objId) as Array<{ id: string; typeId: string; name: string }>;
  return rows.map((r) => ({ id: r.id, typeId: r.typeId, name: r.name }));
}
