/**
 * Action Executor — The central controller for executing Git actions.
 *
 * Architecture Flow:
 * 1. Webview requests an action (e.g. checkout, reset).
 * 2. ActionExecutor validates the request.
 * 3. Sends a preview payload to the Webview.
 * 4. Shows a VS Code native confirmation dialog (if dangerous).
 * 5. Executes the Git command via GitService.
 * 6. Handles errors via ErrorParser.
 * 7. Triggers a full state refresh.
 */

import * as vscode from 'vscode';
import { GitService } from '../services/git.service.js';
import { RepositoryStateEngine } from './state-engine.js';
import { parseGitError } from './error-parser.js';
import type { EdgeKind } from './types.js';

export class ActionExecutor {
  constructor(
    private readonly gitService: GitService,
    private readonly stateEngine: RepositoryStateEngine,
    private readonly outputChannel: vscode.OutputChannel
  ) {}

  /**
   * Main entry point called by GraphPanelProvider when webview requests an action.
   */
  async handleActionRequest(
    action: EdgeKind,
    nodeId: string,
    postMessage: (msg: any) => void
  ): Promise<void> {
    const graph = this.stateEngine.graph;
    if (!graph) return;

    const node = graph.nodes.get(nodeId);
    if (!node) {
      vscode.window.showErrorMessage(`Cannot execute ${action}: Node ${nodeId} not found.`);
      return;
    }

    try {
      // 1. Send Preview to Webview
      postMessage({
        type: 'preview-action',
        preview: { action, nodeId },
      });

      // 2. Validate & Confirm
      const confirmed = await this.confirmAction(action, node);
      if (!confirmed) {
        postMessage({ type: 'clear-preview' });
        return;
      }

      // 3. Execute
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Git: ${this.getVerb(action)}...`,
          cancellable: false,
        },
        async () => {
          await this.executeCommand(action, node);
        }
      );

      // 4. Success Notification
      vscode.window.showInformationMessage(`Successfully completed ${action}.`);
    } catch (err: any) {
      // 5. Error Handling
      const stderr = err.stderr || err.message || 'Unknown error';
      const parsedError = parseGitError(stderr, action);
      
      const viewDetails = 'View Details';
      vscode.window.showErrorMessage(
        `${parsedError.message} ${parsedError.reason} ${parsedError.nextSteps}`,
        viewDetails
      ).then(choice => {
        if (choice === viewDetails) {
          this.outputChannel.show();
        }
      });
    } finally {
      // 6. Cleanup & Refresh
      postMessage({ type: 'clear-preview' });
      await this.stateEngine.buildGraph();
    }
  }

  /**
   * Prompts the user for confirmation if the action is dangerous,
   * or for input if the action requires it (branch name, tag name).
   *
   * Non-destructive actions are confirmed in the webview's ActionPreviewPanel,
   * so they pass through here without an extra dialog.
   */
  private async confirmAction(action: EdgeKind, node: any): Promise<boolean> {
    // Destructive actions get a native VS Code warning as a second safety net
    if (action === 'reset' || action === 'delete-branch') {
      const confirmText = action === 'reset' ? 'Reset (Hard)' : 'Delete Branch';
      const choice = await vscode.window.showWarningMessage(
        `Are you sure you want to perform a ${action} on ${node.label}? This action cannot be easily undone.`,
        { modal: true },
        confirmText
      );
      return choice === confirmText;
    }

    // Actions that require text input
    if (action === 'branch') {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter new branch name',
        placeHolder: 'feature/my-new-branch',
      });
      if (!name) return false;
      node._tempBranchName = name;
      return true;
    }

    if (action === 'create-tag') {
      const name = await vscode.window.showInputBox({
        prompt: 'Enter tag name',
        placeHolder: 'v1.0.0',
      });
      if (!name) return false;
      const message = await vscode.window.showInputBox({
        prompt: 'Enter tag message (leave empty for lightweight tag)',
        placeHolder: 'Release version 1.0.0',
      });
      node._tempTagName = name;
      node._tempTagMessage = message || undefined;
      return true;
    }

    // All other actions are already confirmed by the webview preview panel
    return true;
  }

  /**
   * Maps the UI action to the underlying GitService method.
   */
  private async executeCommand(action: EdgeKind, node: any): Promise<void> {
    const hash = node.data.hash || node.id;
    const branchName = node.label;

    switch (action) {
      case 'checkout':
        // If it's a remote branch, checkout creates a tracking branch.
        // If it's a commit, it goes into detached HEAD.
        await this.gitService.checkout(node.kind === 'remote-branch' ? branchName.replace('origin/', '') : (node.kind === 'branch' ? branchName : hash));
        break;
      case 'branch':
        await this.gitService.createBranch(node._tempBranchName, hash);
        break;
      case 'delete-branch':
        if (node.kind === 'tag') {
          await this.gitService.deleteTag(branchName);
        } else {
          await this.gitService.deleteBranch(branchName, true);
        }
        break;
      case 'merge':
        await this.gitService.merge(node.kind === 'branch' ? branchName : hash);
        break;
      case 'rebase':
        await this.gitService.rebase(node.kind === 'branch' ? branchName : hash);
        break;
      case 'cherry-pick':
        await this.gitService.cherryPick(hash);
        break;
      case 'revert':
        await this.gitService.revert(hash);
        break;
      case 'reset':
        await this.gitService.reset(hash, 'hard');
        break;
      case 'reset-soft':
        await this.gitService.reset(hash, 'soft');
        break;
      case 'reset-mixed':
        await this.gitService.reset(hash, 'mixed');
        break;
      case 'create-tag':
        await this.gitService.createTag(node._tempTagName, hash, node._tempTagMessage);
        break;
      case 'push':
        await this.gitService.push(node.kind === 'branch' ? branchName : undefined);
        break;
      case 'fetch':
        await this.gitService.fetch();
        break;
      default:
        throw new Error(`Action ${action} is not yet implemented.`);
    }
  }

  private getVerb(action: EdgeKind): string {
    const verbs: Record<string, string> = {
      checkout: 'Checking out',
      branch: 'Creating branch',
      'delete-branch': 'Deleting branch',
      merge: 'Merging',
      rebase: 'Rebasing',
      'cherry-pick': 'Cherry-picking',
      revert: 'Reverting',
      reset: 'Resetting (hard)',
      'reset-soft': 'Resetting (soft)',
      'reset-mixed': 'Resetting (mixed)',
      'create-tag': 'Creating tag',
      push: 'Pushing',
      fetch: 'Fetching',
    };
    return verbs[action] || 'Executing';
  }
}
