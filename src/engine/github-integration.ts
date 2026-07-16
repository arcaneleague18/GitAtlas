/**
 * GitHub Integration Engine — bridges the local Git state with GitHub remote data.
 */

import * as vscode from 'vscode';
import { GithubService, GitHubIssue, GitHubPullRequest, GitHubCommitStatus } from '../services/github.service.js';
import { RepositoryStateEngine } from './state-engine.js';
import { DisposableBase } from '../utils/disposable.js';
import type { GitHubContext } from './types.js';

export class GithubIntegrationEngine extends DisposableBase {
  private _onDidChangeContext = new vscode.EventEmitter<GitHubContext>();
  public readonly onDidChangeContext = this._onDidChangeContext.event;

  private currentContext: GitHubContext = {
    pullRequests: {},
    issues: [],
    commitStatuses: {},
  };

  constructor(
    private readonly githubService: GithubService,
    private readonly stateEngine: RepositoryStateEngine
  ) {
    super();
    this.register(
      this.stateEngine.onDidChangeGraph(() => this.updateGithubContext())
    );
  }

  private authPrompted = false;

  /**
   * Called automatically when the local Git graph updates.
   * Fetches latest GitHub data and emits it to the webview.
   */
  private async updateGithubContext() {
    // Only prompt for auth once per session
    const shouldPrompt = !this.authPrompted;
    this.authPrompted = true;
    
    // Only fetch if we have an initialized github session
    const initialized = await this.githubService.initialize(shouldPrompt);
    if (!initialized) return;

    const graph = this.stateEngine.graph;
    if (!graph) return;

    try {
      // 1. Fetch Issues
      const issues = await this.githubService.getIssues();
      this.currentContext.issues = issues;

      // 2. Fetch Pull Requests
      const prs = await this.githubService.getPullRequests();
      this.currentContext.pullRequests = {};
      for (const pr of prs) {
        // We key PRs by the head branch name for easy matching against local branches
        this.currentContext.pullRequests[pr.headBranch] = pr;
      }

      // 3. Fetch CI Statuses for the HEAD commit and recent branches
      // To avoid rate limits, we only fetch status for the current HEAD and 
      // the tips of branches that have an associated PR.
      const commitHashesToFetch = new Set<string>();
      
      const head = graph.nodes.get('HEAD');
      if (head && head.data.hash) {
        commitHashesToFetch.add(head.data.hash);
      }

      // Find branch nodes that match PRs
      for (const [nodeId, node] of graph.nodes.entries()) {
        if (node.kind === 'branch' || node.kind === 'remote-branch') {
          const branchName = node.label.replace('origin/', '');
          if (this.currentContext.pullRequests[branchName]) {
            // Find the target commit hash for this branch
            const commitEdge = graph.edges.find(e => e.source === nodeId && e.kind === 'pointer');
            if (commitEdge) {
              commitHashesToFetch.add(commitEdge.target);
            }
          }
        }
      }

      this.currentContext.commitStatuses = {};
      for (const hash of commitHashesToFetch) {
        const status = await this.githubService.getCommitStatus(hash);
        if (status) {
          this.currentContext.commitStatuses[hash] = status;
        }
      }

      // Emit to listeners (e.g. SidebarProvider, GraphPanelProvider)
      this._onDidChangeContext.fire(this.currentContext);
    } catch (err) {
      console.error('[GithubIntegrationEngine] Failed to update context', err);
    }
  }

  /**
   * Allow forcing an update, e.g., if the user manually authenticates.
   */
  public async forceUpdate() {
    await this.updateGithubContext();
  }

  public get context(): GitHubContext {
    return this.currentContext;
  }
}
