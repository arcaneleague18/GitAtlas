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
import { Toolbar } from './Toolbar';

/** Custom node types registered with React Flow. */
const nodeTypes = {
  commit: CommitNode,
  'branch-label': BranchLabel,
};

export function GraphView() {
  const {
    nodes: storeNodes,
    edges: storeEdges,
    isLoading,
    selectNode,
    commitCount,
    theme,
  } = useGraphStore();

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);
  const initialFitDone = useRef(false);
  const reactFlowRef = useRef<HTMLDivElement>(null);

  // Sync store nodes/edges to local state
  useEffect(() => {
    setNodes(storeNodes);
    setEdges(storeEdges);
    initialFitDone.current = false;
  }, [storeNodes, storeEdges, setNodes, setEdges]);

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
      type: 'smoothstep' as const,
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
    <div className="graph-container" ref={reactFlowRef}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
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
  );
}
