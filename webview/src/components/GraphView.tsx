/**
 * GraphView — Main React Flow graph component.
 *
 * Features:
 * - Renders the commit DAG using React Flow
 * - Custom node types (commit, branch-label)
 * - Smooth zoom & pan
 * - Minimap with styled mask
 * - Built-in controls
 * - Performance: onlyRenderVisibleElements
 * - Animated edges for merges
 * - Node selection → extension communication
 * - Auto fit-to-view on first render
 * - NodeInspector slide-out panel on node selection
 * - Valid action edge highlighting
 */

import { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MiniMap,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore } from '../store/graph.store';
import { postMessage } from '../vscode';
import { CommitNode } from './CommitNode';
import { BranchLabel } from './BranchLabel';
import { WorkingDirectoryNode } from './WorkingDirectoryNode';
import { StashNode } from './StashNode';
import { Toolbar } from './Toolbar';
import { NodeInspector } from './NodeInspector';
import { DagreEdge } from './DagreEdge';

/** Custom node types registered with React Flow. */
const nodeTypes = {
  commit: CommitNode,
  'branch-label': BranchLabel,
  'working-directory': WorkingDirectoryNode,
  stash: StashNode,
};

const edgeTypes = {
  dagre: DagreEdge,
};

export function GraphView() {
  const {
    nodes: storeNodes,
    edges: storeEdges,
    isLoading,
    selectNode,
    commitCount,
    theme,
    isInspectorOpen,
    validActions,
    previewState,
    showStashes,
  } = useGraphStore();

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);
  const initialFitDone = useRef(false);
  const reactFlowRef = useRef<HTMLDivElement>(null);

  // Sync store nodes/edges to local state, with edge glow for valid actions
  useEffect(() => {
    setNodes(storeNodes);

    // Apply edge highlighting based on valid actions
    const validActionKinds = new Set(validActions.map((a) => a.kind));
    const highlightedEdges = storeEdges.map((edge) => {
      // Check if this edge's type matches a valid action
      const isHighlighted = validActionKinds.size > 0 && validActionKinds.has(edge.className?.replace('merge-edge', '').trim() as never);
      if (isHighlighted) {
        return {
          ...edge,
          animated: true,
          style: {
            ...edge.style,
            strokeWidth: 3,
            opacity: 1,
            filter: 'drop-shadow(0 0 6px currentColor)',
          },
        };
      }
      return edge;
    });
    
    // Apply preview overlays if active, and filter out stashes if disabled
    let finalNodes = storeNodes;
    
    if (!showStashes) {
      finalNodes = finalNodes.filter(node => node.type !== 'stash' && (node.data as any)?.kind !== 'stash');
    }
    
    if (previewState) {
      finalNodes = finalNodes.map((node) => {
        if (node.id === previewState.nodeId) {
          return {
            ...node,
            style: {
              ...node.style,
              filter: 'drop-shadow(0 0 12px var(--action-danger))',
              transform: 'scale(1.05)',
              transition: 'all 0.3s ease',
            },
          };
        }
        return {
          ...node,
          style: {
            ...node.style,
            opacity: 0.3,
            transition: 'all 0.3s ease',
          },
        };
      });
    }

    setNodes(finalNodes);
    setEdges(highlightedEdges);
    initialFitDone.current = false;
  }, [storeNodes, storeEdges, setNodes, setEdges, validActions, previewState, showStashes]);

  // Handle node click → select and notify extension
  const onNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      selectNode(node.id);
      postMessage({ type: 'node-selected', nodeId: node.id });
    },
    [selectNode]
  );

  // Handle pane click → deselect
  const onPaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  // Minimap node color based on branch color
  const minimapNodeColor = useCallback(
    (node: { data?: Record<string, unknown> }) => {
      return (node.data?.color as string) ?? 'var(--minimap-node)';
    },
    []
  );

  // Default edge options
  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'dagre' as const,
      style: { strokeWidth: 2 },
    }),
    []
  );

  // Loading state
  if (isLoading) {
    return (
      <div className="graph-loading">
        <div className="graph-loading-spinner" />
        <span>Loading repository graph...</span>
      </div>
    );
  }

  // Empty state
  if (commitCount === 0) {
    return (
      <div className="graph-empty">
        <div className="graph-empty-icon">⎇</div>
        <div className="graph-empty-title">No commits yet</div>
        <div className="graph-empty-message">
          This repository has no commits. Create your first commit to see the
          graph visualization.
        </div>
      </div>
    );
  }

  return (
    <div
      className={`graph-wrapper ${isInspectorOpen ? 'graph-with-inspector' : ''}`}
    >
      <div className="graph-container" ref={reactFlowRef}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          defaultEdgeOptions={defaultEdgeOptions}
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1.5 }}
          minZoom={0.05}
          maxZoom={3}
          // Performance
          onlyRenderVisibleElements
          // Disable editing
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={true}
          // Interaction
          panOnDrag
          zoomOnScroll
          zoomOnDoubleClick
          // Style
          proOptions={{ hideAttribution: true }}
          className={`theme-${theme}`}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--border-muted)"
          />
          <MiniMap
            nodeColor={minimapNodeColor}
            maskColor="var(--minimap-mask)"
            style={{
              width: 160,
              height: 100,
            }}
            pannable
            zoomable
          />
          <Controls
            showInteractive={false}
            showZoom={false}
            showFitView={false}
            position="bottom-right"
          />
          <Toolbar />
        </ReactFlow>
      </div>
      <NodeInspector />
    </div>
  );
}
