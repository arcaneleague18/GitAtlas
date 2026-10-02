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
import type { LayoutOptions } from '../layouts/dagre';
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
  RebaseProgress,
} from '../types';

/** Branch color palette — curated for maximum visual distinction across the color wheel. */
const BRANCH_COLORS = [
  '#58a6ff', // 0: Blue (212°)
  '#3fb950', // 1: Green (130°)
  '#f0883e', // 2: Orange (25°)
  '#bc8cff', // 3: Purple (266°)
  '#d29922', // 4: Yellow / Gold (45°)
  '#ff7b72', // 5: Red (4°)
  '#22d3ee', // 6: Cyan / Turquoise (189°)
  '#f472b6', // 7: Pink / Magenta (326°)
  '#a3e635', // 8: Lime (84°)
  '#818cf8', // 9: Indigo (239°)
  '#fb7185', // 10: Rose (349°)
  '#34d399', // 11: Mint (160°)
  '#e879f9', // 12: Fuchsia (292°)
  '#f59e0b', // 13: Amber (38°)
  '#38bdf8', // 14: Sky Blue (199°)
  '#e11d48', // 15: Crimson (347°)
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
  rebaseProgress?: RebaseProgress;
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

  // Graph layout settings
  nodeSpacing: number;
  rankSpacing: number;

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
  setGraphSettings: (settings: { nodeSpacing: number; rankSpacing: number }) => void;
}

/** Map to track which color is assigned to which branch. */
const branchColorMap = new Map<string, string>();

/** Strip remote prefix to match local and remote tracking counterparts (e.g. origin/main -> main). */
function getCanonicalBranchName(name: string, knownRemotes?: Set<string>): string {
  const slashIdx = name.indexOf('/');
  if (slashIdx > 0 && slashIdx < name.length - 1) {
    const prefix = name.substring(0, slashIdx);
    // Only strip prefix if it is actually a known remote
    if (knownRemotes ? knownRemotes.has(prefix) : (prefix === 'origin' || prefix === 'upstream')) {
      return name.substring(slashIdx + 1);
    }
  }
  return name;
}

function getHueFromColor(color: string): number {
  if (color.startsWith('hsl')) {
    const match = color.match(/hsl\(\s*(\d+)/);
    if (match) return parseInt(match[1]!, 10);
  }
  if (color.startsWith('#')) {
    const hex = color.slice(1);
    const r = parseInt(hex.substring(0, 2), 16) / 255;
    const g = parseInt(hex.substring(2, 4), 16) / 255;
    const b = parseInt(hex.substring(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h = 0;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = Math.round(h * 60);
    if (h < 0) h += 360;
    return h;
  }
  return 0;
}

/**
 * Generate a unique color with guaranteed maximum visual distance from all existing assigned colors.
 */
function generateNextUniqueColor(assignedColors: Set<string>): string {
  // First, pick from predefined palette if any unassigned
  for (const c of BRANCH_COLORS) {
    if (!assignedColors.has(c)) {
      return c;
    }
  }

  // When predefined palette is exhausted, find the largest angular gap between existing hues
  // and place the next color at the exact midpoint of that gap.
  const existingHues = Array.from(assignedColors)
    .map(getHueFromColor)
    .sort((a, b) => a - b);

  if (existingHues.length === 0) {
    return BRANCH_COLORS[0]!;
  }

  let maxGap = 0;
  let bestMidpoint = (existingHues[0]! + 180) % 360;

  for (let i = 0; i < existingHues.length; i++) {
    const current = existingHues[i]!;
    const next = i === existingHues.length - 1 ? existingHues[0]! + 360 : existingHues[i + 1]!;
    const gap = next - current;
    if (gap > maxGap) {
      maxGap = gap;
      bestMidpoint = Math.round((current + gap / 2) % 360);
    }
  }

  let lightness = 65;
  if (bestMidpoint >= 40 && bestMidpoint <= 90) {
    lightness = 50;
  }

  return `hsl(${bestMidpoint}, 85%, ${lightness}%)`;
}

function getBranchColor(branchName: string, knownRemotes?: Set<string>): string {
  const canonical = getCanonicalBranchName(branchName, knownRemotes);
  const existing = branchColorMap.get(canonical) || branchColorMap.get(branchName);
  if (existing) return existing;

  const assignedColors = new Set(branchColorMap.values());
  const color = generateNextUniqueColor(assignedColors);

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
  rebaseProgress: undefined,
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
  nodeSpacing: 280,
  rankSpacing: 60,

  setGraph: (graph: SerializedGraph) => {
    const graphNodeMap = new Map(graph.nodes);

    // Clear stale branch color assignments so deleted/renamed branches
    // don't hold color slots across refreshes
    branchColorMap.clear();

    const knownRemotes = new Set((graph.remotes ?? []).map((r) => r.name));
    knownRemotes.add('origin');
    knownRemotes.add('upstream');

    // Filter to only commit nodes for the graph view
    const commitNodes: [string, GraphNode][] = graph.nodes.filter(
      ([, node]) => node.kind === 'commit'
    );

    // Filter to only parent edges (structural commit-to-commit)
    const parentEdges = graph.edges.filter((e) => e.kind === 'parent');

    // Collect all unique branch names across branch nodes and commit branch labels
    const allBranchNames = new Set<string>();
    if (graph.currentBranch) {
      allBranchNames.add(graph.currentBranch);
    }
    for (const [, node] of graph.nodes) {
      if (node.kind === 'branch' || node.kind === 'remote-branch') {
        allBranchNames.add(node.label);
      }
    }
    for (const [, node] of commitNodes) {
      if (node.data.kind === 'commit') {
        const commitData = node.data as CommitNodeData;
        for (const b of commitData.branches) {
          allBranchNames.add(b);
        }
      }
    }

    // Helper to get priority score for deterministic ordering
    const getBranchPriorityScore = (bName: string): number => {
      const canonical = getCanonicalBranchName(bName, knownRemotes);
      if (bName === graph.currentBranch || canonical === graph.currentBranch) {
        return 0;
      }
      if (canonical === 'main' || canonical === 'master') {
        return 1;
      }
      if (!bName.includes('/')) {
        return 2; // Local branch
      }
      return 3; // Remote branch
    };

    // Sort all branches deterministically: current branch -> main/master -> local -> remote -> alphabetical
    const sortedBranchNames = Array.from(allBranchNames).sort((a, b) => {
      const pA = getBranchPriorityScore(a);
      const pB = getBranchPriorityScore(b);
      if (pA !== pB) return pA - pB;
      return a.localeCompare(b);
    });

    // Pre-assign colors in deterministic priority order so color slots are stable
    for (const bName of sortedBranchNames) {
      getBranchColor(bName, knownRemotes);
    }

    // Build branch legend items
    const branchColorsList: BranchLegendItem[] = [];
    const seenLegendNames = new Set<string>();

    for (const name of sortedBranchNames) {
      const isRemote = name.includes('/');
      const shortName = getCanonicalBranchName(name, knownRemotes);

      if (isRemote && seenLegendNames.has(shortName)) {
        continue;
      }
      if (seenLegendNames.has(name)) {
        continue;
      }
      seenLegendNames.add(name);

      branchColorsList.push({
        name,
        color: getBranchColor(name, knownRemotes),
        isCurrent: name === graph.currentBranch || (!isRemote && shortName === graph.currentBranch),
        isRemote,
      });
    }

    // Determine branch tips to start first-parent color propagation
    interface BranchTip {
      commitHash: string;
      branchName: string;
      priority: number;
      timestamp: number;
    }

    const branchTips: BranchTip[] = [];

    // 1. HEAD commit (highest priority: score 0)
    if (graph.headHash) {
      const headBranchName = graph.currentBranch ?? 'main';
      const headNode = graphNodeMap.get(graph.headHash);
      const headData = headNode?.data as CommitNodeData | undefined;
      branchTips.push({
        commitHash: graph.headHash,
        branchName: headBranchName,
        priority: 0,
        timestamp: headData?.timestamp ?? Infinity,
      });
    }

    // 2. Branch-tip edges
    for (const edge of graph.edges) {
      if (edge.kind === 'branch-tip') {
        const branchName = edge.label || edge.source.replace(/^branch:/, '');
        const targetNode = graphNodeMap.get(edge.target);
        const targetData = targetNode?.data as CommitNodeData | undefined;
        branchTips.push({
          commitHash: edge.target,
          branchName,
          priority: getBranchPriorityScore(branchName),
          timestamp: targetData?.timestamp ?? 0,
        });
      }
    }

    // 3. Commits with branch labels
    for (const [id, node] of commitNodes) {
      if (node.data.kind === 'commit') {
        const commitData = node.data as CommitNodeData;
        for (const b of commitData.branches) {
          branchTips.push({
            commitHash: id,
            branchName: b,
            priority: getBranchPriorityScore(b),
            timestamp: commitData.timestamp ?? 0,
          });
        }
      }
    }

    // Sort branch tips: primary branches first (currentBranch, main, master), then local, then remote, then timestamp
    branchTips.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      return a.branchName.localeCompare(b.branchName);
    });

    // Final color map for commits
    const commitColorMap = new Map<string, string>();
    const visited = new Set<string>();

    // Propagate branch color down its first-parent chain until hitting an already-visited commit
    function propagateColor(startHash: string, color: string) {
      let curr: string | undefined = startHash;
      while (curr) {
        if (visited.has(curr)) {
          break;
        }
        visited.add(curr);
        commitColorMap.set(curr, color);

        const node = graphNodeMap.get(curr);
        if (node?.data.kind === 'commit') {
          const commitData = node.data as CommitNodeData;
          curr = commitData.parentHashes?.[0];
        } else {
          curr = undefined;
        }
      }
    }

    // Propagate from prioritized branch tips
    for (const tip of branchTips) {
      if (!visited.has(tip.commitHash)) {
        const color = getBranchColor(tip.branchName, knownRemotes);
        propagateColor(tip.commitHash, color);
      }
    }

    // Default color for any remaining unreachable commits
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
    if (wdGraphNode) {
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
        const isMerge = (() => {
          const sourceNode = graphNodeMap.get(edge.source);
          if (sourceNode?.data.kind === 'commit') {
            const commitData = sourceNode.data as CommitNodeData;
            // It's a merge edge if this is not the first parent
            return commitData.parentHashes.indexOf(edge.target) > 0;
          }
          return false;
        })();

        // Normal edges use the source (child) commit's color.
        // Merge edges use the target (merged-in branch) commit's color
        // so the line visually shows where the code came from.
        const edgeColor = isMerge
          ? (commitColorMap.get(edge.target) ?? BRANCH_COLORS[0]!)
          : (commitColorMap.get(edge.source) ?? BRANCH_COLORS[0]!);

        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: 'dagre',
          animated: isMerge,
          className: isMerge ? 'merge-edge' : '',
          style: {
            stroke: edgeColor,
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
    const layoutOptions: LayoutOptions = {
      nodeSep: get().nodeSpacing,
      rankSep: get().rankSpacing,
    };
    const { nodes: layoutedNodes, edges: layoutedEdges } = computeLayout(flowNodes, flowEdges, layoutOptions);

    const currentSelectedId = get().selectedNodeId;
    const isSelectedNodeDeleted = currentSelectedId && !graphNodeMap.has(currentSelectedId);

    set({
      nodes: layoutedNodes,
      edges: layoutedEdges,
      headHash: graph.headHash,
      currentBranch: graph.currentBranch,
      repositoryState: graph.state,
      rebaseProgress: graph.rebaseProgress,
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

  setGraphSettings: (settings: { nodeSpacing: number; rankSpacing: number }) => {
    const prev = get();
    if (prev.nodeSpacing === settings.nodeSpacing && prev.rankSpacing === settings.rankSpacing) return;
    set({ nodeSpacing: settings.nodeSpacing, rankSpacing: settings.rankSpacing });
    // Re-layout existing nodes with the new spacing
    const { nodes, edges } = get();
    if (nodes.length > 0) {
      const layoutOptions: LayoutOptions = {
        nodeSep: settings.nodeSpacing,
        rankSep: settings.rankSpacing,
      };
      const { nodes: layoutedNodes, edges: layoutedEdges } = computeLayout(nodes, edges, layoutOptions);
      set({ nodes: layoutedNodes, edges: layoutedEdges });
    }
  },
}));
