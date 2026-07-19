/**
 * DAG Layout Engine using Dagre.
 *
 * Positions commit nodes in a directed acyclic graph layout
 * with newest commits at the top, branches spaced horizontally.
 *
 * Uses the dagre library for automatic graph layout.
 */

import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';

/** Node dimensions for layout calculation. */
const NODE_WIDTH = 320;
const NODE_HEIGHT = 100;

/** Spacing between nodes. */
const NODE_SEP = 40;
const RANK_SEP = 80;
const EDGE_SEP = 20;

/**
 * Compute layout positions for nodes using dagre.
 *
 * @param nodes - React Flow nodes (positions will be overwritten).
 * @param edges - React Flow edges defining the graph topology.
 * @returns New array of nodes with computed positions.
 */
export function computeLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return [];

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));

  // Configure layout: top-to-bottom, newest at top
  g.setGraph({
    rankdir: 'TB',
    nodesep: NODE_SEP,
    ranksep: RANK_SEP,
    edgesep: EDGE_SEP,
    marginx: 40,
    marginy: 40,
  });

  // Add nodes
  for (const node of nodes) {
    g.setNode(node.id, {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    });
  }

  // Add edges
  for (const edge of edges) {
    // Only add edges where both nodes exist in the graph
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  // Run layout
  dagre.layout(g);

  // Apply positions to nodes
  return nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    if (!nodeWithPosition) return node;

    return {
      ...node,
      position: {
        // Center the node on the dagre position
        x: nodeWithPosition.x - NODE_WIDTH / 2,
        y: nodeWithPosition.y - NODE_HEIGHT / 2,
      },
    };
  });
}

/**
 * Get the node dimensions used for layout.
 * Useful for other components that need to know node sizes.
 */
export const LAYOUT_DIMENSIONS = {
  nodeWidth: NODE_WIDTH,
  nodeHeight: NODE_HEIGHT,
  nodeSep: NODE_SEP,
  rankSep: RANK_SEP,
} as const;
