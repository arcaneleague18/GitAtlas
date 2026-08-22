/**
 * Shared types for the webview.
 *
 * Re-exports the subset of types from the extension's type system
 * that the webview needs. Since we can't import from the extension
 * host directly (different build context), we duplicate the message
 * and graph types here.
 *
 * IMPORTANT: Keep these in sync with src/engine/types.ts
 */

// ── Node Types ────────────────────────────────────────────────

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

export type EdgeKind =
  | 'parent'
  | 'branch-tip'
  | 'tag-target'
  | 'stash-parent'
  | 'commit'
  | 'switch'
  | 'merge'
  | 'rebase'
  | 'reset'
  | 'reset-soft'
  | 'reset-mixed'
  | 'cherry-pick'
  | 'revert'
  | 'push'
  | 'pull'
  | 'fetch'
  | 'branch'
  | 'delete-branch'
  | 'tag'
  | 'create-tag'
  | 'stash'
  | 'apply-stash'
  | 'pop-stash';

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'conflicted';

export interface FileChange {
  readonly path: string;
  readonly status: FileChangeStatus;
  readonly oldPath?: string;
}

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
  readonly isOrphaned: boolean;
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
  readonly conflicted: readonly FileChange[];
}

export type NodeData =
  | CommitNodeData
  | BranchNodeData
  | TagNodeData
  | StashNodeData
  | WorkingDirectoryNodeData
  | { readonly kind: 'index'; readonly staged: readonly FileChange[] }
  | { readonly kind: 'detached-head'; readonly hash: string }
  | { readonly kind: 'merge-state'; readonly mergeHead: string; readonly message: string }
  | { readonly kind: 'rebase-state'; readonly onto: string; readonly currentStep: number; readonly totalSteps: number }
  | { readonly kind: 'cherry-pick-state'; readonly cherryPickHead: string };

export interface GraphNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly label: string;
  readonly data: NodeData;
  readonly isHead: boolean;
  readonly isCurrentBranch: boolean;
}

export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: EdgeKind;
  readonly label: string;
}

export type RepositoryState =
  | 'clean'
  | 'dirty'
  | 'merging'
  | 'rebasing'
  | 'cherry-picking'
  | 'reverting'
  | 'bisecting';

export interface RawRemote {
  name: string;
  fetchUrl: string;
  pushUrl: string;
}

export interface SerializedGraph {
  readonly nodes: readonly [string, GraphNode][];
  readonly edges: readonly GraphEdge[];
  readonly headHash: string;
  readonly currentBranch: string | null;
  readonly state: RepositoryState;
  readonly timestamp: number;
  readonly hasMore?: boolean;
  readonly remotes: readonly RawRemote[];
}

// ── Node Details — Inspector Panel Data ───────────────────────

export interface DiffFileStat {
  readonly path: string;
  readonly insertions: number;
  readonly deletions: number;
  readonly isBinary: boolean;
}

export interface NodeDetails {
  readonly nodeId: string;
  readonly kind: NodeKind;
  readonly label: string;
  readonly hash?: string;
  readonly author?: string;
  readonly authorEmail?: string;
  readonly timestamp?: number;
  readonly message?: string;
  readonly parentHashes?: readonly string[];
  readonly branches?: readonly string[];
  readonly tags?: readonly string[];
  readonly diffStats?: readonly DiffFileStat[];
  readonly totalInsertions?: number;
  readonly totalDeletions?: number;
  readonly totalFilesChanged?: number;
  readonly workingDirectoryStatus?: {
    readonly staged: readonly { readonly path: string; readonly status: string }[];
    readonly modified: readonly { readonly path: string; readonly status: string }[];
    readonly untracked: readonly string[];
    readonly conflicted: readonly { readonly path: string; readonly status: string }[];
  };
}

// ── Valid Actions ──────────────────────────────────────────────

export interface ValidAction {
  kind: EdgeKind;
  label: string;
  description: string;
  enabled: boolean;
  disabledReason?: string;
  isDangerous?: boolean;
  args?: any;
}

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

export interface GitHubContext {
  pullRequests: Record<string, GitHubPullRequest>; // keyed by branch name
  issues: GitHubIssue[];
  commitStatuses: Record<string, GitHubCommitStatus>; // keyed by commit hash
}

// ── Previews ──────────────────────────────────────────────────

export interface PreviewData {
  readonly action: EdgeKind;
  readonly nodeId: string;
}

// ── Messages ──────────────────────────────────────────────────

export type ExtensionToWebviewMessage =
  | { type: 'graph-update'; graph: SerializedGraph }
  | { type: 'theme-change'; theme: 'dark' | 'light' | 'high-contrast' }
  | { type: 'node-focus'; nodeId: string }
  | { type: 'loading'; loading: boolean }
  | { type: 'node-details'; nodeId: string; details: NodeDetails }
  | { type: 'valid-actions'; nodeId: string; actions: ValidAction[] }
  | { type: 'preview-action'; preview: PreviewData }
  | { type: 'clear-preview' }
  | { type: 'github-context'; context: GitHubContext }
  | { type: 'commit-message-generated'; message: string }
  | { type: 'file-search-results'; filePath: string; commits: { hash: string; shortHash: string; message: string; author: string; date: string }[] }
  | { type: 'file-purge-result'; filePath: string; success: boolean; message: string }
  | { type: 'mergeability-result'; nodeId: string; canMerge: boolean; status: 'clean' | 'conflicts' | 'up-to-date' | 'fast-forward' | 'error'; conflictFiles: string[]; aheadBehind: { ahead: number; behind: number }; message: string };

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'node-selected'; nodeId: string }
  | { type: 'request-details'; nodeId: string }
  | { type: 'action-requested'; action: EdgeKind; nodeId: string; args?: any }
  | { type: 'open-file'; path: string }
  | { type: 'show-diff'; commitHash: string; filePath: string }
  | { type: 'refresh' }
  | { type: 'toggle-lost-commits'; enabled: boolean }
  | { type: 'load-more' }
  | { type: 'edit-remote-url' }
  | { type: 'remove-remote-url' }
  | { type: 'reword-commit'; hash: string; newMessage: string }
  | { type: 'stage-file'; path: string }
  | { type: 'unstage-file'; path: string }
  | { type: 'stage-all' }
  | { type: 'unstage-all' }
  | { type: 'discard-all' }
  | { type: 'discard-file'; path: string }
  | { type: 'generate-commit-message' }
  | { type: 'commit-staged'; message: string }
  | { type: 'amend-commit' }
  | { type: 'search-file-in-history'; filePath: string }
  | { type: 'purge-file-from-history'; filePath: string }
  | { type: 'check-mergeability'; nodeId: string; ref: string };
