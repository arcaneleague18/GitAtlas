/**
 * GitHub Service — handles authentication and API requests to GitHub.
 * Uses native fetch and VS Code's built-in authentication.
 */

import * as vscode from 'vscode';
import type { GitService } from './git.service.js';

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

export class GithubService {
  private owner: string | null = null;
  private repo: string | null = null;
  private session: vscode.AuthenticationSession | null = null;

  constructor(
    private readonly gitService: GitService,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  /**
   * Initializes the service by finding the GitHub remote and getting an auth session.
   */
  async initialize(promptForAuth: boolean = false): Promise<boolean> {
    await this.detectRepository();
    if (!this.owner || !this.repo) return false;

    this.session = (await vscode.authentication.getSession('github', ['repo'], {
      createIfNone: promptForAuth,
    })) ?? null;

    return !!this.session;
  }

  private async detectRepository(): Promise<void> {
    try {
      const remotes = await this.gitService.getRemotes();
      
      for (const remote of remotes) {
        if (remote.fetchUrl.includes('github.com')) {
          const match = remote.fetchUrl.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
          if (match && match[1] && match[2]) {
            this.owner = match[1];
            this.repo = match[2];
            this.outputChannel.appendLine(`[GithubService] Detected repo: ${this.owner}/${this.repo}`);
            return;
          }
        }
      }
    } catch (err) {
      this.outputChannel.appendLine(`[GithubService] Failed to detect remote: ${err}`);
    }
  }

  private async fetchApi<T>(endpoint: string): Promise<T | null> {
    if (!this.session || !this.owner || !this.repo) return null;

    try {
      const url = `https://api.github.com/repos/${this.owner}/${this.repo}${endpoint}`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.session.accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        this.outputChannel.appendLine(`[GithubService] API error ${response.status}: ${await response.text()}`);
        return null;
      }

      return (await response.json()) as T;
    } catch (err) {
      this.outputChannel.appendLine(`[GithubService] Fetch error: ${err}`);
      return null;
    }
  }

  /**
   * Fetches open pull requests for the repository.
   */
  async getPullRequests(): Promise<GitHubPullRequest[]> {
    const data = await this.fetchApi<any[]>('/pulls?state=open&per_page=30');
    if (!data) return [];

    return data.map((pr) => ({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      state: pr.state,
      headBranch: pr.head.ref,
      baseBranch: pr.base.ref,
    }));
  }

  /**
   * Fetches open issues for the repository (excluding PRs).
   */
  async getIssues(): Promise<GitHubIssue[]> {
    const data = await this.fetchApi<any[]>('/issues?state=open&per_page=30');
    if (!data) return [];

    return data
      .filter((issue) => !issue.pull_request) // Issues API returns PRs too
      .map((issue) => ({
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        state: issue.state,
      }));
  }

  /**
   * Fetches the CI status for a specific commit hash.
   */
  async getCommitStatus(hash: string): Promise<GitHubCommitStatus | null> {
    const data = await this.fetchApi<any>(`/commits/${hash}/status`);
    if (!data) return null;

    // The 'state' can be pending, success, failure, error
    if (['success', 'failure', 'pending', 'error'].includes(data.state)) {
      return {
        state: data.state === 'error' ? 'failure' : data.state,
        url: data.target_url || '',
        description: data.description || '',
      };
    }
    return null;
  }
}
