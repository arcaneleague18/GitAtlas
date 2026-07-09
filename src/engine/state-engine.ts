/**
 * Repository State Engine — builds and maintains the immutable graph model.
 *
 * This is the brain of the extension. It takes raw data from GitService
 * and constructs a typed RepositoryGraph that models the repository as
 * a state machine.
 *
 * Key responsibilities:
 * - Builds GraphNodes from commits, branches, tags, stashes, working directory
 * - Builds GraphEdges for parent-child relationships and branch/tag pointers
 * - Assigns branch and tag labels to commit nodes
 * - Computes HEAD position and current branch
 * - Detects repository state (merging, rebasing, etc.)
 * - Produces immutable snapshots — never mutates the graph in place
 * - Fires events when the graph changes
 */

import * as vscode from 'vscode';
import { GitService } from '../services/git.service.js';
import { DisposableBase } from '../utils/disposable.js';
import type {
  RepositoryGraph,
  SerializedGraph,
  GraphNode,
  GraphEdge,
  CommitNodeData,
  BranchNodeData,
  TagNodeData,
  StashNodeData,
  WorkingDirectoryNodeData,
  RawCommit,
} from './types.js';

/** Color palette for branches — visually distinct, accessible colors. */
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

export class RepositoryStateEngine extends DisposableBase {
  private readonly _onDidChangeGraph = new vscode.EventEmitter<RepositoryGraph>();
  /** Fires when the graph has been rebuilt from fresh git data. */
  readonly onDidChangeGraph = this._onDidChangeGraph.event;

  private _graph: RepositoryGraph | null = null;
  private _branchColorMap = new Map<string, string>();
  private _colorIndex = 0;

  constructor(private readonly gitService: GitService) {
    super();
    this.register(this._onDidChangeGraph);
  }

  /** Get the current graph snapshot, or null if not yet built. */
  get graph(): RepositoryGraph | null {
    return this._graph;
  }

  /**
   * Build (or rebuild) the repository graph from fresh git data.
   * Returns the new immutable graph and fires `onDidChangeGraph`.
   */
  async buildGraph(): Promise<RepositoryGraph> {
    // Fetch all raw data in parallel
    const [head, commits, branches, tags, stashes, remotes, status, repoState] =
      await Promise.all([
        this.gitService.getHead(),
        this.gitService.getLog(),
        this.gitService.getBranches(),
        this.gitService.getTags(),
        this.gitService.getStashes(),
        this.gitService.getRemotes(),
        this.gitService.getStatus(),
        this.gitService.getRepositoryState(),
      ]);

    const nodes = new Map<string, GraphNode>();
    const edges: GraphEdge[] = [];

    // Index: which branches/tags point to each commit
    const commitBranches = new Map<string, string[]>();
    const commitTags = new Map<string, string[]>();

    for (const branch of branches) {
      const existing = commitBranches.get(branch.tipHash) ?? [];
      existing.push(branch.name);
      commitBranches.set(branch.tipHash, existing);
    }

    for (const tag of tags) {
      const existing = commitTags.get(tag.targetHash) ?? [];
      existing.push(tag.name);
      commitTags.set(tag.targetHash, existing);
    }

    // Build commit nodes
    for (const commit of commits) {
      const branchesOnCommit = commitBranches.get(commit.shortHash) ?? commitBranches.get(commit.hash) ?? [];
      const tagsOnCommit = commitTags.get(commit.shortHash) ?? commitTags.get(commit.hash) ?? [];

      const commitNode: GraphNode = {
        id: commit.hash,
        kind: 'commit',
        label: commit.message,
        isHead: commit.hash === head.hash,
        isCurrentBranch: branchesOnCommit.includes(head.branch ?? ''),
        data: {
          kind: 'commit',
          hash: commit.hash,
          shortHash: commit.shortHash,
          message: commit.message,
          author: commit.author,
          authorEmail: commit.authorEmail,
          timestamp: commit.timestamp,
          parentHashes: commit.parentHashes,
          branches: branchesOnCommit,
          tags: tagsOnCommit,
          filesChanged: 0, // Lazy-loaded for performance
        } satisfies CommitNodeData,
      };

      nodes.set(commit.hash, commitNode);

      // Create parent edges
      for (const parentHash of commit.parentHashes) {
        edges.push({
          id: `${commit.hash}->${parentHash}`,
          source: commit.hash,
          target: parentHash,
          kind: 'parent',
          label: '',
        });
      }
    }

    // Build branch nodes
    for (const branch of branches) {
      const branchColor = this.getBranchColor(branch.name);
      const branchNode: GraphNode = {
        id: `branch:${branch.name}`,
        kind: branch.isRemote ? 'remote-branch' : 'branch',
        label: branch.name,
        isHead: false,
        isCurrentBranch: branch.isCurrent,
        data: {
          kind: 'branch',
          name: branch.name,
          isRemote: branch.isRemote,
          isCurrent: branch.isCurrent,
          upstream: branch.upstream,
          tipCommitHash: branch.tipHash,
          aheadBehind: branch.aheadBehind,
        } satisfies BranchNodeData,
      };
      nodes.set(branchNode.id, branchNode);

      // Edge: branch points to its tip commit
      // Find the full hash for this tip
      const tipFullHash = findFullHash(commits, branch.tipHash);
      if (tipFullHash) {
        edges.push({
          id: `branch:${branch.name}->${tipFullHash}`,
          source: `branch:${branch.name}`,
          target: tipFullHash,
          kind: 'branch-tip',
          label: branch.name,
        });
      }

      // Store color for webview
      void branchColor;
    }

    // Build tag nodes
    for (const tag of tags) {
      const tagNode: GraphNode = {
        id: `tag:${tag.name}`,
        kind: 'tag',
        label: tag.name,
        isHead: false,
        isCurrentBranch: false,
        data: {
          kind: 'tag',
          name: tag.name,
          targetHash: tag.targetHash,
          message: tag.message,
          tagger: tag.tagger,
          date: tag.date,
        } satisfies TagNodeData,
      };
      nodes.set(tagNode.id, tagNode);

      // Edge: tag points to its target commit
      const targetFullHash = findFullHash(commits, tag.targetHash);
      if (targetFullHash) {
        edges.push({
          id: `tag:${tag.name}->${targetFullHash}`,
          source: `tag:${tag.name}`,
          target: targetFullHash,
          kind: 'tag-target',
          label: tag.name,
        });
      }
    }

    // Build stash nodes
    for (const stash of stashes) {
      const stashNode: GraphNode = {
        id: `stash:${stash.index}`,
        kind: 'stash',
        label: stash.message,
        isHead: false,
        isCurrentBranch: false,
        data: {
          kind: 'stash',
          index: stash.index,
          message: stash.message,
          parentHash: stash.parentHash,
          timestamp: stash.timestamp,
        } satisfies StashNodeData,
      };
      nodes.set(stashNode.id, stashNode);
    }

    // Build working directory node
    const wdNode: GraphNode = {
      id: 'working-directory',
      kind: 'working-directory',
      label: 'Working Directory',
      isHead: false,
      isCurrentBranch: false,
      data: {
        kind: 'working-directory',
        modified: status.modified,
        staged: status.staged,
        untracked: status.untracked,
      } satisfies WorkingDirectoryNodeData,
    };
    nodes.set(wdNode.id, wdNode);

    const graph: RepositoryGraph = {
      nodes,
      edges,
      headHash: head.hash,
      currentBranch: head.branch,
      state: repoState,
      timestamp: Date.now(),
    };

    this._graph = graph;
    this._onDidChangeGraph.fire(graph);
    return graph;
  }

  /**
   * Serialize the graph for postMessage transfer to the webview.
   * Converts Maps to arrays since Maps can't be structured-cloned.
   */
  serializeGraph(graph: RepositoryGraph): SerializedGraph {
    return {
      nodes: Array.from(graph.nodes.entries()),
      edges: graph.edges,
      headHash: graph.headHash,
      currentBranch: graph.currentBranch,
      state: graph.state,
      timestamp: graph.timestamp,
    };
  }

  /**
   * Get a deterministic color for a branch name.
   */
  getBranchColor(branchName: string): string {
    const existing = this._branchColorMap.get(branchName);
    if (existing) return existing;

    const color = BRANCH_COLORS[this._colorIndex % BRANCH_COLORS.length]!;
    this._colorIndex++;
    this._branchColorMap.set(branchName, color);
    return color;
  }

  /**
   * Get the full branch color map for the webview.
   */
  getBranchColorMap(): Record<string, string> {
    return Object.fromEntries(this._branchColorMap);
  }
}

/**
 * Find the full hash for a short hash in the commit list.
 */
function findFullHash(
  commits: RawCommit[],
  shortOrFullHash: string
): string | undefined {
  // First try exact match on full hash
  const exact = commits.find((c) => c.hash === shortOrFullHash);
  if (exact) return exact.hash;

  // Then try prefix match on short hash
  const prefix = commits.find(
    (c) => c.hash.startsWith(shortOrFullHash) || c.shortHash === shortOrFullHash
  );
  return prefix?.hash;
}
