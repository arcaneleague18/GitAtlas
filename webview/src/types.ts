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

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';

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

export interface SerializedGraph {
  readonly nodes: readonly [string, GraphNode][];
  readonly edges: readonly GraphEdge[];
  readonly headHash: string;
  readonly currentBranch: string | null;
  readonly state: RepositoryState;
  readonly timestamp: number;
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
}

export interface ValidAction {
  readonly kind: EdgeKind;
  readonly label: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
  readonly isDangerous: boolean;
}

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
  | { type: 'clear-preview' };

export type WebviewToExtensionMessage =
  | { type: 'ready' }
  | { type: 'node-selected'; nodeId: string }
  | { type: 'request-details'; nodeId: string }
  | { type: 'action-requested'; action: EdgeKind; nodeId: string }
  | { type: 'open-file'; path: string }
  | { type: 'refresh' };
