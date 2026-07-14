/**
 * Core type definitions for Git Tree Explorer.
 *
 * Models Git as a state machine where:
 * - Nodes represent repository states (commits, branches, working directory, etc.)
 * - Edges represent Git operations (commit, checkout, merge, etc.)
 *
 * This module is the single source of truth for all shared types
 * between the extension host and webview.
 */

// ============================================================
// Node Types — Repository States
// ============================================================

/** All possible kinds of nodes in the repository graph. */
export type NodeKind =
  | 'commit'
  | 'working-directory'
  | 'index'
  | 'branch'
  | 'remote-branch'
  | 'tag'
  | 'stash'
  | 'detached-head'
  | 'merge-state'
  | 'rebase-state'
  | 'cherry-pick-state';

/** A node in the repository graph. */
export interface GraphNode {
  /** Unique identifier (commit hash, branch name, "working-directory", etc.) */
  readonly id: string;
  /** What kind of repository state this node represents. */
  readonly kind: NodeKind;
  /** Human-readable label for the node. */
  readonly label: string;
  /** Additional data depending on `kind`. */
  readonly data: NodeData;
  /** Whether this node is the current HEAD. */
  readonly isHead: boolean;
  /** Whether this node belongs to the current branch. */
  readonly isCurrentBranch: boolean;
}

/** Discriminated union of node data by kind. */
export type NodeData =
  | CommitNodeData
  | BranchNodeData
  | TagNodeData
  | StashNodeData
  | WorkingDirectoryNodeData
  | IndexNodeData
  | DetachedHeadNodeData
  | MergeStateNodeData
  | RebaseStateNodeData
  | CherryPickStateNodeData;

export interface CommitNodeData {
  readonly kind: 'commit';
  readonly hash: string;
  readonly shortHash: string;
  readonly message: string;
  readonly author: string;
  readonly authorEmail: string;
  readonly timestamp: number;
  readonly parentHashes: readonly string[];
  readonly branches: readonly string[];
  readonly tags: readonly string[];
  readonly filesChanged: number;
}

export interface BranchNodeData {
  readonly kind: 'branch';
  readonly name: string;
  readonly isRemote: boolean;
  readonly isCurrent: boolean;
  readonly upstream: string | null;
  readonly tipCommitHash: string;
  readonly aheadBehind: { ahead: number; behind: number } | null;
}

export interface TagNodeData {
  readonly kind: 'tag';
  readonly name: string;
  readonly targetHash: string;
  readonly message: string | null;
  readonly tagger: string | null;
  readonly date: number | null;
}

export interface StashNodeData {
  readonly kind: 'stash';
  readonly index: number;
  readonly message: string;
  readonly parentHash: string;
  readonly timestamp: number;
}

export interface WorkingDirectoryNodeData {
  readonly kind: 'working-directory';
  readonly modified: readonly FileChange[];
  readonly staged: readonly FileChange[];
  readonly untracked: readonly string[];
}

export interface IndexNodeData {
  readonly kind: 'index';
  readonly staged: readonly FileChange[];
}

export interface DetachedHeadNodeData {
  readonly kind: 'detached-head';
  readonly hash: string;
}

export interface MergeStateNodeData {
  readonly kind: 'merge-state';
  readonly mergeHead: string;
  readonly message: string;
}

export interface RebaseStateNodeData {
  readonly kind: 'rebase-state';
  readonly onto: string;
  readonly currentStep: number;
  readonly totalSteps: number;
}

export interface CherryPickStateNodeData {
  readonly kind: 'cherry-pick-state';
  readonly cherryPickHead: string;
}

// ============================================================
// Edge Types — Git Operations
// ============================================================

/** All possible kinds of edges (Git operations) in the state machine. */
export type EdgeKind =
  | 'parent'          // structural: commit parent relationship
  | 'branch-tip'      // structural: branch points to commit
  | 'tag-target'      // structural: tag points to commit
  | 'stash-parent'    // structural: stash based on commit
  | 'commit'
  | 'checkout'
  | 'merge'
  | 'rebase'
  | 'reset'
  | 'cherry-pick'
  | 'push'
  | 'pull'
  | 'fetch'
  | 'branch'
  | 'delete-branch'
  | 'tag'
  | 'stash'
  | 'apply-stash'
  | 'pop-stash';

/** An edge in the repository graph. */
export interface GraphEdge {
  /** Unique identifier for this edge. */
  readonly id: string;
  /** Source node ID. */
  readonly source: string;
  /** Target node ID. */
  readonly target: string;
  /** What kind of operation this edge represents. */
  readonly kind: EdgeKind;
  /** Human-readable label. */
  readonly label: string;
}

// ============================================================
// File Change
// ============================================================

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

export interface FileChange {
  readonly path: string;
  readonly status: FileChangeStatus;
  readonly oldPath?: string;
}

// ============================================================
// Repository Graph — The Complete State
// ============================================================

/** Current state of the repository (e.g., normal, merging, rebasing). */
export type RepositoryState =
  | 'clean'
  | 'dirty'
  | 'merging'
  | 'rebasing'
  | 'cherry-picking'
  | 'reverting'
  | 'bisecting';

/** The complete immutable graph representing the repository state. */
export interface RepositoryGraph {
  /** All nodes indexed by ID. */
  readonly nodes: ReadonlyMap<string, GraphNode>;
  /** All structural and operational edges. */
  readonly edges: readonly GraphEdge[];
  /** The commit hash that HEAD points to. */
  readonly headHash: string;
  /** The current branch name, or null if detached. */
  readonly currentBranch: string | null;
  /** The overall repository state. */
  readonly state: RepositoryState;
  /** Timestamp when this graph snapshot was created. */
  readonly timestamp: number;
}

// ============================================================
// Valid Actions — State Machine Transitions
// ============================================================

export interface ValidAction {
  /** The edge kind for this action. */
  readonly kind: EdgeKind;
  /** Human-readable name. */
  readonly label: string;
  /** Plain English description (for beginner mode). */
  readonly description: string;
  /** Whether this action is currently available. */
  readonly enabled: boolean;
  /** If disabled, why. */
  readonly disabledReason?: string;
  /** Whether this action is destructive / dangerous. */
  readonly isDangerous: boolean;
}

// ============================================================
// Node Details — Inspector Panel Data
// ============================================================

/** Per-file diff statistics. */
export interface DiffFileStat {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly isBinary: boolean;
}

/** Full details for a node, fetched on demand for the inspector panel. */
export interface NodeDetails {
  readonly nodeId: string;
  readonly kind: NodeKind;
  readonly label: string;
  /** Commit-specific fields (null for non-commit nodes). */
  readonly hash?: string;
  readonly author?: string;
  readonly authorEmail?: string;
  readonly timestamp?: number;
  readonly message?: string;
  readonly parentHashes?: readonly string[];
  readonly branches?: readonly string[];
  readonly tags?: readonly string[];
  /** Diff stats (fetched on demand). */
  readonly diffStats?: readonly DiffFileStat[];
  readonly totalInsertions?: number;
  readonly totalDeletions?: number;
  readonly totalFilesChanged?: number;
}

// ============================================================
// Messages — Extension ↔ Webview Communication
// ============================================================

/** Messages from Extension Host → Webview */
// ── GitHub Integration ────────────────────────────────────────

export interface GitHubIssue {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
}

export interface GitHubPullRequest extends GitHubIssue {
  headBranch: string;
  baseBranch: string;
}

export interface GitHubCommitStatus {
  state: 'success' | 'failure' | 'pending';
  url: string;
  description: string;
}

// ── Previews ──────────────────────────────────────────────────

export interface PreviewData {
  readonly action: EdgeKind;
  readonly nodeId: string;
}

export interface GitHubContext {
  pullRequests: Record<string, GitHubPullRequest>; // keyed by branch name
  issues: GitHubIssue[];
  commitStatuses: Record<string, GitHubCommitStatus>; // keyed by commit hash
}

export type ExtensionToWebviewMessage =
  | { type: 'graph-update'; graph: SerializedGraph }
  | { type: 'theme-change'; theme: 'dark' | 'light' | 'high-contrast' }
  | { type: 'node-focus'; nodeId: string }
  | { type: 'loading'; loading: boolean }
  | { type: 'node-details'; nodeId: string; details: NodeDetails }
  | { type: 'valid-actions'; nodeId: string; actions: ValidAction[] }
  | { type: 'preview-action'; preview: PreviewData }
  | { type: 'clear-preview' }
  | { type: 'github-context'; context: GitHubContext };

/** Messages from Webview → Extension Host */
export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'node-selected'; nodeId: string }
  | { type: 'request-details'; nodeId: string }
  | { type: 'action-requested'; action: EdgeKind; nodeId: string }
  | { type: 'open-file'; path: string }
  | { type: 'refresh' };

/**
 * Serialized version of RepositoryGraph for postMessage transfer.
 * Maps are converted to arrays of entries since they can't be
 * structured-cloned across the webview boundary.
 */
export interface SerializedGraph {
  readonly nodes: readonly [string, GraphNode][];
  readonly edges: readonly GraphEdge[];
  readonly headHash: string;
  readonly currentBranch: string | null;
  readonly state: RepositoryState;
  readonly timestamp: number;
}

// ============================================================
// Git Service Types — Raw Data from Git CLI
// ============================================================

export interface RawCommit {
  hash: string;
  shortHash: string;
  parentHashes: string[];
  author: string;
  authorEmail: string;
  timestamp: number;
  message: string;
  refs: string;
}

export interface RawBranch {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  upstream: string | null;
  tipHash: string;
  aheadBehind: { ahead: number; behind: number } | null;
}

export interface RawTag {
  name: string;
  targetHash: string;
  message: string | null;
  tagger: string | null;
  date: number | null;
}

export interface RawStash {
  index: number;
  message: string;
  hash: string;
  timestamp: number;
}

export interface RawRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface RawStatus {
  modified: FileChange[];
  staged: FileChange[];
  untracked: string[];
}

export interface RawHead {
  hash: string;
  branch: string | null;
  isDetached: boolean;
}

// ============================================================
// Sidebar Types
// ============================================================

export type SidebarItemKind =
  | 'header'
  | 'state-indicator'
  | 'branch'
  | 'commit'
  | 'working-directory'
  | 'stash'
  | 'tag'
  | 'remote'
  | 'file';

export interface SidebarItem {
  readonly id: string;
  readonly kind: SidebarItemKind;
  readonly label: string;
  readonly description?: string;
  readonly tooltip?: string;
  readonly iconId?: string;
  readonly children?: readonly SidebarItem[];
  readonly contextValue?: string;
  readonly command?: string;
  readonly commandArgs?: readonly unknown[];
}
