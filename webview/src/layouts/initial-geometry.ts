import { Position, type Node } from '@xyflow/react';

/**
 * React Flow force-mounts every node whose handle bounds are unknown, even
 * with onlyRenderVisibleElements. Seed large histories with measurement hints
 * so offscreen cards can stay unmounted. ResizeObserver replaces these hints
 * with actual dimensions as each card enters the viewport; CSS stays natural.
 */
export function seedInitialGeometry(nodes: Node[]): Node[] {
  if (nodes.length <= 1000) return nodes;
  return nodes.map(node => node.type !== 'commit' ? node : {
    ...node,
    measured: node.measured ?? { width: 320, height: 60 },
    handles: [
      { type: 'target', position: Position.Top, x: 26, y: 0, width: 1, height: 1 },
      { type: 'source', position: Position.Bottom, x: 26, y: 60, width: 1, height: 1 },
    ],
  });
}
