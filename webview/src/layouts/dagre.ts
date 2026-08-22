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
const NODE_WIDTH = 52; // Width of the circle + padding
const NODE_HEIGHT = 60; // Approximate height of a node

/** Spacing between nodes. */
const NODE_SEP = 280;
const RANK_SEP = 60;
const EDGE_SEP = 20;

/**
 * Compute layout positions for nodes using dagre.
 *
 * @param nodes - React Flow nodes (positions will be overwritten).
 * @param edges - React Flow edges defining the graph topology.
 * @returns New array of nodes with computed positions.
 */
export function computeLayout(nodes: Node[], edges: Edge[]): { nodes: Node[], edges: Edge[] } {
  if (nodes.length === 0) return { nodes: [], edges: [] };

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
  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = g.node(node.id);
    if (!nodeWithPosition) return node;

    return {
      ...node,
      position: {
        // Center the 52px layout box on the React Flow node's left circle (26px center)
        x: nodeWithPosition.x - 26,
        y: nodeWithPosition.y - 30, // NODE_HEIGHT / 2
      },
    };
  });

  const layoutedEdges = edges.map((edge) => {
    const dagreEdge = g.edge(edge.source, edge.target);
    if (!dagreEdge || !dagreEdge.points) return edge;

    const points = dagreEdge.points.map((p: { x: number, y: number }) => ({
      x: p.x,
      y: p.y
    }));

    return {
      ...edge,
      type: 'dagre',
      data: {
        ...edge.data,
        points,
      }
    };
  });

  return { nodes: layoutedNodes, edges: layoutedEdges };
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
