/**
 * EdgeHandle — a React Flow Handle whose connection dot is only painted when an
 * edge is actually attached to it. An unattached handle still exists (so an edge
 * CAN connect) but renders invisibly, so nodes don't sprout stray connection-point
 * dots on the sides nothing links to. Connected handles keep a small dot so the
 * attachment point reads intentionally.
 */
import React from 'react';
import { Handle, Position, useNodeConnections, type HandleType } from '@xyflow/react';

export const EdgeHandle: React.FC<{
  type: HandleType;
  position: Position;
  /** Tailwind bg color for the dot when connected (e.g. "!bg-gray-400"). */
  dotClass?: string;
}> = ({ type, position, dotClass = '!bg-gray-400' }) => {
  const connections = useNodeConnections({ handleType: type });
  const connected = connections.length > 0;
  return (
    <Handle
      type={type}
      position={position}
      // Invisible (but present) when nothing is attached; a subtle dot when it is.
      className={connected ? dotClass : '!bg-transparent !border-0'}
      style={connected ? undefined : { width: 1, height: 1, minWidth: 1, minHeight: 1 }}
    />
  );
};

export default EdgeHandle;
