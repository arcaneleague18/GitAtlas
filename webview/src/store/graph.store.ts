/**
 * Zustand store for the commit graph.
 *
 * Manages:
 * - React Flow nodes and edges (positioned, styled)
 * - Selected node state
 * - HEAD and current branch tracking
 * - Theme state
 * - Transform from SerializedGraph → React Flow format
 */

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';
import { computeLayout } from '../layouts/dagre';
import type {
  SerializedGraph,
  GraphNode,
  CommitNodeData,
  WorkingDirectoryNodeData,
  RepositoryState,
  NodeDetails,
  ValidAction,
  PreviewData,
  GitHubContext,
} from '../types';

/** Branch color palette — matches the extension host colors. */
const BRANCH_COLORS = [
  '#58a6ff', // blue
  '#3fb950', // green
  '#d29922', // yellow
  '#f78166', // orange
  '#bc8cff', // purple
  '#ff7b72', // red
  '#79c0ff', // light blue
  '#7ee787', // light green
  '#e3b341', // gold
  '#ffa657', // amber
];

export interface GraphStoreState {
  // Data
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  headHash: string;
  currentBranch: string | null;
  repositoryState: RepositoryState;
  theme: 'dark' | 'light' | 'high-contrast';
  isLoading: boolean;
  commitCount: number;
  branchCount: number;
  hasMore: boolean;
  showLostCommits: boolean;

  // Raw graph data for lookups
  graphNodes: Map<string, GraphNode>;

  // Inspector panel state
  selectedNodeDetails: NodeDetails | null;
  validActions: ValidAction[];
  isInspectorOpen: boolean;

  // Preview state
  previewState: PreviewData | null;

  // GitHub Context
  githubContext: GitHubContext | null;

  // Actions
  setGraph: (graph: SerializedGraph) => void;
  selectNode: (nodeId: string | null) => void;
  setTheme: (theme: 'dark' | 'light' | 'high-contrast') => void;
  setLoading: (loading: boolean) => void;
  focusNode: (nodeId: string) => void;
  setNodeDetails: (details: NodeDetails) => void;
  setValidActions: (actions: ValidAction[]) => void;
  toggleInspector: () => void;
  closeInspector: () => void;
  setPreviewState: (preview: PreviewData | null) => void;
  setGithubContext: (context: GitHubContext) => void;
  setShowLostCommits: (show: boolean) => void;
}

/** Map to track which color is assigned to which branch. */
const branchColorMap = new Map<string, string>();
let colorIndex = 0;

function getBranchColor(branchName: string): string {
  const existing = branchColorMap.get(branchName);
  if (existing) return existing;
  const color = BRANCH_COLORS[colorIndex % BRANCH_COLORS.length]!;
  colorIndex++;
  branchColorMap.set(branchName, color);
  return color;
}

export const useGraphStore = create<GraphStoreState>((set, get) => ({
  // Initial state
  nodes: [],
  edges: [],
  selectedNodeId: null,
  headHash: '',
  currentBranch: null,
  repositoryState: 'clean',
  theme: 'dark',
  isLoading: true,
  commitCount: 0,
  branchCount: 0,
  hasMore: false,
  showLostCommits: false,
  graphNodes: new Map(),
  selectedNodeDetails: null,
  validActions: [],
  isInspectorOpen: false,
  previewState: null,
  githubContext: null,

  setGraph: (graph: SerializedGraph) => {
    const graphNodeMap = new Map(graph.nodes);

    // Filter to only commit nodes for the graph view
    const commitNodes: [string, GraphNode][] = graph.nodes.filter(
      ([, node]) => node.kind === 'commit'
    );

    // Count branches (for status display)
    const branchNodes = graph.nodes.filter(
      ([, node]) => node.kind === 'branch' || node.kind === 'remote-branch'
    );

    // Filter to only parent edges (structural commit-to-commit)
    const parentEdges = graph.edges.filter((e) => e.kind === 'parent');

    // Determine branch color for each commit node
    const commitColorMap = new Map<string, string>();
    for (const [id, node] of commitNodes) {
      if (node.data.kind === 'commit') {
        const commitData = node.data as CommitNodeData;
        if (commitData.branches.length > 0) {
          // Use the first branch's color
          const primaryBranch = commitData.branches[0]!;
          commitColorMap.set(id, getBranchColor(primaryBranch));
        }
      }
    }

    // Propagate colors along parent chains for commits without branch labels
    // Walk topologically: for each commit without a color, inherit from child
    const childrenMap = new Map<string, string[]>();
    for (const edge of parentEdges) {
      const children = childrenMap.get(edge.target) ?? [];
      children.push(edge.source);
      childrenMap.set(edge.target, children);
    }

    // Simple color propagation: traverse from commits that have colors
    const visited = new Set<string>();
    function propagateColor(commitHash: string, color: string) {
      if (visited.has(commitHash)) return;
      visited.add(commitHash);

      if (!commitColorMap.has(commitHash)) {
        commitColorMap.set(commitHash, color);
      }

      const node = graphNodeMap.get(commitHash);
      if (node?.data.kind === 'commit') {
        const commitData = node.data as CommitNodeData;
        // Propagate to first parent (main line)
        if (commitData.parentHashes.length > 0) {
          propagateColor(commitData.parentHashes[0]!, commitColorMap.get(commitHash) ?? color);
        }
      }
    }

    // Start propagation from commits that have branch labels
    for (const [id] of commitNodes) {
      if (commitColorMap.has(id)) {
        propagateColor(id, commitColorMap.get(id)!);
      }
    }

    // Default color for any remaining
    for (const [id] of commitNodes) {
      if (!commitColorMap.has(id)) {
        commitColorMap.set(id, BRANCH_COLORS[0]!);
      }
    }

    // Build React Flow nodes
    const flowNodes: Node[] = commitNodes.map(([id, node]) => {
      const commitData = node.data as CommitNodeData;
      const color = commitColorMap.get(id) ?? BRANCH_COLORS[0]!;

      return {
        id,
        type: 'commit',
        position: { x: 0, y: 0 }, // Will be set by layout
        data: {
          ...commitData,
          color,
          isHead: node.isHead,
          isCurrentBranch: node.isCurrentBranch,
          isSelected: id === get().selectedNodeId,
        },
      };
    });

    // Add Working Directory node if there are uncommitted changes
    const wdGraphNode = graph.nodes.find(
      ([, node]) => node.kind === 'working-directory'
    );
    if (wdGraphNode && graph.headHash) {
      const [wdId, wdNode] = wdGraphNode;
      const wdData = wdNode.data as WorkingDirectoryNodeData;
      const totalChanges =
        (wdData.modified?.length ?? 0) +
        (wdData.staged?.length ?? 0) +
        (wdData.untracked?.length ?? 0);

      if (totalChanges > 0) {
        flowNodes.push({
          id: wdId,
          type: 'working-directory',
          position: { x: 0, y: 0 },
          data: {
            ...wdData,
            isSelected: wdId === get().selectedNodeId,
          },
        });
      }
    }

    // Build React Flow edges
    const flowEdges: Edge[] = parentEdges
      .filter((e) => {
        // Only include edges where both nodes exist
        return graphNodeMap.has(e.source) && graphNodeMap.has(e.target);
      })
      .map((edge) => {
        const sourceColor = commitColorMap.get(edge.source) ?? BRANCH_COLORS[0]!;
        const isMerge = (() => {
          const sourceNode = graphNodeMap.get(edge.source);
          if (sourceNode?.data.kind === 'commit') {
            const commitData = sourceNode.data as CommitNodeData;
            // It's a merge edge if this is not the first parent
            return commitData.parentHashes.indexOf(edge.target) > 0;
          }
          return false;
        })();

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'smoothstep',
          animated: isMerge,
          className: isMerge ? 'merge-edge' : '',
          style: {
            stroke: sourceColor,
            strokeWidth: isMerge ? 1.5 : 2,
            opacity: isMerge ? 0.5 : 0.7,
          },
        };
      });

    // Add WD → HEAD edge if the WD node was added
    if (
      wdGraphNode &&
      flowNodes.some((n) => n.id === 'working-directory') &&
      graph.headHash
    ) {
      const headColor = commitColorMap.get(graph.headHash) ?? BRANCH_COLORS[0]!;
      flowEdges.push({
        id: 'wd->head',
        source: 'working-directory',
        target: graph.headHash,
        type: 'smoothstep',
        animated: true,
        className: 'wd-edge',
        style: {
          stroke: headColor,
          strokeWidth: 2,
          strokeDasharray: '6 4',
          opacity: 0.6,
        },
      });
    }

    // Compute layout positions
    const layoutedNodes = computeLayout(flowNodes, flowEdges);

    set({
      nodes: layoutedNodes,
      edges: flowEdges,
      headHash: graph.headHash,
      currentBranch: graph.currentBranch,
      repositoryState: graph.state,
      isLoading: false,
      commitCount: commitNodes.length,
      branchCount: branchNodes.length,
      hasMore: graph.hasMore ?? false,
      graphNodes: graphNodeMap,
    });
  },

  selectNode: (nodeId: string | null) => {
    set((state) => ({
      selectedNodeId: nodeId,
      isInspectorOpen: nodeId !== null,
      // Clear previous details when selecting a new node
      selectedNodeDetails: nodeId === null ? null : state.selectedNodeDetails,
      validActions: nodeId === null ? [] : state.validActions,
      nodes: state.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isSelected: node.id === nodeId,
        },
      })),
    }));
  },

  setTheme: (theme) => set({ theme }),

  setLoading: (loading) => set({ isLoading: loading }),

  focusNode: (_nodeId: string) => {
    // The actual focus/zoom-to-node is handled in GraphView component
    // This just triggers a re-render signal
  },

  setNodeDetails: (details: NodeDetails) => {
    set((state) => {
      // Only update if the details are for the currently selected node
      if (state.selectedNodeId === details.nodeId) {
        return { selectedNodeDetails: details };
      }
      return {};
    });
  },

  setValidActions: (actions: ValidAction[]) => {
    set({ validActions: actions });
  },

  toggleInspector: () => {
    set((state) => ({ isInspectorOpen: !state.isInspectorOpen }));
  },

  closeInspector: () => {
    set({
      isInspectorOpen: false,
      selectedNodeId: null,
      selectedNodeDetails: null,
      validActions: [],
      previewState: null,
    });
  },

  setPreviewState: (preview: PreviewData | null) => {
    set({ previewState: preview });
  },

  setGithubContext: (context: GitHubContext) => {
    set({ githubContext: context });
  },

  setShowLostCommits: (show: boolean) => {
    set({ showLostCommits: show });
    // Note: The actual graph update is triggered by Toolbar via postMessage
  },
}));
