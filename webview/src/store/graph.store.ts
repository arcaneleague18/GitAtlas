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
  RawRemote,
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
  '#f47067', // salmon red
  '#d2a8ff', // violet
  '#56d4dd', // cyan / turquoise
  '#ff9bce', // pink
  '#89b4fa', // lavender blue
  '#a6e3a1', // mint green
];

export interface BranchLegendItem {
  name: string;
  color: string;
  isCurrent: boolean;
  isRemote: boolean;
}

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
  showStashes: boolean;
  branchColors: BranchLegendItem[];
  remotes: readonly RawRemote[];

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
  setShowStashes: (show: boolean) => void;
}

/** Map to track which color is assigned to which branch. */
const branchColorMap = new Map<string, string>();

/** Strip remote prefix to match local and remote tracking counterparts (e.g. origin/main -> main). */
function getCanonicalBranchName(name: string): string {
  if (name.includes('/') && !name.endsWith('/')) {
    return name.replace(/^[^/]+\//, '');
  }
  return name;
}

/** Dynamic HSL color generator using golden ratio to guarantee unique hues beyond predefined palette. */
function generateUniqueColor(index: number): string {
  if (index < BRANCH_COLORS.length) {
    return BRANCH_COLORS[index]!;
  }
  const goldenRatioConjugate = 0.618033988749895;
  const hue = Math.floor(((index * goldenRatioConjugate) % 1) * 360);
  return `hsl(${hue}, 85%, 65%)`;
}

function getBranchColor(branchName: string): string {
  const canonical = getCanonicalBranchName(branchName);
  const existing = branchColorMap.get(canonical) || branchColorMap.get(branchName);
  if (existing) return existing;

  const assignedColors = new Set(branchColorMap.values());
  let colorIdx = assignedColors.size;
  let color = generateUniqueColor(colorIdx);

  // Guarantee no two distinct branches get the same color
  while (assignedColors.has(color)) {
    colorIdx++;
    color = generateUniqueColor(colorIdx);
  }

  branchColorMap.set(canonical, color);
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
  showStashes: true,
  branchColors: [],
  remotes: [],
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

    // Filter to only parent edges (structural commit-to-commit)
    const parentEdges = graph.edges.filter((e) => e.kind === 'parent');

    // Determine branch color for each commit node
    const commitColorMap = new Map<string, string>();
    for (const [id, node] of commitNodes) {
      if (node.data.kind === 'commit') {
        const commitData = node.data as CommitNodeData;
        if (commitData.branches.length > 0) {
          // Sort branches by priority to find the best primary branch
          const sortedBranches = [...commitData.branches].sort((a, b) => {
            if (a === graph.currentBranch) return -1;
            if (b === graph.currentBranch) return 1;
            
            const aIsMain = a === 'main' || a === 'master';
            const bIsMain = b === 'main' || b === 'master';
            if (aIsMain && !bIsMain) return -1;
            if (!aIsMain && bIsMain) return 1;
            
            const aIsRemote = a.includes('/');
            const bIsRemote = b.includes('/');
            if (!aIsRemote && bIsRemote) return -1;
            if (aIsRemote && !bIsRemote) return 1;
            
            return a.localeCompare(b);
          });
          
          const primaryBranch = sortedBranches[0]!;
          commitColorMap.set(id, getBranchColor(primaryBranch));
        }
      }
    }

    // Build branch legend items
    const branchColorsList: BranchLegendItem[] = [];
    const seenBranchNames = new Set<string>();

    // 1. Local branch nodes first
    for (const [, node] of graph.nodes) {
      if (node.kind === 'branch') {
        const name = node.label;
        if (!seenBranchNames.has(name)) {
          seenBranchNames.add(name);
          branchColorsList.push({
            name,
            color: getBranchColor(name),
            isCurrent: node.isCurrentBranch || name === graph.currentBranch,
            isRemote: false,
          });
        }
      }
    }

    // 2. Commit node branch labels
    for (const [, node] of commitNodes) {
      if (node.data.kind === 'commit') {
        const commitData = node.data as CommitNodeData;
        for (const b of commitData.branches) {
          if (!b.includes('/') && !seenBranchNames.has(b)) {
            seenBranchNames.add(b);
            branchColorsList.push({
              name: b,
              color: getBranchColor(b),
              isCurrent: b === graph.currentBranch,
              isRemote: false,
            });
          }
        }
      }
    }

    // 3. Remote branch nodes if not already covered
    for (const [, node] of graph.nodes) {
      if (node.kind === 'remote-branch') {
        const fullRemoteName = node.label;
        const shortName = fullRemoteName.replace(/^[^/]+\//, '');
        if (!seenBranchNames.has(shortName) && !seenBranchNames.has(fullRemoteName)) {
          seenBranchNames.add(fullRemoteName);
          branchColorsList.push({
            name: fullRemoteName,
            color: getBranchColor(fullRemoteName),
            isCurrent: false,
            isRemote: true,
          });
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

    // Add Stash nodes
    const stashGraphNodes = graph.nodes.filter(
      ([, node]) => node.kind === 'stash'
    );
    for (const [stashId, stashNode] of stashGraphNodes) {
      flowNodes.push({
        id: stashId,
        type: 'stash',
        position: { x: 0, y: 0 },
        data: {
          ...stashNode.data,
          isSelected: stashId === get().selectedNodeId,
        },
      });
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
          type: 'dagre',
          animated: isMerge,
          className: isMerge ? 'merge-edge' : '',
          style: {
            stroke: sourceColor,
            strokeWidth: isMerge ? 1.5 : 2,
            opacity: isMerge ? 0.5 : 0.7,
          },
        };
      });

    // Add Stash edges
    const stashEdges = graph.edges.filter((e) => e.kind === 'stash-parent');
    for (const edge of stashEdges) {
      if (graphNodeMap.has(edge.source) && graphNodeMap.has(edge.target)) {
        const parentColor = commitColorMap.get(edge.target) ?? BRANCH_COLORS[0]!;
        flowEdges.push({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'dagre',
          animated: false,
          className: 'stash-edge',
          style: {
            stroke: parentColor,
            strokeWidth: 2,
            strokeDasharray: '4 4',
            opacity: 0.8,
          },
        });
      }
    }

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
        type: 'dagre',
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

    // Compute layout positions and edge routing
    const { nodes: layoutedNodes, edges: layoutedEdges } = computeLayout(flowNodes, flowEdges);

    const currentSelectedId = get().selectedNodeId;
    const isSelectedNodeDeleted = currentSelectedId && !graphNodeMap.has(currentSelectedId);

    set({
      nodes: layoutedNodes,
      edges: layoutedEdges,
      headHash: graph.headHash,
      currentBranch: graph.currentBranch,
      repositoryState: graph.state,
      isLoading: false,
      commitCount: commitNodes.length,
      branchCount: branchColorsList.length,
      branchColors: branchColorsList,
      remotes: graph.remotes ?? [],
      hasMore: graph.hasMore ?? false,
      graphNodes: graphNodeMap,
      ...(isSelectedNodeDeleted && {
        selectedNodeId: null,
        isInspectorOpen: false,
        selectedNodeDetails: null,
        validActions: [],
      }),
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

  setShowStashes: (show: boolean) => {
    set({ showStashes: show });
  },
}));
