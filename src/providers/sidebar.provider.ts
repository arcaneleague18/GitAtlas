/**
 * Sidebar TreeView Provider — displays repository structure in the sidebar.
 *
 * Renders a hierarchical tree with sections for:
 * - Current State (HEAD, branch, clean/dirty indicator)
 * - Branches (local and remote, current highlighted)
 * - Recent Commits (last N with hash + message)
 * - Working Directory (modified / staged / untracked counts)
 * - Stashes
 * - Tags
 * - Remotes
 *
 * Each item has contextual icons and fires commands to interact
 * with the graph webview.
 */

import * as vscode from 'vscode';
import { RepositoryStateEngine } from '../engine/state-engine.js';
import type { GithubIntegrationEngine } from '../engine/github-integration.js';
import { DisposableBase } from '../utils/disposable.js';
import type {
  RepositoryGraph,
  GraphNode,
  CommitNodeData,
  BranchNodeData,
  TagNodeData,
  StashNodeData,
  WorkingDirectoryNodeData,
} from '../engine/types.js';

/** Maximum number of recent commits to show in the sidebar. */
const MAX_SIDEBAR_COMMITS = 50;

/**
 * A single item in the sidebar tree.
 */
export class SidebarTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly sidebarKind: string,
    public readonly nodeId?: string,
  ) {
    super(label, collapsibleState);
  }
}

export class SidebarProvider
  extends DisposableBase
  implements vscode.TreeDataProvider<SidebarTreeItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    SidebarTreeItem | undefined | null
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private graph: RepositoryGraph | null = null;

  constructor(
    private readonly stateEngine: RepositoryStateEngine,
    private readonly githubIntegration?: GithubIntegrationEngine
  ) {
    super();
    this.register(this._onDidChangeTreeData);

    // Rebuild tree when graph changes
    this.register(
      stateEngine.onDidChangeGraph((graph) => {
        this.graph = graph;
        this._onDidChangeTreeData.fire(undefined);
      })
    );

    if (this.githubIntegration) {
      this.register(
        this.githubIntegration.onDidChangeContext(() => {
          this._onDidChangeTreeData.fire(undefined);
        })
      );
    }
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SidebarTreeItem): SidebarTreeItem {
    return element;
  }

  getChildren(element?: SidebarTreeItem): SidebarTreeItem[] {
    if (!this.graph) {
      return [
        this.createInfoItem('Loading repository...', 'loading'),
      ];
    }

    // Root level — return section headers
    if (!element) {
      return this.getRootItems();
    }

    // Children of section headers
    switch (element.sidebarKind) {
      case 'section-state':
        return this.getStateItems();
      case 'section-branches':
        return this.getBranchItems();
      case 'section-working-directory':
        return this.getWorkingDirectoryItems();
      case 'section-stashes':
        return this.getStashItems();
      case 'section-tags':
        return this.getTagItems();
      case 'section-remotes':
        return this.getRemoteItems();
      case 'section-prs':
        return this.getPullRequestItems();
      case 'section-issues':
        return this.getIssueItems();
      default:
        return [];
    }
  }

  // ── Root Items ──────────────────────────────────────────────

  private getRootItems(): SidebarTreeItem[] {
    const items = [
      new SidebarTreeItem('Current State', vscode.TreeItemCollapsibleState.Collapsed, 'section-state'),
      new SidebarTreeItem('Branches', vscode.TreeItemCollapsibleState.Collapsed, 'section-branches'),
    ];

    if (this.githubIntegration) {
      const ctx = this.githubIntegration.context;
      if (Object.keys(ctx.pullRequests).length > 0) {
        items.push(new SidebarTreeItem(`Pull Requests (${Object.keys(ctx.pullRequests).length})`, vscode.TreeItemCollapsibleState.Collapsed, 'section-prs'));
      }
      if (ctx.issues.length > 0) {
        items.push(new SidebarTreeItem(`Issues (${ctx.issues.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'section-issues'));
      }
    }

    const commitCount = this.countNodesByKind('commit');
    const commitItem = new SidebarTreeItem(
      `Commits: ${commitCount}`,
      vscode.TreeItemCollapsibleState.None,
      'info-commits'
    );
    commitItem.iconPath = new vscode.ThemeIcon('git-commit');
    
    items.push(
      commitItem,
      new SidebarTreeItem('Working Directory', vscode.TreeItemCollapsibleState.Collapsed, 'section-working-directory')
    );

    const stashCount = this.countNodesByKind('stash');
    if (stashCount > 0) {
      items.push(new SidebarTreeItem(`Stashes (${stashCount})`, vscode.TreeItemCollapsibleState.Collapsed, 'section-stashes'));
    }

    const tagCount = this.countNodesByKind('tag');
    if (tagCount > 0) {
      items.push(new SidebarTreeItem(`Tags (${tagCount})`, vscode.TreeItemCollapsibleState.Collapsed, 'section-tags'));
    }

    const remoteNodes = this.getRemoteNames();
    if (remoteNodes.length > 0) {
      items.push(new SidebarTreeItem(`Remotes (${remoteNodes.length})`, vscode.TreeItemCollapsibleState.Collapsed, 'section-remotes'));
    }

    return items;
  }

  // ── Current State ───────────────────────────────────────────

  private getStateItems(): SidebarTreeItem[] {
    if (!this.graph) return [];

    const items: SidebarTreeItem[] = [];

    // HEAD
    const headItem = this.createInfoItem(
      this.graph.currentBranch
        ? `HEAD → ${this.graph.currentBranch}`
        : `HEAD → ${this.graph.headHash.substring(0, 7)} (detached)`,
      'head'
    );
    headItem.iconPath = new vscode.ThemeIcon(
      this.graph.currentBranch ? 'git-branch' : 'warning'
    );
    items.push(headItem);

    // Repository state
    const stateLabel = this.getStateLabel(this.graph.state);
    const stateItem = this.createInfoItem(stateLabel, 'repo-state');
    stateItem.iconPath = new vscode.ThemeIcon(
      this.getStateIcon(this.graph.state)
    );
    items.push(stateItem);

    return items;
  }

  // ── GitHub ──────────────────────────────────────────────────

  private getPullRequestItems(): SidebarTreeItem[] {
    if (!this.githubIntegration) return [];
    
    const prs = Object.values(this.githubIntegration.context.pullRequests);
    return prs.map((pr) => {
      const item = new SidebarTreeItem(
        `#${pr.number} ${pr.title}`,
        vscode.TreeItemCollapsibleState.None,
        'pr'
      );
      item.description = `[${pr.headBranch}]`;
      item.iconPath = new vscode.ThemeIcon('git-pull-request');
      
      item.command = {
        title: 'Open Pull Request',
        command: 'vscode.open',
        arguments: [vscode.Uri.parse(pr.url)],
      };
      
      return item;
    });
  }

  private getIssueItems(): SidebarTreeItem[] {
    if (!this.githubIntegration) return [];
    
    return this.githubIntegration.context.issues.map((issue) => {
      const item = new SidebarTreeItem(
        `#${issue.number} ${issue.title}`,
        vscode.TreeItemCollapsibleState.None,
        'issue'
      );
      item.iconPath = new vscode.ThemeIcon('issues');
      
      item.command = {
        title: 'Open Issue',
        command: 'vscode.open',
        arguments: [vscode.Uri.parse(issue.url)],
      };
      
      return item;
    });
  }

  // ── Branches ────────────────────────────────────────────────

  private getBranchItems(): SidebarTreeItem[] {
    if (!this.graph) return [];

    const items: SidebarTreeItem[] = [];

    // Local branches first
    const localBranches = this.getNodesByKind('branch');
    const remoteBranches = this.getNodesByKind('remote-branch');

    for (const node of localBranches) {
      const data = node.data as BranchNodeData;
      const item = new SidebarTreeItem(
        data.name,
        vscode.TreeItemCollapsibleState.None,
        'branch',
        node.id
      );

      if (data.isCurrent) {
        item.description = '● current';
        item.iconPath = new vscode.ThemeIcon('check');
      } else {
        item.iconPath = new vscode.ThemeIcon('git-branch');
      }

      // Show ahead/behind
      if (data.aheadBehind) {
        const { ahead, behind } = data.aheadBehind;
        if (ahead > 0 || behind > 0) {
          item.description = `${item.description ?? ''} ↑${ahead} ↓${behind}`.trim();
        }
      }

      item.tooltip = `Branch: ${data.name}${data.upstream ? `\nUpstream: ${data.upstream}` : ''}`;
      item.command = {
        command: 'gitTreeExplorer.selectNode',
        title: 'Select Node',
        arguments: [node.id],
      };
      items.push(item);
    }

    // Separator
    if (remoteBranches.length > 0 && localBranches.length > 0) {
      items.push(this.createInfoItem('── Remote ──', 'separator'));
    }

    for (const node of remoteBranches) {
      const data = node.data as BranchNodeData;
      const item = new SidebarTreeItem(
        data.name,
        vscode.TreeItemCollapsibleState.None,
        'remote-branch',
        node.id
      );
      item.iconPath = new vscode.ThemeIcon('cloud');
      item.command = {
        command: 'gitTreeExplorer.selectNode',
        title: 'Select Node',
        arguments: [node.id],
      };
      items.push(item);
    }

    return items;
  }


  // ── Working Directory ───────────────────────────────────────

  private getWorkingDirectoryItems(): SidebarTreeItem[] {
    const wd = this.getWorkingDirectoryNode();
    if (!wd) return [];

    const items: SidebarTreeItem[] = [];

    if (wd.staged.length > 0) {
      const staged = this.createInfoItem(
        `Staged (${wd.staged.length})`,
        'staged'
      );
      staged.iconPath = new vscode.ThemeIcon('diff-added');
      items.push(staged);

      for (const file of wd.staged) {
        const fileItem = this.createInfoItem(
          `  ${file.path}`,
          'file'
        );
        fileItem.iconPath = new vscode.ThemeIcon(this.getFileStatusIcon(file.status));
        fileItem.description = file.status;
        items.push(fileItem);
      }
    }

    if (wd.modified.length > 0) {
      const modified = this.createInfoItem(
        `Modified (${wd.modified.length})`,
        'modified'
      );
      modified.iconPath = new vscode.ThemeIcon('diff-modified');
      items.push(modified);

      for (const file of wd.modified) {
        const fileItem = this.createInfoItem(
          `  ${file.path}`,
          'file'
        );
        fileItem.iconPath = new vscode.ThemeIcon(this.getFileStatusIcon(file.status));
        fileItem.description = file.status;
        items.push(fileItem);
      }
    }

    if (wd.untracked.length > 0) {
      const untracked = this.createInfoItem(
        `Untracked (${wd.untracked.length})`,
        'untracked'
      );
      untracked.iconPath = new vscode.ThemeIcon('question');
      items.push(untracked);

      for (const path of wd.untracked) {
        const fileItem = this.createInfoItem(`  ${path}`, 'file');
        fileItem.iconPath = new vscode.ThemeIcon('file-add');
        items.push(fileItem);
      }
    }

    if (items.length === 0) {
      items.push(this.createInfoItem('Working tree clean', 'clean'));
    }

    return items;
  }

  // ── Stashes ─────────────────────────────────────────────────

  private getStashItems(): SidebarTreeItem[] {
    if (!this.graph) return [];

    return this.getNodesByKind('stash').map((node) => {
      const data = node.data as StashNodeData;
      const item = new SidebarTreeItem(
        data.message,
        vscode.TreeItemCollapsibleState.None,
        'stash',
        node.id
      );
      item.description = `stash@{${data.index}}`;
      item.iconPath = new vscode.ThemeIcon('archive');
      item.command = {
        command: 'gitTreeExplorer.selectNode',
        title: 'Select Node',
        arguments: [node.id],
      };
      return item;
    });
  }

  // ── Tags ────────────────────────────────────────────────────

  private getTagItems(): SidebarTreeItem[] {
    if (!this.graph) return [];

    return this.getNodesByKind('tag').map((node) => {
      const data = node.data as TagNodeData;
      const item = new SidebarTreeItem(
        data.name,
        vscode.TreeItemCollapsibleState.None,
        'tag',
        node.id
      );
      item.description = data.targetHash.substring(0, 7);
      item.iconPath = new vscode.ThemeIcon('tag');
      if (data.message) {
        item.tooltip = data.message;
      }
      item.command = {
        command: 'gitTreeExplorer.selectNode',
        title: 'Select Node',
        arguments: [node.id],
      };
      return item;
    });
  }

  // ── Remotes ─────────────────────────────────────────────────

  private getRemoteItems(): SidebarTreeItem[] {
    const remoteNames = this.getRemoteNames();
    return remoteNames.map((name) => {
      const item = this.createInfoItem(name, 'remote');
      item.iconPath = new vscode.ThemeIcon('cloud');
      return item;
    });
  }

  // ── Helpers ─────────────────────────────────────────────────

  private createInfoItem(label: string, kind: string): SidebarTreeItem {
    return new SidebarTreeItem(
      label,
      vscode.TreeItemCollapsibleState.None,
      kind
    );
  }

  private countNodesByKind(kind: string): number {
    if (!this.graph) return 0;
    let count = 0;
    for (const node of this.graph.nodes.values()) {
      if (node.kind === kind) count++;
    }
    return count;
  }

  private getNodesByKind(kind: string): GraphNode[] {
    if (!this.graph) return [];
    const nodes: GraphNode[] = [];
    for (const node of this.graph.nodes.values()) {
      if (node.kind === kind) nodes.push(node);
    }
    return nodes;
  }

  private getWorkingDirectoryNode(): WorkingDirectoryNodeData | null {
    if (!this.graph) return null;
    const node = this.graph.nodes.get('working-directory');
    if (!node || node.data.kind !== 'working-directory') return null;
    return node.data;
  }

  private getRemoteNames(): string[] {
    if (!this.graph) return [];
    const remotes = new Set<string>();
    for (const node of this.graph.nodes.values()) {
      if (node.kind === 'remote-branch') {
        const data = node.data as BranchNodeData;
        const remoteName = data.name.split('/')[0];
        if (remoteName) remotes.add(remoteName);
      }
    }
    return Array.from(remotes);
  }

  private getStateLabel(state: string): string {
    switch (state) {
      case 'clean': return '✓ Clean';
      case 'dirty': return '● Uncommitted changes';
      case 'merging': return '⚡ Merge in progress';
      case 'rebasing': return '⚡ Rebase in progress';
      case 'cherry-picking': return '⚡ Cherry-pick in progress';
      case 'reverting': return '⚡ Revert in progress';
      case 'bisecting': return '⚡ Bisect in progress';
      default: return state;
    }
  }

  private getStateIcon(state: string): string {
    switch (state) {
      case 'clean': return 'pass-filled';
      case 'dirty': return 'circle-filled';
      case 'merging':
      case 'rebasing':
      case 'cherry-picking':
      case 'reverting':
      case 'bisecting':
        return 'warning';
      default:
        return 'info';
    }
  }

  private getFileStatusIcon(status: string): string {
    switch (status) {
      case 'added': return 'diff-added';
      case 'modified': return 'diff-modified';
      case 'deleted': return 'diff-removed';
      case 'renamed': return 'diff-renamed';
      default: return 'file';
    }
  }
}
